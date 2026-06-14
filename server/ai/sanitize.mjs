// Validation + reconciliation for the structured fields a polish/strict-review
// reply returns (fit scores, missing-skill gaps). Kept separate from the
// provider clients so the response-shaping rules are easy to find and test.

import { findUngroundedJdTerm } from "./grounding.mjs";

function clampFitScore(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}

// Validate the AI's base/tailored fit numbers. Returns null when neither score
// is usable so the client falls back to the local engine.
export function sanitizeAiScore(raw) {
  if (!raw || typeof raw !== "object") return null;
  const base = clampFitScore(raw.base);
  const tailored = clampFitScore(raw.tailored);
  if (base === null && tailored === null) return null;
  return {
    base: base ?? tailored,
    tailored: tailored ?? base,
    liftReason: typeof raw.liftReason === "string" ? raw.liftReason.slice(0, 300) : ""
  };
}

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
            { field: "skill", text: entry.subtitleLeft ?? entry.skills ?? "", bulletId: "" },
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
        const key = [sectionId, entryId, item.bulletId, item.field].join("::");
        targets.set(key, {
          target: { sectionId, entryId, field: item.field },
          currentText: clippedString(item.text, 1200),
          sectionHeading
        });
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
  // Grounding corpus for hit keywords: every current field text in the scope
  // plus the user's honest context. A JD keyword the model writes INTO a
  // proposedText must already exist somewhere in here — the evidence field is
  // model prose and can launder an inferred fact ("clinics run Windows"), but
  // it cannot conjure the term into the source text.
  const grounding = [
    ...[...targets.values()].map((t) => t.currentText),
    contextSectionsText(scope),
    String(honestContext ?? "")
  ].join("\n").toLowerCase();
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
    if (seen.has(key)) { drop("duplicateTarget"); continue; }
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
    const proposedLower = proposedText.toLowerCase();
    const ungroundedHit = hits.some((kw) => {
      const words = (kw.toLowerCase().match(/[a-z0-9.#+]{3,}/g) ?? []);
      if (!words.length) return false;
      const inProposed = words.some((w) => proposedLower.includes(w));
      const inGrounding = words.some((w) => grounding.includes(w));
      return inProposed && !inGrounding;
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
    seen.add(key);
    if (output.length >= 12) break;
  }
  return output;
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
export function sanitizeStrictReview(raw, jobText = "", grounding = "") {
  if (!raw || typeof raw !== "object") return null;
  const jobLower = String(jobText ?? "").toLowerCase();
  const groundingLower = String(grounding ?? "").toLowerCase();

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
      // bullet; reject smuggled markup the same way tailor suggestions do.
      if (suggestedEdit && containsStructuredMarkup(gap.suggestedEdit)) return null;
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
      if (findUngroundedJdTerm(rewrite, jobLower, groundingLower)) return null;
      const hits = Array.isArray(item.hits)
        ? item.hits.map((hit) => clippedString(hit, 80)).filter(Boolean).slice(0, 6)
        : [];
      return { original, rewrite, hits };
    })
    .filter(Boolean)
    .slice(0, 4);

  const riskFlags = (Array.isArray(raw.riskFlags) ? raw.riskFlags : [])
    .map((flag) => {
      if (!flag || typeof flag !== "object") return null;
      const risk = clippedString(flag.risk, 300);
      if (!risk) return null;
      return {
        bullet: clippedString(flag.bullet, 300),
        risk,
        suggestion: clippedString(flag.suggestion, 300)
      };
    })
    .filter(Boolean)
    .slice(0, 3);

  const rawRec = raw.recommendation && typeof raw.recommendation === "object" ? raw.recommendation : {};
  const recommendation = {
    applyAsIs: Boolean(rawRec.applyAsIs),
    reason: clippedString(rawRec.reason, 300),
    topEdits: (Array.isArray(rawRec.topEdits) ? rawRec.topEdits : [])
      .map((edit) => clippedString(edit, 300))
      .filter(Boolean)
      .slice(0, 3),
    coverLetterAngle: clippedString(rawRec.coverLetterAngle, 1400)
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

// The numeric band each strict-review verdict must fall in. Mirrors the rule in
// the strict-review prompt.
const VERDICT_SCORE_BANDS = {
  "DON'T APPLY": [0, 45],
  STRETCH: [46, 69],
  "REASONABLE FIT": [70, 84],
  "STRONG FIT": [85, 100]
};

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

function sumBuckets(raw) {
  if (!raw || typeof raw !== "object") return null;
  let total = 0;
  let present = 0;
  for (const [bucket, max] of Object.entries(BUCKET_MAX)) {
    const n = Math.round(Number(raw[bucket]));
    if (!Number.isFinite(n)) continue;
    present++;
    total += Math.max(0, Math.min(max, n));
  }
  // Require most buckets so a one-field reply can't masquerade as a score.
  return present >= 3 ? Math.min(100, total) : null;
}

// The strict reviewer reports per-bucket subtotals; the SERVER does the
// arithmetic. The model judges facts (coverage), the server derives the
// number — the same bucket judgments always produce the same score, which
// removes the holistic-number run-to-run wobble. Returns null when the model
// did not supply usable buckets so the caller can fall back to the legacy
// holistic fitScore + reconcileFitVerdict path.
export function scoreFromBuckets(rawBuckets) {
  if (!rawBuckets || typeof rawBuckets !== "object") return null;
  const base = sumBuckets(rawBuckets.base);
  const tailored = sumBuckets(rawBuckets.tailored);
  if (base === null && tailored === null) return null;
  return {
    base: base ?? tailored,
    tailored: tailored ?? base,
    liftReason: typeof rawBuckets.liftReason === "string" ? rawBuckets.liftReason.slice(0, 300) : ""
  };
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

// Deterministic caps + verdict from the sanitized gaps the reviewer itself
// reported: a BLOCKER gap (clearance/license/degree-class) caps both scores in
// the DON'T APPLY band; a HIGH gap (missing required skill) caps below 70. The
// verdict is then a pure function of the capped tailored score — never a
// second model opinion that can disagree with the number.
export function applyGapCapsAndVerdict(aiScore, strictReview) {
  if (!aiScore) return { aiScore, verdict: strictReview?.verdict ?? null };
  const gaps = Array.isArray(strictReview?.gaps) ? strictReview.gaps : [];
  // Graduated HIGH-gap cap. A single missing required skill is near-universal on
  // an honest pass against an 8-15 skill JD; the old binary "any HIGH -> 69"
  // pinned otherwise-strong matches to the STRETCH ceiling, which is why almost
  // everything read STRETCH. Now the cap scales with how many required skills are
  // genuinely missing. A BLOCKER still forces DON'T APPLY (unchanged).
  const highGaps = gaps.filter((gap) => gap.severity === "HIGH").length;
  let cap = 100;
  if (highGaps >= 1) cap = 79; // 1 missing required skill: top of REASONABLE FIT
  if (highGaps >= 2) cap = 69; // 2: STRETCH ceiling (the old flat behavior)
  if (highGaps >= 3) cap = 60; // 3+: solidly STRETCH
  if (gaps.some((gap) => gap.severity === "BLOCKER")) cap = 45;
  const base = Math.min(aiScore.base, cap);
  const tailored = Math.min(aiScore.tailored, cap);
  if (cap < 100 && (base !== aiScore.base || tailored !== aiScore.tailored)) {
    console.warn("[ai] capped fit score for reported gaps", {
      cap,
      base: `${aiScore.base}->${base}`,
      tailored: `${aiScore.tailored}->${tailored}`
    });
  }
  return { aiScore: { ...aiScore, base, tailored }, verdict: verdictForScore(tailored) };
}

// Enforce verdict/score agreement server-side rather than trusting the prompt —
// the UI must never show a contradictory pair. Reconciliation is always in the
// CONSERVATIVE direction: when the score is above the verdict's band (e.g.
// "DON'T APPLY" with a tailored 82) the score is clamped DOWN to the band; when
// the score is below the band (e.g. "STRONG FIT" with a tailored 82) the
// VERDICT is downgraded to the band the score sits in. A fit signal is never
// inflated to match the more optimistic half of a disagreement.
export function reconcileFitVerdict(aiScore, verdict) {
  if (!aiScore || typeof verdict !== "string") return { aiScore, verdict: verdict ?? null };
  const normalized = verdict.trim().toUpperCase();
  const band = VERDICT_SCORE_BANDS[normalized];
  if (!band) return { aiScore, verdict };
  const [lo, hi] = band;
  if (aiScore.tailored > hi) {
    console.warn("[ai] clamped tailored fit score down to verdict band", {
      verdict: normalized,
      from: aiScore.tailored,
      to: hi
    });
    // Clamp base into the band too: a pessimistic verdict judges the JOB fit,
    // which covers the original resume as well. Leaving base above the clamped
    // tailored score would render as "tailoring made the resume worse" when
    // the truth is "this job is a non-starter either way".
    return {
      aiScore: { ...aiScore, base: Math.min(aiScore.base, hi), tailored: hi },
      verdict: normalized
    };
  }
  if (aiScore.tailored < lo) {
    const downgraded = verdictForScore(aiScore.tailored);
    console.warn("[ai] downgraded verdict to match tailored fit score", {
      from: normalized,
      to: downgraded,
      tailored: aiScore.tailored
    });
    return { aiScore, verdict: downgraded };
  }
  return { aiScore, verdict: normalized };
}
