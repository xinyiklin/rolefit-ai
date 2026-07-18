// Validation + reconciliation for the structured fields a polish/strict-review
// reply returns (fit scores, missing-skill gaps). Kept separate from the
// provider clients so the response-shaping rules are easy to find and test.

import {
  findUngroundedClaimTerm,
  findUngroundedJdTerm,
  isClaimTermGroundedInSource,
  isTermGrounded,
  proseHasUngroundedTerm
} from "./grounding.ts";

const EVIDENCE_TYPES = new Set(["exact", "adjacent", "none"]);
const TAILOR_FIELDS = new Set(["bullet", "skill", "titleLeft", "titleRight", "subtitleLeft", "subtitleRight"]);
const TAILOR_RISKS = new Set(["low", "medium", "high"]);
const GAP_BOILERPLATE = new Set([
  "candidate", "experience", "gap", "knowledge", "lack", "lacks", "missing",
  "must", "no", "proficiency", "required", "requirement", "skill", "skills"
]);

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

export function sanitizeMissingRequiredSkills(raw: unknown, jobText: unknown = "", grounding: unknown = "") {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const keyword = String(item.keyword ?? item.skill ?? "").trim().slice(0, 120);
      if (!keyword) return null;
      if (String(jobText ?? "").trim() && !isClaimTermGroundedInSource(keyword, jobText)) return null;
      let evidenceType = EVIDENCE_TYPES.has(String(item.evidenceType)) ? String(item.evidenceType) : "none";
      const reason = String(item.reason ?? item.evidence ?? "").trim().slice(0, 300);
      const groundedExact = evidenceType === "exact"
        && isClaimTermGroundedInSource(keyword, grounding)
        && evidenceIsGrounded(reason, grounding);
      if (evidenceType === "exact" && !groundedExact) evidenceType = "none";
      return {
        keyword,
        evidenceType,
        canHonestlyAdd: groundedExact ? item.canHonestlyAdd === true : false,
        reason: evidenceType === "exact" || /\b(?:no evidence|not in (?:the )?resume|missing|unsupported)\b/i.test(reason)
          ? reason
          : ""
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
  // no attributes — is legal bullet content: bold/italic/underline spans surface
  // in the editor as <b>/<i>/<u>, so most formatted resumes carry these tokens in
  // currentText and a faithful suggestion echoes them. Strip the exact mark
  // tokens before scanning for real smuggled HTML (anything with attributes,
  // other tags, or scripts still rejects).
  return /<\/?[a-z][^>]*>/i.test(text.replace(/<\/?(?:b|i|u)>/gi, ""));
}

const EVIDENCE_BOILERPLATE = new Set([
  "according", "all", "and", "already", "attests", "bullet", "bullets", "context", "entry", "evidence",
  "exact", "honest", "list", "listed", "lists", "project", "projects", "quote", "quotes",
  "resume", "role", "row", "says", "section", "shows", "skills", "states", "the", "three", "tool",
  "tools", "used", "uses", "using"
]);

function evidenceIsGrounded(value: unknown, grounding: unknown): boolean {
  const tokens = (String(value ?? "").toLowerCase().match(/[a-z0-9.#+]{3,}/g) ?? [])
    .filter((token) => !EVIDENCE_BOILERPLATE.has(token));
  if (!tokens.length) return false;
  const grounded = tokens.filter((token) => isTermGrounded(token, grounding)).length;
  return grounded === tokens.length;
}

function sameClaimTokenSet(left: unknown, right: unknown): boolean {
  const tokens = (value: unknown) => [...new Set(
    (String(value ?? "").toLowerCase().match(/[a-z0-9.#+]+/g) ?? [])
  )].sort().join("|");
  return tokens(left) === tokens(right);
}

function numericClaimTokens(value: unknown): string[] {
  return [...new Set((String(value ?? "").match(/\d[\d,_]*(?:\.\d+)?/g) ?? [])
    .map((token) => token.replace(/[, _]/g, "").replace(/^0+(?=\d)/, ""))
    .filter(Boolean))];
}

export function hasUngroundedNumericClaim(value: unknown, grounding: unknown): boolean {
  const grounded = new Set(numericClaimTokens(grounding));
  return numericClaimTokens(value).some((token) => !grounded.has(token));
}

function gapIsGroundedInJob(value: unknown, jobText: unknown): boolean {
  const tokens = [...new Set((String(value ?? "").toLowerCase().match(/\.net\b|[a-z0-9][a-z0-9.#+]*/g) ?? [])
    .filter((token) => !GAP_BOILERPLATE.has(token)))];
  if (!tokens.length) return false;
  return tokens.every((token) => isClaimTermGroundedInSource(token, jobText));
}

function gapClaimIsGrounded(value: unknown, grounding: unknown): boolean {
  const tokens = [...new Set((String(value ?? "").toLowerCase().match(/\.net\b|[a-z0-9][a-z0-9.#+]*/g) ?? [])
    .filter((token) => !GAP_BOILERPLATE.has(token)))];
  return tokens.length > 0 && tokens.every((token) => isClaimTermGroundedInSource(token, grounding));
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
    // Resolve the grounding corpus before validating model-authored evidence.
    // STANDARD entries are entry-local; skills/summary use the whole resume
    // scope. This is the same attribution boundary used by the term gates.
    const entryInfo = entryGrounding.get(`${allowed.target.sectionId}::${allowed.target.entryId}`);
    const grounding = entryInfo && entryInfo.type === "standard" ? entryInfo.text : corpusGrounding;
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
    // A pure reorder of the same skills/words introduces no new factual claim;
    // allow its locator-style evidence. Any substantive rewrite needs evidence
    // whose distinctive terms actually overlap the entry/honest-context corpus.
    if (!sameClaimTokenSet(proposedText, allowed.currentText) && !evidenceIsGrounded(evidence, grounding)) {
      drop("ungroundedEvidence");
      continue;
    }
    if (containsStructuredMarkup(rawProposedText)) { drop("structuredMarkup"); continue; }
    const risk = TAILOR_RISKS.has(String(item.risk)) ? String(item.risk) : "medium";
    // `hits` render as covered-keyword chips. Keep a claim only when the term is
    // actually present (alias/inflection aware) in all three owning sources:
    // the job posting, this proposed rewrite, and this target entry/honest
    // context. A model may not stamp a harmless rewrite with unrelated coverage
    // (the prior sanitizer explicitly allowed that false-positive chip).
    const hits = (Array.isArray(item.hits) ? (item.hits as unknown[]) : [])
      .map((hit) => clippedString(hit, 80))
      .filter(Boolean)
      .filter((kw) =>
        isTermGrounded(kw, jobText)
        && isTermGrounded(kw, proposedText)
        && isTermGrounded(kw, grounding)
      )
      .slice(0, 6);
    // JD-term grounding on the proposed text itself — the hits check above is
    // evadable by omitting the keyword from hits (observed live: "Linux" written
    // into a bullet with hits: [] and evidence "n/a"). Capitalized tokens and
    // lowercase tech-concept terms that appear in the JD must already exist in
    // the scope or honest context; see grounding.ts.
    if (findUngroundedJdTerm(proposedText, jobLower, grounding)) {
      drop("ungroundedJdTerm");
      continue;
    }
    // Facts do not become safe merely because they are absent from the JD. Catch
    // newly introduced metrics and known tech/proper-claim terms against the same
    // entry-local evidence corpus. Bracketed metric prompts contain no number and
    // remain allowed; concrete unsupported numbers never do.
    const numericGrounding = `${allowed.currentText}\n${String(honestContext ?? "")}`;
    if (hasUngroundedNumericClaim(proposedText, numericGrounding)) {
      drop("ungroundedNumber");
      continue;
    }
    if (findUngroundedClaimTerm(proposedText, grounding)) {
      drop("ungroundedClaimTerm");
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
  "nonExactEvidence", "missingEvidence", "ungroundedEvidence", "ungroundedKeyword",
  "ungroundedJdTerm", "ungroundedNumber", "ungroundedClaimTerm"
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
// must be a known string and every array must exist.
const VERDICTS = new Set(["STRONG FIT", "REASONABLE FIT", "STRETCH", "DON'T APPLY"]);
const GAP_SEVERITIES = new Set(["BLOCKER", "HIGH", "MEDIUM", "LOW"]);
export const COVERAGE_STATUSES = new Set(["covered", "missing", "adjacent"]);
const COVERAGE_CATEGORIES = new Set(["Required tech", "Required experience", "Required years", "Preferred"]);

export function enumValue(value: unknown, allowed: Set<string>, fallback: string): string {
  const candidate = String(value ?? "").trim().toUpperCase();
  // Verdicts/severities are upper-case; coverage status + evidenceType are
  // lower-case, so match against the set in its own case.
  if (allowed.has(candidate)) return candidate;
  const lower = String(value ?? "").trim().toLowerCase();
  if (allowed.has(lower)) return lower;
  return fallback;
}

function exactEnumValue(value: unknown, allowed: Set<string>): string | null {
  const candidate = String(value ?? "").trim();
  const upper = candidate.toUpperCase();
  if (allowed.has(upper)) return upper;
  const lower = candidate.toLowerCase();
  return allowed.has(lower) ? lower : null;
}

// AI Review owns the fit judgment. The server validates only the response
// contract: both numbers must be finite 0-100 values, and the model-authored
// tailored score must agree with the model-authored verdict's documented band.
// A contradictory reply is unusable and gets retried by the user/provider; the
// server never changes either half to manufacture agreement.
export function sanitizeAiFitScore(raw: unknown, verdict: unknown) {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  if (typeof source.base !== "number" || typeof source.tailored !== "number") return null;
  if (!Number.isFinite(source.base) || !Number.isFinite(source.tailored)) return null;
  if (!Number.isInteger(source.base) || !Number.isInteger(source.tailored)) return null;
  if (source.base < 0 || source.base > 100 || source.tailored < 0 || source.tailored > 100) return null;
  const normalizedVerdict = exactEnumValue(verdict, VERDICTS);
  if (!normalizedVerdict) return null;
  const tailored = source.tailored;
  const inBand =
    normalizedVerdict === "STRONG FIT" ? tailored >= 85 :
    normalizedVerdict === "REASONABLE FIT" ? tailored >= 70 && tailored <= 84 :
    normalizedVerdict === "STRETCH" ? tailored >= 46 && tailored <= 69 :
    tailored <= 45;
  if (!inBand) return null;
  return {
    base: source.base,
    tailored,
    liftReason: clippedString(source.liftReason, 300)
  };
}

// Per-rewrite grounder for the strict-review "apply rewrite" path. A review
// rewrite carries only original/rewrite text (no target id), yet the client
// applies it one-click into the bullet whose text matches `original`
// (ReviewRail findBullet). Corpus grounding there let the REVIEW pass re-inject
// the exact misattribution the tailor gate now drops (e.g. "Python/Node" onto a
// pure-Node bullet, grounded by a Skills-row "Python"). This matches the
// rewrite's `original` back to the STANDARD entry that contains it and grounds
// against THAT entry's own text + honest context. Ambiguous or unmatched text
// fails closed to the original text + honest context: the client applies by text
// match, so corpus grounding could otherwise authorize a fact from the wrong
// entry. Returns a lowercased grounding string ready for findUngroundedJdTerm.
export function makeRewriteGrounder(scope: TailorScopeInput, honestContext: unknown, _corpusGrounding: unknown): RewriteGrounder {
  const entryGrounding = buildEntryGroundingMap(scope, honestContext);
  const honest = String(honestContext ?? "");
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
  // cannot know which) and therefore fail closed rather than grounding a
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
    return `${originalText}\n${honest}`.toLowerCase();
  };
}

// Numeric claims are stricter than technology attribution: a percentage/date/
// count from another bullet in the same role cannot license changing this target
// bullet's metric. Match the rewrite original to its exact current bullet and
// ground numbers against that field plus honest context only.
export function makeRewriteNumericGrounder(scope: TailorScopeInput, honestContext: unknown): RewriteGrounder {
  const honest = String(honestContext ?? "");
  const normalize = (value: unknown): string => String(value ?? "")
    .replace(/<\/?(?:b|i|u)>/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const bullets = new Map<string, string>();
  if (scope && Array.isArray(scope.sections)) {
    for (const section of scope.sections) {
      if (!Array.isArray(section?.entries)) continue;
      for (const entry of section.entries) {
        if (!Array.isArray(entry?.bullets)) continue;
        for (const bullet of entry.bullets) {
          const key = normalize(bullet?.text);
          if (key) bullets.set(key, `${String(bullet?.text ?? "")}\n${honest}`);
        }
      }
    }
  }
  return (originalText: string): string => bullets.get(normalize(originalText)) ?? `${originalText}\n${honest}`;
}

// Validate and clamp the strict-review object before it reaches the client.
// Returns null for non-objects so the UI simply omits the review pane. Every
// field the client reads is forced to a safe type, invalid enum rows are
// dropped rather than converted into model judgments, arrays are capped, and rewrite/suggestedEdit text that smuggles
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
  options: {
    rewriteGrounder?: RewriteGrounder;
    rewriteNumericGrounder?: RewriteGrounder;
    suggestedEditNumericGrounding?: unknown;
  } = {}
) {
  if (!raw || typeof raw !== "object") return null;
  // Model output: read fields defensively off a record view (never validated).
  const src = raw as Record<string, unknown>;
  const verdict = exactEnumValue(src.verdict, VERDICTS);
  if (!verdict) return null;
  const jobLower = String(jobText ?? "").toLowerCase();
  const groundingLower = String(grounding ?? "").toLowerCase();
  // Optional entry-scoped grounder for one-click rewrites (see makeRewriteGrounder);
  // absent (2-3 arg callers, e.g. probes) -> corpus grounding, unchanged behavior.
  const rewriteGrounder = typeof options.rewriteGrounder === "function" ? options.rewriteGrounder : null;
  const rewriteNumericGrounder = typeof options.rewriteNumericGrounder === "function" ? options.rewriteNumericGrounder : null;
  const suggestedEditNumericGrounding = String(options.suggestedEditNumericGrounding ?? "");

  // Coverage is part of the AI review itself. Validate shape and enum values but
  // do not reinterpret, rescore, or downgrade the model's semantic judgment.
  // Invalid rows are omitted instead of being coerced to "missing" (which would
  // silently create a local negative judgment the AI never made).
  const coverage = (Array.isArray(src.coverage) ? src.coverage : [])
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const keyword = clippedString(row.keyword ?? row.requirement, 180);
      const categoryCandidate = clippedString(row.category, 80);
      const category = COVERAGE_CATEGORIES.has(categoryCandidate) ? categoryCandidate : null;
      const status = exactEnumValue(row.status ?? row.tailoredStatus, COVERAGE_STATUSES);
      // A coverage row asserts that `keyword` is a real JD requirement. Validate
      // that claim without changing the AI-owned covered/missing/adjacent status.
      if (!keyword || !category || !status || !gapIsGroundedInJob(keyword, jobText)) return null;
      return {
        category,
        keyword,
        status,
        where: clippedString(row.where ?? row.tailoredEvidence, 300)
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .slice(0, 12);

  const gaps = (Array.isArray(src.gaps) ? src.gaps : [])
    .map((gap) => {
      if (!gap || typeof gap !== "object") return null;
      const gapText = clippedString(gap.gap, 300);
      if (!gapText) return null;
      // Free-form gaps are model claims too. A hallucinated requirement must not
      // reach the UI as if the job actually required it.
      if (!gapIsGroundedInJob(gapText, jobText)) return null;
      const severity = exactEnumValue(gap.severity, GAP_SEVERITIES);
      // Do not synthesize a MEDIUM judgment when the model violates the enum.
      if (!severity) return null;
      let suggestedEdit = clippedString(gap.suggestedEdit, 1400);
      // A suggestedEdit is rendered as inline copy the user may paste into a
      // bullet; blank smuggled markup the same way tailor suggestions do.
      // Keep the gap itself so a malformed paste-ready edit cannot hide an
      // otherwise usable gap from the review pane.
      if (suggestedEdit && containsStructuredMarkup(gap.suggestedEdit)) suggestedEdit = "";
      // Blank a paste-ready edit that introduces an ungrounded JD skill term —
      // the gap stays visible, but we don't hand the user unsupported copy.
      if (suggestedEdit && findUngroundedJdTerm(suggestedEdit, jobLower, groundingLower)) suggestedEdit = "";
      // Gaps have no stable resume target, so an existing number elsewhere in
      // the resume cannot authorize paste-ready metric copy. Only an explicit
      // user attestation in honestContext can ground a newly suggested number.
      if (suggestedEdit && hasUngroundedNumericClaim(suggestedEdit, suggestedEditNumericGrounding)) suggestedEdit = "";
      if (suggestedEdit && findUngroundedClaimTerm(suggestedEdit, groundingLower)) suggestedEdit = "";
      const rawEvidenceType = EVIDENCE_TYPES.has(String(gap.evidenceType)) ? String(gap.evidenceType) : "none";
      let evidence = clippedString(gap.evidence, 300);
      const noEvidence = !evidence || /\b(?:no evidence|not in (?:the )?resume|missing|unsupported)\b/i.test(evidence);
      const supportGrounded = gapClaimIsGrounded(gapText, groundingLower)
        && evidenceIsGrounded(evidence, groundingLower);
      const evidenceType = rawEvidenceType !== "none" && !supportGrounded ? "none" : rawEvidenceType;
      if (!supportGrounded && !noEvidence) evidence = "";
      return {
        gap: gapText,
        severity,
        evidenceType,
        canHonestlyAdd: evidenceType === "exact" && supportGrounded ? gap.canHonestlyAdd === true : false,
        evidence,
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
      const numericGrounding = rewriteNumericGrounder ? rewriteNumericGrounder(original) : rewriteGrounding;
      if (hasUngroundedNumericClaim(rewrite, numericGrounding)) return null;
      if (findUngroundedClaimTerm(rewrite, rewriteGrounding)) return null;
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
  // shows. verdictReason is deliberately NOT rewritten: it explains the AI's
  // own verdict and the server no longer substitutes a deterministic verdict.
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
    applyAsIs: rawRec.applyAsIs === true,
    reason: clippedString(rawRec.reason, 300),
    topEdits: (Array.isArray(rawRec.topEdits) ? rawRec.topEdits : [])
      .map((edit) => clippedString(edit, 300))
      .filter(Boolean)
      .filter((edit) => !proseIsUngrounded(edit))
      .slice(0, 3),
    coverLetterAngle
  };

  return {
    verdict,
    verdictReason: clippedString(src.verdictReason, 300),
    coverage,
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
