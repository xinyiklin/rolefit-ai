// Validation + reconciliation for the structured fields a polish/strict-review
// reply returns (fit scores, missing-skill gaps). Kept separate from the
// provider clients so the response-shaping rules are easy to find and test.

import { findUngroundedJdTerm, isTermGrounded, proseHasUngroundedTerm } from "./grounding.ts";

const EVIDENCE_TYPES = new Set(["exact", "adjacent", "none"]);
const TAILOR_FIELDS = new Set(["bullet", "skill", "titleLeft", "titleRight", "subtitleLeft", "subtitleRight"]);
const TAILOR_RISKS = new Set(["low", "medium", "high"]);

// Boundary types: the tailor scope and model replies are untyped input coerced
// defensively (Array.isArray / clippedString / typeof guards), so their fields
// stay `unknown` and every array is narrowed before iteration.
type TailorScopeInput = { sections?: unknown; contextSections?: unknown } | null | undefined;
// The canonical editable target for a scope field, keyed in the target map.
type ResolvedTarget = {
  target: { sectionId: string; entryId: string; bulletId?: string; field: string };
  currentText: string;
  sectionHeading: string;
};
// One field spec while building the target map (aliases present only for skills).
type EntryTargetSpec = { field: string; aliases?: string[]; text: unknown; bulletId: string };
// Entry-scoped grounding: the section type + that entry's own text (lowercased).
type EntryGrounding = { type: string; text: string };
// dropStats collector: reason -> count.
type DropStats = Record<string, number>;
// Optional entry-scoped grounder for one-click review rewrites.
type RewriteGrounder = (originalText: string) => string;

export function sanitizeMissingRequiredSkills(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const keyword = String(item.keyword ?? item.skill ?? "").trim().slice(0, 120);
      if (!keyword) return null;
      const evidenceType = EVIDENCE_TYPES.has(String(item.evidenceType)) ? String(item.evidenceType) : "none";
      return {
        keyword,
        evidenceType,
        canHonestlyAdd: evidenceType === "exact" ? Boolean(item.canHonestlyAdd) : false,
        reason: String(item.reason ?? item.evidence ?? "").trim().slice(0, 300)
      };
    })
    .filter(Boolean)
    .slice(0, 8);
}

export function clippedString(value: unknown, max: number): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function containsStructuredMarkup(value: unknown): boolean {
  const text = String(value ?? "");
  if (/[\r\n]/.test(text)) return true;
  if (/\\(?:begin|end|section|subsection|item|href)\b/i.test(text)) return true;
  // The structured editor's own inline-mark vocabulary — exactly <b>/<i>/<u>,
  // no attributes — is legal bullet content: a .tex \textbf span round-trips
  // through the editor as <b>, so most formatted resumes carry these tokens in
  // currentText and a faithful suggestion echoes them. Strip the exact mark
  // tokens before scanning for real smuggled HTML (anything with attributes,
  // other tags, or scripts still rejects).
  return /<\/?[a-z][^>]*>/i.test(text.replace(/<\/?(?:b|i|u)>/gi, ""));
}

function targetKey(target: Record<string, unknown> | null | undefined): string {
  if (!target || typeof target !== "object") return "";
  const sectionId = clippedString(target.sectionId, 120);
  const entryId = clippedString(target.entryId, 120);
  const bulletId = clippedString(target.bulletId, 120);
  const field = clippedString(target.field, 40);
  return [sectionId, entryId, bulletId, field].join("::");
}

// Flatten read-only context ("Include") sections into one text blob for
// grounding ONLY. They are never added to the target map below — that is what
// keeps them read-only — but their text is legitimate on-resume evidence, so a
// tailored claim citing a real fact from (say) Education must not drop as
// ungrounded.
function contextSectionsText(scope: TailorScopeInput): string {
  if (!scope || !Array.isArray(scope.contextSections)) return "";
  const parts = [];
  for (const section of scope.contextSections) {
    parts.push(section.heading ?? "");
    for (const entry of section.entries ?? []) {
      parts.push(entry.titleLeft, entry.titleRight, entry.subtitleLeft, entry.subtitleRight);
      for (const bullet of entry.bullets ?? []) parts.push(bullet.text);
    }
  }
  return parts.filter(Boolean).join("\n");
}

