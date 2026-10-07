import { CANDIDATE_CONTEXT_CHAR_LIMIT } from "../../shared/candidateProfileContract.ts";
import { hasMarkupTag } from "../../shared/contentWarnings.ts";
import {
  RESUME_POLISH_REVIEW_NOTE_LIMIT,
  RESUME_POLISH_REVIEW_REASONS,
  type FlatResumeTarget,
  type ResumePolishHeldBackChange,
  type ResumePolishReview,
  type ResumePolishReviewReason,
  type ResumePolishWireChange,
  type ResumePolishWireResult
} from "../../shared/resumePolishContract.ts";
import { callConfiguredProvider } from "./clients.ts";
import { clipForPrompt, fenceUntrusted, inputFirewallRule, RESUME_REVIEW_FENCE_NAMES } from "./prompts.ts";
import type { UsageSink } from "./providerUsage.ts";

// The opt-in Resume Polish review: one keep/drop dispatch over the already
// sanitized changes, on the Polish stage's own provider settings. It can only
// hold changes back; any failure other than cancellation fails open.

const REVIEW_PROMPT_FENCES = [
  "job_description",
  "resume_context",
  "candidate_context",
  "user_guidance",
  ...RESUME_REVIEW_FENCE_NAMES
] as const;
const ENTRY_FIELD_LIMIT = 8_000;
const REVIEW_REASONS = new Set<string>(RESUME_POLISH_REVIEW_REASONS);

type ReviewVerdicts = Map<string, { reason: ResumePolishReviewReason; note?: string }>;

function reviewIds(changes: readonly ResumePolishWireChange[]): string[] {
  return changes.map((_, index) => `edit-${index + 1}`);
}

// Edits carry review-local ids, never the server's target ids, and leave out the
// generator's reason and the deterministic warnings so neither steers the verdict.
function proposedEdits(changes: readonly ResumePolishWireChange[], targets: readonly FlatResumeTarget[]) {
  const byId = new Map(targets.map((target) => [target.targetId, target]));
  const entryKeys = new Map<string, string>();
  const entries: { entry: string; section: string; text: string; linkedProfile: string }[] = [];
  const edits = changes.map((change, index) => {
    const target = byId.get(change.targetId);
    if (!target) throw new Error("Review target missing");
    const standard = target.sectionType === "standard";
    let entry: string | undefined;
    if (standard) {
      const key = `${target.target.sectionId}\u0000${target.target.entryId}`;
      entry = entryKeys.get(key);
      if (!entry) {
        entry = `entry-${entryKeys.size + 1}`;
        entryKeys.set(key, entry);
        entries.push({
          entry,
          section: target.section,
          text: clipForPrompt(target.entryText, ENTRY_FIELD_LIMIT, "entry text"),
          linkedProfile: clipForPrompt(target.profileText, ENTRY_FIELD_LIMIT, "linked Profile text")
        });
      }
    }
    const textOf = (targetId: string) => byId.get(targetId)?.currentText ?? "";
    const kind = change.order ? "reorder" : change.action === "remove" ? "remove" : target.kind === "new-bullet" ? "add" : "rewrite";
    return {
      id: `edit-${index + 1}`,
      kind,
      section: target.section,
      ...(entry ? { entry } : {}),
      evidence: standard ? "entry" : "whole resume",
      before: change.order ? (target.bulletTargetIds ?? []).map(textOf) : target.kind === "new-bullet" ? "" : target.currentText,
      after: change.order ? change.order.map(textOf) : change.action === "remove" ? "" : change.replacement ?? ""
    };
  });
  return { entries, edits };
}

