import type { IncomingMessage, ServerResponse } from "node:http";

import {
  FetchTimeoutError,
  isRequestAborted,
  requestAbortSignal,
  sendJson
} from "../http.ts";
import { UserSafeAiError, safeConfigErrorMessage } from "./errors.ts";
import { readAiJsonBody } from "./json.ts";
import { providerLabel } from "./providers.ts";
import { generateResumeProposal } from "./resumeProposal.ts";
import { normalizeResumeScope, resumeScopeToText } from "./resumeScope.ts";

export async function handlePolish(req: IncomingMessage, res: ServerResponse): Promise<void> {
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

    const tailorScope = normalizeResumeScope(body.tailorScope);
    const scopeText = resumeScopeToText(tailorScope);
    const editableText = resumeScopeToText(tailorScope, true);
    const jobText = String(body.jobText ?? "").slice(0, 35_000);
    const honestContext = String(body.honestContext ?? "").slice(0, 8_000);
    const customInstructions = String(body.customInstructions ?? "").slice(0, 4_000);
    if (!tailorScope.sections.length || editableText.length < 40 || jobText.trim().length < 40) {
      sendJson(res, 400, {
        error: "Select at least one editable resume section and add a job description before polishing."
      });
      return;
    }

    const proposal = await generateResumeProposal({
      body,
      tailorScope,
      scopeText,
      jobText,
      honestContext,
      customInstructions,
      signal: request.signal
    });
    provider = proposal.provider;
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
    console.warn("[ai] polish failed", {
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