// Reads scope.sections ONLY — never scope.contextSections. This is the structural
// guarantee that read-only "Include" sections can never become editable targets:
// a suggestion against a context section finds no entry here and is dropped as
// "unknownTarget". Do not fold contextSections in.
function buildTailorTargetMap(scope: TailorScopeInput): Map<string, ResolvedTarget> {
  const targets = new Map<string, ResolvedTarget>();
  if (!scope || !Array.isArray(scope.sections)) return targets;
  for (const section of scope.sections) {
    const sectionId = clippedString(section?.id, 120);
    const sectionHeading = clippedString(section?.heading, 120);
    const type = section?.type === "skills" ? "skills" : section?.type === "summary" ? "summary" : "standard";
    if (!sectionId || !Array.isArray(section?.entries)) continue;
    for (const entry of section.entries) {
      const entryId = clippedString(entry?.id, 120);
      if (!entryId) continue;
      const entryTargets: EntryTargetSpec[] = type === "skills"
        ? [
            // A skills row's list lives in the `subtitleLeft` property of the
            // scope JSON, and the prompt lists BOTH "skill" and "subtitleLeft"
            // as valid fields — so a model routinely targets it as "subtitleLeft"
            // (the literal property name it reads). Register both field names as
            // aliases for the one canonical "skill" target so that targeting
            // resolves instead of dropping as unknownTarget (which left the
            // changeSummary claiming a skills edit the resume never received).
            { field: "skill", aliases: ["subtitleLeft"], text: entry.subtitleLeft ?? entry.skills ?? "", bulletId: "" },
            { field: "titleLeft", text: entry.titleLeft ?? "", bulletId: "" }
          ]
        : type === "summary"
        // Summary rows have no meaningful heading slots — only their paragraph
        // bullets (added below) are valid targets.
        ? []
        : [
            { field: "titleLeft", text: entry.titleLeft ?? "", bulletId: "" },
            { field: "titleRight", text: entry.titleRight ?? "", bulletId: "" },
            { field: "subtitleLeft", text: entry.subtitleLeft ?? "", bulletId: "" },
            { field: "subtitleRight", text: entry.subtitleRight ?? "", bulletId: "" }
          ];
      for (const item of entryTargets) {
        // One canonical target object, shared by every field alias below, so the
        // emitted suggestion always carries the canonical field (e.g. "skill",
        // never "subtitleLeft") and the seen-set can dedup aliases to one entry.
        const resolved = {
          target: { sectionId, entryId, field: item.field },
          currentText: clippedString(item.text, 1200),
          sectionHeading
        };
        for (const field of [item.field, ...(item.aliases ?? [])]) {
          targets.set([sectionId, entryId, item.bulletId, field].join("::"), resolved);
        }
      }
      if (Array.isArray(entry.bullets)) {
        for (const bullet of entry.bullets) {
          const bulletId = clippedString(bullet?.id, 120);
          if (!bulletId) continue;
          const key = [sectionId, entryId, bulletId, "bullet"].join("::");
          targets.set(key, {
            target: { sectionId, entryId, bulletId, field: "bullet" },
            currentText: clippedString(bullet?.text, 1200),
            sectionHeading
          });
        }
      }
    }
  }
  return targets;
}

// Structural diagnostic: the list of valid target keys for a scope, so an
// all-drop log can show how the model's emitted targets diverge from the real
// ones. Keys are ids+field only — no resume text.
export function tailorTargetKeys(scope: TailorScopeInput): string[] {
  return [...buildTailorTargetMap(scope).keys()];
}

