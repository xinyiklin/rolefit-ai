import {
  RESUME_POLISH_STATUSES,
  type FlatResumeTarget,
  type ResumePolishStatus,
  type ResumePolishWithheldReason,
  type ResumePolishWireChange,
  type ResumePolishWireResult,
  flattenResumeTargets
} from "../../shared/resumePolishContract.ts";
import { callConfiguredProvider } from "./clients.ts";
import {
  findUngroundedClaimTerm,
  findUngroundedJdTerm,
  findUngroundedOutcomeClaim,
  proseHasUngroundedTerm
} from "./grounding.ts";
import { clipForPrompt, fenceUntrusted, inputFirewallRule } from "./prompts.ts";
import { resolveProviderRequest } from "./providers.ts";
import { containsStructuredMarkup, hasUngroundedNumericClaim } from "./sanitize.ts";
import { UserSafeAiError } from "./errors.ts";

type AttemptStats = { attempts?: number };
type DropCounts = Record<ResumePolishWithheldReason, number>;

const VALID_STATUSES = new Set<string>(RESUME_POLISH_STATUSES);

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

const PROMPT_TARGET_BUDGET = 42_000;
const JOB_TERM_STOP_WORDS = new Set([
  "and", "are", "for", "from", "have", "role", "that", "the", "this", "with", "you", "your"
]);

type PromptTarget = Pick<FlatResumeTarget, "targetId" | "kind" | "section" | "currentText">;

