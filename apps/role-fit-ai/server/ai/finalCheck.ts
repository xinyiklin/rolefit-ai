import type { IncomingMessage, ServerResponse } from "node:http";

import {
  FINAL_CHECK_ISSUE_KINDS,
  type FinalCheckIssue,
  type FinalCheckIssueKind,
  type FinalCheckResult
} from "../../shared/finalCheckContract.ts";
import { FetchTimeoutError, isRequestAborted, requestAbortSignal, sendJson } from "../http.ts";
import { callConfiguredProvider } from "./clients.ts";
import { UserSafeAiError, safeConfigErrorMessage } from "./errors.ts";
import {
  LIST_STOPWORDS,
  distinctiveTokenKeys,
  findUngroundedCuratedClaimTerm,
  findUngroundedOutcomeClaim,
  hasUnsupportedOwnershipIncrease
} from "./grounding.ts";
import { readAiJsonBody } from "./json.ts";
import { clipForPrompt, fenceUntrusted, inputFirewallRule } from "./prompts.ts";
import { providerLabel, resolveProviderRequest } from "./providers.ts";
import { hasUngroundedNumericClaim } from "./sanitize.ts";

type AttemptStats = { attempts?: number };

// The check reads one finished document against the same job and evidence
// whichever kind it is. Only the nouns in the prompt change: a resume's claims
// live in entries and bullets, a letter's in prose, and telling the model which
// it is reading is the difference between useful and generic feedback.
export type FinalCheckDocumentKind = "resume" | "cover-letter";

const DOCUMENT_NOUNS: Record<FinalCheckDocumentKind, { noun: string; tag: string; article: string }> = {
  resume: { noun: "resume", tag: "current_resume", article: "a job application resume" },
  "cover-letter": { noun: "cover letter", tag: "current_cover_letter", article: "a job application cover letter" }
};