// Entry-scoped grounding map for the anti-misattribution gate. For each entry it
// records the section TYPE and that entry's OWN text (title/subtitle rows + every
// bullet) joined with the user's honest context, lowercased. STANDARD
// project/experience targets ground against this entry-local text only — so a
// real skill the candidate lists in Skills, or used in a DIFFERENT entry, cannot
// be relocated onto a project that never used it (the "Python/Node adapter" on a
// pure-Node project failure). Skills-row and summary targets deliberately skip
// this and keep the whole-scope corpus (listing a skill you have, or summarizing
// the whole resume, is legitimately corpus-level). Honest context is the escape
// hatch: a tool a project genuinely used but the bullet never named can still be
// attested there.
function buildEntryGroundingMap(scope: TailorScopeInput, honestContext: unknown): Map<string, EntryGrounding> {
  const map = new Map<string, EntryGrounding>();
  if (!scope || !Array.isArray(scope.sections)) return map;
  const honest = String(honestContext ?? "");
  for (const section of scope.sections) {
    const sectionId = clippedString(section?.id, 120);
    const type = section?.type === "skills" ? "skills" : section?.type === "summary" ? "summary" : "standard";
    if (!sectionId || !Array.isArray(section?.entries)) continue;
    for (const entry of section.entries) {
      const entryId = clippedString(entry?.id, 120);
      if (!entryId) continue;
      const parts = [entry?.titleLeft, entry?.titleRight, entry?.subtitleLeft, entry?.subtitleRight];
      if (Array.isArray(entry?.bullets)) for (const bullet of entry.bullets) parts.push(bullet?.text);
      const text = `${parts.filter(Boolean).join("\n")}\n${honest}`.toLowerCase();
      map.set(`${sectionId}::${entryId}`, { type, text });
    }
  }
  return map;
}

