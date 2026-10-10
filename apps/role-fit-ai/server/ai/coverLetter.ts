// Cover-letter AI is one request. The model sees the whole evidence corpus and
// decides what to use; the server resolves correspondence deterministically,
// warns on content concerns and repairs unusable structure once. The
// server has no approval stage; the browser stages a valid response as a
// proposal. `concerns` are factual findings the browser may carry into the
// next request after acceptance; `warnings` describe only this draft.

import { sanitizeContentWarnings } from "../../shared/contentWarnings.ts";
import { coverFitGapStatements, parsePolishFitFindings, type PolishFitFindings } from "../../shared/polishFitFindings.ts";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  FetchTimeoutError,
  isRequestAborted,
  requestAbortSignal,
  sendJson
} from "../http.ts";
import { UserSafeAiError, safeConfigErrorMessage } from "./errors.ts";
import { readAiJsonBody } from "./json.ts";
import { resolveProviderRequest } from "./providers.ts";
import {
  buildCoverLetterTailorPrompts,
  clipForPrompt,
  COVER_JOB_CHAR_LIMIT
} from "./prompts.ts";
import { callConfiguredProvider } from "./clients.ts";
import {
  buildCoverLetterPreflight,
  type ResolvedCoverLetterContext
} from "../../src/lib/coverLetterPreflight.ts";
import type {
  CoverLetterEvidenceItem,
  CoverLetterTailorResult
} from "../../src/lib/coverLetterEvidence.ts";
import {
  assembleCoverLetterText,
  coverLetterLengthWarnings,
  evidenceUsedByParagraphs,
  parseCoverLetterEvidenceItems,
  SOURCE_LETTER_EVIDENCE_ID,
  validateCoverLetterTailorOutput
} from "./coverLetterContracts.ts";
import type { CoverLetterSourceContext } from "../../src/lib/coverLetterTemplate.ts";
import {
  CoverLetterBlockedError,
  coverLetterIssueWarnings,
  isCoverLetterConcern,
  repairMessagesForCoverLetterIssues
} from "./coverLetterIssues.ts";
import { coverLetterParagraphClaims } from "./coverLetterParagraphEvidence.ts";

// Optional dispatch-attempt collector (same additive pattern as the sanitizer's
// drop-stats): callConfiguredProvider bumps `attempts` once per dispatch attempt.
type AttemptStats = { attempts?: number };

// A public employer fact plus where it came from. Populated by an app-owned
// research step; absent employer context never blocks or delays tailoring.
export type CoverLetterEmployerFact = { fact: string; source: string };

type TailorCoverLetterArgs = {
  provider: string;
  model: string;
  reasoningEffort?: string | null;
  apiKey?: string;
  jobText: string;
  sourceContext: CoverLetterSourceContext;
  evidenceItems: CoverLetterEvidenceItem[];
  resolvedContext: ResolvedCoverLetterContext;
  employerContext: CoverLetterEmployerFact[];
  customInstructions: string;
  fitFindings?: PolishFitFindings | null;
  signal?: AbortSignal;
};