export function finalCheckDocumentKind(value: unknown): FinalCheckDocumentKind {
  return value === "cover-letter" ? "cover-letter" : "resume";
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function containsFeedbackMarkup(value: unknown): boolean {
  const valueText = String(value ?? "");
  return /[\r\n]|<\/?[a-z][^>]*>|\\(?:begin|end|section|subsection|item|href)\b/i.test(valueText);
}

function exactSourceExcerpt(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const excerpt = value.trim();
  return excerpt.length <= max ? excerpt : "";
}

function hasUngroundedClaimSignal(value: string, grounding: string): boolean {
  return hasUngroundedNumericClaim(value, grounding)
    || Boolean(findUngroundedCuratedClaimTerm(value, grounding))
    || Boolean(findUngroundedOutcomeClaim(value, grounding, { candidateProse: true }))
    || hasUnsupportedOwnershipIncrease(value, grounding);
}

const ISSUE_DETAIL_STOPWORDS = new Set([
  ...LIST_STOPWORDS,
  "resume", "letter", "cover", "document", "posting", "job", "current",
  "claim", "claims", "claimed", "require", "requires", "requirement",
  "wording", "phrase", "sentence", "bullet", "item", "show", "shown",
  "missing", "unsupported", "unclear", "vague", "specific", "exact"
]);

function detailReferencesExcerpt(detail: string, sourceExcerpt: string): boolean {
  const excerptTokens = new Set(distinctiveTokenKeys(sourceExcerpt, ISSUE_DETAIL_STOPWORDS));
  const detailTokens = distinctiveTokenKeys(detail, ISSUE_DETAIL_STOPWORDS);
  const overlap = detailTokens.filter((token) => excerptTokens.has(token)).length;
  return overlap >= 2 || (overlap > 0 && overlap / excerptTokens.size >= 0.5);
}

function materialRequirementMissing(requirement: string, currentDocument: string): boolean {
  const requirementTokens = distinctiveTokenKeys(requirement, ISSUE_DETAIL_STOPWORDS);
  if (!requirementTokens.length) return false;
  const documentTokens = new Set(distinctiveTokenKeys(currentDocument, ISSUE_DETAIL_STOPWORDS));
  const overlap = requirementTokens.filter((token) => documentTokens.has(token)).length;
  return overlap === 0 || (requirementTokens.length >= 3 && overlap / requirementTokens.length < 1 / 3);
}

function issueHasExactSourceAnchor(
  issue: FinalCheckIssue,
  sourceExcerpt: string,
  currentDocument: string,
  evidenceText: string,
  jobText: string
): boolean {
  const source = issue.kind === "MISSING" ? jobText : currentDocument;
  if (!sourceExcerpt || !source.includes(sourceExcerpt)) return false;
  if (!detailReferencesExcerpt(issue.detail, sourceExcerpt)) return false;
  if (issue.kind === "UNSUPPORTED") {
    return !hasUngroundedClaimSignal(issue.detail, sourceExcerpt)
      && hasUngroundedClaimSignal(sourceExcerpt, evidenceText);
  }
  if (issue.kind === "MISSING") {
    return !hasUngroundedClaimSignal(issue.detail, sourceExcerpt)
      && (hasUngroundedClaimSignal(sourceExcerpt, currentDocument)
        || materialRequirementMissing(sourceExcerpt, currentDocument));
  }
  return !hasUngroundedClaimSignal(issue.detail, sourceExcerpt);
}

function derivedSummary(status: FinalCheckResult["status"], issues: FinalCheckIssue[]): string {
  if (status === "READY") return "No material unsupported, missing, or clarity issues were identified.";
  if (status === "NEEDS_EVIDENCE") {
    const count = issues.filter((issue) => issue.kind === "UNSUPPORTED").length;
    return `${count} claim${count === 1 ? " needs" : "s need"} evidence or softer wording.`;
  }
  return `${issues.length} item${issues.length === 1 ? "" : "s"} should be reviewed before applying.`;
}

export function sanitizeFinalCheck(
  raw: unknown,
  currentDocument: string,
  evidenceText: string,
  jobText: string
): FinalCheckResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new UserSafeAiError("AI returned an invalid document check. Retry, or switch providers.", 502);
  }
  const source = raw as Record<string, unknown>;
  if (!Array.isArray(source.issues)) {
    throw new UserSafeAiError("AI returned an invalid document check. Retry, or switch providers.", 502);
  }

  const issues: FinalCheckIssue[] = [];
  const seen = new Set<string>();
  for (const rawIssue of source.issues.slice(0, 20)) {
    if (!rawIssue || typeof rawIssue !== "object" || Array.isArray(rawIssue)) continue;
    const issue = rawIssue as Record<string, unknown>;
    const kind = text(issue.kind, 24).toUpperCase();
    const sourceExcerpt = exactSourceExcerpt(issue.sourceExcerpt, 500);
    const detail = text(issue.detail, 500);
    const action = text(issue.action, 360);
    if (
      !(FINAL_CHECK_ISSUE_KINDS as readonly string[]).includes(kind)
      || !sourceExcerpt
      || !detail
      || !action
      || containsFeedbackMarkup(issue.detail)
      || containsFeedbackMarkup(issue.action)
    ) continue;
    const candidate: FinalCheckIssue = {
      kind: kind as FinalCheckIssueKind,
      detail,
      action
    };
    const key = `${kind}:${detail.toLowerCase()}`;
    if (
      seen.has(key)
      || !issueHasExactSourceAnchor(candidate, sourceExcerpt, currentDocument, evidenceText, jobText)
    ) continue;
    seen.add(key);
    issues.push(candidate);
    if (issues.length === 5) break;
  }

  if (source.issues.length > 0 && issues.length === 0) {
    throw new UserSafeAiError("AI returned an invalid document check. Retry, or switch providers.", 502);
  }
  const status: FinalCheckResult["status"] = issues.some((issue) => issue.kind === "UNSUPPORTED")
    ? "NEEDS_EVIDENCE"
    : issues.length
      ? "REVIEW"
      : "READY";
  return { status, summary: derivedSummary(status, issues), issues };
}

