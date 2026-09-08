import { findUngroundedProseProperClaimTerm } from "./grounding.ts";
import { candidateClaimSentences } from "./coverLetterGroundingIssues.ts";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  APPLICATION_REVIEW_CODES,
  localApplicationReview,
  applicationReviewEvidenceLimitError,
  mergeApplicationReviewFindings,
  sanitizeApplicationReviewFinding,
  type ApplicationReviewFinding,
  type ApplicationReviewInput,
  type ApplicationReviewResult,
} from "../../shared/applicationReviewContract.ts";
import { isRequestAborted, requestAbortSignal, sendJson } from "../http.ts";
import { readAiJsonBody } from "./json.ts";
import { UserSafeAiError, safeConfigErrorMessage } from "./errors.ts";
import { resolveProviderRequest } from "./providers.ts";
import { callConfiguredProvider } from "./clients.ts";
import { fenceUntrusted, inputFirewallRule } from "./prompts.ts";
import { candidateClaimIssue, explicitAdviceClaims } from "./claimEvidence.ts";

export function parseApplicationReviewInput(
  raw: Record<string, unknown>,
): ApplicationReviewInput {
  const text = (key: string, max: number) => {
    if (typeof raw[key] !== "string" || raw[key].length > max)
      throw new UserSafeAiError(
        `Final review received an invalid ${key} field.`,
        400,
      );
    return raw[key] as string;
  };
  if (
    typeof raw.includeResume !== "boolean" ||
    typeof raw.includeCoverLetter !== "boolean" ||
    !Array.isArray(raw.evidence)
  )
    throw new UserSafeAiError(
      "Final review received invalid material selection or evidence.",
      400,
    );
  const ids = new Set<string>();
  const evidence = raw.evidence.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new UserSafeAiError("Final review received invalid evidence.", 400);
    const { id, kind, label, text } = item as Record<string, unknown>;
    if (
      typeof id !== "string" ||
      !id ||
      id === "job_posting" ||
      id.length > 120 ||
      ids.has(id) ||
      (kind !== "resume" && kind !== "context") ||
      typeof label !== "string" ||
      label.length > 200 ||
      typeof text !== "string" ||
      !text.trim()
    )
      throw new UserSafeAiError("Final review received invalid evidence.", 400);
    ids.add(id);
    return { id, kind: kind as "resume" | "context", label, text };
  });
  const evidenceError = applicationReviewEvidenceLimitError(evidence);
  if (evidenceError) throw new UserSafeAiError(evidenceError, 400);
  const resumeText = text("resumeText", 60_000);
  const coverLetterText = text("coverLetterText", 20_000);
  if (
    (!raw.includeResume && resumeText) ||
    (!raw.includeCoverLetter && coverLetterText)
  )
    throw new UserSafeAiError(
      "Excluded documents must not be submitted as review materials.",
      400,
    );
  return {
    jobText: text("jobText", 35_000),
    company: text("company", 200),
    role: text("role", 200),
    includeResume: raw.includeResume,
    includeCoverLetter: raw.includeCoverLetter,
    resumeText,
    coverLetterText,
    evidence,
  };
}