// dropStats (optional) collects WHY suggestions were rejected, keyed by reason.
// The route logs it (shape-only, no resume text) when a reply's suggestions all
// die in sanitization — a silent all-drop looks identical to "the model had
// nothing to say" and is otherwise undebuggable.
// honestContext (optional) joins the scope text as grounding for the keyword
// checks below; jobText (optional) marks which terms count as JD-sourced.
export function sanitizeTailorSuggestions(
  raw: unknown,
  scope: TailorScopeInput,
  dropStats?: DropStats,
  honestContext?: unknown,
  jobText?: unknown
) {
  if (!Array.isArray(raw)) return [];
  const targets = buildTailorTargetMap(scope);
  if (!targets.size) return [];
  const jobLower = String(jobText ?? "").toLowerCase();
  // Whole-scope corpus grounding: every current field text in the scope + the
  // read-only context sections + the user's honest context. Used for SKILLS-row
  // and SUMMARY targets, where naming a skill the candidate has anywhere (or
  // summarizing the whole resume) is honest. The evidence field is model prose
  // and can launder an inferred fact ("clinics run Windows"); the source text
  // cannot conjure the term.
  const corpusGrounding = [
    // new Set collapses the field aliases (which share one target object) so a
    // skills row's text appears once, not once per alias.
    ...[...new Set(targets.values())].map((t) => t.currentText),
    contextSectionsText(scope),
    String(honestContext ?? "")
  ].join("\n").toLowerCase();
  // Entry-scoped grounding for STANDARD project/experience targets: a tech term
  // added to a project bullet must be evidenced by THAT entry's own text or
  // honest context — not the skills section or a sibling entry. Closes the
  // misattribution hole corpus grounding structurally cannot see.
  const entryGrounding = buildEntryGroundingMap(scope, honestContext);
  const seen = new Set();
  const output = [];
  const drop = (reason: string): void => {
    if (dropStats) dropStats[reason] = (dropStats[reason] ?? 0) + 1;
  };
  for (const item of raw) {
    if (!item || typeof item !== "object") { drop("notObject"); continue; }
    const rawTarget = item.target && typeof item.target === "object" ? item.target : item;
    const field = clippedString(rawTarget.field ?? item.field, 40);
    if (!TAILOR_FIELDS.has(field)) { drop("badField"); continue; }
    // bulletId is only meaningful for field "bullet"; the target map keys every
    // non-bullet field (skill, titleLeft/Right, subtitleLeft/Right) with "".
    // A model that attaches a stray or invented bulletId to a non-bullet target
    // — observed on skills-row adds, where the summary claimed the edit but the
    // suggestion silently dropped as unknownTarget — would otherwise never match.
    // Normalize it out so the target resolves on (sectionId, entryId, field).
    const bulletId = field === "bullet" ? (rawTarget.bulletId ?? item.bulletId) : "";
    const key = targetKey({
      sectionId: rawTarget.sectionId ?? item.sectionId,
      entryId: rawTarget.entryId ?? item.entryId,
      bulletId,
      field
    });
    const allowed = targets.get(key);
    if (!allowed) { drop("unknownTarget"); continue; }
    // Dedup on the canonical target OBJECT, not the model's field name: every
    // field alias for one resume field shares a single `allowed` object (a skills
    // row reached via both "skill" and its "subtitleLeft" alias, say), so identity
    // dedup collapses them to one suggestion — and a true duplicate target
    // resolves to that same object too.
    if (seen.has(allowed)) { drop("duplicateTarget"); continue; }
    const rawProposedText = item.proposedText ?? item.rewrite ?? item.text;
    const proposedText = clippedString(rawProposedText, 1400);
    if (!proposedText || proposedText === allowed.currentText) { drop("emptyOrUnchanged"); continue; }
    const evidenceType = EVIDENCE_TYPES.has(String(item.evidenceType)) ? String(item.evidenceType) : "none";
    // Proposed edits must be directly supportable by resume or honest-context
    // evidence. Adjacent/none gaps belong in missingRequiredSkills, not in an
    // applyable change.
    if (evidenceType !== "exact") { drop("nonExactEvidence"); continue; }
    const evidence = clippedString(item.evidence, 280);
    // Placeholder evidence ("n/a", "none", a dash) is how a model ships an
    // ungrounded edit while technically filling the field.
    if (!evidence || evidence.length < 8 || /^(n\/?a|none|unknown|todo|-+|\.+)$/i.test(evidence)) {
      drop("missingEvidence");
      continue;
    }
    if (containsStructuredMarkup(rawProposedText)) { drop("structuredMarkup"); continue; }
    const risk = TAILOR_RISKS.has(String(item.risk)) ? String(item.risk) : "medium";
    const hits = Array.isArray(item.hits)
      ? (item.hits as unknown[]).map((hit) => clippedString(hit, 80)).filter(Boolean).slice(0, 6)
      : [];
    // Hit-keyword grounding: if a claimed JD keyword was written into the
    // proposed text but none of its significant words exist anywhere in the
    // scope or honest context, the "exact evidence" is inferred, not real
    // (e.g. resume says "EHR migration at a clinic", model writes "on Windows
    // clinic workstations" because clinics plausibly run Windows). Wholly-new
    // terms are the dangerous fabrication class; partial overlaps are left to
    // the prompt rules and human review.
    // Grounding source for THIS target: STANDARD entries use their own entry text
    // (+ honest context) so a skill from Skills or another entry cannot be
    // misattributed here; skills/summary (and any unmapped target) use the corpus.
    const entryInfo = entryGrounding.get(`${allowed.target.sectionId}::${allowed.target.entryId}`);
    const grounding = entryInfo && entryInfo.type === "standard" ? entryInfo.text : corpusGrounding;
    const proposedLower = proposedText.toLowerCase();
    const ungroundedHit = hits.some((kw) => {
      const words = (kw.toLowerCase().match(/[a-z0-9.#+]{3,}/g) ?? []);
      if (!words.length) return false;
      // Only a hit actually written INTO the proposal is a fabrication risk; a
      // merely-reported hit is fine.
      const inProposed = words.some((w) => proposedLower.includes(w));
      if (!inProposed) return false;
      // Alias/inflection-aware grounding — the SAME discipline findUngroundedJdTerm
      // uses below — so an entry that spells a tech in its short/alias form (k8s,
      // postgres, ts) still grounds a hit naming the long form (Kubernetes,
      // PostgreSQL, TypeScript). A raw substring check here false-dropped honest
      // edits once grounding narrowed to a single entry's text.
      return !isTermGrounded(kw, grounding);
    });
    if (ungroundedHit) { drop("ungroundedKeyword"); continue; }
    // JD-term grounding on the proposed text itself — the hits check above is
    // evadable by omitting the keyword from hits (observed live: "Linux" written
    // into a bullet with hits: [] and evidence "n/a"). Capitalized tokens and
    // lowercase tech-concept terms that appear in the JD must already exist in
    // the scope or honest context; see grounding.mjs.
    if (findUngroundedJdTerm(proposedText, jobLower, grounding)) {
      drop("ungroundedJdTerm");
      continue;
    }
    output.push({
      id: clippedString(item.id, 120) || `suggestion-${output.length + 1}`,
      target: allowed.target,
      sectionHeading: allowed.sectionHeading,
      currentText: allowed.currentText,
      proposedText,
      reason: clippedString(item.reason, 280),
      evidenceType,
      evidence,
      hits,
      risk
    });
    seen.add(allowed);
    if (output.length >= 12) break;
  }
  return output;
}

// Drop reasons that mean a suggestion was UNSUPPORTED by the resume/evidence —
// the anti-fabrication catches — as opposed to benign shape drops (duplicate,
// unchanged, mis-targeted id, smuggled markup). Surfacing the unsupported count
// lets the UI show "N edits withheld" so a caught fabrication doesn't look
// identical to a clean "nothing to suggest" pass.
const UNSUPPORTED_DROP_REASONS = new Set([
  "nonExactEvidence", "missingEvidence", "ungroundedKeyword", "ungroundedJdTerm"
]);

// Summarize the sanitizer's dropStats (reason -> count) into a client-safe object
// (counts only, never suggestion text). Returns null when nothing was dropped so
// the UI can distinguish a caught-fabrication from a genuinely empty result.
export function summarizeDroppedSuggestions(dropStats: unknown) {
  if (!dropStats || typeof dropStats !== "object") return null;
  let total = 0;
  let unsupported = 0;
  for (const [reason, count] of Object.entries(dropStats)) {
    const n = Number(count) || 0;
    if (n <= 0) continue;
    total += n;
    if (UNSUPPORTED_DROP_REASONS.has(reason)) unsupported += n;
  }
  if (total <= 0) return null;
  return { total, unsupported, reasons: { ...dropStats } };
}

// Strict-review enums, mirrored from the strict-review prompt + the client's
// StrictReview type in src/resume/types.ts. The client dereferences fields like
// sr.verdict.replace(...) and gap.severity.toLowerCase() directly, so every value
// must be a known string and every array must exist. (The user-visible coverage
// table's status enum is coerced separately, when scoring.mjs'
// displayCoverageFromRequirements derives it — see COVERAGE_STATUSES below.)
const VERDICTS = new Set(["STRONG FIT", "REASONABLE FIT", "STRETCH", "DON'T APPLY"]);
const GAP_SEVERITIES = new Set(["BLOCKER", "HIGH", "MEDIUM", "LOW"]);
// Exported so the split-out scoring module (scoring.mjs) grounds requirement
// coverage against the same coverage-status vocabulary.
export const COVERAGE_STATUSES = new Set(["covered", "missing", "adjacent"]);

export function enumValue(value: unknown, allowed: Set<string>, fallback: string): string {
  const candidate = String(value ?? "").trim().toUpperCase();
  // Verdicts/severities are upper-case; coverage status + evidenceType are
  // lower-case, so match against the set in its own case.
  if (allowed.has(candidate)) return candidate;
  const lower = String(value ?? "").trim().toLowerCase();
  if (allowed.has(lower)) return lower;
  return fallback;
}

// Per-rewrite grounder for the strict-review "apply rewrite" path. A review
// rewrite carries only original/rewrite text (no target id), yet the client
// applies it one-click into the bullet whose text matches `original`
// (ReviewRail findBullet). Corpus grounding there let the REVIEW pass re-inject
// the exact misattribution the tailor gate now drops (e.g. "Python/Node" onto a
// pure-Node bullet, grounded by a Skills-row "Python"). This matches the
// rewrite's `original` back to the STANDARD entry that contains it and grounds
// against THAT entry's own text + honest context. Falls back to the whole-corpus
// grounding when the original matches no standard entry (a reworded quote, a
// skills/summary target, or no scope) so behavior is never stricter than today
// for unmatched rewrites. Returns a function (originalText) => lowercased
// grounding string, ready for findUngroundedJdTerm's pre-lowercased contract.
export function makeRewriteGrounder(scope: TailorScopeInput, honestContext: unknown, corpusGrounding: unknown): RewriteGrounder {
  const entryGrounding = buildEntryGroundingMap(scope, honestContext);
  const corpusLower = String(corpusGrounding ?? "").toLowerCase();
  // Mirror the client's ReviewRail `normalize` EXACTLY: stripInlineMarks removes
  // <b>/<i>/<u> to "" (NOT to a space), then collapse whitespace + trim +
  // lowercase. This must match so the server grounds against the SAME bullet the
  // client will apply the rewrite to (its findBullet uses exact normalized bullet
  // equality).
  const norm = (t: unknown): string => String(t ?? "").replace(/<\/?(?:b|i|u)>/gi, "").replace(/\s+/g, " ").trim().toLowerCase();
  // Index each STANDARD-entry BULLET by its normalized text -> that entry's
  // grounding text, matching the client's findBullet (exact normalized equality,
  // first match). A substring match over the whole entry blob mis-routes: if
  // entry A's bullet contains entry B's shorter bullet as a substring and A
  // carries a JD tech B lacks, the server would ground against A while the client
  // applies to B — landing the fabrication on B. Bullet texts that normalize
  // identically across DIFFERENT entries are AMBIGUOUS (the client picks first; we
  // cannot know which) and fall back to corpus rather than risk grounding a
  // fabrication against the wrong entry.
  const bulletGrounding = new Map<string, string>();
  const ambiguous = new Set<string>();
  if (scope && Array.isArray(scope.sections)) {
    for (const section of scope.sections) {
      const type = section?.type === "skills" ? "skills" : section?.type === "summary" ? "summary" : "standard";
      const sectionId = clippedString(section?.id, 120);
      if (type !== "standard" || !sectionId || !Array.isArray(section?.entries)) continue;
      for (const entry of section.entries) {
        const entryId = clippedString(entry?.id, 120);
        const info = entryId ? entryGrounding.get(`${sectionId}::${entryId}`) : null;
        if (!info || !Array.isArray(entry?.bullets)) continue;
        for (const bullet of entry.bullets) {
          const key = norm(bullet?.text);
          if (!key) continue;
          const prior = bulletGrounding.get(key);
          if (prior && prior !== info.text) ambiguous.add(key);
          else bulletGrounding.set(key, info.text);
        }
      }
    }
  }
  return (originalText: string): string => {
    const needle = norm(originalText);
    if (needle && !ambiguous.has(needle)) {
      const grounding = bulletGrounding.get(needle);
      if (grounding) return grounding;
    }
    return corpusLower;
  };
}

// Validate and clamp the strict-review object before it reaches the client.
// Returns null for non-objects so the UI simply omits the review pane. Every
// field the client reads is forced to a safe type, enums fall back to a known
// value, arrays are capped, and rewrite/suggestedEdit text that smuggles
// LaTeX/HTML/newlines is dropped via the same containsStructuredMarkup gate the
// applyable tailor suggestions use.
//
// jobText + grounding gate the APPLYABLE rewrite/suggestedEdit text through the
// same findUngroundedJdTerm check the tailor path uses: a one-click rewrite is
// written straight into a resume bullet, so a JD skill it introduces that is
// absent from the polished resume + honest context is fabrication. An ungrounded
// rewrite is dropped entirely; an ungrounded suggestedEdit is blanked (the gap
// itself still shows, just without the unsupported paste-ready copy).
export function sanitizeStrictReview(
  raw: unknown,
  jobText: string = "",
  grounding: string = "",
  options: { rewriteGrounder?: RewriteGrounder } = {}
) {
  if (!raw || typeof raw !== "object") return null;
  // Model output: read fields defensively off a record view (never validated).
  const src = raw as Record<string, unknown>;
  const jobLower = String(jobText ?? "").toLowerCase();
  const groundingLower = String(grounding ?? "").toLowerCase();
  // Optional entry-scoped grounder for one-click rewrites (see makeRewriteGrounder);
  // absent (2-3 arg callers, e.g. probes) -> corpus grounding, unchanged behavior.
  const rewriteGrounder = typeof options.rewriteGrounder === "function" ? options.rewriteGrounder : null;

  // The user-visible coverage table is no longer read from the model here: it is
  // DERIVED from the reviewer's requirementCoverage rows by
  // displayCoverageFromRequirements (scoring.mjs) and attached to the result by the
  // /api/polish route, so the display table can't diverge from the scored evidence.

  const gaps = (Array.isArray(src.gaps) ? src.gaps : [])
    .map((gap) => {
      if (!gap || typeof gap !== "object") return null;
      const gapText = clippedString(gap.gap, 300);
      if (!gapText) return null;
      let suggestedEdit = clippedString(gap.suggestedEdit, 1400);
      // A suggestedEdit is rendered as inline copy the user may paste into a
      // bullet; blank smuggled markup the same way tailor suggestions do.
      // Keep the gap itself so a malformed paste-ready edit cannot hide a
      // HIGH/BLOCKER gap from the review pane or score caps.
      if (suggestedEdit && containsStructuredMarkup(gap.suggestedEdit)) suggestedEdit = "";
      // Blank a paste-ready edit that introduces an ungrounded JD skill term —
      // the gap stays visible, but we don't hand the user unsupported copy.
      if (suggestedEdit && findUngroundedJdTerm(suggestedEdit, jobLower, groundingLower)) suggestedEdit = "";
      const evidenceType = EVIDENCE_TYPES.has(String(gap.evidenceType)) ? String(gap.evidenceType) : "none";
      return {
        gap: gapText,
        severity: enumValue(gap.severity, GAP_SEVERITIES, "MEDIUM"),
        evidenceType,
        canHonestlyAdd: evidenceType === "exact" ? Boolean(gap.canHonestlyAdd) : false,
        evidence: clippedString(gap.evidence, 300),
        suggestedEdit
      };
    })
    // Typed predicate (erasable) drops the map's null members from the type too.
    .filter((gap): gap is NonNullable<typeof gap> => Boolean(gap))
    .slice(0, 8);

  const rewrites = (Array.isArray(src.rewrites) ? src.rewrites : [])
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const original = clippedString(item.original, 1400);
      const rewrite = clippedString(item.rewrite, 1400);
      if (!original || !rewrite) return null;
      // The client offers a one-click "apply" of rewrite text into the resume;
      // it must be plain prose, never LaTeX/HTML/multi-line markup.
      if (containsStructuredMarkup(item.rewrite)) return null;
      // Same JD-term grounding the tailor path enforces: a rewrite is applied
      // directly into a bullet, so an ungrounded JD skill in it is fabrication.
      // Ground against the STANDARD entry this rewrite targets (matched via its
      // `original`) so the review path can't reintroduce a misattribution the
      // tailor gate drops; corpus fallback for unmatched originals.
      const rewriteGrounding = rewriteGrounder ? rewriteGrounder(original) : groundingLower;
      if (findUngroundedJdTerm(rewrite, jobLower, rewriteGrounding)) return null;
      // `hits` render as "✓ <keyword>" chips claiming this rewrite now COVERS
      // those JD keywords. The rewrite TEXT is grounded above, but the claimed
      // matches were not — a model could leave the text nearly unchanged and
      // stamp fabricated ✓ coverage (the tailor path grounds its hits for the
      // same anti-fab reason; this review path did not). Keep a hit only when
      // the rewrite text actually surfaces it AND it is grounded in the resume/
      // honest context — dropping the individual false chip, not the honest
      // rewrite. isTermGrounded is token-anchored (alias/inflection/phrase-aware,
      // short-token safe: Go, CI/CD, k8s↔kubernetes). Known safe-direction limit:
      // a MULTI-WORD hit whose wording differs from the text by a plural or word
      // order (isGrounded's phrase branch is a literal substring) drops that one
      // chip — it under-credits, never fabricates; the rewrite still shows.
      const hits = (Array.isArray(item.hits) ? (item.hits as unknown[]) : [])
        .map((hit) => clippedString(hit, 80))
        .filter(Boolean)
        .filter((kw) => isTermGrounded(kw, rewrite) && isTermGrounded(kw, rewriteGrounding))
        .slice(0, 6);
      return { original, rewrite, hits };
    })
    // Typed predicate (erasable) drops the map's null members from the type too.
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .slice(0, 4);

  // Advisory prose surfaces (riskFlags[].suggestion, recommendation.topEdits[],
  // recommendation.coverLetterAngle) are model free text the user reads as
  // guidance; a JD skill term they name that is absent from the polished resume +
  // honest context is fabrication the same way an ungrounded rewrite is. Run each
  // through the prose-mode findUngroundedJdTerm backstop used for suggestedEdit:
  // company/role proper nouns are allowed (proseMode skips the capitalized-token
  // detector), but curated branded tools / lowercase tech concepts still gate.
  // On a flagged term, BLANK the string (or DROP the topEdits item) — never drop
  // the whole parent object, so an honest risk flag or recommendation still
  // shows. verdictReason is deliberately NOT grounded here (the route owns it).
  // Thin local alias over the shared prose-grounding predicate (jobLower/
  // groundingLower are already lower-cased above).
  const proseIsUngrounded = (text: unknown) => proseHasUngroundedTerm(text, jobLower, groundingLower);

  const riskFlags = (Array.isArray(src.riskFlags) ? src.riskFlags : [])
    .map((flag) => {
      if (!flag || typeof flag !== "object") return null;
      const risk = clippedString(flag.risk, 300);
      if (!risk) return null;
      let suggestion = clippedString(flag.suggestion, 300);
      if (proseIsUngrounded(suggestion)) suggestion = "";
      return {
        bullet: clippedString(flag.bullet, 300),
        risk,
        suggestion
      };
    })
    // Typed predicate (erasable) drops the map's null members from the type too.
    .filter((flag): flag is NonNullable<typeof flag> => Boolean(flag))
    .slice(0, 3);

  const rawRec = (src.recommendation && typeof src.recommendation === "object" ? src.recommendation : {}) as Record<string, unknown>;
  let coverLetterAngle = clippedString(rawRec.coverLetterAngle, 1400);
  if (proseIsUngrounded(coverLetterAngle)) coverLetterAngle = "";
  const recommendation = {
    applyAsIs: Boolean(rawRec.applyAsIs),
    reason: clippedString(rawRec.reason, 300),
    topEdits: (Array.isArray(rawRec.topEdits) ? rawRec.topEdits : [])
      .map((edit) => clippedString(edit, 300))
      .filter(Boolean)
      .filter((edit) => !proseIsUngrounded(edit))
      .slice(0, 3),
    coverLetterAngle
  };

  return {
    verdict: enumValue(src.verdict, VERDICTS, "STRETCH"),
    verdictReason: clippedString(src.verdictReason, 300),
    gaps,
    rewrites,
    riskFlags,
    recommendation
  };
}

export function missingRequiredSkillsFromStrictReview(strictReview: { gaps?: unknown } | null | undefined) {
  if (!strictReview || !Array.isArray(strictReview.gaps)) return [];
  return sanitizeMissingRequiredSkills(
    strictReview.gaps.map((gap) => ({
      keyword: gap.gap,
      evidenceType: gap.evidenceType,
      canHonestlyAdd: gap.canHonestlyAdd,
      reason: gap.evidence || gap.suggestedEdit
    }))
  );
}