export function buildFinalCheckPrompts({
  documentKind = "resume",
  currentDocument,
  evidenceText,
  jobText,
  customInstructions
}: {
  documentKind?: FinalCheckDocumentKind;
  currentDocument: string;
  evidenceText: string;
  jobText: string;
  customInstructions: string;
}) {
  const { noun, tag, article } = DOCUMENT_NOUNS[documentKind];
  const systemPrompt = `You perform a concise, advisory final check of ${article}. Return exactly one JSON object and no markdown.

${inputFirewallRule()}

Inspect the actual current ${noun}. Never rewrite it, score fit, choose whether to apply, or invent candidate facts. Candidate evidence may substantiate a claim but is not another editable ${noun}. Report only material issues a candidate can act on.`;
  const userPrompt = `Check the current ${noun} against the job and candidate evidence.

<${tag}>
${fenceUntrusted(clipForPrompt(currentDocument, 35_000, `current ${noun}`))}
</${tag}>

<candidate_evidence>
${fenceUntrusted(clipForPrompt(evidenceText, 35_000, "candidate evidence"))}
</candidate_evidence>

<job_description>
${fenceUntrusted(clipForPrompt(jobText, 30_000, "job description"))}
</job_description>

<user_guidance>
${fenceUntrusted(clipForPrompt(customInstructions, 3_000, "user guidance")) || "Not provided."}
</user_guidance>

Issue kinds:
- UNSUPPORTED: a concrete claim in the current ${noun} is not substantiated by candidate_evidence.
- MISSING: an important job requirement is not evidenced in the current ${noun}.
- CLARITY: wording in the current ${noun} is materially ambiguous or hard to scan.

Rules:
- Return at most five material issues, ordered by importance.
- sourceExcerpt is an exact verbatim substring from the current ${noun} for UNSUPPORTED and CLARITY, or from job_description for MISSING.
- detail identifies the exact claim, requirement, or wording at issue.
- action is one concise human action; never write replacement ${noun} text.
- Do not report cosmetic preferences, evidence metadata, scores, verdicts, or recommendations to apply.

Return this shape:
{
  "status": "READY | REVIEW | NEEDS_EVIDENCE",
  "summary": "one short sentence",
  "issues": [
    { "kind": "UNSUPPORTED | MISSING | CLARITY", "sourceExcerpt": "exact source text", "detail": "specific issue", "action": "specific action" }
  ]
}`;
  return { systemPrompt, userPrompt };
}

export async function handleFinalCheck(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST." });
    return;
  }

  let provider = "claude-cli";
  const request = requestAbortSignal(req, res);
  try {
    const body = await readAiJsonBody(req, 500_000);
    const documentKind = finalCheckDocumentKind(body.documentKind);
    const currentDocument = String(body.documentText ?? body.resumeText ?? "").slice(0, 45_000).trim();
    const evidenceText = String(body.evidenceText ?? "").slice(0, 45_000).trim();
    const jobText = String(body.jobText ?? "").slice(0, 35_000).trim();
    const customInstructions = String(body.customInstructions ?? "").slice(0, 4_000).trim();
    if (currentDocument.length < 80 || jobText.length < 40) {
      sendJson(res, 400, {
        error: `Add the current ${DOCUMENT_NOUNS[documentKind].noun} and prepare the job before checking it.`
      });
      return;
    }
    const resolved = resolveProviderRequest(body);
    provider = resolved.provider;
    const prompts = buildFinalCheckPrompts({ documentKind, currentDocument, evidenceText, jobText, customInstructions });
    const stats: AttemptStats = {};
    const parsed = await callConfiguredProvider({
      ...resolved,
      systemPrompt: prompts.systemPrompt,
      userPrompt: prompts.userPrompt,
      signal: request.signal
    }, stats);
    sendJson(res, 200, {
      ...sanitizeFinalCheck(parsed, currentDocument, evidenceText, jobText),
      provider: resolved.provider,
      model: resolved.model,
      reasoningEffort: resolved.reasoningEffort,
      attempts: stats.attempts ?? 1
    });
  } catch (error) {
    if (isRequestAborted(error, req, res)) return;
    if (error instanceof UserSafeAiError) {
      sendJson(res, error.status, { error: error.message });
      return;
    }
    if (error instanceof FetchTimeoutError || (error instanceof Error && /timed out|timeout/i.test(error.message))) {
      sendJson(res, 504, { error: `${providerLabel(provider)} timed out. Try again or switch providers.` });
      return;
    }
    const configMessage = safeConfigErrorMessage(error instanceof Error ? error.message : "");
    if (configMessage) {
      sendJson(res, 400, { error: configMessage });
      return;
    }
    console.warn("[ai] final check failed", {
      provider,
      errorName: error instanceof Error ? error.name : typeof error
    });
    sendJson(res, 500, {
      error: `${providerLabel(provider)} did not return a usable document check. Check the selected provider and model, then try again.`
    });
  } finally {
    request.dispose();
  }
}
