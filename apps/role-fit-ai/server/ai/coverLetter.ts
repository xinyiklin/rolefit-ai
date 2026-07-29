// Cover-letter AI is one request. The model sees the whole evidence corpus and
// decides what to use; the server resolves correspondence deterministically,
// validates the result, and repairs once in silence before giving up. Nothing
// here pauses for candidate approval. The legacy grounded reviser below still
// serves the older optional /api/polish cover leg, which the browser never uses.

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
  buildCoverLetterPrompts,
  buildCoverLetterTailorPrompts,
  clipForPrompt,
  COVER_JOB_CHAR_LIMIT,
  COVER_RESUME_CHAR_LIMIT,
  COVER_SOURCE_CHAR_LIMIT
} from "./prompts.ts";
import { callConfiguredProvider } from "./clients.ts";
import { findUngroundedJdTerm, findUngroundedOutcomeClaim } from "./grounding.ts";
import { hasUngroundedNumericClaim } from "./sanitize.ts";
import {
  buildCoverLetterPreflight,
  hasUnresolvedCoverLetterTokens,
  type ResolvedCoverLetterContext
} from "../../src/lib/coverLetterPreflight.ts";
import type {
  CoverLetterEvidenceItem,
  CoverLetterTailorResult
} from "../../src/lib/coverLetterEvidence.ts";
import {
  assembleCoverLetterText,
  coverLetterLengthWarnings,
  COVER_LETTER_CHAR_LIMIT,
  evidenceUsedByParagraphs,
  parseCoverLetterEvidenceItems,
  SOURCE_LETTER_EVIDENCE_ID,
  validateCoverLetterTailorOutput
} from "./coverLetterContracts.ts";
import {
  analyzeCoverLetterTemplate,
  type CoverLetterSourceContext
} from "../../src/lib/coverLetterTemplate.ts";

// Optional dispatch-attempt collector (same additive pattern as the sanitizer's
// drop-stats): callConfiguredProvider bumps `attempts` once per dispatch attempt.
type AttemptStats = { attempts?: number };

// A public employer fact plus where it came from. Populated by an app-owned
// research step; absent employer context never blocks or delays tailoring.
export type CoverLetterEmployerFact = { fact: string; source: string };

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Employer/job statements may use facts from the posting, but they must not
// widen the candidate-evidence corpus. Remove sentences whose grammatical
// subject is clearly the resolved employer, team, role, or posting only when
// they contain no candidate reference. Mixed employer/candidate sentences remain
// visible to the JD-term candidate-claim gate.
function candidateClaimSurface(text: string, resolved: ResolvedCoverLetterContext): string {
  const company = resolved.company.trim();
  const candidateName = resolved.candidateName.trim();
  const employerSubject = company
    ? new RegExp(
        `^(?:${escapeRegex(company)}(?:['’]s)?(?=\\s|[,:;.!?]|$)|The company\\b|The team\\b|This role\\b|The posting\\b)`,
        "i"
      )
    : /^(?:The company|The team|This role|The posting)\b/i;
  const candidateReferences = [candidateName, candidateName.split(/\s+/)[0] ?? ""]
    .filter((value, index, values) => value.length >= 2 && values.indexOf(value) === index)
    .map(escapeRegex);
  const candidateReference = new RegExp(
    `\\b(?:I|me|my|mine|we|us|our|ours|candidate|applicant${
      candidateReferences.length > 0 ? `|${candidateReferences.join("|")}` : ""
    })\\b`,
    "i"
  );
  // The server's supported Node runtime includes sentence segmentation. It
  // preserves abbreviations in employer names such as "Acme, Inc."; a raw
  // punctuation split would turn that valid employer-only fact into fragments.
  const sentences = [
    ...new Intl.Segmenter("en", { granularity: "sentence" }).segment(text)
  ].flatMap(({ segment }) => segment.split(/[\r\n]+/));
  return sentences
    .filter((sentence) => {
      const trimmed = sentence.trim();
      return !employerSubject.test(trimmed) || candidateReference.test(trimmed);
    })
    .join(" ");
}

// The resolved provider config + grounding inputs the legacy reviser needs.
type CoverLetterArgs = {
  provider: string;
  model: string;
  reasoningEffort?: string | null;
  apiKey?: string;
  jobText: string;
  resumeText: string;
  sourceCoverLetterText: string;
  honestContext: string;
  customInstructions: string;
  resolvedContext?: ResolvedCoverLetterContext;
  signal?: AbortSignal;
};

