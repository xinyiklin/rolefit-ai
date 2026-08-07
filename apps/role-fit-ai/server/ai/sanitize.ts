// Validation and reconciliation for structured tailoring output. Kept separate
// from provider clients so response-shaping rules are easy to find and test.

import {
  findUngroundedClaimTerm,
  findUngroundedOutcomeClaim,
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
  // Exact mark tokens are safe only when they are properly nested and closed.
  // An orphan <b> or misnested <b><i>...</b></i> previously passed this scan
  // and stored malformed inline state in the editor.
  const stack: string[] = [];
  for (const match of text.matchAll(/<(\/)?(b|i|u)>/gi)) {
    const tag = match[2].toLowerCase();
    if (!match[1]) stack.push(tag);
    else if (stack.pop() !== tag) return true;
  }
  if (stack.length) return true;
  return /<\/?[a-z][^>]*>/i.test(text.replace(/<\/?(?:b|i|u)>/gi, ""));
}

const EVIDENCE_BOILERPLATE = new Set([
  // Source-attribution scaffolding is not part of the factual claim. Models
  // routinely prefix a close quote with phrases such as "the honest context
  // explicitly states" or "the user confirms"; requiring those narrator words
  // to appear inside the user's evidence incorrectly rejects an otherwise exact
  // quote. The substantive words (tool names, proficiency, responsibilities,
  // recency, etc.) remain outside this set and must still all be grounded.
  "according", "all", "and", "already", "attests", "bullet", "bullets", "candidate", "clearly", "current",
  "confirms", "contains", "context", "demonstrates", "describes", "directly", "documents", "entry", "evidence",
  "exact", "existing", "experience", "explicit", "explicitly", "for", "includes",
  "from", "honest", "indicates", "list", "listed", "lists", "mentions", "notes", "project", "projects", "provided",
  "quote", "quotes", "reports", "resume", "role", "row", "says", "section", "shows", "skills", "source",
  "states", "that", "the", "this", "three", "tool", "tools", "used", "user", "uses", "using", "with", "within"
]);