export async function tailorCoverLetter(
  {
    provider,
    model,
    reasoningEffort,
    apiKey,
    jobText,
    sourceContext,
    evidenceItems,
    resolvedContext,
    employerContext,
    customInstructions,
    fitFindings = null,
    signal
  }: TailorCoverLetterArgs,
  stats?: AttemptStats
): Promise<CoverLetterTailorResult> {
  const promptInput = {
    reasoningEffort,
    jobText: clipForPrompt(jobText, COVER_JOB_CHAR_LIMIT, "job description"),
    sourceContext: {
      structuredTemplate: sourceContext.structuredTemplate,
      authoredProse: sourceContext.authoredProse,
      slots: sourceContext.slots
    },
    evidenceItems,
    resolvedContext,
    employerContext,
    customInstructions,
    fitFindings
  };

  const attempt = async (repair?: { violations: string[]; rejectedOutput: unknown }) => {
    const { systemPrompt, userPrompt } = buildCoverLetterTailorPrompts({
      ...promptInput,
      ...(repair ? { repair } : {})
    });
    const parsed = await callConfiguredProvider(
      { provider, model, reasoningEffort, apiKey, systemPrompt, userPrompt, signal },
      stats
    );
    const validation = validateCoverLetterTailorOutput({
      value: parsed,
      evidence: evidenceItems,
      sourceContext,
      resolved: resolvedContext
    });
    const claimReview = validation.output
      ? coverLetterParagraphClaims({
          paragraphs: validation.output.bodyParagraphs,
          evidence: evidenceItems, authoredProse: sourceContext.authoredProse,
          jobText, employerContext: employerContext.map((item) => item.fact).join("\n"),
          resolved: resolvedContext
        })
      : { issues: [], warnings: [] };
    const issues = [...validation.issues, ...claimReview.issues];
    return { parsed, validation, issues, concerns: claimReview.warnings };
  };

  let run = await attempt();
  let repaired = false;
  if (!run.validation.output || run.issues.some((issue) => issue.blocking)) {
    // Repair only technical defects; usable content concerns remain advisory.
    repaired = true;
    // The model's own notes are display-only, so they never go back to it.
    const { warnings: _notes, ...rejectedOutput } = (run.parsed && typeof run.parsed === "object" && !Array.isArray(run.parsed)
      ? run.parsed
      : { value: run.parsed }) as Record<string, unknown>;
    run = await attempt({
      violations: repairMessagesForCoverLetterIssues(run.issues.filter((issue) => issue.blocking)),
      rejectedOutput
    });
  }
  if (!run.validation.output || run.issues.some((issue) => issue.blocking)) {
    throw new CoverLetterBlockedError(run.issues.filter((issue) => issue.blocking), repaired);
  }

  const { output } = run.validation;
  const coverLetterText = assembleCoverLetterText(output.bodyParagraphs, resolvedContext);
  // Claim findings are about the facts in the wording, so they outlive
  // acceptance; structure, quality, citation bookkeeping, leftover tokens,
  // style, length, and model notes describe this draft only and are recomputed
  // for the next one. Model notes sit last so the list cap trims them first.
  const durable = run.issues.filter(isCoverLetterConcern);
  const draftOnly = run.issues.filter((issue) => !isCoverLetterConcern(issue));
  return {
    status: "ready",
    coverLetterText,
    bodyParagraphs: output.bodyParagraphs,
    evidenceUsed: evidenceUsedByParagraphs(output.bodyParagraphs, evidenceItems),
    warnings: sanitizeContentWarnings([...coverLetterIssueWarnings(draftOnly), ...output.warnings, ...coverLetterLengthWarnings(coverLetterText), ...output.modelNotes]) ?? [],
    concerns: sanitizeContentWarnings([...coverLetterIssueWarnings(durable), ...run.concerns]) ?? [],
    ...(fitFindings?.gaps.length ? { fitGaps: coverFitGapStatements(parsedFitGaps(run.parsed), fitFindings, output.bodyParagraphs.length) } : {}),
    ...(repaired ? { repaired: true } : {})
  };
}

// Display-only statements; they never become a warning or concern.
function parsedFitGaps(parsed: unknown): unknown {
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>).fitGaps : undefined;
}

function parseDetailValues(body: Record<string, unknown>) {
  const rawValues =
    body.detailValues && typeof body.detailValues === "object"
      ? (body.detailValues as Record<string, unknown>)
      : {};
  return {
    candidate_name: String(rawValues.candidate_name ?? "").slice(0, 200),
    role: String(rawValues.role ?? "").slice(0, 300),
    company: String(rawValues.company ?? "").slice(0, 300)
  };
}

function parseSlotAnswers(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const answers: Record<string, string> = {};
  for (const [key, rawAnswer] of Object.entries(value as Record<string, unknown>).slice(0, 20)) {
    if (!/^[A-Za-z0-9:_-]{1,140}$/.test(key)) continue;
    const answer = String(rawAnswer ?? "")
      .trim()
      .slice(0, 2_000);
    if (answer) answers[key] = answer;
  }
  return answers;
}