// Build the cover-letter revision prompt, call the provider, and apply the grounding
// backstop. The grounding corpus is the resume text fed to the prompt plus
// honest context, so each caller grounds against exactly what produced the
// letter. Returns the letter, or "" when it is empty or blanked for an
// ungrounded claim (callers treat that as a failed revision).
export async function reviseGroundedCoverLetter(
  {
    provider,
    model,
    reasoningEffort,
    apiKey,
    jobText,
    resumeText,
    sourceCoverLetterText,
    honestContext,
    customInstructions,
    resolvedContext,
    signal
  }: CoverLetterArgs,
  stats?: AttemptStats
): Promise<string> {
  const legacySource = analyzeCoverLetterTemplate({
    text: sourceCoverLetterText,
    candidateName: resolvedContext?.candidateName,
    role: resolvedContext?.role,
    company: resolvedContext?.company,
    recipientName: resolvedContext?.recipientName,
    date: resolvedContext?.date
  });
  const { systemPrompt, userPrompt } = buildCoverLetterPrompts({
    jobText: clipForPrompt(jobText, COVER_JOB_CHAR_LIMIT, "job description"),
    resumeText: clipForPrompt(resumeText, COVER_RESUME_CHAR_LIMIT, "resume"),
    sourceCoverLetterText: clipForPrompt(
      legacySource.authoredProse,
      COVER_SOURCE_CHAR_LIMIT,
      "source cover letter"
    ),
    honestContext,
    customInstructions,
    resolvedContext
  });
  const parsed = await callConfiguredProvider(
    { provider, model, reasoningEffort, apiKey, systemPrompt, userPrompt, signal },
    stats
  );
  const letter = String((parsed as { coverLetterText?: unknown }).coverLetterText ?? "")
    .trim()
    .slice(0, COVER_LETTER_CHAR_LIMIT);
  const grounding = `${legacySource.authoredProse}\n${resumeText}\n${honestContext}\n${JSON.stringify(resolvedContext ?? {})}`;
  if (
    hasUnresolvedCoverLetterTokens(letter) ||
    findUngroundedJdTerm(letter, jobText.toLowerCase(), grounding.toLowerCase(), {
      proseMode: true
    }) ||
    hasUngroundedNumericClaim(letter, grounding) ||
    findUngroundedOutcomeClaim(letter, grounding, { candidateProse: true })
  ) {
    console.warn(
      "[ai] cover letter failed grounding or placeholder checks; returning an empty result",
      { provider }
    );
    return "";
  }
  return letter;
}

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
  signal?: AbortSignal;
};

// Candidate-claim grounding, expressed as repairable violations rather than a
// single opaque rejection so the repair pass knows what to fix.
function groundingViolations({
  coverLetterText,
  jobText,
  grounding,
  resolved
}: {
  coverLetterText: string;
  jobText: string;
  grounding: string;
  resolved: ResolvedCoverLetterContext;
}): string[] {
  const claims = candidateClaimSurface(coverLetterText, resolved);
  const violations: string[] = [];
  const ungroundedTerm = findUngroundedJdTerm(
    claims,
    jobText.toLowerCase(),
    grounding.toLowerCase(),
    { proseMode: true }
  );
  if (ungroundedTerm) {
    violations.push(
      `The letter claims "${ungroundedTerm}" for the candidate, but no supplied evidence supports it. Remove the claim or ground it in real evidence.`
    );
  }
  if (hasUngroundedNumericClaim(claims, grounding)) {
    violations.push(
      "The letter states a number, scale, or duration that no supplied evidence contains. Remove it or use a figure the evidence states."
    );
  }
  const outcome = findUngroundedOutcomeClaim(claims, grounding, { candidateProse: true });
  if (outcome) {
    violations.push(
      `The letter claims an outcome no evidence supports: "${outcome}". Describe only what the evidence records.`
    );
  }
  return violations;
}

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
    signal
  }: TailorCoverLetterArgs,
  stats?: AttemptStats
): Promise<CoverLetterTailorResult> {
  const promptInput = {
    jobText: clipForPrompt(jobText, COVER_JOB_CHAR_LIMIT, "job description"),
    sourceContext: {
      structuredTemplate: sourceContext.structuredTemplate,
      authoredProse: sourceContext.authoredProse,
      slots: sourceContext.slots
    },
    evidenceItems,
    resolvedContext,
    employerContext,
    customInstructions
  };
  const grounding = [
    sourceContext.authoredProse,
    ...evidenceItems.map((item) => item.text),
    JSON.stringify(resolvedContext)
  ].join("\n");

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
    const violations = [
      ...validation.violations,
      ...(validation.output
        ? groundingViolations({
            coverLetterText: validation.coverLetterText,
            jobText,
            grounding,
            resolved: resolvedContext
          })
        : [])
    ];
    return { parsed, validation, violations };
  };

  let run = await attempt();
  let repaired = false;
  if (run.violations.length > 0) {
    // One silent repair. A model that omits an id or reaches for a stock phrase
    // is a drafting slip, not a reason to hand the candidate a planning task.
    repaired = true;
    run = await attempt({ violations: run.violations, rejectedOutput: run.parsed });
  }
  if (!run.validation.output || run.violations.length > 0) {
    throw new UserSafeAiError(
      "The tailored letter did not pass RoleFit's evidence checks, so your current letter was kept. Try again, or add the missing detail to your resume or personal context.",
      422
    );
  }

  const { output } = run.validation;
  const coverLetterText = assembleCoverLetterText(output.bodyParagraphs, resolvedContext);
  return {
    status: "ready",
    coverLetterText,
    bodyParagraphs: output.bodyParagraphs,
    evidenceUsed: evidenceUsedByParagraphs(output.bodyParagraphs, evidenceItems),
    warnings: [...output.warnings, ...coverLetterLengthWarnings(coverLetterText)],
    ...(repaired ? { repaired: true } : {})
  };
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

export async function handleCoverLetter(
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
    const customInstructions = String(body.customInstructions ?? "").slice(0, 4_000);
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

    const evidenceItems = parseCoverLetterEvidenceItems(body.evidenceItems);
    if (!evidenceItems.some((item) => item.source === "resume")) {
      sendJson(res, 400, { error: "Add your resume before tailoring a cover letter." });
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
        signal: request.signal
      },
      coverStats
    );
    sendJson(res, 200, {
      ...result,
      model,
      provider,
      reasoningEffort,
      attempts: coverStats.attempts ?? 1
    });
  } catch (error) {
    if (isRequestAborted(error, req, res)) return;
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
      error: "Could not tailor the cover letter. Check AI settings and try again."
    });
  } finally {
    request.dispose();
  }
}

export { SOURCE_LETTER_EVIDENCE_ID };