export function evidenceIsGrounded(value: unknown, grounding: unknown): boolean {
  // Keep internal periods for names such as node.js/.NET, but free sentence-end
  // punctuation before tokenizing. Without this, every normal evidence sentence
  // ended in an impossible token such as "review." or "powerpoint." and was
  // rejected even when the exact word appeared in honest context.
  const evidenceText = String(value ?? "").toLowerCase().replace(/\.(?=\s|$)/g, " ");
  const tokens = (evidenceText.match(/[a-z0-9.#+]{3,}/g) ?? [])
    .filter((token) => !EVIDENCE_BOILERPLATE.has(token));
  if (!tokens.length) return false;
  const grounded = tokens.filter((token) => isTermGrounded(token, grounding)).length;
  // The prompt permits a close paraphrase, so one derivational wording change
  // ("proficiency" for "proficient") must not invalidate a longer exact quote.
  // Require at least 75% token grounding; short evidence remains effectively
  // exact (1/1, 2/2, and 3/3). Proposed tool/claim/number gates below still
  // validate the actual resume wording independently of this locator prose.
  return grounded >= Math.ceil(tokens.length * 0.75);
}

function sameClaimTokenSet(left: unknown, right: unknown): boolean {
  const tokens = (value: unknown) => [...new Set(
    (String(value ?? "").toLowerCase().match(/[a-z0-9.#+]+/g) ?? [])
  )].sort().join("|");
  return tokens(left) === tokens(right);
}

const SMALL_NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19
};
const TENS_NUMBER_WORDS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90
};
const SMALL_NUMBER_PATTERN = Object.keys(SMALL_NUMBER_WORDS).join("|");
const TENS_NUMBER_PATTERN = Object.keys(TENS_NUMBER_WORDS).join("|");
const WORD_NUMBER_PATTERN =
  `(?:${SMALL_NUMBER_PATTERN}|(?:${TENS_NUMBER_PATTERN})(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?)`;
const DIGIT_NUMBER_PATTERN = String.raw`\d[\d,_]*(?:\.\d+)?`;
const DURATION_CLAIM_PATTERN = new RegExp(
  String.raw`\b(${DIGIT_NUMBER_PATTERN}|${WORD_NUMBER_PATTERN})\s*(?:\+|plus)?\s+(years?|months?|weeks?|days?|hours?)\b`,
  "gi"
);

type NumericClaim = { key: string; display: string };

function normalizedDigit(value: string): string {
  return value.replace(/[, _]/g, "").replace(/^0+(?=\d)/, "");
}

function normalizedWordNumber(value: string): string | null {
  const parts = value.toLowerCase().replace(/-/g, " ").split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    const number = SMALL_NUMBER_WORDS[parts[0]] ?? TENS_NUMBER_WORDS[parts[0]];
    return number === undefined ? null : String(number);
  }
  if (parts.length === 2 && TENS_NUMBER_WORDS[parts[0]] !== undefined) {
    const ones = SMALL_NUMBER_WORDS[parts[1]];
    if (ones !== undefined && ones > 0 && ones < 10) {
      return String(TENS_NUMBER_WORDS[parts[0]] + ones);
    }
  }
  return null;
}

function normalizedNumber(value: string): string | null {
  return /^\d/.test(value) ? normalizedDigit(value) : normalizedWordNumber(value);
}

function numericClaims(value: unknown): NumericClaim[] {
  const text = String(value ?? "");
  const claims: NumericClaim[] = [];
  const seen = new Set<string>();
  const push = (key: string, display: string) => {
    if (!key || seen.has(key)) return;
    seen.add(key);
    claims.push({ key, display });
  };

  for (const match of text.matchAll(DURATION_CLAIM_PATTERN)) {
    const number = normalizedNumber(match[1]);
    if (!number) continue;
    const unit = match[2].toLowerCase().replace(/s$/, "");
    push(`duration:${unit}:${number}`, match[0]);
    push(`number:${number}`, match[1]);
  }

  for (const match of text.matchAll(/\d[\d,_]*(?:\.\d+)?/g)) {
    const number = normalizedDigit(match[0]);
    if (number) push(`number:${number}`, match[0]);
  }
  return claims;
}

export function findUngroundedNumericClaim(value: unknown, grounding: unknown): string | null {
  const grounded = new Set(numericClaims(grounding).map((claim) => claim.key));
  return numericClaims(value).find((claim) => !grounded.has(claim.key))?.display ?? null;
}

export function hasUngroundedNumericClaim(value: unknown, grounding: unknown): boolean {
  return findUngroundedNumericClaim(value, grounding) !== null;
}

export function gapIsGroundedInJob(value: unknown, jobText: unknown): boolean {
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
    if (!section || typeof section !== "object") continue;
    parts.push(section.heading ?? "");
    if (!Array.isArray(section.entries)) continue;
    for (const entry of section.entries) {
      if (!entry || typeof entry !== "object") continue;
      parts.push(entry.titleLeft, entry.titleRight, entry.subtitleLeft, entry.subtitleRight);
      if (!Array.isArray(entry.bullets)) continue;
      for (const bullet of entry.bullets) {
        if (bullet && typeof bullet === "object") parts.push(bullet.text);
      }
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
  const seenIds = new Set<string>();
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
    const proposedText = String(rawProposedText ?? "").replace(/\s+/g, " ").trim();
    // Never silently turn an overlong model response into a different, possibly
    // malformed claim. In particular, slicing could cut a closing inline mark
    // or sentence midway and still let the altered text reach Apply.
    if (proposedText.length > 1400) { drop("overlongProposedText"); continue; }
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
    if (findUngroundedOutcomeClaim(proposedText, grounding)) {
      drop("ungroundedOutcome");
      continue;
    }
    let id = clippedString(item.id, 120);
    if (!id || seenIds.has(id)) {
      let ordinal = output.length + 1;
      do id = `suggestion-${ordinal++}`; while (seenIds.has(id));
    }
    seenIds.add(id);
    output.push({
      id,
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
  "ungroundedJdTerm", "ungroundedNumber", "ungroundedClaimTerm", "ungroundedOutcome"
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