// Employer research is optional and app-owned. Unusable context is dropped
// silently rather than failing the request.
function parseEmployerContext(value: unknown): CoverLetterEmployerFact[] {
  if (!Array.isArray(value)) return [];
  const facts: CoverLetterEmployerFact[] = [];
  for (const raw of value.slice(0, 12)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const record = raw as Record<string, unknown>;
    const fact = String(record.fact ?? "")
      .trim()
      .slice(0, 600);
    const source = String(record.source ?? "")
      .trim()
      .slice(0, 500);
    if (!fact || !/^https?:\/\//i.test(source)) continue;
    facts.push({ fact, source });
  }
  return facts;
}

export async function handleCoverPolish(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST." });
    return;
  }

  const request = requestAbortSignal(req, res);
  try {
    const body = await readAiJsonBody(req, 1_000_000);
    const jobText = String(body.jobText ?? "").slice(0, 35_000);
    const sourceCoverLetterText = String(body.sourceCoverLetterText ?? "").slice(0, 35_000);
    const sourceWarnings = sanitizeContentWarnings(body.sourceWarnings) ?? [];
    const customInstructions = [String(body.customInstructions ?? "").slice(0, 4_000), ...sourceWarnings].join("\n");
    const detailValues = parseDetailValues(body);
    const rawResolved =
      body.resolvedContext && typeof body.resolvedContext === "object"
        ? (body.resolvedContext as Record<string, unknown>)
        : {};
    const slotAnswers = parseSlotAnswers(body.slotAnswers);
    const preflight = buildCoverLetterPreflight({
      text: sourceCoverLetterText,
      candidateName: String(rawResolved.candidateName ?? "").slice(0, 200),
      role: String(rawResolved.role ?? "").slice(0, 300),
      company: String(rawResolved.company ?? "").slice(0, 300),
      values: detailValues,
      slotAnswers,
      date: String(rawResolved.date ?? "").slice(0, 100)
    });
    if (!preflight.canTailor) {
      sendJson(res, 422, {
        status: "needs_input",
        missingFields: preflight.missingFields,
        privateSlots: preflight.privateSlots.map((slot) => ({
          id: slot.id,
          prompt: slot.normalizedPrompt
        })),
        reasons: preflight.blockers
      });
      return;
    }
    if (jobText.trim().length < 40) {
      sendJson(res, 400, {
        error: "Add the job description so the cover letter can be tailored to this role."
      });
      return;
    }

    const fitFindings = parsePolishFitFindings(body.fitFindings);
    if (fitFindings === "invalid") {
      sendJson(res, 400, { error: "Cover Polish received unreadable Fit findings. Reload the page and try again." });
      return;
    }

    const evidenceItems = parseCoverLetterEvidenceItems(body.evidenceItems);
    if (!evidenceItems.some((item) => item.source === "resume")) {
      sendJson(res, 400, { error: "Add your resume before polishing a cover letter." });
      return;
    }

    const resolved = resolveProviderRequest(body);
    const { provider, apiKey, model, reasoningEffort } = resolved;
    const coverStats: AttemptStats = {};
    const result = await tailorCoverLetter(
      {
        provider,
        model,
        reasoningEffort,
        apiKey,
        jobText,
        sourceContext: {
          rawTemplateText: sourceCoverLetterText,
          structuredTemplate: preflight.template.structuredTemplate,
          authoredProse: preflight.template.authoredProse,
          slots: preflight.template.slots
        },
        evidenceItems,
        resolvedContext: preflight.resolved,
        employerContext: parseEmployerContext(body.employerContext),
        customInstructions,
        fitFindings,
        signal: request.signal
      },
      coverStats
    );
    sendJson(res, 200, {
      ...result,
      warnings: sanitizeContentWarnings([...preflight.warnings, ...result.warnings]) ?? [],
      concerns: sanitizeContentWarnings([...result.concerns, ...sourceWarnings]) ?? [],
      model,
      provider,
      reasoningEffort,
      attempts: coverStats.attempts ?? 1
    });
  } catch (error) {
    if (isRequestAborted(error, req, res)) return;
    if (error instanceof CoverLetterBlockedError) {
      sendJson(res, error.status, {
        status: "blocked",
        reason: "technical_checks",
        error: error.message,
        issues: error.issues,
        repairAttempted: error.repairAttempted
      });
      return;
    }
    if (error instanceof UserSafeAiError) {
      sendJson(res, error.status, { error: error.message });
      return;
    }
    if (
      error instanceof FetchTimeoutError ||
      (error instanceof Error && /timed out|timeout/i.test(error.message))
    ) {
      sendJson(res, 504, {
        error: "The AI provider timed out. Try again or switch providers."
      });
      return;
    }
    if (error instanceof Error && error.message === "Request is too large.") {
      sendJson(res, 413, {
        error: "Request is too large. Shorten the cover letter, resume, or job text."
      });
      return;
    }
    const configMessage = safeConfigErrorMessage(error instanceof Error ? error.message : "");
    if (configMessage) {
      sendJson(res, 400, { error: configMessage });
      return;
    }
    sendJson(res, 500, {
      error: "Could not polish the cover letter. Check AI settings and try again."
    });
  } finally {
    request.dispose();
  }
}

export { SOURCE_LETTER_EVIDENCE_ID };