export function reviewProviderFindings(
  raw: unknown,
  input: ApplicationReviewInput,
  local: ApplicationReviewResult,
): ApplicationReviewResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new UserSafeAiError(
      "Final review returned an unreadable result.",
      422,
    );
  const value = raw as Record<string, unknown>;
  if (
    !Array.isArray(value.findings) ||
    typeof value.coverageComplete !== "boolean" ||
    typeof value.overflow !== "boolean"
  )
    throw new UserSafeAiError("Final review returned an invalid result.", 422);
  let incomplete = !value.coverageComplete;
  const accepted: ApplicationReviewFinding[] = [];
  for (const item of value.findings) {
    if (!item || typeof item !== "object") {
      incomplete = true;
      continue;
    }
    const candidate = item as ApplicationReviewFinding;
    const dependencies: ApplicationReviewFinding["dependencies"] = [
      "job",
      "resume",
      "coverLetter",
      "evidence",
      "settings",
    ];
    const finding = { ...candidate, dependencies };
    const checked = sanitizeApplicationReviewFinding(
      finding,
      input,
      local.reviewedDocuments,
    );
    if (
      !checked ||
      !finding.anchor ||
      !finding.sourceExcerpt ||
      !finding.evidenceId
    ) {
      incomplete = true;
      continue;
    }
    const evidence = input.evidence.find(
      (item) => item.id === finding.evidenceId,
    );
    const isCandidate =
      candidateClaimSentences(finding.anchor, {
        company: input.company,
        role: input.role,
        candidateName: "",
        date: "",
        greeting: "",
        signoff: "",
        recipientName: "",
      }).length > 0;
    const crossDocument =
      ["current_resume", "current_cover_letter"].includes(
        finding.evidenceId ?? "",
      ) && ["attribution", "uncertain"].includes(finding.code);
    const targetFinding = finding.code === "target" && finding.evidenceId === "job_posting";
    if (
      (isCandidate && !evidence && !crossDocument && !targetFinding) ||
      (!isCandidate && finding.evidenceId !== "job_posting")
    ) {
      incomplete = true;
      continue;
    }
    const recoveryClaims = explicitAdviceClaims(finding.recovery);
    const recoverySource =
      evidence?.text ??
      (crossDocument
        ? input.resumeText + "\n" + input.coverLetterText
        : input.jobText);
    if (
      recoveryClaims.length &&
      ((!evidence && !crossDocument) ||
        recoveryClaims.some(
          (claim) =>
            candidateClaimIssue(claim, recoverySource) ||
            findUngroundedProseProperClaimTerm(claim, recoverySource, ""),
        ))
    ) {
      incomplete = true;
      continue;
    }

    if (
      finding.code === "unsupported_claim" ||
      finding.code === "attribution"
    ) {
      if (!evidence && !crossDocument) {
        incomplete = true;
        continue;
      }
      if (
        !candidateClaimIssue(
          finding.anchor,
          evidence?.text ?? input.resumeText + "\n" + input.coverLetterText,
        )
      ) {
        finding.code = "uncertain";
        finding.message =
          "Check this claim and its attribution against the cited source.";
      }
    }
    accepted.push(finding);
  }
  const all = mergeApplicationReviewFindings(local.findings, accepted);
  const overflow = local.overflow || value.overflow || all.length > 12;
  const complete =
    !incomplete &&
    !overflow &&
    input.evidence.length > 0 &&
    Boolean(input.jobText.trim()) &&
    !local.findings.some(
      (finding) =>
        finding.code === "completeness" || finding.code === "uncertain",
    );
  return {
    ...local,
    findings: all.slice(0, 12),
    complete,
    overflow,
    completedAt: new Date().toISOString(),
  };
}

export async function handleApplicationReview(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST." });
    return;
  }
  const request = requestAbortSignal(req, res);
  let local: ApplicationReviewResult | undefined;
  try {
    const body = await readAiJsonBody(req, 1_000_000);
    const input = parseApplicationReviewInput(body);
    local = localApplicationReview(input);
    if (!local.reviewedDocuments.length) {
      sendJson(res, 200, local);
      return;
    }
    const config = resolveProviderRequest(body);
    const raw = await callConfiguredProvider({
      ...config,
      signal: request.signal,
      retryUnreadableOutput: false,
      systemPrompt: `You review final application materials without changing or submitting them. ${inputFirewallRule()}\nUse only supplied sources. A document under review is not independent evidence for itself. Evidence labeled loaded resume is candidate-supplied, not independently verified. Never invent facts or present an uncertain relationship as a verified defect. Review employer statements only against job_posting; candidate claims only against candidate evidence, preserving entry, duration, technology, outcome, and ownership. Compare all included documents with each other and the target. For cross-document conflicts only, use evidenceId current_resume or current_cover_letter; these sources do not independently establish truth. Candidate revisions and coverage suggestions must cite candidate evidence, never just the posting. Return useful coverage opportunities and editorial instructions grounded in source excerpts. Recovery is advice about what to check or change, not replacement document text. Do not write new candidate claims in recovery. Return at most 12 findings; set overflow true and coverageComplete false if material review remains unfinished. An absence of findings is not a guarantee. Return JSON {"coverageComplete":boolean,"overflow":boolean,"findings":[{"code":"${APPLICATION_REVIEW_CODES.join(" | ")}","document":"resume | coverLetter","anchor":"exact document excerpt","message":"bounded actionable finding","recovery":"bounded suggestion without invented facts","evidenceId":"provided evidence id or job_posting","sourceExcerpt":"exact source excerpt"}]}.`,
      userPrompt: `<resolved_context>${fenceUntrusted(JSON.stringify({ company: input.company, role: input.role }))}</resolved_context>\n<job_description>${fenceUntrusted(input.jobText)}</job_description>\n<current_resume>${fenceUntrusted(input.resumeText)}</current_resume>\n<current_cover_letter>${fenceUntrusted(input.coverLetterText)}</current_cover_letter>\n<candidate_evidence>${fenceUntrusted(JSON.stringify(input.evidence))}</candidate_evidence>`,
    });
    sendJson(res, 200, reviewProviderFindings(raw, input, local));
  } catch (error) {
    if (isRequestAborted(error, req, res)) return;
    const message =
      error instanceof UserSafeAiError
        ? error.message
        : safeConfigErrorMessage(error instanceof Error ? error.message : "") ||
          "Final review could not finish. Check AI settings and retry.";
    sendJson(
      res,
      local ? 200 : error instanceof UserSafeAiError ? error.status : 500,
      local
        ? { ...local, error: message, complete: false }
        : { error: message },
    );
  } finally {
    request.dispose();
  }
}
