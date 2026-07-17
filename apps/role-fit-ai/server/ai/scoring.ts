// Fit scoring + verdict arithmetic — the server does the math over
// reviewer-extracted evidence; split from sanitize.ts. Anti-fabrication-critical:
// behavior changes require adversarial review.

import { clippedString, enumValue, COVERAGE_STATUSES } from "./sanitize.ts";
import { ELIGIBILITY_BLOCKER, SENIORITY_BUCKET_RE } from "./eligibilityLexicon.ts";

// The four scoring buckets (clarity is derived separately, not a coverage bucket).
type BucketName = "requiredTech" | "requiredDomains" | "seniority" | "preferred";
// Which coverage column a scoring pass reads.
type StatusField = "baseStatus" | "tailoredStatus";
// A sanitized requirement-coverage row (the shape sanitizeRequirementCoverage emits).
type RequirementRow = {
  bucket: BucketName;
  category: string;
  requirement: string;
  importance: string;
  baseStatus: string;
  tailoredStatus: string;
  baseEvidence: string;
  tailoredEvidence: string;
};
// The already-sanitized review object the caps/clarity math reads defensively.
type StrictReviewLike = {
  gaps?: Array<{ gap?: unknown; severity?: unknown; capEligible?: unknown }>;
  verdict?: string;
  riskFlags?: unknown[];
} | null | undefined;
// The base/tailored score pair the coverage arithmetic produces.
type AiScore = { base: number; tailored: number; liftReason: string };

// Optional grounding inputs for requirement coverage. Omitting this argument
// preserves legacy behavior for existing callers; route code supplies all four
// corpora so model-authored statuses are treated only as claims to verify.
export type RequirementCoverageGrounding = {
  jobText?: unknown;
  baseResume?: unknown;
  tailoredResume?: unknown;
  honestContext?: unknown;
};

const REQUIREMENT_IMPORTANCE = new Set(["critical", "high", "medium", "low"]);
const LOGISTICAL_REQUIREMENT_RE = /\b(?:travel|relocat(?:e|ion)|on[- ]?site|in[- ]?office|remote|hybrid|shift|overnight|weekend|on[- ]?call|overtime|extended hours|physical|lift(?:ing)?|stand(?:ing)?|commute|driver'?s? licen[cs]e|driving|transportation)\b/i;
const DEGREE_OR_EQUIVALENT_RE = /(?:degree|bachelor['’]?s?|master['’]?s?).{0,60}(?:or|and\/or)\s+(?:equivalent|relevant|comparable).{0,30}experience|(?:equivalent|relevant|comparable)\s+experience.{0,60}(?:degree|bachelor['’]?s?|master['’]?s?)/i;

const TOKEN_STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "have",
  "in", "into", "is", "it", "of", "on", "or", "that", "the", "their", "this", "to",
  "using", "use", "used", "with", "you", "your"
]);

// Evidence frequently arrives as reporting prose rather than a verbatim quote:
// "Skills section lists React" should ground on React, not fail because the
// resume does not literally contain "section lists". Remove only this framing;
// distinctive role/domain/tool words still have to match the corpus.
const EVIDENCE_REPORTING_BOILERPLATE = new Set([
  ...TOKEN_STOPWORDS,
  "base", "bullet", "bullets", "candidate", "context", "current", "entry", "evidence",
  "honest", "include", "includes", "including", "list", "lists", "listed", "listing", "mentions", "mentioned", "original", "polished",
  "project", "projects", "resume", "role", "section", "shows", "shown", "skills", "states",
  "tailored", "work", "says"
]);

const REQUIREMENT_BOILERPLATE = new Set([
  ...TOKEN_STOPWORDS,
  "ability", "candidate", "candidates", "domain", "experience", "knowledge", "must", "preferred",
  "proficiency", "proficient", "qualification", "qualifications", "required", "requirement",
  "requirements", "should", "skill", "skills", "technology", "technologies", "tool", "tools", "years", "year"
]);

// Small, established equivalence families only. Both corpus and claim tokens
// receive the same canonical form, preserving valid coverage without broad
// fuzzy matching (which would reopen false-friend failures).
const COVERAGE_TOKEN_CANONICAL = new Map<string, string>([
  ["postgres", "postgres"], ["postgresql", "postgres"],
  ["k8s", "kubernetes"], ["kubernetes", "kubernetes"],
  ["ts", "typescript"], ["typescript", "typescript"],
  ["react", "react"], ["react.js", "react"], ["reactjs", "react"]
]);

