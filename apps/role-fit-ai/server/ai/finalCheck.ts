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
import { findUngroundedCuratedClaimTerm, findUngroundedOutcomeClaim } from "./grounding.ts";
import { readAiJsonBody } from "./json.ts";
import { clipForPrompt, fenceUntrusted, inputFirewallRule } from "./prompts.ts";
import { providerLabel, resolveProviderRequest } from "./providers.ts";
import { hasUngroundedNumericClaim } from "./sanitize.ts";

type AttemptStats = { attempts?: number };

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function containsFeedbackMarkup(value: unknown): boolean {
  const valueText = String(value ?? "");
  return /[\r\n]|<\/?[a-z][^>]*>|\\(?:begin|end|section|subsection|item|href)\b/i.test(valueText);
}

function hasUngroundedClaimSignal(value: string, grounding: string): boolean {
  return hasUngroundedNumericClaim(value, grounding)
    || Boolean(findUngroundedCuratedClaimTerm(value, grounding))
    || Boolean(findUngroundedOutcomeClaim(value, grounding, { candidateProse: true }));
}

function issueIsGrounded(
  issue: FinalCheckIssue,
  currentResume: string,
  evidenceText: string,
  jobText: string
): boolean {
  if (issue.kind === "UNSUPPORTED") {
    return !hasUngroundedClaimSignal(issue.detail, currentResume)
      && hasUngroundedClaimSignal(issue.detail, evidenceText);
  }
  if (issue.kind === "MISSING") {
    return !hasUngroundedClaimSignal(issue.detail, `${currentResume}\n${jobText}`)
      && hasUngroundedClaimSignal(issue.detail, currentResume);
  }
  return !hasUngroundedClaimSignal(issue.detail, currentResume);
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
  currentResume: string,
  evidenceText: string,
  jobText: string
): FinalCheckResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new UserSafeAiError("AI returned an invalid Final Check. Retry, or switch providers.", 502);
  }
  const source = raw as Record<string, unknown>;
  if (!Array.isArray(source.issues)) {
    throw new UserSafeAiError("AI returned an invalid Final Check. Retry, or switch providers.", 502);
  }

  const issues: FinalCheckIssue[] = [];
  const seen = new Set<string>();
  for (const rawIssue of source.issues.slice(0, 20)) {
    if (!rawIssue || typeof rawIssue !== "object" || Array.isArray(rawIssue)) continue;
    const issue = rawIssue as Record<string, unknown>;
    const kind = text(issue.kind, 24).toUpperCase();
    const detail = text(issue.detail, 500);
    const action = text(issue.action, 360);
    if (
      !(FINAL_CHECK_ISSUE_KINDS as readonly string[]).includes(kind)
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
    if (seen.has(key) || !issueIsGrounded(candidate, currentResume, evidenceText, jobText)) continue;
    seen.add(key);
    issues.push(candidate);
    if (issues.length === 5) break;
  }

  if (source.issues.length > 0 && issues.length === 0) {
    throw new UserSafeAiError("AI returned an invalid Final Check. Retry, or switch providers.", 502);
  }
  const status: FinalCheckResult["status"] = issues.some((issue) => issue.kind === "UNSUPPORTED")
    ? "NEEDS_EVIDENCE"
    : issues.length
      ? "REVIEW"
      : "READY";
  return { status, summary: derivedSummary(status, issues), issues };
}

export function buildFinalCheckPrompts({
  currentResume,
  evidenceText,
  jobText,
  customInstructions
}: {
  currentResume: string;
  evidenceText: string;
  jobText: string;
  customInstructions: string;
}) {
  const systemPrompt = `You perform a concise, advisory final check of a job application resume. Return exactly one JSON object and no markdown.

${inputFirewallRule()}

Inspect the actual current resume. Never rewrite it, score fit, choose whether to apply, or invent candidate facts. Candidate evidence may substantiate a claim but is not another editable resume. Report only material issues a candidate can act on.`;
  const userPrompt = `Check the current resume against the job and candidate evidence.

<current_resume>
${fenceUntrusted(clipForPrompt(currentResume, 35_000, "current resume"))}
</current_resume>

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
- UNSUPPORTED: a concrete current-resume claim is not substantiated by candidate_evidence.
- MISSING: an important job requirement is not evidenced in the current resume.
- CLARITY: current-resume wording is materially ambiguous or hard to scan.

Rules:
- Return at most five material issues, ordered by importance.
- detail identifies the exact claim, requirement, or wording at issue.
- action is one concise human action; never write replacement resume text.
- Do not report cosmetic preferences, evidence metadata, scores, verdicts, or recommendations to apply.

Return this shape:
{
  "status": "READY | REVIEW | NEEDS_EVIDENCE",
  "summary": "one short sentence",
  "issues": [
    { "kind": "UNSUPPORTED | MISSING | CLARITY", "detail": "specific issue", "action": "specific action" }
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
    const currentResume = String(body.resumeText ?? "").slice(0, 45_000).trim();
    const evidenceText = String(body.evidenceText ?? "").slice(0, 45_000).trim();
    const jobText = String(body.jobText ?? "").slice(0, 35_000).trim();
    const customInstructions = String(body.customInstructions ?? "").slice(0, 4_000).trim();
    if (currentResume.length < 80 || jobText.length < 40) {
      sendJson(res, 400, { error: "Add the current resume and prepare the job before running Final Check." });
      return;
    }
    const resolved = resolveProviderRequest(body);
    provider = resolved.provider;
    const prompts = buildFinalCheckPrompts({ currentResume, evidenceText, jobText, customInstructions });
    const stats: AttemptStats = {};
    const parsed = await callConfiguredProvider({
      ...resolved,
      systemPrompt: prompts.systemPrompt,
      userPrompt: prompts.userPrompt,
      signal: request.signal
    }, stats);
    sendJson(res, 200, {
      ...sanitizeFinalCheck(parsed, currentResume, evidenceText, jobText),
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
      error: `${providerLabel(provider)} did not return a usable Final Check. Check the selected provider and model, then try again.`
    });
  } finally {
    request.dispose();
  }
}