function matchingJobTermCount(target: FlatResumeTarget, jobTerms: Set<string>): number {
  const targetTerms = new Set(`${target.section} ${target.currentText}`
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
  return kindPriority + summaryPriority + Math.min(12, matchingJobTermCount(target, jobTerms)) * 10;
}

export function selectPromptTargets(targets: FlatResumeTarget[], jobText: string): {
  selectedTargets: FlatResumeTarget[];
  omittedCount: number;
  serialized: string;
} {
  const jobTerms = new Set((jobText.toLowerCase().match(/[a-z0-9+#.]{3,}/g) ?? [])
    .filter((term) => !JOB_TERM_STOP_WORDS.has(term)));
  const ranked = targets
    .map((target, index) => ({ target, index, priority: targetPriority(target, jobTerms) }))
    .sort((left, right) =>
      right.priority - left.priority
      || left.target.section.localeCompare(right.target.section)
      || left.index - right.index
    );
  const selectedTargets: FlatResumeTarget[] = [];
  const promptTargets: PromptTarget[] = [];
  let serialized = "[]";
  for (const { target } of ranked) {
    const candidate: PromptTarget = {
      targetId: target.targetId,
      kind: target.kind,
      section: target.section,
      currentText: target.currentText.slice(0, 900)
    };
    const nextSerialized = JSON.stringify([...promptTargets, candidate]);
    if (nextSerialized.length > PROMPT_TARGET_BUDGET) continue;
    promptTargets.push(candidate);
    selectedTargets.push(target);
    serialized = nextSerialized;
  }
  return { selectedTargets, omittedCount: targets.length - selectedTargets.length, serialized };
}

export function buildResumeProposalPrompts({
  jobText,
  targets,
  scopeText,
  honestContext,
  customInstructions
}: {
  jobText: string;
  targets: FlatResumeTarget[];
  scopeText: string;
  honestContext: string;
  customInstructions: string;
}) {
  const targetSelection = selectPromptTargets(targets, jobText);
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

<resume_context>
${fenceUntrusted(clipForPrompt(scopeText, 28_000, "resume context"))}
</resume_context>

<candidate_context>
${fenceUntrusted(clipForPrompt(honestContext, 6_000, "candidate context")) || "Not provided."}
</candidate_context>

<user_guidance>
${fenceUntrusted(clipForPrompt(customInstructions, 3_000, "user guidance")) || "Not provided."}
</user_guidance>

Rules:
- Return only targetId values from editable_targets.
- replacement must be a complete replacement for currentText, not instructions or commentary.
- Preserve supported inline <b>, <i>, and <u> marks when relevant; return no other markup or newlines.
- skill-label describes only the category (for example Languages, Frameworks, Cloud & DevOps, Databases, Tools, or Platforms). Keep it to a short category phrase.
- skill-list contains actual skills only. It may reorder, deduplicate, or surface skills already supported by the resume or candidate context.
- Never move content between skill-label and skill-list. Never replace a category label with technologies, and never replace a skill list with a category label.
- A new skill may come only from the resume or candidate context, never merely from the job description.
- A real skill may be added to a skill-list or Summary target from the whole resume/context. A project or experience rewrite may use only facts grounded in that same entry.
- Omit weak, cosmetic, unchanged, or unsupported edits. Do not explain evidence metadata.
- summary and remainingGaps are optional concise feedback, maximum 3 items each.

Return this shape:
{
  "status": "PROPOSAL | NO_CHANGES | WITHHELD",
  "changes": [
    { "targetId": "target-1", "replacement": "complete replacement", "reason": "short optional reason" }
  ],
  "summary": ["up to 3 material improvements"],
  "remainingGaps": ["up to 3 important gaps"]
}`;
  return { systemPrompt, userPrompt, ...targetSelection };
}

function increment(counts: DropCounts, reason: ResumePolishWithheldReason): void {
  counts[reason] += 1;
}

function stripInlineMarks(value: string): string {
  return value.replace(/<\/?(?:b|i|u)>/gi, "").trim();
}

function normalizedSkillText(value: string): string {
  return stripInlineMarks(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9.+#/&-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const SKILL_CATEGORY_LABEL = /^(?:(?:programming|technical)\s+)?languages?|frameworks?(?:\s*(?:&|and)\s*libraries)?|libraries|cloud(?:\s*(?:&|and)\s*devops)?|devops|databases?|tools?|platforms?|technologies|technical skills|skills|data\s*(?:&|and)\s*analytics|methods?\s*(?:&|and)\s*tools?|software$/i;

function isSkillCategoryLabel(value: string): boolean {
  return SKILL_CATEGORY_LABEL.test(normalizedSkillText(value));
}

function validSkillLabel(value: string): boolean {
  const plain = stripInlineMarks(value);
  const words = plain.match(/[A-Za-z0-9+#.-]+/g) ?? [];
  return plain.length <= 60
    && words.length >= 1
    && words.length <= 5
    && !/[,;|:\r\n.!?]/.test(plain)
    && isSkillCategoryLabel(plain);
}

function splitSkillList(value: string): string[] {
  return stripInlineMarks(value)
    .split(/[,;|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function corpusContainsSkill(corpus: string, skill: string): boolean {
  const normalizedCorpus = normalizedSkillText(corpus);
  const normalizedSkill = normalizedSkillText(skill);
  if (!normalizedSkill) return false;
  const escaped = normalizedSkill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9+#.])${escaped}(?=$|[^a-z0-9+#.])`, "i").test(normalizedCorpus);
}

function validSkillList(replacement: string, target: FlatResumeTarget, grounding: string): boolean {
  const items = splitSkillList(replacement);
  if (!items.length || items.length > 30 || (items.length === 1 && isSkillCategoryLabel(items[0]))) return false;
  const currentItems = new Set(splitSkillList(target.currentText).map(normalizedSkillText));
  const seen = new Set<string>();
  for (const item of items) {
    const key = normalizedSkillText(item);
    const words = item.match(/[A-Za-z0-9+#.-]+/g) ?? [];
    if (!key || seen.has(key) || words.length > 8 || /[.!?]$/.test(item) || isSkillCategoryLabel(item)) return false;
    if (!currentItems.has(key) && !corpusContainsSkill(grounding, item)) return false;
    seen.add(key);
  }
  return true;
}

function replacementIsSupported(
  replacement: string,
  target: FlatResumeTarget,
  jobText: string,
  scopeText: string,
  honestContext: string
): boolean {
  const wholeResumeGrounding = `${scopeText}\n${honestContext}`;
  if (target.kind === "skill-label") return validSkillLabel(replacement);
  if (target.kind === "skill-list" && !validSkillList(replacement, target, wholeResumeGrounding)) return false;
  const grounding = target.sectionType === "standard"
    ? target.entryText
    : wholeResumeGrounding;
  const lowerGrounding = grounding.toLowerCase();
  return !findUngroundedJdTerm(replacement, jobText.toLowerCase(), lowerGrounding)
    && !hasUngroundedNumericClaim(replacement, grounding)
    && !findUngroundedClaimTerm(replacement, grounding)
    && !findUngroundedOutcomeClaim(replacement, grounding);
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
  honestContext: string,
  omittedTargetCount = 0
): ResumePolishWireResult {
  const source = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const targetMap = new Map(targets.map((target) => [target.targetId, target]));
  const rawChanges = Array.isArray(source.changes) ? source.changes : [];
  const counts: DropCounts = { UNSUPPORTED: 0, INVALID_TARGET: 0, UNCHANGED: 0, MALFORMED: 0 };
  if (!Array.isArray(source.changes)) counts.MALFORMED += 1;
  const seenTargets = new Set<string>();
  const changes: ResumePolishWireChange[] = [];

  for (const rawChange of rawChanges.slice(0, 40)) {
    if (!rawChange || typeof rawChange !== "object" || Array.isArray(rawChange)) {
      increment(counts, "MALFORMED");
      continue;
    }
    const change = rawChange as Record<string, unknown>;
    const targetId = text(change.targetId, 40);
    const target = targetMap.get(targetId);
    if (!target) {
      increment(counts, "INVALID_TARGET");
      continue;
    }
    if (seenTargets.has(targetId)) {
      increment(counts, "MALFORMED");
      continue;
    }
    const replacementRaw = change.replacement;
    const replacement = text(replacementRaw, 1400);
    if (!replacement || String(replacementRaw ?? "").length > 1400 || containsStructuredMarkup(replacementRaw)) {
      increment(counts, "MALFORMED");
      continue;
    }
    if (replacement === target.currentText) {
      increment(counts, "UNCHANGED");
      continue;
    }
    if (!replacementIsSupported(replacement, target, jobText, scopeText, honestContext)) {
      increment(counts, "UNSUPPORTED");
      continue;
    }
    seenTargets.add(targetId);
    changes.push({
      targetId,
      replacement,
      ...(text(change.reason, 240) ? { reason: text(change.reason, 240) } : {})
    });
    if (changes.length === 12) break;
  }

  const withheldReasons = (Object.entries(counts) as Array<[ResumePolishWithheldReason, number]>)
    .filter(([, count]) => count > 0)
    .map(([reason]) => reason);
  const withheldCount = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const requestedStatus = text(source.status, 20).toUpperCase();
  let status: ResumePolishStatus;
  if (changes.length) status = "PROPOSAL";
  else if (rawChanges.length > 0 || withheldCount > 0 || requestedStatus === "WITHHELD") status = "WITHHELD";
  else status = VALID_STATUSES.has(requestedStatus) && requestedStatus === "NO_CHANGES" ? "NO_CHANGES" : "WITHHELD";

  const resultingGrounding = `${scopeText}\n${changes.map((change) => change.replacement).join("\n")}`;
  const summary = changes.length
    ? optionalList(source.summary, 260).filter((item) =>
        !proseHasUngroundedTerm(item, jobText.toLowerCase(), resultingGrounding.toLowerCase())
        && !findUngroundedClaimTerm(item, resultingGrounding)
        && !findUngroundedOutcomeClaim(item, resultingGrounding)
        && !hasUngroundedNumericClaim(item, resultingGrounding)
      )
    : [];

  return {
    status,
    changes,
    summary,
    remainingGaps: optionalList(source.remainingGaps, 260),
    omittedTargetCount,
    withheld: { count: withheldCount, reasons: withheldReasons }
  };
}

export async function generateResumeProposal({
  body,
  resumeScope,
  scopeText,
  jobText,
  honestContext,
  customInstructions,
  signal
}: {
  body: Record<string, unknown>;
  resumeScope: unknown;
  scopeText: string;
  jobText: string;
  honestContext: string;
  customInstructions: string;
  signal?: AbortSignal;
}) {
  const targets = flattenResumeTargets(resumeScope as Parameters<typeof flattenResumeTargets>[0]);
  if (!targets.length) {
    throw new UserSafeAiError("Set at least one editable resume section to Polish.", 400);
  }
  const { provider, apiKey, model, reasoningEffort } = resolveProviderRequest(body);
  const prompts = buildResumeProposalPrompts({
    jobText,
    targets,
    scopeText,
    honestContext,
    customInstructions
  });
  const stats: AttemptStats = {};
  const parsed = await callConfiguredProvider({
    provider,
    apiKey,
    model,
    reasoningEffort,
    systemPrompt: prompts.systemPrompt,
    userPrompt: prompts.userPrompt,
    signal
  }, stats);
  return {
    ...sanitizeResumeProposal(
      parsed,
      prompts.selectedTargets,
      jobText,
      scopeText,
      honestContext,
      prompts.omittedCount
    ),
    provider,
    model,
    reasoningEffort,
    attempts: stats.attempts ?? 1
  };
}
