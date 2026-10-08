import { CANDIDATE_CONTEXT_CHAR_LIMIT, linkProfileBlocks, profileHeadings, profileTextOnResume } from "../../shared/candidateProfileContract.ts";
import { sanitizeContentWarnings } from "../../shared/contentWarnings.ts";
import { affirmativeTerm, jobTerminology, unsupportedTerminology, type JobTerm } from "../../src/resume/terminology.ts";
import { templateHasUnresolvedSlots } from "../../src/lib/coverLetterTemplate.ts";
import { OWNERSHIP_ISSUE, affirmativeEvidence, affirmativeEvidenceForTerm, candidateClaimIssue, evidencePolarity, evidenceSegments, explicitAdviceClaims } from "./claimEvidence.ts";
import {
  NEW_BULLETS_PER_ENTRY,
  RESUME_POLISH_STATUSES,
  sanitizeResumePolishAdvice,
  type FlatResumeTarget,
  type ResumePolishStatus,
  type ResumePolishWithheldReason,
  type ResumePolishWireChange,
  type ResumePolishWireResult,
  flattenResumeTargets
} from "../../shared/resumePolishContract.ts";
import { callConfiguredProvider } from "./clients.ts";
import {
  actionVerbPast,
  declaresSoloProject,
  findCountWithUnstatedPurpose,
  findUngroundedClaimTerm,
  findUngroundedJdTerm,
  findUngroundedOutcomeClaim,
  findUngroundedProseProperClaimTerm,
  hasUnsupportedOwnershipIncrease,
  isClaimTermGroundedInSource,
  isTermGrounded,
  ownershipStrength,
  soloProjectSupportsAuthorship
} from "./grounding.ts";
import {
  accomplishmentStyleRules,
  clipForPrompt,
  fenceUntrusted,
  inputFirewallRule,
  polishSelfAuditInstructions
} from "./prompts.ts";
import { resolveProviderRequest } from "./providers.ts";
import { reviewResumeProposal, withResumeProposalReview } from "./resumeProposalReview.ts";
import { containsStructuredMarkup, findUngroundedNumericClaim } from "./sanitize.ts";
import type { NormalizedResumeScope } from "./resumeScope.ts";
import { UserSafeAiError } from "./errors.ts";

type AttemptStats = { attempts?: number };
type DropCounts = Record<ResumePolishWithheldReason, number>;

const VALID_STATUSES = new Set<string>(RESUME_POLISH_STATUSES);

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

const PROMPT_TARGET_BUDGET = 42_000;
// Only the first items in this window are eligible for examination. A longer
// response records its tail as malformed, so truncation can never settle as
// NO_CHANGES.
const MAX_EXAMINED_CHANGES = 40;
// Usable changes returned to the client. The prompt states this limit so the
// model orders its list by value; selection keeps its order, not the kind order.
const RESULT_CHANGE_LIMIT = 12;
const JOB_TERM_STOP_WORDS = new Set([
  "and", "are", "for", "from", "have", "role", "that", "the", "this", "with", "you", "your"
]);

type PromptTarget = Pick<FlatResumeTarget, "targetId" | "kind" | "section" | "currentText" | "target"> & { bullets?: string[] };