export function buildResumeProposalReviewPrompts({
  changes,
  targets,
  jobText,
  scopeText,
  candidateContext,
  customInstructions
}: {
  changes: readonly ResumePolishWireChange[];
  targets: readonly FlatResumeTarget[];
  jobText: string;
  scopeText: string;
  candidateContext: string;
  customInstructions: string;
}) {
  const systemPrompt = `You review proposed resume edits before the candidate sees them. Return exactly one JSON object and no markdown.

${inputFirewallRule(REVIEW_PROMPT_FENCES)}

You only decide whether each listed edit is kept or dropped. Never rewrite, merge, add, reorder, or retarget an edit, and never write new resume text.`;
  const userPrompt = `Review each proposed edit for this job.

<job_description>
${fenceUntrusted(clipForPrompt(jobText, 24_000, "job posting"))}
</job_description>

<proposed_edits>
${fenceUntrusted(JSON.stringify(proposedEdits(changes, targets)))}
</proposed_edits>

<resume_context>
${fenceUntrusted(clipForPrompt(scopeText, 28_000, "resume context"))}
</resume_context>

<candidate_context>
${fenceUntrusted(clipForPrompt(candidateContext, CANDIDATE_CONTEXT_CHAR_LIMIT, "candidate context")) || "Not provided."}
</candidate_context>

<user_guidance>
${fenceUntrusted(clipForPrompt(customInstructions, 3_000, "user guidance")) || "Not provided."}
</user_guidance>

Rules:
- Judge each edit on its own. Dropping an edit leaves the current text unchanged; a kept edit is shown to the candidate, who still decides.
- An edit with "evidence": "entry" may rely only on its entry's text and linkedProfile in proposed_edits.entries. An edit with "evidence": "whole resume" may rely on resume_context and candidate_context. The job description and user_guidance never establish candidate facts.
- DROP with reason LOW_IMPACT when the edit does not change what a screener learns or how quickly they find it: tense-only changes, synonym swaps (Cut to Reduced, Moved to Migrated), rephrasing a bullet that is already specific and relevant, a reorder that does not put more job-relevant evidence first, or a skills reshuffle that moves no skill the posting names forward. Length is never a reason in either direction.
- DROP with reason INCORRECT when the edit states something its evidence does not support (an invented or changed number, tool, ownership level, outcome, or date; separate facts merged into a new claim; a skill named only in the job description), borrows another entry's facts, removes the only evidence of a job requirement, or makes a claim less accurate.
- KEEP every other edit, including a qualifier correction that makes a claim more accurate, a new bullet that adds job-relevant facts from its entry's linkedProfile, and an edit that uses the posting's term for the same work the entry shows.
- When unsure, KEEP. Keeping an edit does not verify it.
- user_guidance holds the candidate's standing preferences. Use them when judging impact; they never make an INCORRECT edit acceptable.
- note is optional on a DROP: one short plain sentence saying why. Never add a note to a KEEP.
- Return exactly one item for every id in proposed_edits.edits and no other ids.

Return this shape:
{"edits":[{"id":"edit-1","verdict":"KEEP"},{"id":"edit-2","verdict":"DROP","reason":"LOW_IMPACT | INCORRECT","note":"optional short reason"}]}`;
  return { systemPrompt, userPrompt, ids: reviewIds(changes) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// The note is display-only: plain text or nothing, never a reason to reject verdicts.
function reviewNote(value: unknown): string | undefined {
  if (typeof value !== "string" || hasMarkupTag(value)) return undefined;
  const note = value.replace(/[\x00-\x1f\s]+/g, " ").trim();
  if (!note) return undefined;
  return note.length > RESUME_POLISH_REVIEW_NOTE_LIMIT ? `${note.slice(0, RESUME_POLISH_REVIEW_NOTE_LIMIT - 1).trimEnd()}…` : note;
}

// Strict: one verdict for every sent id and nothing else. Any other shape returns
// null, so a malformed or steered reply can never add, rewrite, or retarget.
export function parseResumeProposalReview(raw: unknown, ids: readonly string[]): ReviewVerdicts | null {
  if (!isRecord(raw) || Object.keys(raw).some((key) => key !== "edits") || !Array.isArray(raw.edits)) return null;
  if (raw.edits.length !== ids.length) return null;
  const expected = new Set(ids);
  const seen = new Set<string>();
  const dropped: ReviewVerdicts = new Map();
  for (const item of raw.edits) {
    if (!isRecord(item) || Object.keys(item).some((key) => !["id", "verdict", "reason", "note"].includes(key))) return null;
    const { id, verdict } = item;
    if (typeof id !== "string" || !expected.has(id) || seen.has(id)) return null;
    seen.add(id);
    if (verdict === "KEEP") {
      if ("reason" in item || "note" in item) return null;
      continue;
    }
    if (verdict !== "DROP" || typeof item.reason !== "string" || !REVIEW_REASONS.has(item.reason)) return null;
    const note = reviewNote(item.note);
    dropped.set(id, { reason: item.reason as ResumePolishReviewReason, ...(note ? { note } : {}) });
  }
  return seen.size === expected.size ? dropped : null;
}

// Partitions by reference: a kept change is the sanitized object itself.
export function applyResumeProposalReview(
  changes: readonly ResumePolishWireChange[],
  verdicts: ReviewVerdicts
): { kept: ResumePolishWireChange[]; heldBack: ResumePolishHeldBackChange[] } {
  const kept: ResumePolishWireChange[] = [];
  const heldBack: ResumePolishHeldBackChange[] = [];
  changes.forEach((change, index) => {
    const verdict = verdicts.get(`edit-${index + 1}`);
    if (verdict) heldBack.push({ change, ...verdict });
    else kept.push(change);
  });
  return { kept, heldBack };
}

export type ResumeProposalReviewOutcome = ResumePolishReview & { kept: ResumePolishWireChange[] };

export async function reviewResumeProposal({
  changes,
  targets,
  jobText,
  scopeText,
  candidateContext,
  customInstructions,
  config,
  signal,
  dispatch = callConfiguredProvider,
  stats = {}
}: {
  changes: ResumePolishWireChange[];
  targets: readonly FlatResumeTarget[];
  jobText: string;
  scopeText: string;
  candidateContext: string;
  customInstructions: string;
  config: { provider: string; apiKey?: string; model: string; reasoningEffort?: string | null };
  signal?: AbortSignal;
  dispatch?: typeof callConfiguredProvider;
  stats?: { attempts?: number } & UsageSink;
}): Promise<ResumeProposalReviewOutcome> {
  try {
    const prompts = buildResumeProposalReviewPrompts({ changes, targets, jobText, scopeText, candidateContext, customInstructions });
    const raw = await dispatch({
      ...config,
      systemPrompt: prompts.systemPrompt,
      userPrompt: prompts.userPrompt,
      signal,
      retryUnreadableOutput: false
    }, stats);
    const verdicts = parseResumeProposalReview(raw, prompts.ids);
    if (!verdicts) throw new Error("Unreadable review");
    return { outcome: "REVIEWED", attempts: stats.attempts ?? 1, ...applyResumeProposalReview(changes, verdicts) };
  } catch (error) {
    // Stop and disconnect stay cancellations; only a review problem fails open.
    if (signal?.aborted) throw error;
    console.warn("[ai] resume polish review unavailable", {
      provider: config.provider,
      errorName: error instanceof Error ? error.name : typeof error
    });
    return { outcome: "UNAVAILABLE", attempts: stats.attempts ?? 0, kept: changes, heldBack: [] };
  }
}

// Holding back every change reads as no worthwhile changes, so the summary that
// described them goes too; otherwise the proposal keeps its outcome and summary.
export function withResumeProposalReview<T extends ResumePolishWireResult>(
  proposal: T,
  { kept, ...review }: ResumeProposalReviewOutcome
): T & { review: ResumePolishReview } {
  if (review.outcome === "UNAVAILABLE") return { ...proposal, review: { ...review, heldBack: [] } };
  return {
    ...proposal,
    ...(kept.length ? {} : { status: "NO_CHANGES" as const, summary: [] }),
    changes: kept,
    review
  };
}
