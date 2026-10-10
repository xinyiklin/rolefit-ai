import type { IncomingMessage, ServerResponse } from "node:http";

import {
  FetchTimeoutError,
  isRequestAborted,
  requestAbortSignal,
  sendJson
} from "../http.ts";
import { candidateContextLimitError } from "../../shared/candidateProfileContract.ts";
import { parsePolishFitFindings } from "../../shared/polishFitFindings.ts";
import { UserSafeAiError, safeConfigErrorMessage } from "./errors.ts";
import { readAiJsonBody } from "./json.ts";
import { providerLabel, resolveProviderRequest } from "./providers.ts";
import { generateResumeProposal } from "./resumeProposal.ts";
import { normalizeResumeScope, resumeScopeToText } from "./resumeScope.ts";

// Absent means the client predates the preference and keeps the original
// behavior; a present non-boolean is a client bug, and coercing it either way
// would silently decide a preference the user owns. Exported so the default is
// assertable without driving a whole proposal.
export function resolveBoldBulletKeywords(value: unknown): boolean | null {
  if (value === undefined) return true;
  return typeof value === "boolean" ? value : null;
}

// The opt-in edit review: absent (every client before it, and the setting off)
// is off; a present non-boolean is a client bug, as above.
export function resolveReviewEdits(value: unknown): boolean | null {
  if (value === undefined) return false;
  return typeof value === "boolean" ? value : null;
}

export async function handleResumePolish(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST." });
    return;
  }

  let provider = "claude-cli";
  const request = requestAbortSignal(req, res);
  try {
    const body = await readAiJsonBody(req, 1_000_000);
    if (body.mode !== "resume-proposal") {
      sendJson(res, 400, { error: "Use mode resume-proposal for Resume Polish." });
      return;
    }

    const resumeScope = normalizeResumeScope(body.resumeScope);
    const scopeText = resumeScopeToText(resumeScope);
    const editableText = resumeScopeToText(resumeScope, true);
    const jobText = String(body.jobText ?? "").slice(0, 35_000);
    const candidateContext = String(body.candidateContext ?? "");
    const contextLimitError = candidateContextLimitError(candidateContext);
    if (contextLimitError) {
      sendJson(res, 400, { error: contextLimitError });
      return;
    }
    const customInstructions = String(body.customInstructions ?? "").slice(0, 4_000);
    const boldBulletKeywords = resolveBoldBulletKeywords(body.boldBulletKeywords);
    if (boldBulletKeywords === null) {
      sendJson(res, 400, {
        error: "Resume Polish received an invalid bold-keywords preference. Reload the page and try again."
      });
      return;
    }
    const reviewEdits = resolveReviewEdits(body.reviewEdits);
    if (reviewEdits === null) {
      sendJson(res, 400, {
        error: "Resume Polish received an invalid review preference. Reload the page and try again."
      });
      return;
    }
    const fitFindings = parsePolishFitFindings(body.fitFindings);
    if (fitFindings === "invalid") {
      sendJson(res, 400, {
        error: "Resume Polish received unreadable Fit findings. Reload the page and try again."
      });
      return;
    }
    if (!resumeScope.sections.length || !editableText.trim() || jobText.trim().length < 40) {
      sendJson(res, 400, {
        error: "Select at least one editable resume section and add a job description before polishing."
      });
      return;
    }

    // Resolve before provider work so a failure names the selected provider.
    provider = resolveProviderRequest(body).provider;
    const proposal = await generateResumeProposal({
      body,
      resumeScope,
      scopeText,
      jobText,
      candidateContext,
      customInstructions,
      boldBulletKeywords,
      reviewEdits,
      fitFindings,
      signal: request.signal
    });
    sendJson(res, 200, proposal);
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
    if (error instanceof Error && error.message === "Request is too large.") {
      sendJson(res, 413, { error: "Request is too large. Shorten the resume or job text." });
      return;
    }
    const configMessage = safeConfigErrorMessage(error instanceof Error ? error.message : "");
    if (configMessage) {
      sendJson(res, 400, { error: configMessage });
      return;
    }
    console.warn("[ai] resume polish failed", {
      provider,
      errorName: error instanceof Error ? error.name : typeof error
    });
    sendJson(res, 500, {
      error: `${providerLabel(provider)} did not return a usable proposal. Check the selected provider and model, then try again.`
    });
  } finally {
    request.dispose();
  }
}
