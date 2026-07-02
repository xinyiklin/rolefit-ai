// Validation + reconciliation for the structured fields a polish/strict-review
// reply returns (fit scores, missing-skill gaps). Kept separate from the
// provider clients so the response-shaping rules are easy to find and test.

import { findUngroundedJdTerm, isTermGrounded, proseHasUngroundedTerm } from "./grounding.mjs";

const EVIDENCE_TYPES = new Set(["exact", "adjacent", "none"]);
const TAILOR_FIELDS = new Set(["bullet", "skill", "titleLeft", "titleRight", "subtitleLeft", "subtitleRight"]);
const TAILOR_RISKS = new Set(["low", "medium", "high"]);

export function sanitizeMissingRequiredSkills(raw) {
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

function clippedString(value, max) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function containsStructuredMarkup(value) {
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

function targetKey(target) {
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
function contextSectionsText(scope) {
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
function buildTailorTargetMap(scope) {
  const targets = new Map();
  if (!scope || !Array.isArray(scope.sections)) return targets;
  for (const section of scope.sections) {
    const sectionId = clippedString(section?.id, 120);
    const sectionHeading = clippedString(section?.heading, 120);
    const type = section?.type === "skills" ? "skills" : section?.type === "summary" ? "summary" : "standard";
    if (!sectionId || !Array.isArray(section?.entries)) continue;
    for (const entry of section.entries) {
      const entryId = clippedString(entry?.id, 120);
      if (!entryId) continue;
      const entryTargets = type === "skills"
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
export function tailorTargetKeys(scope) {
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
function buildEntryGroundingMap(scope, honestContext) {
  const map = new Map();
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
export function sanitizeTailorSuggestions(raw, scope, dropStats, honestContext, jobText) {
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
  const drop = (reason) => {
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
      ? item.hits.map((hit) => clippedString(hit, 80)).filter(Boolean).slice(0, 6)
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
export function summarizeDroppedSuggestions(dropStats) {
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
// sr.verdict.replace(...), gap.severity.toLowerCase(), and sr.coverage[].status
// directly, so every value must be a known string and every array must exist.
const VERDICTS = new Set(["STRONG FIT", "REASONABLE FIT", "STRETCH", "DON'T APPLY"]);
const GAP_SEVERITIES = new Set(["BLOCKER", "HIGH", "MEDIUM", "LOW"]);
const COVERAGE_STATUSES = new Set(["covered", "missing", "adjacent"]);
const REQUIREMENT_IMPORTANCE = new Set(["critical", "high", "medium", "low"]);

function enumValue(value, allowed, fallback) {
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
export function makeRewriteGrounder(scope, honestContext, corpusGrounding) {
  const entryGrounding = buildEntryGroundingMap(scope, honestContext);
  const corpusLower = String(corpusGrounding ?? "").toLowerCase();
  // Mirror the client's ReviewRail `normalize` EXACTLY: stripInlineMarks removes
  // <b>/<i>/<u> to "" (NOT to a space), then collapse whitespace + trim +
  // lowercase. This must match so the server grounds against the SAME bullet the
  // client will apply the rewrite to (its findBullet uses exact normalized bullet
  // equality).
  const norm = (t) => String(t ?? "").replace(/<\/?(?:b|i|u)>/gi, "").replace(/\s+/g, " ").trim().toLowerCase();
  // Index each STANDARD-entry BULLET by its normalized text -> that entry's
  // grounding text, matching the client's findBullet (exact normalized equality,
  // first match). A substring match over the whole entry blob mis-routes: if
  // entry A's bullet contains entry B's shorter bullet as a substring and A
  // carries a JD tech B lacks, the server would ground against A while the client
  // applies to B — landing the fabrication on B. Bullet texts that normalize
  // identically across DIFFERENT entries are AMBIGUOUS (the client picks first; we
  // cannot know which) and fall back to corpus rather than risk grounding a
  // fabrication against the wrong entry.
  const bulletGrounding = new Map();
  const ambiguous = new Set();
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
  return (originalText) => {
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
export function sanitizeStrictReview(raw, jobText = "", grounding = "", options = {}) {
  if (!raw || typeof raw !== "object") return null;
  const jobLower = String(jobText ?? "").toLowerCase();
  const groundingLower = String(grounding ?? "").toLowerCase();
  // Optional entry-scoped grounder for one-click rewrites (see makeRewriteGrounder);
  // absent (2-3 arg callers, e.g. probes) -> corpus grounding, unchanged behavior.
  const rewriteGrounder = typeof options.rewriteGrounder === "function" ? options.rewriteGrounder : null;

  const coverage = (Array.isArray(raw.coverage) ? raw.coverage : [])
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const keyword = clippedString(row.keyword, 120);
      if (!keyword) return null;
      return {
        category: clippedString(row.category, 60),
        keyword,
        status: enumValue(row.status, COVERAGE_STATUSES, "missing"),
        where: clippedString(row.where, 300)
      };
    })
    .filter(Boolean)
    .slice(0, 12);

  const gaps = (Array.isArray(raw.gaps) ? raw.gaps : [])
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
    .filter(Boolean)
    .slice(0, 8);

  const rewrites = (Array.isArray(raw.rewrites) ? raw.rewrites : [])
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
      const hits = (Array.isArray(item.hits) ? item.hits : [])
        .map((hit) => clippedString(hit, 80))
        .filter(Boolean)
        .filter((kw) => isTermGrounded(kw, rewrite) && isTermGrounded(kw, rewriteGrounding))
        .slice(0, 6);
      return { original, rewrite, hits };
    })
    .filter(Boolean)
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
  // shows. verdictReason and coverage[].where are deliberately NOT grounded here
  // (the route owns verdictReason; coverage[].where quotes the JD by design).
  // Thin local alias over the shared prose-grounding predicate (jobLower/
  // groundingLower are already lower-cased above).
  const proseIsUngrounded = (text) => proseHasUngroundedTerm(text, jobLower, groundingLower);

  const riskFlags = (Array.isArray(raw.riskFlags) ? raw.riskFlags : [])
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
    .filter(Boolean)
    .slice(0, 3);

  const rawRec = raw.recommendation && typeof raw.recommendation === "object" ? raw.recommendation : {};
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
    verdict: enumValue(raw.verdict, VERDICTS, "STRETCH"),
    verdictReason: clippedString(raw.verdictReason, 300),
    coverage,
    gaps,
    rewrites,
    riskFlags,
    recommendation
  };
}

export function missingRequiredSkillsFromStrictReview(strictReview) {
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

function verdictForScore(score) {
  if (score >= 85) return "STRONG FIT";
  if (score >= 70) return "REASONABLE FIT";
  if (score >= 46) return "STRETCH";
  return "DON'T APPLY";
}

// Per-bucket point maxima for the arithmetic fit score. Mirrors the weights in
// the strict-review scoring prompt.
const BUCKET_MAX = {
  requiredTech: 40,
  requiredDomains: 25,
  seniority: 15,
  preferred: 10,
  clarity: 10
};

const STATUS_POINTS = {
  covered: 1,
  adjacent: 0.45,
  missing: 0
};

const IMPORTANCE_POINTS = {
  critical: 3,
  high: 2,
  medium: 1,
  low: 0.5
};

const MISSING_BUCKET_DEFAULTS = {
  requiredTech: 0.5,
  requiredDomains: 0.75,
  seniority: 0.75,
  preferred: 1
};

function requirementBucket(category) {
  const text = String(category ?? "").toLowerCase();
  if (/\bprefer|nice|bonus|plus\b/.test(text)) return "preferred";
  if (/\byear|senior|level|degree|certif|clearance|citizen|authorization|authorisation|sponsor|visa|license|licence\b/.test(text)) {
    return "seniority";
  }
  if (/\btech|skill|tool|language|framework|platform|stack\b/.test(text)) return "requiredTech";
  if (/\bexperience|domain|responsibilit|work|practice|project|deliver|build|design|develop\b/.test(text)) return "requiredDomains";
  return null;
}

function sanitizeRequirementCoverage(raw) {
  if (!Array.isArray(raw)) return [];
  const output = [];
  const seen = new Set();
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const requirement = clippedString(row.requirement ?? row.keyword ?? row.gap, 180);
    if (!requirement) continue;
    const category = clippedString(row.category, 80);
    const bucket = requirementBucket(category);
    if (!bucket) continue;
    const importance = enumValue(row.importance, REQUIREMENT_IMPORTANCE, bucket === "preferred" ? "low" : "medium");
    const baseStatus = enumValue(row.baseStatus ?? row.status, COVERAGE_STATUSES, "missing");
    const tailoredStatus = enumValue(row.tailoredStatus ?? row.status, COVERAGE_STATUSES, baseStatus);
    const key = `${bucket}:${requirement.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({
      bucket,
      category,
      requirement,
      importance,
      baseStatus,
      tailoredStatus,
      baseEvidence: clippedString(row.baseEvidence ?? row.where, 300),
      tailoredEvidence: clippedString(row.tailoredEvidence ?? row.where, 300)
    });
    if (output.length >= 20) break;
  }
  return output;
}

function scoreRequirementBucket(rows, bucket, statusField) {
  const relevant = rows.filter((row) => row.bucket === bucket);
  if (!relevant.length) return Math.round(BUCKET_MAX[bucket] * MISSING_BUCKET_DEFAULTS[bucket]);
  let total = 0;
  let earned = 0;
  for (const row of relevant) {
    const weight = IMPORTANCE_POINTS[row.importance] ?? 1;
    total += weight;
    earned += weight * (STATUS_POINTS[row[statusField]] ?? 0);
  }
  return total ? Math.round(BUCKET_MAX[bucket] * (earned / total)) : 0;
}

function scoreRequirementClarity(rows, statusField, strictReview) {
  const relevant = rows.filter((row) => row.bucket !== "preferred");
  if (!relevant.length) return 8;
  let total = 0;
  let earned = 0;
  for (const row of relevant) {
    const weight = IMPORTANCE_POINTS[row.importance] ?? 1;
    total += weight;
    earned += weight * (STATUS_POINTS[row[statusField]] ?? 0);
  }
  const riskPenalty = Math.min(3, Array.isArray(strictReview?.riskFlags) ? strictReview.riskFlags.length : 0);
  return Math.max(0, Math.min(10, Math.round(10 * (earned / Math.max(1, total))) - riskPenalty));
}

function scoreRequirements(rows, statusField, strictReview) {
  return Math.min(100, (
    scoreRequirementBucket(rows, "requiredTech", statusField) +
    scoreRequirementBucket(rows, "requiredDomains", statusField) +
    scoreRequirementBucket(rows, "seniority", statusField) +
    scoreRequirementBucket(rows, "preferred", statusField) +
    scoreRequirementClarity(rows, statusField, strictReview)
  ));
}

function requirementLiftReason(rows) {
  const improved = rows
    .filter((row) => (STATUS_POINTS[row.tailoredStatus] ?? 0) > (STATUS_POINTS[row.baseStatus] ?? 0))
    .map((row) => row.requirement)
    .slice(0, 2);
  if (!improved.length) return "Tailoring did not materially change requirement coverage.";
  return `Tailoring improved evidence for ${improved.join(improved.length > 1 ? " and " : "")}.`;
}

// Primary strict-review scoring path: the model extracts requirement coverage,
// but the server owns every point calculation. This removes model-authored
// numeric bucket wobble while keeping the reviewer responsible for evidence
// classification.
export function scoreFromRequirementCoverage(rawCoverage, strictReview) {
  const rows = sanitizeRequirementCoverage(rawCoverage);
  // Require enough rows that the score is based on an actual requirement table,
  // not one or two vague bullets. Fallback callers may still use legacy buckets.
  if (rows.length < 4) return null;
  return {
    base: scoreRequirements(rows, "baseStatus", strictReview),
    tailored: scoreRequirements(rows, "tailoredStatus", strictReview),
    liftReason: requirementLiftReason(rows)
  };
}

// ELIGIBILITY lexicon: the HARD eligibility gates (clearance / work-auth /
// residency / license / cert / degree) that force a DON'T APPLY when a JD
// requires one the candidate lacks. Deliberately EXCLUDES bare year/senior/level
// — a missing "5+ years" is a HIGH gap at most, never a hard blocker. Terms are
// chosen to avoid substring FALSE POSITIVES on a critical/high MISSING row (each
// would wrongly tell the user NOT to apply to a role they qualify for):
// "authorization"/"authorisation" stay FULL words (so "unauthorized access", a
// security SKILL, never fires), with an explicit "...to work" phrase catching
// the standalone "authorized/eligible to work"; "green card" takes a right
// boundary (rejects "cardigan"); "permanent resid(ent|ency|ence)" rejects
// "residual" (an ML term). The bare "EAD" abbreviation is deliberately NOT
// matched — it collides with the finance/risk metric Exposure At Default
// (EAD/PD/LGD); the spelled-out "employment authorization document" is already
// caught by "authorization". Only fires under coverageHasEligibilityBlocker's
// critical/high + still-missing guard. Under-coverage is the safe direction;
// missed gates (work permit / right to work / US person / SC-DV) are a
// deliberate lexicon follow-up.
const ELIGIBILITY_BLOCKER =
  /clearance|citizen|authorization|authorisation|sponsor|visa|license|licence|certif|degree|\bgreen\s*cards?\b|permanent\s+resid(?:ent|ency|ence)\b|polygraph|ts\/sci|(?:eligible|authoriz\w+|authoris\w+)\s+to\s+work/i;

// The model often reports a hard eligibility blocker as a requirementCoverage
// ROW ("Active Secret clearance required", tailoredStatus "missing") rather than
// as a gap with severity BLOCKER. Without this, a role the candidate is formally
// ineligible for can score 80-90 / "Strong fit", defeating the prompt's hard-
// blocker guarantee. Returns true when ANY sanitized coverage row is an
// eligibility requirement (category or requirement text matches ELIGIBILITY_
// BLOCKER) that is strong-importance (critical/high) AND still MISSING after
// tailoring. Only a "missing" tailoredStatus escalates, so a satisfied
// requirement never caps.
export function coverageHasEligibilityBlocker(rawCoverage) {
  if (!Array.isArray(rawCoverage)) return false;
  // Scan the RAW rows, NOT sanitizeRequirementCoverage's output: that helper
  // drops any row whose `category` does not match a scoring bucket, so a hard
  // gate filed under a non-bucketing label ("Eligibility", "Education",
  // "Compliance", "Legal", "Security") would never reach this test and the cap
  // would silently fail to fire. Read the same raw fields the sanitizer reads
  // (requirement/keyword/gap + category) and gate conservatively: an explicit
  // critical/high importance AND a still-"missing" tailored status, so a
  // satisfied or vaguely-rated requirement never over-caps an applicable role.
  return rawCoverage.some((row) => {
    if (!row || typeof row !== "object") return false;
    const requirement = String(row.requirement ?? row.keyword ?? row.gap ?? "");
    const category = String(row.category ?? "");
    if (!ELIGIBILITY_BLOCKER.test(`${category} ${requirement}`)) return false;
    const importance = enumValue(row.importance, REQUIREMENT_IMPORTANCE, "medium");
    if (importance !== "critical" && importance !== "high") return false;
    const tailoredStatus = enumValue(row.tailoredStatus ?? row.status, COVERAGE_STATUSES, "missing");
    return tailoredStatus === "missing";
  });
}

// The score is derived from requirementCoverage, but the HIGH-gap caps read the
// SEPARATE strictReview.gaps array — so a model can mark required rows "missing"
// in coverage (correctly lowering the score) while omitting them from gaps to
// escape the cap ladder, keeping a REASONABLE/STRONG band it shouldn't. This
// counts missing required requirements straight from the coverage table
// (critical/high importance, non-preferred bucket, still missing after tailoring)
// so applyGapCapsAndVerdict can cap on whichever source reports more. Hard
// eligibility gates are handled separately by coverageHasEligibilityBlocker.
export function missingRequiredFromCoverage(rawCoverage) {
  return sanitizeRequirementCoverage(rawCoverage).filter((row) =>
    row.bucket !== "preferred" &&
    (row.importance === "critical" || row.importance === "high") &&
    row.tailoredStatus === "missing"
  ).length;
}

// Deterministic caps + verdict from the sanitized gaps the reviewer itself
// reported: a BLOCKER gap (clearance/license/degree-class) caps both scores in
// the DON'T APPLY band; a HIGH gap (missing required skill) caps below 70. The
// verdict is then a pure function of the capped tailored score — never a
// second model opinion that can disagree with the number.
//
// hasCoverageBlocker (default false to preserve every existing caller/signature)
// is the synthetic BLOCKER signal derived from the requirementCoverage table via
// coverageHasEligibilityBlocker: when true, cap=45 + DON'T APPLY fire exactly
// like a BLOCKER gap, so an eligibility gate reported only as a coverage row
// still governs fit.
// Single source for the server verdict reason when an unmet eligibility gate
// forces DON'T APPLY. Referenced by both applyGapCapsAndVerdict branches (the
// null-score path and the capped-score path) so the wording can never drift.
const ELIGIBILITY_BLOCKER_CAP_REASON =
  "Server verdict: a required eligibility gate is unmet, which forces DON'T APPLY.";

export function applyGapCapsAndVerdict(aiScore, strictReview, hasCoverageBlocker = false, coverageMissingCount = 0) {
  const gaps = Array.isArray(strictReview?.gaps) ? strictReview.gaps : [];
  // A BLOCKER gap OR a synthetic eligibility blocker from the coverage table
  // (missing critical/high clearance/work-auth/license/cert/degree row) forces
  // the DON'T APPLY band, regardless of HIGH-gap count OR score availability.
  const hasBlocker = hasCoverageBlocker || gaps.some((gap) => gap.severity === "BLOCKER");
  if (!aiScore) {
    // No usable numeric score (the client falls back to the local engine score),
    // but a hard eligibility blocker must STILL force DON'T APPLY — otherwise a
    // sparse review (a clearance/work-auth/license/cert/degree gate reported with
    // too few coverage rows to score, and no numeric buckets) would inherit the
    // model's optimistic verdict for a role the candidate is formally ineligible
    // for. With no blocker, pass the sanitized verdict through unchanged.
    return {
      aiScore,
      verdict: hasBlocker ? "DON'T APPLY" : (strictReview?.verdict ?? null),
      capReason: hasBlocker ? ELIGIBILITY_BLOCKER_CAP_REASON : ""
    };
  }
  // Graduated HIGH-gap cap. A single missing required skill is near-universal on
  // an honest pass against an 8-15 skill JD; the old binary "any HIGH -> 69"
  // pinned otherwise-strong matches to the STRETCH ceiling, which is why almost
  // everything read STRETCH. Now the cap scales with how many required skills are
  // genuinely missing. A BLOCKER still forces DON'T APPLY (unchanged).
  // Reconcile the two model arrays: take the STRONGER missing-required signal —
  // a missing critical/high requirementCoverage row is at least as severe as a
  // HIGH gap — so the fit number can't be gamed by under-reporting gaps. Honest
  // replies (gaps and coverage agree) are unchanged; max() only bites when
  // coverage reports MORE missing than the gaps array did.
  const highGaps = Math.max(
    gaps.filter((gap) => gap.severity === "HIGH").length,
    coverageMissingCount
  );
  let cap = 100;
  if (highGaps >= 1) cap = 79; // 1 missing required skill: top of REASONABLE FIT
  if (highGaps >= 2) cap = 69; // 2: STRETCH ceiling (the old flat behavior)
  if (highGaps >= 3) cap = 60; // 3+: solidly STRETCH
  if (hasBlocker) cap = 45;
  const base = Math.min(aiScore.base, cap);
  const tailored = Math.min(aiScore.tailored, cap);
  if (cap < 100 && (base !== aiScore.base || tailored !== aiScore.tailored)) {
    console.warn("[ai] capped fit score for reported gaps", {
      cap,
      base: `${aiScore.base}->${base}`,
      tailored: `${aiScore.tailored}->${tailored}`
    });
  }
  // Deterministic, server-authored reason naming the mechanism that set the
  // verdict. Stated only from facts already in the sanitized review — a blocker's
  // presence, or the count of missing-required gaps that capped the score — so
  // no new claim enters the review. Consumed by the /api/polish route when the
  // server verdict overrides the model's, so the user never reads the model's
  // stale justification for a verdict it no longer holds.
  let capReason;
  if (hasBlocker) {
    capReason = ELIGIBILITY_BLOCKER_CAP_REASON;
  } else if (highGaps >= 1 && aiScore.tailored > cap) {
    // Only claim the cap when it actually bound; a score already below the cap
    // set its own band, and attributing it to the cap would misstate the cause.
    capReason = `Server verdict: ${highGaps} missing required qualification${highGaps === 1 ? "" : "s"} capped the fit score at ${cap}, setting the ${verdictForScore(tailored)} band.`;
  } else {
    capReason = `Server verdict: recomputed from requirement-coverage evidence to the ${verdictForScore(tailored)} band (score ${tailored}).`;
  }
  return { aiScore: { ...aiScore, base, tailored }, verdict: verdictForScore(tailored), capReason };
}