function tokenVariants(raw: string): string[] {
  const token = raw.replace(/^\.+|\.+$/g, "");
  if (!token) return [];
  const variants = new Set<string>();
  const add = (variant: string) => {
    if (!variant) return;
    variants.add(variant);
    const canonical = COVERAGE_TOKEN_CANONICAL.get(variant);
    if (canonical) variants.add(canonical);
  };
  add(token);
  if (/^[a-z]+$/.test(token)) {
    if (token.length > 5 && token.endsWith("ies")) add(`${token.slice(0, -3)}y`);
    if (token.length > 5 && token.endsWith("ments")) add(token.slice(0, -5));
    if (token.length > 4 && token.endsWith("ment")) add(token.slice(0, -4));
    if (token.length > 5 && token.endsWith("ing")) {
      const stem = token.slice(0, -3).replace(/(.)\1$/, "$1");
      add(stem);
      add(`${stem}e`);
    }
    if (token.length > 4 && token.endsWith("ed")) {
      const stem = token.slice(0, -2).replace(/(.)\1$/, "$1");
      add(stem);
      add(`${stem}e`);
    }
    if (token.length > 4 && token.endsWith("s")) add(token.slice(0, -1));
  }
  return [...variants];
}

function rawTokens(value: unknown): string[] {
  return String(value ?? "").toLowerCase().match(/[a-z0-9][a-z0-9+#.]*/g) ?? [];
}

function corpusTokens(value: unknown): Set<string> {
  return new Set(rawTokens(value).flatMap(tokenVariants));
}

function distinctiveTokens(value: unknown, ignored: Set<string>): string[] {
  return [...new Set(rawTokens(value)
    .filter((token) => (token.length >= 2 || token === "c" || token === "r" || /^\d+$/.test(token)) && !ignored.has(token))
  )];
}

type AtomicRequirementKind = "typescript" | "dotnet" | "go" | "c" | "r";

// Reviewer requirement labels often wrap a short technology in descriptive
// prose ("TypeScript development", "Go backend services"). Detect the atomic
// claim inside that label before generic token-overlap scoring can let a false
// friend (TS/SCI, net-zero, go-to-market, C-suite, R&D) carry the row.
function atomicRequirementKind(value: unknown): AtomicRequirementKind | null {
  const raw = String(value ?? "");
  if (/\.net\b/i.test(raw)) return "dotnet";
  if (/\btypescript\b/i.test(raw)) return "typescript";
  if (/\bGolang\b/i.test(raw) || /(?:^|[^A-Za-z0-9])Go(?![-&A-Za-z0-9+#])/.test(raw)) return "go";
  if (/(?:^|[^A-Za-z0-9])C(?![-&A-Za-z0-9+#])/.test(raw)) return "c";
  if (/(?:^|[^A-Za-z0-9])R(?![-&A-Za-z0-9+#])/.test(raw)) return "r";
  return null;
}

function specialAtomicRequirementGrounded(value: unknown, corpus: unknown, _ignored: Set<string>): boolean | null {
  const raw = String(value ?? "");
  const source = String(corpus ?? "");
  if (/\bts\s*\/\s*sci\b/i.test(raw) || /\bts\b.{0,20}\bclearance\b/i.test(raw)) {
    return /\bts\s*\/\s*sci\b/i.test(source) || /\bts\b.{0,20}\bclearance\b/i.test(source);
  }
  const kind = atomicRequirementKind(raw);
  if (kind === "dotnet") return /(?:^|[^a-z0-9])\.net(?![-a-z0-9])/i.test(source) ? null : false;
  if (kind === "typescript") {
    const grounded = /\bTypeScript\b/i.test(source)
      || /(?:^|[^A-Za-z0-9/])TS(?!\s*\/\s*SCI\b|[A-Za-z0-9])/i.test(source);
    return grounded ? null : false;
  }
  if (kind === "go") {
    return /\bGolang\b/i.test(source) || /(?:^|[^A-Za-z0-9])Go(?![-&A-Za-z0-9+#])/.test(source) ? null : false;
  }
  if (kind === "c") {
    return /(?:^|[^A-Za-z0-9])C(?![-&A-Za-z0-9+#])/.test(source) ? null : false;
  }
  if (kind === "r") {
    return /(?:^|[^A-Za-z0-9])R(?![-&A-Za-z0-9+#])/.test(source) ? null : false;
  }
  return null;
}

function hasAtomicFalseFriend(value: unknown, corpus: unknown, ignored: Set<string>): boolean {
  const raw = String(value ?? "");
  const source = String(corpus ?? "");
  const exact = specialAtomicRequirementGrounded(raw, source, ignored);
  if (exact !== false) return false;
  const kind = atomicRequirementKind(raw);
  if (kind === "dotnet") return /\bnet[- ]zero\b/i.test(source);
  if (kind === "typescript") return /\bTS\s*\/\s*SCI\b/i.test(source);
  if (kind === "go") return /\bgo[- ]to[- ]market\b|\bgo[- ]getter\b/i.test(source);
  if (kind === "c") return /\bC[- ]suite\b|\bC[- ]level\b|\bC#\b|\bC\+\+\b/i.test(source);
  if (kind === "r") return /\bR\s*&\s*D\b/i.test(source);
  return false;
}

function phraseGrounded(value: unknown, corpus: unknown, ignored: Set<string>, requireAll = false): boolean {
  const special = specialAtomicRequirementGrounded(value, corpus, ignored);
  if (special !== null) return special;
  const tokens = distinctiveTokens(value, ignored);
  if (!tokens.length) return false;
  const available = corpusTokens(corpus);
  let hits = 0;
  for (const token of tokens) {
    if (tokenVariants(token).some((variant) => available.has(variant))) hits += 1;
  }
  // Single-token evidence (React, AWS, Go) must match exactly. Longer prose can
  // paraphrase lightly, but a clear majority of distinctive terms must survive.
  if (requireAll) return hits === tokens.length;
  return tokens.length === 1 ? hits === 1 : hits * 5 >= tokens.length * 3;
}

function requirementNegatedInCorpus(requirement: unknown, corpus: unknown): boolean {
  const source = String(corpus ?? "").toLowerCase();
  const tokens = distinctiveTokens(requirement, REQUIREMENT_BOILERPLATE)
    .filter((token) => token.length >= 3)
    .sort((a, b) => b.length - a.length);
  const anchor = tokens[0];
  if (!anchor) return false;
  const escaped = anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...source.matchAll(new RegExp(`\\b${escaped}\\b`, "g"))];
  if (!matches.length) return false;
  return matches.every((match) => {
    const at = match.index ?? 0;
    const before = source.slice(Math.max(0, at - 50), at);
    const after = source.slice(at + anchor.length, Math.min(source.length, at + anchor.length + 50));
    return /\b(?:no|not|never|without|lack(?:s|ed|ing)?)\b[^.!;\n]{0,45}$/.test(before)
      || /^[^.!;\n]{0,30}\b(?:no experience|not experienced|unsupported|not used)\b/.test(after);
  });
}

function requirementContext(requirement: unknown, source: unknown): string {
  const text = String(source ?? "");
  const tokens = distinctiveTokens(requirement, REQUIREMENT_BOILERPLATE).sort((a, b) => b.length - a.length);
  const lower = text.toLowerCase();
  const anchor = tokens.find((token) => lower.includes(token));
  if (!anchor) return text;
  const lines = text.split(/\r?\n/);
  const lineIndex = lines.findIndex((line) => line.toLowerCase().includes(anchor));
  if (lineIndex < 0) {
    const at = lower.indexOf(anchor);
    return text.slice(Math.max(0, at - 180), Math.min(text.length, at + anchor.length + 180));
  }
  return `${lines[Math.max(0, lineIndex - 1)] ?? ""}\n${lines[lineIndex]}`;
}

function requirementIsPreferredOnly(requirement: unknown, category: unknown, jobText: unknown): boolean {
  if (/\b(?:preferred|nice|bonus)\b/i.test(String(category ?? ""))) return true;
  const context = requirementContext(requirement, jobText);
  return /\b(?:preferred|nice[- ]to[- ]have|bonus|plus)\b/i.test(context)
    && !/\b(?:required|must|minimum|mandatory)\b/i.test(context);
}

function isLogisticalRequirement(value: unknown): boolean {
  return LOGISTICAL_REQUIREMENT_RE.test(String(value ?? ""));
}

function requirementIsGrounded(requirement: string, grounding?: RequirementCoverageGrounding): boolean {
  if (!grounding || grounding.jobText === undefined) return true;
  return phraseGrounded(requirement, grounding.jobText, REQUIREMENT_BOILERPLATE, true);
}

function effectiveCoverageClaim(
  status: string,
  evidence: string,
  corpus: unknown,
  groundingEnabled: boolean,
  requirement: string
): { status: string; evidence: string } {
  if (!groundingEnabled || status === "missing") return { status, evidence };
  if (requirementNegatedInCorpus(requirement, corpus)) {
    return { status: "missing", evidence: "Not in resume" };
  }
  if (hasAtomicFalseFriend(requirement, corpus, REQUIREMENT_BOILERPLATE)) {
    return { status: "missing", evidence: "Not in resume" };
  }
  // "covered" means exact requirement evidence, so the requirement itself
  // must be anchored too; otherwise padded prose could hide one fabricated tool
  // among several generic grounded words and still pass the ratio check.
  if (status === "covered" && !phraseGrounded(requirement, corpus, REQUIREMENT_BOILERPLATE, true)) {
    return { status: "missing", evidence: "Not in resume" };
  }
  if (/\b(?:not in (?:the )?resume|no evidence|unsupported|not provided|no .{0,30}experience|without .{0,40}|lack(?:s|ed|ing)? .{0,40})\b/i.test(evidence)) {
    return { status: "missing", evidence: "Not in resume" };
  }
  return phraseGrounded(evidence, corpus, EVIDENCE_REPORTING_BOILERPLATE)
    ? { status, evidence }
    : { status: "missing", evidence: "Not in resume" };
}

function verdictForScore(score: number): string {
  if (score >= 85) return "STRONG FIT";
  if (score >= 70) return "REASONABLE FIT";
  if (score >= 46) return "STRETCH";
  return "DON'T APPLY";
}

// Per-bucket point maxima for the arithmetic fit score. Mirrors the weights in
// the strict-review scoring prompt.
const BUCKET_MAX: Record<string, number> = {
  requiredTech: 40,
  requiredDomains: 25,
  seniority: 15,
  preferred: 10,
  clarity: 10
};

const STATUS_POINTS: Record<string, number> = {
  covered: 1,
  adjacent: 0.45,
  missing: 0
};

const IMPORTANCE_POINTS: Record<string, number> = {
  critical: 3,
  high: 2,
  medium: 1,
  low: 0.5
};

const MISSING_BUCKET_DEFAULTS: Record<string, number> = {
  requiredTech: 0.5,
  requiredDomains: 0.75,
  seniority: 0.75,
  preferred: 1
};

function requirementBucket(category: unknown): BucketName | null {
  const text = String(category ?? "").toLowerCase();
  if (/\bprefer|nice|bonus|plus\b/.test(text)) return "preferred";
  // Seniority-bucket terms share the credential-gate vocabulary — the regex
  // lives in the shared eligibility lexicon so a new gate term is added to all
  // three lists together (a term missing HERE silently drops its row from
  // scoring; see the lexicon header).
  if (SENIORITY_BUCKET_RE.test(text)) {
    return "seniority";
  }
  if (/\btech|skill|tool|language|framework|platform|stack\b/.test(text)) return "requiredTech";
  if (/\bexperience|domain|responsibilit|work|practice|project|deliver|build|design|develop\b/.test(text)) return "requiredDomains";
  return null;
}

function sanitizeRequirementCoverage(raw: unknown, grounding?: RequirementCoverageGrounding): RequirementRow[] {
  if (!Array.isArray(raw)) return [];
  const output: RequirementRow[] = [];
  const seen = new Set<string>();
  // Coverage compares what the original and polished DOCUMENTS prove. Honest
  // context may authorize a tailor suggestion, but it does not count as resume
  // coverage until that supported fact actually appears in tailoredResume.
  const baseCorpus = String(grounding?.baseResume ?? "");
  const tailoredCorpus = String(grounding?.tailoredResume ?? "");
  const groundingEnabled = grounding !== undefined;
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const requirement = clippedString(row.requirement ?? row.keyword ?? row.gap, 180);
    if (!requirement) continue;
    if (!requirementIsGrounded(requirement, grounding)) continue;
    const category = clippedString(row.category, 80);
    const bucket = requirementBucket(category);
    if (!bucket) continue;
    const importance = enumValue(row.importance, REQUIREMENT_IMPORTANCE, bucket === "preferred" ? "low" : "medium");
    const rawBaseStatus = enumValue(row.baseStatus ?? row.status, COVERAGE_STATUSES, "missing");
    const rawTailoredStatus = enumValue(row.tailoredStatus ?? row.status, COVERAGE_STATUSES, rawBaseStatus);
    const rawBaseEvidence = clippedString(row.baseEvidence ?? row.where, 300);
    const rawTailoredEvidence = clippedString(row.tailoredEvidence ?? row.where, 300);
    const base = effectiveCoverageClaim(rawBaseStatus, rawBaseEvidence, baseCorpus, groundingEnabled, requirement);
    const tailored = effectiveCoverageClaim(rawTailoredStatus, rawTailoredEvidence, tailoredCorpus, groundingEnabled, requirement);
    const key = `${bucket}:${requirement.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({
      bucket,
      category,
      requirement,
      importance,
      baseStatus: base.status,
      tailoredStatus: tailored.status,
      baseEvidence: base.evidence,
      tailoredEvidence: tailored.evidence
    });
    if (output.length >= 20) break;
  }
  return output;
}

function scoreRequirementBucket(rows: RequirementRow[], bucket: BucketName, statusField: StatusField): number {
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

function scoreRequirementClarity(rows: RequirementRow[], statusField: StatusField, strictReview: StrictReviewLike): number {
  const relevant = rows.filter((row) => row.bucket !== "preferred");
  if (!relevant.length) return 8;
  let total = 0;
  let earned = 0;
  for (const row of relevant) {
    const weight = IMPORTANCE_POINTS[row.importance] ?? 1;
    total += weight;
    earned += weight * (STATUS_POINTS[row[statusField]] ?? 0);
  }
  // Array.isArray(strictReview?.riskFlags) truthiness proves strictReview non-null.
  const riskPenalty = Math.min(3, Array.isArray(strictReview?.riskFlags) ? strictReview!.riskFlags!.length : 0);
  return Math.max(0, Math.min(10, Math.round(10 * (earned / Math.max(1, total))) - riskPenalty));
}

function scoreRequirements(rows: RequirementRow[], statusField: StatusField, strictReview: StrictReviewLike): number {
  return Math.min(100, (
    scoreRequirementBucket(rows, "requiredTech", statusField) +
    scoreRequirementBucket(rows, "requiredDomains", statusField) +
    scoreRequirementBucket(rows, "seniority", statusField) +
    scoreRequirementBucket(rows, "preferred", statusField) +
    scoreRequirementClarity(rows, statusField, strictReview)
  ));
}

function requirementLiftReason(rows: RequirementRow[]): string {
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
export function scoreFromRequirementCoverage(
  rawCoverage: unknown,
  strictReview: StrictReviewLike,
  grounding?: RequirementCoverageGrounding
): AiScore | null {
  const rows = sanitizeRequirementCoverage(rawCoverage, grounding);
  // Require enough rows that the score is based on an actual requirement table,
  // not one or two vague bullets. Fallback callers may still use legacy buckets.
  const requiredDecisionBuckets = new Set(rows.filter((row) => row.bucket !== "preferred").map((row) => row.bucket));
  if (rows.length < 6 || requiredDecisionBuckets.size < 2) return null;
  return {
    base: scoreRequirements(rows, "baseStatus", strictReview),
    tailored: scoreRequirements(rows, "tailoredStatus", strictReview),
    liftReason: requirementLiftReason(rows)
  };
}

// Importance ordering for the user-visible coverage table: highest-impact rows
// first, so the client's "Coverage · N" list leads with the requirements that
// decide apply/skip. Unknown importances sort as "medium".
const DISPLAY_COVERAGE_IMPORTANCE_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

// Derive the user-visible coverage table from the SAME requirementCoverage rows
// the score is built from. This REPLACES the model-authored strictReview.coverage
// array, which used to duplicate this data: the strict-review prompt asked the
// model to mirror tailoredStatus into a second array, but scoring never read it,
// so the display table could silently drift from the scored evidence. Now both the
// score and the display come from one requirementCoverage source.
//
// Each sanitized row maps to the client display shape { category, keyword, status,
// where } — keyword is the requirement text, and status/where are the TAILORED
// status/evidence (the reviewed resume after the proposed changes). Status enums
// are already coerced to the coverage vocabulary by sanitizeRequirementCoverage,
// and an empty tailoredEvidence passes through unchanged (matching the prior
// sanitizer's clipped-string behavior — empty is allowed). Rows are ordered
// critical→high→medium→low (stable within a tier) and capped at 12, mirroring the
// old prompt's "4-12 most important". Returns [] when coverage is unusable — the
// same empty fallback the old sanitizer produced when the model omitted coverage.
export function displayCoverageFromRequirements(rawCoverage: unknown, grounding?: RequirementCoverageGrounding) {
  const rows = sanitizeRequirementCoverage(rawCoverage, grounding).map((row, index) => ({ row, index }));
  rows.sort((a, b) => {
    const rank =
      (DISPLAY_COVERAGE_IMPORTANCE_ORDER[a.row.importance] ?? 2) -
      (DISPLAY_COVERAGE_IMPORTANCE_ORDER[b.row.importance] ?? 2);
    return rank !== 0 ? rank : a.index - b.index; // stable within a tier
  });
  return rows.slice(0, 12).map(({ row }) => ({
    category: row.category,
    keyword: row.requirement,
    status: row.tailoredStatus,
    where: row.tailoredEvidence
  }));
}

// ELIGIBILITY_BLOCKER (the hard-gate lexicon: clearance / work-auth / residency /
// license / cert / degree terms that force DON'T APPLY) lives in the shared
// eligibility lexicon (./eligibilityLexicon.ts) alongside the distiller's
// AUTH_STEMS and the seniority-bucket regex, so the three co-evolving term
// lists are updated together; its header documents each deliberate delta
// (EAD/naturaliz distill-only, license/degree blocker-only, false-positive
// boundary choices).

// The model often reports a hard eligibility blocker as a requirementCoverage
// ROW ("Active Secret clearance required", tailoredStatus "missing") rather than
// as a gap with severity BLOCKER. Without this, a role the candidate is formally
// ineligible for can score 80-90 / "Strong fit", defeating the prompt's hard-
// blocker guarantee. Returns true when ANY sanitized coverage row is an
// eligibility requirement (category or requirement text matches ELIGIBILITY_
// BLOCKER) that is strong-importance (critical/high) AND still MISSING after
// tailoring. Only a "missing" tailoredStatus escalates, so a satisfied
// requirement never caps.
export function coverageHasEligibilityBlocker(rawCoverage: unknown, grounding?: RequirementCoverageGrounding): boolean {
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
    if (!requirementIsGrounded(requirement, grounding)) return false;
    if (isLogisticalRequirement(`${category} ${requirement}`)) return false;
    if (DEGREE_OR_EQUIVALENT_RE.test(requirement)) return false;
    if (requirementIsPreferredOnly(requirement, category, grounding?.jobText)) return false;
    if (!ELIGIBILITY_BLOCKER.test(`${category} ${requirement}`)) return false;
    const importance = enumValue(row.importance, REQUIREMENT_IMPORTANCE, "medium");
    if (importance !== "critical" && importance !== "high") return false;
    const rawTailoredStatus = enumValue(row.tailoredStatus ?? row.status, COVERAGE_STATUSES, "missing");
    const tailoredEvidence = clippedString(row.tailoredEvidence ?? row.where, 300);
    const tailoredCorpus = String(grounding?.tailoredResume ?? "");
    const tailored = effectiveCoverageClaim(
      rawTailoredStatus,
      tailoredEvidence,
      tailoredCorpus,
      grounding !== undefined,
      requirement
    );
    // Formal eligibility is binary: adjacent experience cannot satisfy a
    // required clearance/license/work-authorization gate. Only a grounded
    // covered claim clears the blocker.
    return tailored.status !== "covered";
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
export function missingRequiredFromCoverage(rawCoverage: unknown, grounding?: RequirementCoverageGrounding): number {
  return sanitizeRequirementCoverage(rawCoverage, grounding).filter((row) =>
    row.bucket !== "preferred" &&
    !isLogisticalRequirement(`${row.category} ${row.requirement}`) &&
    !requirementIsPreferredOnly(row.requirement, row.category, grounding?.jobText) &&
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

export function applyGapCapsAndVerdict(
  aiScore: AiScore | null,
  strictReview: StrictReviewLike,
  hasCoverageBlocker: boolean = false,
  coverageMissingCount: number = 0
) {
  // Array.isArray(strictReview?.gaps) truthiness proves strictReview non-null.
  const gaps = Array.isArray(strictReview?.gaps) ? strictReview!.gaps! : [];
  const capGaps = gaps.filter((gap) =>
    gap.capEligible !== false &&
    !isLogisticalRequirement(gap.gap) &&
    !DEGREE_OR_EQUIVALENT_RE.test(String(gap.gap ?? ""))
  );
  // A BLOCKER gap OR a synthetic eligibility blocker from the coverage table
  // (missing critical/high clearance/work-auth/license/cert/degree row) forces
  // the DON'T APPLY band, regardless of HIGH-gap count OR score availability.
  const hasBlocker = hasCoverageBlocker || capGaps.some((gap) => gap.severity === "BLOCKER");
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
    capGaps.filter((gap) => gap.severity === "HIGH").length,
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