function matchingJobTermCount(text: string, jobTerms: Set<string>): number {
  const targetTerms = new Set(text
    .toLowerCase()
    .match(/[a-z0-9+#.]{3,}/g) ?? []);
  let matches = 0;
  for (const term of targetTerms) {
    if (jobTerms.has(term)) matches += 1;
  }
  return matches;
}

function targetPriority(target: FlatResumeTarget, jobTerms: Set<string>): number {
  const kindPriority = target.kind === "bullet"
    ? 40
    : target.kind === "skill-list"
      ? 35
      : 15;
  const summaryPriority = target.sectionType === "summary" ? 45 : 0;
  return kindPriority + summaryPriority + Math.min(12, matchingJobTermCount(`${target.section} ${target.currentText}`, jobTerms)) * 10;
}

export function selectPromptTargets(targets: FlatResumeTarget[], jobText: string): {
  selectedTargets: FlatResumeTarget[];
  omittedCount: number;
  serialized: string;
} {
  const jobTerms = new Set((jobText.toLowerCase().match(/[a-z0-9+#.]{3,}/g) ?? [])
    .filter((term) => !JOB_TERM_STOP_WORDS.has(term)));
  // Order targets and new-bullet slots only take budget the existing targets
  // leave, so neither changes which existing fields this pass can edit.
  const ranked = [
    ...targets
      .filter((target) => target.kind !== "new-bullet" && target.kind !== "bullet-order")
      .map((target, index) => ({ target, index, priority: targetPriority(target, jobTerms) }))
      .sort((left, right) =>
        right.priority - left.priority
        || left.target.section.localeCompare(right.target.section)
        || left.index - right.index
      ),
    ...targets
      .filter((target) => target.kind === "bullet-order")
      .map((target, index) => ({ target, index, priority: 0 })),
    ...targets
      .filter((target) => target.kind === "new-bullet")
      .map((target, index) => ({ target, index, priority: matchingJobTermCount(target.profileText, jobTerms) }))
      .sort((left, right) => right.priority - left.priority || left.index - right.index)
  ];
  const selectedTargets: FlatResumeTarget[] = [];
  const promptTargets: PromptTarget[] = [];
  const entries: { sectionId: string; entryId: string; text: string }[] = [];
  let serialized = JSON.stringify({ entries, targets: promptTargets });
  for (const { target } of ranked) {
    // An order must be a complete permutation, so every bullet it names must be editable.
    if (target.bulletTargetIds && !target.bulletTargetIds.every((id) => selectedTargets.some((item) => item.targetId === id))) continue;
    const candidate: PromptTarget = {
      targetId: target.targetId,
      kind: target.kind,
      section: target.section,
      currentText: target.currentText,
      target: target.target,
      ...(target.bulletTargetIds ? { bullets: target.bulletTargetIds } : {})
    };
    const entry = { sectionId: target.target.sectionId, entryId: target.target.entryId, text: target.entryText };
    const nextEntries = entries.some((item) => item.sectionId === entry.sectionId && item.entryId === entry.entryId)
      ? entries
      : [...entries, entry];
    const nextSerialized = JSON.stringify({ entries: nextEntries, targets: [...promptTargets, candidate] });
    if (nextSerialized.length > PROMPT_TARGET_BUDGET) continue;
    if (nextEntries !== entries) entries.push(entry);
    promptTargets.push(candidate);
    selectedTargets.push(target);
    serialized = nextSerialized;
  }
  // Unsent order targets and new-bullet slots are not existing fields, so they never count as omitted.
  const fieldCount = (list: FlatResumeTarget[]) =>
    list.filter((target) => target.kind !== "bullet-order" && target.kind !== "new-bullet").length;
  return { selectedTargets, omittedCount: fieldCount(targets) - fieldCount(selectedTargets), serialized };
}

export function buildResumeProposalPrompts({
  jobText,
  targets,
  scopeText,
  candidateContext,
  customInstructions,
  boldBulletKeywords = true,
  reasoningEffort,
  adviceSources = "",
  sourceWarnings = []
}: {
  jobText: string;
  targets: FlatResumeTarget[];
  scopeText: string;
  candidateContext: string;
  customInstructions: string;
  boldBulletKeywords?: boolean;
  reasoningEffort?: unknown;
  adviceSources?: string;
  sourceWarnings?: string[];
}) {
  const targetSelection = selectPromptTargets(targets, jobText);
  const auditInstructions = polishSelfAuditInstructions(reasoningEffort);
  const entryProfiles = [...new Map(targetSelection.selectedTargets
    .filter((target) => target.profileText)
    .map((target) => [`${target.target.sectionId}\u0000${target.target.entryId}`, {
      sectionId: target.target.sectionId,
      entryId: target.target.entryId,
      profile: target.profileText
    }])).values()];
  const profileHasHeadings = profileHeadings(candidateContext).length > 0;
  const removableBullets = targetSelection.selectedTargets.some((target) => target.kind === "bullet" && target.sectionType === "standard");
  const orderTargets = targetSelection.selectedTargets.some((target) => target.kind === "bullet-order");
  const systemPrompt = `You are a careful resume editor. Return exactly one JSON object and no markdown.

${inputFirewallRule()}

Propose only material, truthful improvements supported by the candidate's resume or explicit context. Never invent or relocate employers, titles, dates, education, tools, metrics, outcomes, eligibility, or experience. Keep identity, contact, education, dates, omitted sections, and read-only context unchanged.`;
  const userPrompt = `Polish the editable resume targets for this job in one pass.

<job_description>
${fenceUntrusted(clipForPrompt(jobText, 24_000, "job posting"))}
</job_description>

<editable_targets>
${fenceUntrusted(targetSelection.serialized)}
</editable_targets>

<earlier_output_concerns>
${fenceUntrusted(JSON.stringify(sourceWarnings))}
</earlier_output_concerns>

<resume_context>
${fenceUntrusted(clipForPrompt(scopeText, 28_000, "resume context"))}
</resume_context>

<evidence_items>
${fenceUntrusted(clipForPrompt(adviceSources, 12_000, "optional advice source references"))}
</evidence_items>

<candidate_context>
${fenceUntrusted(clipForPrompt(candidateContext, CANDIDATE_CONTEXT_CHAR_LIMIT, "candidate context")) || "Not provided."}
</candidate_context>
${entryProfiles.length ? `
<entry_profiles>
${fenceUntrusted(JSON.stringify(entryProfiles))}
</entry_profiles>
` : ""}
<user_guidance>
${fenceUntrusted(clipForPrompt(customInstructions, 3_000, "user guidance")) || "Not provided."}
</user_guidance>

Rules:
- Return only targetId values from editable_targets.targets. Entry evidence is listed once in editable_targets.entries and joined by sectionId and entryId.
- replacement must be a complete replacement for currentText, not instructions or commentary.
- user_guidance holds the candidate's standing preferences for this resume. Follow them when they fit these rules: they may narrow, order, or shorten edits, but never authorize an unsupported claim, a posting-only skill, or a change to a locked field.
${boldBulletKeywords
  ? "- Preserve supported inline <b>, <i>, and <u> marks when relevant; return no other markup or newlines."
  : "- Preserve supported inline <b>, <i>, and <u> marks when relevant, except never use <b> in a bullet replacement; return no other markup or newlines."}
- skill-list contains actual skills only. It may reorder, deduplicate, or surface skills already supported by the resume or candidate context.
- Skill category labels are locked and never appear in editable_targets. Never replace a skill list with a category label.
- A new skill may come only from the resume or candidate context, never merely from the job description.
- A real skill may be added to a skill-list or Summary target from the whole resume/context. A project or experience rewrite may use only facts grounded in that same entry or its entry_profiles text; another entry's profile text and the rest of candidate_context are never evidence for it.
- Preserve same-entry attribution; negative or aspirational text is not evidence.
- Never combine separate facts into a new claim: a database and a pipeline mentioned separately are not a database-backed pipeline, helping a team is not doing its work, and a broader posting term (CI/CD for CI) is a new claim. Keep a project's listed tools when they matter for this job, without adding how they were used.
- Preserve supporting-role and team wording (assisted, helped, supported, part of a team) instead of promoting it to direct execution or ownership, even when adding "with" or "alongside" teammates.
- Prefer posting terminology when supported. Preserve clear mentions of important supported requirements somewhere in the resume. True aliases are equivalent; related tools or partial composites are not. Never stuff keywords or copy posting sentences.
<terminology_priorities>
${fenceUntrusted(JSON.stringify(jobTerminology(jobText).terms.map(({ keyword, category }) => ({ keyword, category }))))}
</terminology_priorities>
- Every change must change what a screener learns or how quickly they find it: surface buried job-relevant evidence, rewrite filler or a feature tour into the one claim that matters, or use the posting's term when it names exactly what the same entry shows. Omit churn: tense-only changes, synonym swaps (Cut to Reduced, Moved to Migrated), and rephrasing a bullet that is already specific and relevant. Leave strong bullets unchanged; NO_CHANGES is correct when nothing material remains.
- Keep the candidate's accurate verbs, and keep any number you retain with the noun it counts, exactly as written. Never compute a new total, such as years of experience from dates.
- Omit weak, cosmetic, unchanged, or unsupported edits. Do not explain evidence metadata.
- At most ${RESULT_CHANGE_LIMIT} changes are kept, in the order you list them. Put the changes that matter most for this job first; do not pad the list.
${removableBullets ? `- To cut a project or experience bullet, return its targetId with "action": "remove" and a reason instead of a replacement. Remove only a bullet clearly irrelevant to this job or redundant with a stronger bullet, never the only evidence of a job requirement, and never every bullet of an entry. A bullet is rewritten or removed, not both.
` : ""}${orderTargets ? `- A bullet-order target lists its entry's bullet targetIds in current order. To lead with the most job-relevant evidence, return its targetId with "order": the same targetIds in the new order, and a reason. Never reorder for cosmetic reasons. An entry gets removals or one reorder, never both: if you remove any bullet from an entry, omit that entry's bullet-order target.
` : ""}
- summary is optional concise feedback, maximum 3 items.
- advice is optional editorial guidance about emphasis, order, space, or missing evidence. Cite exact job and entry excerpts. Advice never supplies replacement text or asserts new candidate facts.
${entryProfiles.length ? `- A new-bullet target adds one bullet at the end of its entry. Write it only from that entry's entry_profiles text, only when it adds material job-relevant evidence the entry does not already show, and never repeat an existing bullet. Use only the add targets whose target.entryId is that entry (at most ${NEW_BULLETS_PER_ENTRY} per entry), and copy that entryId into the change. Omit unused new-bullet targets.
- Set "evidence": "profile" on any change that relies on entry_profiles text.
` : ""}${profileHasHeadings ? `- advice may add profileExcerpt, an exact candidate_context excerpt. Use kind add-from-profile, with empty sectionId and entryId, only for a candidate_context heading block that matches the job and names no resume entry.
` : ""}
${accomplishmentStyleRules(true)}

${auditInstructions}

Return this shape:
{
  "status": "PROPOSAL | NO_CHANGES | WITHHELD",
  "changes": [
    { "targetId": "target-1", "replacement": "complete replacement", "reason": "short optional reason"${entryProfiles.length ? ', "evidence": "profile"' : ""} }${removableBullets ? ',\n    { "targetId": "target-2", "action": "remove", "reason": "why it does not serve this job" }' : ""}${orderTargets ? ',\n    { "targetId": "order-1", "order": ["target-4", "target-3"], "reason": "why this order serves this job" }' : ""}${entryProfiles.length ? ',\n    { "targetId": "add-1", "entryId": "the target entryId", "replacement": "one new bullet", "evidence": "profile" }' : ""}
  ],
  "summary": ["up to 3 material improvements"],
  "advice": [{"kind":"emphasis | order | space | missing-evidence${profileHasHeadings ? " | add-from-profile" : ""}", "sectionId":"existing id", "entryId":"existing id", "jobExcerpt":"exact posting excerpt", "candidateExcerpt":"exact same-entry evidence"${profileHasHeadings ? ', "profileExcerpt":"optional exact candidate_context excerpt"' : ""}, "rationale":"short optional structural suggestion; never an edit or invented fact"}]
}`;
  return { systemPrompt, userPrompt, ...targetSelection };
}

function increment(counts: DropCounts, reason: ResumePolishWithheldReason): void {
  counts[reason] += 1;
}

function stripInlineMarks(value: string): string {
  return value.replace(/<\/?(?:b|i|u)>/gi, "").trim();
}

function plainText(value: string): string {
  return stripInlineMarks(value).replace(/\s+/g, " ").trim().toLowerCase();
}

function stripBoldMarks(value: string): string {
  return value.replace(/<\/?b>/gi, "").replace(/\s+/g, " ").trim();
}

function normalizedSkillText(value: string): string {
  return stripInlineMarks(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9.+#/&-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const LABEL_WORD = String.raw`(?:languages?|frameworks?|libraries|cloud|devops|databases?|tools?|platforms?|technologies|skills|software)`;
// Only inside a compound label ("Data & Analytics"); alone they name real skills.
const COMPOUND_LABEL_WORD = String.raw`(?:${LABEL_WORD}|data|analytics|methods?)`;
const LABEL_QUALIFIER = String.raw`(?:(?:programming|technical|developer|web|cloud|data|other)\s+)?`;
// Labels are built only from category words ("Developer Tools", "Languages &
// Frameworks"); "Google Cloud" and "Data Analytics" contain one but are skills.
const SKILL_CATEGORY_LABEL = new RegExp(String.raw`^${LABEL_QUALIFIER}(?:${LABEL_WORD}|${COMPOUND_LABEL_WORD}(?:\s*(?:&|and|/)\s*${LABEL_QUALIFIER}${COMPOUND_LABEL_WORD})+)$`, "i");
const PROFICIENCY = /^(?:advanced|basic|beginner|intermediate|proficient|expert|fluent|native|certified|familiar|conversational)$/i;

// A row's label is the first line of its entry text unless the row has none.
function skillRowLabel(target: FlatResumeTarget): string {
  const first = target.entryText.split("\n")[0] ?? "";
  return first === target.currentText ? "" : normalizedSkillText(first).replace(/-/g, " ");
}

// The head and each parenthetical part are checked: "Docker (Developer Tools)".
function isSkillCategoryLabel(value: string, rowLabels: Set<string>): boolean {
  const text = stripInlineMarks(value);
  return text.includes(":") || text.split(/[(),]/).map((part) => normalizedSkillText(part).replace(/-/g, " ")).filter(Boolean)
    .some((part) => SKILL_CATEGORY_LABEL.test(part) || rowLabels.has(part));
}

// A name inside an interface list; "the AWS SDK" is not a listed name.
const LISTED_NAME = String.raw`(?!(?:the|a|an|our|their|its|my)\b)[\w.+#-]+(?:\s+[\w.+#-]+)?`;
const PROVIDER_LIST = /\b(API|SDK|CLI)s?\s+(?:providers?|vendors?)\s*\(([^()]*)\)/gi;

// "OpenAI API" is supported only where the evidence attaches that interface to the
// name: "OpenAI API", "OpenAI and Anthropic APIs", or "API providers (OpenAI,
// Anthropic)", never "Docker and the AWS SDKs" or "REST APIs (Django, PostgreSQL)".
function interfaceItemSupported(head: string, grounding: string): boolean {
  const [, name = "", kind = ""] = head.match(/^(.+?)\s+(API|SDK|CLI)s?$/i) ?? [];
  if (!name || !affirmativeEvidenceForTerm(name, grounding)) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const attached = new RegExp(String.raw`(?<![\w.+#-])${escaped}(?:\s+${kind}s?\b|(?:\s*,\s*${LISTED_NAME})*\s*,?\s+(?:and|or|&)\s+${LISTED_NAME}\s+${kind}s\b)`, "i");
  const listed = (segment: string) => [...segment.matchAll(PROVIDER_LIST)].some(([, listKind = "", items = ""]) =>
    listKind.toLowerCase() === kind.toLowerCase()
    && items.split(/\s*(?:,|\band\b|\bor\b|&)\s*/i).some((item) => item.trim().toLowerCase() === name.toLowerCase()));
  return evidenceSegments(grounding).some((segment) => evidencePolarity(segment) === "affirmative" && (attached.test(segment) || listed(segment)));
}

const AI_CODING_TOOL = /\b(?:Claude Code|GitHub Copilot|Gemini CLI|Aider|Antigravity)\b/;
// These names have other meanings, so their line must also be about coding.
const AMBIGUOUS_AI_CODING_TOOL = /\b(?:Codex|Copilot|Cursor|Windsurf)\b/;
const CODING_WORK = /\b(?:cod(?:e|ing)|debug\w*|implement\w*|refactor\w*|pull requests?|PRs?|test\w*|develop\w*|program\w*)\b/i;
const GENERIC_AI_ASSISTED_WORK = /^(?:software\s+)?(?:development|coding|programming|engineering)$/i;

// "AI-assisted code review" is grounded by one line that names an AI coding tool and
// that activity; development itself needs only the tool. Returns those lines.
function aiAssistedEvidence(head: string, grounding: string): string {
  const activity = head.match(/^AI-assisted\s+(.+)$/i)?.[1];
  if (!activity) return "";
  const namesTool = (segment: string) => AI_CODING_TOOL.test(segment) || (AMBIGUOUS_AI_CODING_TOOL.test(segment) && CODING_WORK.test(segment));
  const segments = evidenceSegments(grounding);
  if (segments.some((segment) => evidencePolarity(segment) === "denied"
    && (isTermGrounded(head, segment) || (namesTool(segment) && isTermGrounded(activity, segment))))) return "";
  return segments.filter((segment) => evidencePolarity(segment) === "affirmative" && namesTool(segment)
    && (GENERIC_AI_ASSISTED_WORK.test(activity) || isTermGrounded(activity, segment))).join("\n");
}

// A parenthetical names parts of its head ("AWS (S3, EC2)"); each part needs
// evidence beside that head, so "Azure (Functions)" is not two separate mentions.
// Under an interface head, each name needs that interface attached to it:
// "OpenAI and Anthropic APIs", "LLM APIs (OpenAI, Anthropic)".
function skillItemSupported(item: string, grounding: string): boolean {
  if (/\)\s*\S/.test(item)) return false;
  const [head = "", ...parts] = item.split(/[(),;|]/).map((part) => part.trim()).filter(Boolean);
  const [, joined = "", kind = ""] = head.match(/^(.+?)\s+(API|SDK|CLI)s$/i) ?? [];
  const names = joined.split(/\s+(?:and|&)\s+|\s*\/\s*/i);
  const hasInterface = (name: string) => Boolean(kind) && interfaceItemSupported(`${name} ${kind}`, grounding);
  const aiAssisted = aiAssistedEvidence(head, grounding);
  const headSupported = affirmativeEvidenceForTerm(head, grounding) || interfaceItemSupported(head, grounding)
    || (names.length > 1 && names.every(hasInterface)) || Boolean(aiAssisted);
  if (!headSupported || parts.some((part) => PROFICIENCY.test(part))) return false;
  const besideHead = [aiAssisted, ...evidenceSegments(grounding).filter((segment) => affirmativeEvidenceForTerm(head, segment))].join("\n");
  return parts.every((part) => affirmativeEvidenceForTerm(`${head} ${part}`, grounding) || affirmativeEvidenceForTerm(part, besideHead) || hasInterface(part));
}

// A separator inside parentheses belongs to its item: "AWS (S3, EC2)".
function splitSkillList(value: string): string[] {
  return stripInlineMarks(value)
    .split(/[,;|](?![^()]*\))/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function skillListIssue(replacement: string, target: FlatResumeTarget, grounding: string, rowLabels: Set<string>): string | null {
  const items = splitSkillList(replacement);
  if (!items.length || items.length > 30) return "Skills list length is unusable";
  const currentItems = new Set(splitSkillList(target.currentText).map(normalizedSkillText));
  const seen = new Set<string>();
  for (const item of items) {
    const key = normalizedSkillText(item);
    const words = item.match(/[A-Za-z0-9+#.-]+/g) ?? [];
    const shown = item.length > 80 ? `${item.slice(0, 80)}…` : item;
    if (seen.has(key)) return `Repeated skill: ${shown}`;
    if (!key || words.length > 8 || /[.!?]$/.test(item)) return `Not a skill name: ${shown}`;
    if (!currentItems.has(key)) {
      if (isSkillCategoryLabel(item, rowLabels)) return `Category label or qualifier, not a skill: ${shown}`;
      if (!skillItemSupported(item, grounding)) return `Skill not found in the resume or Profile: ${shown}`;
    }
    seen.add(key);
  }
  return null;
}

function markedText(value: string): string {
  return [...value.matchAll(/<([biu])>(.*?)<\/\1>/gi)].map((match) => `${match[1].toLowerCase()}:${match[2]}`).join("\n");
}

// The posting may name a skill by its head, a parenthetical part, or one word of it.
function postingNamesSkill(item: string, jobText: string, postingTerms: JobTerm[]): boolean {
  const parts = [item, ...item.split(/[\s(),/]+/)].map((part) => part.trim()).filter((part) => part.length > 1);
  return parts.some((part) => isTermGrounded(part, jobText) || isClaimTermGroundedInSource(part, jobText))
    || postingTerms.some(({ keyword }) => affirmativeTerm(item, keyword));
}

// Reordering the same skills, written and marked the same, is an edit only when it
// moves a skill the posting names forward.
function isImmaterialSkillOrder(replacement: string, current: string, jobText: string, postingTerms: JobTerm[]): boolean {
  const exact = (value: string) => splitSkillList(value).map((item) => item.replace(/\s+/g, " "));
  const after = exact(replacement);
  const before = exact(current);
  if (after.length !== before.length || markedText(replacement) !== markedText(current) || !after.every((item) => before.includes(item))) return false;
  return !after.some((item, index) => before.indexOf(item) > index && postingNamesSkill(item, jobText, postingTerms));
}

// Whole words as written, so a casing, symbol, or spelling change is a new word;
// only tense and number inflect ("Builds", "Built"). `raw` keeps the word itself.
function rewriteTokens(value: string): { raw: string; stem: string }[] {
  return stripInlineMarks(value).split(/\s+/)
    .map((word) => word.replace(/^[("'\u201c]+|[)"'\u201d.,;:!?]+$/g, ""))
    .filter(Boolean)
    .map((raw) => ({ raw, stem: actionVerbPast(raw) ?? raw.replace(/(?:ing|ed|es|s)$/, "") }));
}

// Deleting one of these narrows what a bullet claims ("Solely built", "critical
// tools", "senior", "three"), so the edit is a correction to review, never a no-op
// trim. Deleting a negation or hedge ("not", "nearly") widens the claim instead;
// that stays a dropped no-op rather than an unwarned inflation.
export const NARROWING_CLAIM_WORDS = new Set([
  "solely", "sole", "alone", "only", "single-handedly", "independently", "personally", "entirely", "fully",
  "all", "every", "each", "entire", "whole", "critical", "key", "major", "primary", "core", "mission-critical",
  "production", "enterprise", "large-scale", "company-wide", "org-wide", "first", "most", "many", "multiple", "several",
  "senior", "lead", "principal", "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "dozen", "dozens", "hundred", "hundreds", "thousand", "thousands", "million", "millions", "billion", "billions",
  "double", "triple", "half"
]);

// A rewrite that adds no word, keeps the rest in order and marked alike, cuts
// under 15%, and deletes no narrowing claim word or number leaves the resume
// saying the same thing: a no-op, never a reviewable edit.
function isImmaterialRewrite(replacement: string, current: string): boolean {
  const before = rewriteTokens(current);
  const kept = new Set<number>();
  let next = 0;
  for (const { stem } of rewriteTokens(replacement)) {
    next = before.findIndex((token, index) => index >= next && token.stem === stem) + 1;
    if (!next) return false;
    kept.add(next - 1);
  }
  const deletesClaim = before.some(({ raw }, index) => !kept.has(index)
    && (NARROWING_CLAIM_WORDS.has(raw.toLowerCase()) || /\d/.test(raw)));
  return !deletesClaim
    && markedText(replacement) === markedText(current)
    && stripInlineMarks(replacement).length >= stripInlineMarks(current).length * 0.85;
}

// An experience or project entry is grounded only by its own text and the
// Profile text linked to it; Skills and Summary draw on the whole resume and Profile.
function entryGrounding(target: FlatResumeTarget, withProfile = true): string {
  return withProfile && target.profileText ? `${target.entryText}\n${target.profileText}` : target.entryText;
}

// Evidence concerns in a replacement, one per kind of check, worded for the review rail.
function replacementIssues(
  replacement: string,
  target: FlatResumeTarget,
  { jobText, scopeText, candidateContext, rowLabels }: { jobText: string; scopeText: string; candidateContext: string; rowLabels: Set<string> },
  withProfile = true
): string[] {
  const wholeResumeGrounding = `${scopeText}\n${candidateContext}`;
  const skillIssue = target.kind === "skill-list" ? skillListIssue(replacement, target, wholeResumeGrounding, rowLabels) : null;
  if (skillIssue) return [skillIssue];
  const standard = target.sectionType === "standard";
  const grounding = standard ? entryGrounding(target, withProfile) : wholeResumeGrounding;
  const ownershipEvidence = affirmativeEvidence(standard ? grounding : `${target.entryText}\n${candidateContext}`);
  // A hyphenated practice ("AI-assisted code review", "Test-driven development") is a
  // skill, not an ownership claim; a role phrase such as "Team Lead" still is.
  const practice = (value: string) => target.kind === "skill-list" ? value.replace(/\b(?!co-)[\w.+#]+-(?:assisted|supported|driven|led|managed|owned|leading)\b/gi, "") : value;
  const baseline = target.kind === "skill-list" ? replacement : target.currentText;
  const claimIssue = candidateClaimIssue(replacement, grounding, baseline, ownershipEvidence);
  const ownWork = standard && withProfile && Boolean(target.profileText) && declaresSoloProject(target.profileText)
    && soloProjectSupportsAuthorship(replacement, target.currentText, ownershipEvidence);
  const ownership = !ownWork && (claimIssue === OWNERSHIP_ISSUE
    || hasUnsupportedOwnershipIncrease(replacement, baseline, ownershipEvidence, undefined, { presentLead: target.kind !== "skill-list" })
    || (target.kind === "skill-list" && hasUnsupportedOwnershipIncrease(practice(replacement), practice(target.currentText), ownershipEvidence)));
  // The entry uses a verb this strong elsewhere, but no one line ties it to this claim.
  const level = ownershipStrength(replacement);
  const spread = level === 2 && ownershipStrength(target.currentText) === 0 && ownershipStrength(ownershipEvidence) >= level;
  const where = standard ? "this entry's evidence" : "the resume or Profile";
  const named = (label: string, value: string | null) => value ? `${label}: ${asWritten(value, replacement)}` : null;
  const issues = [
    claimIssue === OWNERSHIP_ISSUE ? null : claimIssue?.replace(/: (.+)$/, (_, value: string) => `: ${asWritten(value, replacement)}`) ?? null,
    ownership ? `${OWNERSHIP_ISSUE}${spread ? "; no single evidence line supports it, so check it does not merge separate facts" : ""}` : null,
    named(`Posting term not found in ${where}`, findUngroundedJdTerm(replacement, jobText.toLowerCase(), grounding.toLowerCase(), { jobText })),
    named("Unsupported measurement or duration", findUngroundedNumericClaim(replacement, grounding)),
    named("No evidence line ties this count to the purpose stated for it", target.kind === "skill-list" ? null : findCountWithUnstatedPurpose(replacement, affirmativeEvidence(grounding))),
    named(`Term not found in ${where}`, findUngroundedClaimTerm(replacement, grounding)),
    named("Unsupported outcome", findUngroundedOutcomeClaim(replacement, grounding))
  ].filter((issue): issue is string => Boolean(issue));
  // One concern per named value: a posting tool is also an unsupported technology.
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = issue.slice(issue.indexOf(": ") + 2).toLowerCase();
    return !seen.has(key) && Boolean(seen.add(key));
  }).slice(0, 3);
}

// Detectors report lowercased names; show the name as the edit writes it.
function asWritten(value: string, replacement: string): string {
  const at = stripInlineMarks(replacement).toLowerCase().indexOf(value.toLowerCase());
  return at < 0 ? value : stripInlineMarks(replacement).slice(at, at + value.length);
}

function optionalList(value: unknown, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const cleaned = text(item, maxLength).replace(/^[\s•·‣◦▪●○*\-–—]+/, "").trim();
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
    if (result.length === 3) break;
  }
  return result;
}

export function sanitizeResumeProposal(
  raw: unknown,
  targets: FlatResumeTarget[],
  jobText: string,
  scopeText: string,
  candidateContext: string,
  omittedTargetCount = 0,
  boldBulletKeywords = true
): ResumePolishWireResult {
  const source = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const targetMap = new Map(targets.map((target) => [target.targetId, target]));
  const rawChanges = Array.isArray(source.changes) ? source.changes : [];
  const baseCounts: DropCounts = { UNSUPPORTED: 0, INVALID_TARGET: 0, UNCHANGED: 0, MALFORMED: 0 };
  if (!Array.isArray(source.changes)) baseCounts.MALFORMED += 1;
  if (rawChanges.length > MAX_EXAMINED_CHANGES) {
    baseCounts.MALFORMED += rawChanges.length - MAX_EXAMINED_CHANGES;
  }
  const postingTerms = jobTerminology(jobText).terms;
  const evidence = { jobText, scopeText, candidateContext, rowLabels: new Set(targets.filter((target) => target.kind === "skill-list").map(skillRowLabel).filter(Boolean)) };

  // Rewrites are examined first, so when a rewrite and a new bullet carry the
  // same text the existing bullet is the one rewritten; a bullet both rewritten
  // and removed is never removed; an entry with removals cannot also be reordered.
  const examined = rawChanges.slice(0, MAX_EXAMINED_CHANGES);
  const examineRank = (change: unknown) => {
    if (!change || typeof change !== "object") return 0;
    const value = change as Record<string, unknown>;
    const kind = targetMap.get(text(value.targetId, 40))?.kind;
    return kind === "new-bullet" ? 3 : kind === "bullet-order" ? 2 : value.action === "remove" ? 1 : 0;
  };
  const entryBulletCounts = new Map<string, number>();
  for (const target of targets) {
    if (target.kind !== "bullet") continue;
    const key = `${target.target.sectionId}\u0000${target.target.entryId}`;
    entryBulletCounts.set(key, (entryBulletCounts.get(key) ?? 0) + 1);
  }
  // One examination of the first `limit` changes. The cap below re-runs it over
  // a shorter prefix, so a change the cap cuts can never have won a conflict
  // against one the model listed earlier.
  const runPass = (limit: number) => {
    const counts: DropCounts = { ...baseCounts };
    const seenTargets = new Set<string>();
    // Bullet texts already accepted per entry in this response, so a second
    // bullet change with the same text is a no-op rather than a duplicate line.
    const proposedTexts = new Map<string, Set<string>>();
    const accepted: { index: number; rank: number; change: ResumePolishWireChange }[] = [];
    const removalsByEntry = new Map<string, number>();
    // A rewrite of a bullet blocks its removal even when the rewrite is dropped.
    const rewriteAttempts = new Set<string>();
    for (const [index, rawChange] of [...examined.slice(0, limit).entries()].sort((left, right) => examineRank(left[1]) - examineRank(right[1]))) {
      const rank = examineRank(rawChange);
      if (!rawChange || typeof rawChange !== "object" || Array.isArray(rawChange)) {
        increment(counts, "MALFORMED");
        continue;
      }
      const change = rawChange as Record<string, unknown>;
      const targetId = text(change.targetId, 40);
      const target = targetMap.get(targetId);
      // A new-bullet slot is positional, so the model must name the entry it means;
      // a spilled "third add" otherwise lands in the next entry's slot.
      if (!target || (target.kind === "new-bullet" && text(change.entryId, 120) !== target.target.entryId)) {
        increment(counts, "INVALID_TARGET");
        continue;
      }
      if (seenTargets.has(targetId)) {
        increment(counts, "MALFORMED");
        continue;
      }
      // Exactly one operation per change; an ambiguous one is never read destructively.
      if ([change.replacement, change.action, change.order].filter((value) => value !== undefined).length !== 1) {
        increment(counts, "MALFORMED");
        continue;
      }
      const entryKey = `${target.target.sectionId}\u0000${target.target.entryId}`;
      const reason = text(change.reason, 240);
      if (change.action !== undefined) {
        const removals = removalsByEntry.get(entryKey) ?? 0;
        if (change.action !== "remove" || rewriteAttempts.has(targetId)) {
          increment(counts, "MALFORMED");
          continue;
        }
        if (target.kind !== "bullet" || target.sectionType !== "standard" || removals + 1 >= (entryBulletCounts.get(entryKey) ?? 0)) {
          increment(counts, "INVALID_TARGET");
          continue;
        }
        seenTargets.add(targetId);
        removalsByEntry.set(entryKey, removals + 1);
        const { sectionId, entryId, bulletId } = target.target;
        accepted.push({ index, rank, change: { targetId, target: { sectionId, entryId, ...(bulletId ? { bulletId } : {}) }, action: "remove", ...(reason ? { reason } : {}) } });
        continue;
      }
      if (target.kind === "bullet-order") {
        const expected = target.bulletTargetIds ?? [];
        const order = Array.isArray(change.order) ? change.order.map((id) => text(id, 40)) : [];
        if (
          order.length !== expected.length
          || new Set(order).size !== order.length
          || !order.every((id) => expected.includes(id))
          || removalsByEntry.has(entryKey)
        ) {
          increment(counts, "MALFORMED");
          continue;
        }
        if (order.every((id, index) => id === expected[index])) {
          increment(counts, "UNCHANGED");
          continue;
        }
        seenTargets.add(targetId);
        const { sectionId, entryId } = target.target;
        accepted.push({ index, rank, change: { targetId, target: { sectionId, entryId }, order, ...(reason ? { reason } : {}) } });
        continue;
      }
      if (change.order !== undefined) {
        increment(counts, "MALFORMED");
        continue;
      }
      rewriteAttempts.add(targetId);
      const replacementRaw = change.replacement;
      const normalized = text(replacementRaw, 1400);
      // A replacement carrying only inline marks ("<b></b>") passes the markup
      // gate and would blank the field, so it is malformed for every target kind.
      if (
        !normalized
        || !stripInlineMarks(normalized)
        || String(replacementRaw ?? "").length > 1400
        || containsStructuredMarkup(replacementRaw)
        || templateHasUnresolvedSlots(normalized)
      ) {
        increment(counts, "MALFORMED");
        continue;
      }
      // Comparing both sides unbolded keeps a bold-only delta UNCHANGED, so turning
      // the preference off never proposes a formatting-only edit.
      const plainBullet = !boldBulletKeywords && target.kind !== "skill-list";
      const replacement = plainBullet ? stripBoldMarks(normalized) : normalized;
      if (replacement === (plainBullet ? stripBoldMarks(target.currentText) : target.currentText)) {
        increment(counts, "UNCHANGED");
        continue;
      }
      if (target.kind === "skill-list"
        ? isImmaterialSkillOrder(replacement, target.currentText, jobText, postingTerms)
        : target.kind === "bullet" && isImmaterialRewrite(replacement, plainBullet ? stripBoldMarks(target.currentText) : target.currentText)) {
        seenTargets.add(targetId);
        increment(counts, "UNCHANGED");
        continue;
      }
      const entryTexts = proposedTexts.get(entryKey) ?? new Set<string>();
      if (target.kind !== "skill-list" && (
        entryTexts.has(plainText(replacement))
        || (target.kind === "new-bullet" && target.entryText.split("\n").some((line) => plainText(line) === plainText(replacement)))
      )) {
        increment(counts, "UNCHANGED");
        continue;
      }
      const warnings = unsupportedTerminology(replacement, target.sectionType === "standard" ? entryGrounding(target) : `${scopeText}\n${candidateContext}`, postingTerms);
      const issues = replacementIssues(replacement, target, evidence);
      if (issues.length) warnings.push(`Not supported by provided evidence. ${issues.join("; ").replace(/[.!?]+$/, "")}.`);
      const usesProfile = Boolean(target.profileText) && (
        target.kind === "new-bullet"
        || change.evidence === "profile"
        || (!issues.length && replacementIssues(replacement, target, evidence, false).length > 0)
      );
      seenTargets.add(targetId);
      entryTexts.add(plainText(replacement));
      proposedTexts.set(entryKey, entryTexts);
      const { sectionId, entryId, bulletId } = target.target;
      accepted.push({ index, rank, change: {
        targetId,
        target: { sectionId, entryId, ...(bulletId ? { bulletId } : {}) },
        replacement,
        ...(usesProfile ? { evidence: "profile" as const } : {}),
        ...(warnings.length ? { warnings } : {}),
        ...(reason ? { reason } : {})
      } });
    }
    return { counts, accepted: accepted.sort((left, right) => left.index - right.index) };
  };
  // The cap keeps the first usable changes in the model's own order, so a
  // Profile addition it listed first survives twelve lower-value rewrites. When
  // more than the limit are usable, the prefix up to the last kept change is
  // examined again without the cut tail, until the kept set is stable.
  let limit = examined.length;
  let pass = runPass(limit);
  while (pass.accepted.length > RESULT_CHANGE_LIMIT) {
    limit = pass.accepted[RESULT_CHANGE_LIMIT - 1].index + 1;
    pass = runPass(limit);
  }
  const { counts, accepted } = pass;
  const omittedByCap = examined.length - limit;
  // The kept set is emitted in the kind order the client and its probes expect.
  const changes = [...accepted].sort((left, right) => left.rank - right.rank || left.index - right.index).map((item) => item.change);

  const withheldReasons = (Object.entries(counts) as Array<[ResumePolishWithheldReason, number]>)
    .filter(([, count]) => count > 0)
    .map(([reason]) => reason);
  const droppedCount = Object.values(counts).reduce((sum, count) => sum + count, 0);
  // UNCHANGED is a no-op, not a withholding, so it stays out of the count every
  // surface renders as "withheld because it could not be verified". It remains in
  // `reasons`, which is the diagnostic channel.
  const withheldCount = droppedCount - counts.UNCHANGED;
  const requestedStatus = text(source.status, 20).toUpperCase();
  const requestedStatusIsValid = VALID_STATUSES.has(requestedStatus);
  // An all-UNCHANGED settle is not a withholding: the model returned the text
  // already on the resume, so nothing was suppressed and nothing failed a check.
  // A drop for any safety reason still reports WITHHELD.
  const onlyUnchanged = counts.UNCHANGED > 0
    && withheldCount === 0
    && rawChanges.length <= MAX_EXAMINED_CHANGES
    && requestedStatusIsValid;
  let status: ResumePolishStatus;
  if (changes.length) status = "PROPOSAL";
  else if (onlyUnchanged && requestedStatus !== "WITHHELD") status = "NO_CHANGES";
  else if (rawChanges.length > 0 || droppedCount > 0 || requestedStatus === "WITHHELD") status = "WITHHELD";
  else status = VALID_STATUSES.has(requestedStatus) && requestedStatus === "NO_CHANGES" ? "NO_CHANGES" : "WITHHELD";

  const summary = optionalList(source.summary, 260);
  const warnings: string[] = [];
  if (omittedByCap > 0) warnings.push(`Only the first ${RESULT_CHANGE_LIMIT} usable edits are shown; additional edits may be omitted.`);

  return {
    status,
    changes,
    summary,
    ...(warnings.length ? { warnings } : {}),
    omittedTargetCount,
    withheld: { count: withheldCount, reasons: withheldReasons }
  };
}

// Text from the first Profile heading on, so an add-from-profile quote comes
// from a heading block rather than general facts.
function headedProfileText(candidateContext: string): string {
  const first = profileHeadings(candidateContext)[0];
  return first ? candidateContext.split("\n").slice(first.line).join("\n") : "";
}

export function sanitizeResumeAdvice(raw: unknown, scope: NormalizedResumeScope, jobText: string, candidateContext = "") {
  const linked = linkProfileBlocks(scope, candidateContext);
  const onResume = profileTextOnResume(scope, candidateContext);
  return sanitizeResumePolishAdvice(raw).map((item) => {
    const warnings: string[] = [];
    const jobConfirmed = Boolean(item.jobExcerpt) && jobText.includes(item.jobExcerpt);
    let evidence: string;
    let confirmed: boolean;
    if (item.kind === "add-from-profile") {
      const excerpt = item.profileExcerpt ?? "";
      evidence = candidateContext;
      confirmed = jobConfirmed
        && Boolean(excerpt)
        && headedProfileText(candidateContext).includes(excerpt)
        && !onResume.some((text) => text.includes(excerpt));
    } else {
      const section = [...scope.sections, ...scope.contextSections].find((section) => section.id === item.sectionId);
      const entry = section?.entries.find((entry) => entry.id === item.entryId);
      const resumeEvidence = entry ? [entry.titleLeft, entry.subtitleLeft, ...entry.bullets.map((bullet) => bullet.text)].join("\n") : "";
      const profile = entry ? linked.get(entry.id) ?? "" : "";
      evidence = profile ? `${resumeEvidence}\n${profile}` : resumeEvidence;
      confirmed = Boolean(entry)
        && jobConfirmed
        && Boolean(item.candidateExcerpt || item.profileExcerpt)
        && (!item.candidateExcerpt || resumeEvidence.includes(item.candidateExcerpt))
        && (!item.profileExcerpt || profile.includes(item.profileExcerpt));
    }
    if (!confirmed) warnings.push("Source reference could not be confirmed.");
    if (explicitAdviceClaims(item.rationale).some((claim) => candidateClaimIssue(claim, evidence)
      || findUngroundedProseProperClaimTerm(claim, evidence, ""))) warnings.push("Advice is not supported by provided evidence.");
    // An add-from-profile item is about the Profile, never a resume entry.
    const ids = item.kind === "add-from-profile" ? { sectionId: "", entryId: "" } : {};
    return { ...item, ...ids, ...(warnings.length ? { warnings } : {}) };
  });
}

export async function generateResumeProposal({
  body,
  resumeScope,
  scopeText,
  jobText,
  candidateContext,
  customInstructions,
  boldBulletKeywords = true,
  reviewEdits = false,
  signal,
  dispatch = callConfiguredProvider
}: {
  body: Record<string, unknown>;
  resumeScope: unknown;
  scopeText: string;
  jobText: string;
  candidateContext: string;
  customInstructions: string;
  boldBulletKeywords?: boolean;
  reviewEdits?: boolean;
  signal?: AbortSignal;
  dispatch?: typeof callConfiguredProvider;
}) {
  const targets = flattenResumeTargets(resumeScope as Parameters<typeof flattenResumeTargets>[0], candidateContext);
  if (!targets.length) {
    throw new UserSafeAiError("Set at least one editable resume section to Polish.", 400);
  }
  const scope = resumeScope as NormalizedResumeScope;
  const adviceSources = [...scope.sections, ...scope.contextSections].map((section) => ({
    sectionId: section.id,
    heading: section.heading,
    entries: section.entries.map((entry) => ({
      entryId: entry.id,
      title: entry.titleLeft,
      subtitle: entry.subtitleLeft
    }))
  }));
  const { provider, apiKey, model, reasoningEffort } = resolveProviderRequest(body);
  const prompts = buildResumeProposalPrompts({
    jobText,
    targets,
    scopeText,
    candidateContext,
    customInstructions,
    boldBulletKeywords,
    reasoningEffort,
    sourceWarnings: sanitizeContentWarnings(body.sourceWarnings),
    adviceSources: JSON.stringify(adviceSources)
  });
  const stats: AttemptStats = {};
  const parsed = await dispatch({
    provider,
    apiKey,
    model,
    reasoningEffort,
    systemPrompt: prompts.systemPrompt,
    userPrompt: prompts.userPrompt,
    signal
  }, stats);
  const proposal = {
    ...sanitizeResumeProposal(
      parsed,
      prompts.selectedTargets,
      jobText,
      scopeText,
      candidateContext,
      prompts.omittedCount,
      boldBulletKeywords
    ),
    advice: sanitizeResumeAdvice((parsed as Record<string, unknown>)?.advice, scope, jobText, candidateContext),
    provider,
    model,
    reasoningEffort,
    attempts: stats.attempts ?? 1
  };
  if (!reviewEdits || !proposal.changes.length) return proposal;
  const review = await reviewResumeProposal({
    changes: proposal.changes,
    targets: prompts.selectedTargets,
    jobText,
    scopeText,
    candidateContext,
    customInstructions,
    config: { provider, apiKey, model, reasoningEffort },
    signal,
    dispatch
  });
  return withResumeProposalReview(proposal, review);
}
