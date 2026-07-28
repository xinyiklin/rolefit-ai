// Cover-letter AI has two explicit standalone stages: preparation classifies
// every atomic evidence item, then drafting receives only selected evidence.
// The legacy grounded reviser remains for the older optional /api/polish cover
// leg, but the browser workflow never uses that one-string path.

import type { IncomingMessage, ServerResponse } from "node:http";
import {
  FetchTimeoutError,
  isRequestAborted,
  requestAbortSignal,
  sendJson,
} from "../http.ts";
import { UserSafeAiError, safeConfigErrorMessage } from "./errors.ts";
import { readAiJsonBody } from "./json.ts";
import { resolveProviderRequest } from "./providers.ts";
import {
  buildCoverLetterPreparationPrompts,
  buildCoverLetterPrompts,
  buildPreparedCoverLetterDraftPrompts,
  clipForPrompt,
  COVER_JOB_CHAR_LIMIT,
  COVER_RESUME_CHAR_LIMIT,
  COVER_SOURCE_CHAR_LIMIT,
} from "./prompts.ts";
import { callConfiguredProvider } from "./clients.ts";
import {
  findUngroundedOutcomeClaim,
  proseHasUngroundedTerm,
} from "./grounding.ts";
import { hasUngroundedNumericClaim } from "./sanitize.ts";
import {
  buildCoverLetterPreflight,
  hasUnresolvedCoverLetterTokens,
  type CoverLetterPreparationValues,
  type CoverLetterSourceMode,
  type ResolvedCoverLetterContext,
} from "../../src/lib/coverLetterPreflight.ts";
import type {
  CoverLetterEvidenceOverride,
  CoverLetterEvidenceItem,
  CoverLetterPlan,
  CoverLetterPreparation,
  CoverLetterProposal,
} from "../../src/lib/coverLetterEvidence.ts";
import {
  assembleCoverLetterProposal,
  parseCoverLetterEvidenceOverrides,
  parseCoverLetterEvidenceItems,
  validateCoverLetterDraftOutput,
  validateCoverLetterPlanForDraft,
  validateCoverLetterPreparationOutput,
} from "./coverLetterContracts.ts";
import { hasPreservedSourcePhrase } from "./coverLetterQuality.ts";
import {
  analyzeCoverLetterTemplate,
  coverLetterHasAuthoredVoice,
  type CoverLetterSourceContext,
} from "../../src/lib/coverLetterTemplate.ts";

// Upper bound on a returned cover letter (~3 paragraphs / 180-280 words is ~2k
// chars; this just caps a pathological provider response, matching the per-field
// caps in applicationAnswers.ts).
const COVER_LETTER_CHAR_LIMIT = 8_000;

// Optional dispatch-attempt collector (same additive pattern as the sanitizer's
// drop-stats): callConfiguredProvider bumps `attempts` once per dispatch attempt.
type AttemptStats = { attempts?: number };

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Employer/job statements may use facts from the posting, but they must not
// widen the candidate-evidence corpus. Remove sentences whose grammatical
// subject is clearly the resolved employer, team, role, or posting only when
// they contain no candidate reference. Mixed employer/candidate sentences remain
// visible to the JD-term candidate-claim gate.
function candidateClaimSurface(
  text: string,
  resolved: ResolvedCoverLetterContext,
): string {
  const company = resolved.company.trim();
  const candidateName = resolved.candidateName.trim();
  const employerSubject = company
    ? new RegExp(
        `^(?:${escapeRegex(company)}(?:'s)?|The company|The team|This role|The posting)\\b`,
        "i",
      )
    : /^(?:The company|The team|This role|The posting)\b/i;
  const candidateReferences = [
    candidateName,
    candidateName.split(/\s+/)[0] ?? "",
  ]
    .filter(
      (value, index, values) =>
        value.length >= 2 && values.indexOf(value) === index,
    )
    .map(escapeRegex);
  const candidateReference = new RegExp(
    `\\b(?:I|me|my|mine|we|us|our|ours|candidate|applicant${
      candidateReferences.length > 0 ? `|${candidateReferences.join("|")}` : ""
    })\\b`,
    "i",
  );
  return text
    .split(/(?<=[.!?])\s+|[\r\n]+/)
    .filter((sentence) => {
      const trimmed = sentence.trim();
      return !employerSubject.test(trimmed) || candidateReference.test(trimmed);
    })
    .join(" ");
}

// The resolved provider config + grounding inputs the grounded generator needs.
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
  sourceMode?: CoverLetterSourceMode;
  preparationValues?: CoverLetterPreparationValues;
  resolvedContext?: ResolvedCoverLetterContext;
  signal?: AbortSignal;
};

type PreparedCoverLetterCommonArgs = {
  provider: string;
  model: string;
  reasoningEffort?: string | null;
  apiKey?: string;
  jobText: string;
  sourceContext: CoverLetterSourceContext;
  sourceMode: CoverLetterSourceMode;
  preparationValues: CoverLetterPreparationValues;
  resolvedContext: ResolvedCoverLetterContext;
  customInstructions: string;
  signal?: AbortSignal;
};

// Build the cover-letter revision prompt, call the provider, and apply the grounding
// backstop. The grounding corpus is the resume text fed to the prompt plus
// honest context, so each caller grounds against exactly what produced the
// letter: the polish pass passes its polished/tailored text, the standalone
// path passes the current resume. Returns the letter, or "" when it is empty or
// blanked for an ungrounded claim (callers treat that as a failed revision).
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
    sourceMode = "authored_letter",
    preparationValues = {},
    resolvedContext,
    signal,
  }: CoverLetterArgs,
  stats?: AttemptStats,
): Promise<string> {
  const legacySource = analyzeCoverLetterTemplate({
    text: sourceCoverLetterText,
    candidateName: resolvedContext?.candidateName,
    role: resolvedContext?.role,
    company: resolvedContext?.company,
    recipientName: resolvedContext?.recipientName,
    date: resolvedContext?.date,
  });
  const { systemPrompt, userPrompt } = buildCoverLetterPrompts({
    jobText: clipForPrompt(jobText, COVER_JOB_CHAR_LIMIT, "job description"),
    resumeText: clipForPrompt(resumeText, COVER_RESUME_CHAR_LIMIT, "resume"),
    sourceCoverLetterText: clipForPrompt(
      legacySource.authoredProse,
      COVER_SOURCE_CHAR_LIMIT,
      "source cover letter",
    ),
    honestContext,
    customInstructions,
    sourceMode,
    preparationValues,
    resolvedContext,
  });
  const parsed = await callConfiguredProvider(
    {
      provider,
      model,
      reasoningEffort,
      apiKey,
      systemPrompt,
      userPrompt,
      signal,
    },
    stats,
  );
  const letter = String(
    (parsed as { coverLetterText?: unknown }).coverLetterText ?? "",
  )
    .trim()
    .slice(0, COVER_LETTER_CHAR_LIMIT);
  const preparationEvidence = Object.values(preparationValues).join("\n");
  const grounding = `${legacySource.authoredProse}\n${resumeText}\n${honestContext}\n${preparationEvidence}\n${JSON.stringify(resolvedContext ?? {})}`;
  if (
    hasUnresolvedCoverLetterTokens(letter) ||
    proseHasUngroundedTerm(
      letter,
      jobText.toLowerCase(),
      grounding.toLowerCase(),
    ) ||
    hasUngroundedNumericClaim(letter, grounding) ||
    findUngroundedOutcomeClaim(letter, grounding, { candidateProse: true })
  ) {
    console.warn(
      "[ai] cover letter failed grounding or placeholder checks; returning an empty result",
      { provider },
    );
    return "";
  }
  return letter;
}

export async function prepareCoverLetter(
  {
    provider,
    model,
    reasoningEffort,
    apiKey,
    jobText,
    sourceContext,
    sourceMode,
    preparationValues,
    resolvedContext,
    customInstructions,
    signal,
    evidenceItems,
    evidenceOverrides = [],
    clarificationAnswers,
  }: PreparedCoverLetterCommonArgs & {
    evidenceItems: CoverLetterEvidenceItem[];
    evidenceOverrides?: CoverLetterEvidenceOverride[];
    clarificationAnswers: Record<string, string>;
  },
  stats?: AttemptStats,
): Promise<CoverLetterPreparation> {
  const { systemPrompt, userPrompt } = buildCoverLetterPreparationPrompts({
    jobText: clipForPrompt(jobText, COVER_JOB_CHAR_LIMIT, "job description"),
    sourceContext: {
      structuredTemplate: sourceContext.structuredTemplate,
      authoredProse: sourceContext.authoredProse,
      slots: sourceContext.slots,
    },
    sourceMode,
    evidenceItems,
    evidenceOverrides,
    preparationValues,
    resolvedContext,
    clarificationAnswers,
    customInstructions,
  });
  const parsed = await callConfiguredProvider(
    {
      provider,
      model,
      reasoningEffort,
      apiKey,
      systemPrompt,
      userPrompt,
      signal,
    },
    stats,
  );
  return validateCoverLetterPreparationOutput(
    parsed,
    evidenceItems,
    sourceMode,
    sourceContext,
    sourceMode === "guided_draft" &&
      !coverLetterHasAuthoredVoice(sourceContext.authoredProse),
    evidenceOverrides,
  );
}

export async function draftPreparedCoverLetter(
  {
    provider,
    model,
    reasoningEffort,
    apiKey,
    jobText,
    sourceContext,
    sourceMode,
    preparationValues,
    resolvedContext,
    customInstructions,
    signal,
    plan,
    selectedEvidence,
  }: PreparedCoverLetterCommonArgs & {
    plan: CoverLetterPlan;
    selectedEvidence: CoverLetterEvidenceItem[];
  },
  stats?: AttemptStats,
): Promise<CoverLetterProposal> {
  const selectedPlan: CoverLetterPlan = {
    ...plan,
    decisions: plan.decisions.filter((decision) => decision.decision === "use"),
  };
  const { systemPrompt, userPrompt } = buildPreparedCoverLetterDraftPrompts({
    jobText: clipForPrompt(jobText, COVER_JOB_CHAR_LIMIT, "job description"),
    sourceContext: {
      structuredTemplate: sourceContext.structuredTemplate,
      authoredProse: sourceContext.authoredProse,
      slots: sourceContext.slots,
    },
    sourceMode,
    selectedEvidence,
    plan: selectedPlan,
    resolvedContext,
    tonePreference: preparationValues.tone,
    customInstructions,
  });
  const parsed = await callConfiguredProvider(
    {
      provider,
      model,
      reasoningEffort,
      apiKey,
      systemPrompt,
      userPrompt,
      signal,
    },
    stats,
  );
  const output = validateCoverLetterDraftOutput(
    parsed,
    selectedEvidence,
    sourceContext,
    plan,
    resolvedContext,
  );
  const proposal = assembleCoverLetterProposal(
    output,
    resolvedContext,
    selectedEvidence,
  );
  const bodyText = proposal.blocks
    .filter((block) => block.kind === "body")
    .map((block) => block.text)
    .join("\n\n");
  if (
    coverLetterHasAuthoredVoice(sourceContext.authoredProse) &&
    !hasPreservedSourcePhrase(sourceContext.authoredProse, bodyText)
  ) {
    throw new UserSafeAiError(
      "The draft did not preserve a recognizable phrase from the authored letter. Try again.",
      502,
    );
  }
  const grounding = [
    sourceContext.authoredProse,
    ...selectedEvidence.map((item) => item.text),
    JSON.stringify(resolvedContext),
  ].join("\n");
  const candidateClaims = candidateClaimSurface(
    proposal.coverLetterText,
    resolvedContext,
  );
  if (
    proseHasUngroundedTerm(
      candidateClaims,
      jobText.toLowerCase(),
      grounding.toLowerCase(),
    ) ||
    hasUngroundedNumericClaim(candidateClaims, grounding) ||
    findUngroundedOutcomeClaim(candidateClaims, grounding, {
      candidateProse: true,
    })
  ) {
    throw new UserSafeAiError(
      "The draft did not pass evidence checks. Review the selected evidence and try again.",
      422,
    );
  }
  return proposal;
}

function parsePreparationValues(
  body: Record<string, unknown>,
): CoverLetterPreparationValues {
  const rawValues =
    body.preparationValues && typeof body.preparationValues === "object"
      ? (body.preparationValues as Record<string, unknown>)
      : {};
  return {
    candidate_name: String(rawValues.candidate_name ?? "").slice(0, 200),
    role: String(rawValues.role ?? "").slice(0, 300),
    company: String(rawValues.company ?? "").slice(0, 300),
    recipient_name: String(rawValues.recipient_name ?? "").slice(0, 300),
    why_role: String(rawValues.why_role ?? "").slice(0, 2_000),
    lead_experience: String(rawValues.lead_experience ?? "").slice(0, 4_000),
    tone: String(rawValues.tone ?? "").slice(0, 500),
  };
}

function parseClarificationAnswers(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const answers: Record<string, string> = {};
  for (const [key, rawAnswer] of Object.entries(
    value as Record<string, unknown>,
  ).slice(0, 20)) {
    if (!/^[A-Za-z0-9:_-]{1,140}$/.test(key)) continue;
    const answer = String(rawAnswer ?? "")
      .trim()
      .slice(0, 2_000);
    if (answer) answers[key] = answer;
  }
  return answers;
}

export async function handleCoverLetter(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST." });
    return;
  }

  const request = requestAbortSignal(req, res);
  try {
    const body = await readAiJsonBody(req, 1_000_000);
    const mode =
      body.mode === "prepare" || body.mode === "draft" ? body.mode : null;
    if (!mode) {
      sendJson(res, 400, {
        error: "Choose prepare or draft mode for the cover-letter request.",
      });
      return;
    }
    const jobText = String(body.jobText ?? "").slice(0, 35_000);
    const sourceCoverLetterText = String(
      body.sourceCoverLetterText ?? "",
    ).slice(0, 35_000);
    const customInstructions = String(body.customInstructions ?? "").slice(
      0,
      4_000,
    );

    const sourceMode: CoverLetterSourceMode | null =
      body.sourceMode === "authored_letter" ||
      body.sourceMode === "guided_draft"
        ? body.sourceMode
        : null;
    if (!sourceMode) {
      sendJson(res, 400, {
        error: "Choose authored-letter or guided-draft mode before continuing.",
      });
      return;
    }
    const preparationValues = parsePreparationValues(body);
    const rawResolved =
      body.resolvedContext && typeof body.resolvedContext === "object"
        ? (body.resolvedContext as Record<string, unknown>)
        : {};
    const clarificationAnswers = parseClarificationAnswers(
      body.clarificationAnswers,
    );
    const preflight = buildCoverLetterPreflight({
      text: sourceCoverLetterText,
      sourceMode,
      candidateName: String(rawResolved.candidateName ?? "").slice(0, 200),
      role: String(rawResolved.role ?? "").slice(0, 300),
      company: String(rawResolved.company ?? "").slice(0, 300),
      values: preparationValues,
      slotAnswers: clarificationAnswers,
      date: String(rawResolved.date ?? "").slice(0, 100),
    });
    if (!preflight.canPrepare) {
      sendJson(res, 422, {
        status: "needs_input",
        missingFields: preflight.missingFields,
        reasons: preflight.preparationBlockers,
      });
      return;
    }
    if (jobText.trim().length < 40) {
      sendJson(res, 400, {
        error:
          "Add the job description so the cover letter can be tailored to this role.",
      });
      return;
    }

    const resolved = resolveProviderRequest(body);
    const { provider, apiKey, model, reasoningEffort } = resolved;
    const coverStats: AttemptStats = {};
    const sourceContext: CoverLetterSourceContext = {
      rawTemplateText: sourceCoverLetterText,
      structuredTemplate: preflight.template.structuredTemplate,
      authoredProse: preflight.template.authoredProse,
      slots: preflight.template.slots,
    };
    const common = {
      provider,
      model,
      reasoningEffort,
      apiKey,
      jobText,
      sourceContext,
      sourceMode,
      preparationValues,
      resolvedContext: preflight.resolved,
      customInstructions,
      signal: request.signal,
    };
    if (mode === "prepare") {
      const evidenceItems = parseCoverLetterEvidenceItems(body.evidenceItems);
      const evidenceOverrides = parseCoverLetterEvidenceOverrides(
        body.evidenceOverrides,
        evidenceItems,
      );
      if (!evidenceItems.some((item) => item.source === "resume")) {
        sendJson(res, 400, {
          error: "Add your resume before preparing a cover letter.",
        });
        return;
      }
      const preparation = await prepareCoverLetter(
        {
          ...common,
          evidenceItems,
          evidenceOverrides,
          clarificationAnswers,
        },
        coverStats,
      );
      sendJson(res, 200, {
        ...preparation,
        model,
        provider,
        reasoningEffort,
        attempts: coverStats.attempts ?? 1,
      });
      return;
    }

    const selectedEvidence = parseCoverLetterEvidenceItems(
      body.selectedEvidence,
    );
    if (selectedEvidence.length > 3) {
      sendJson(res, 400, {
        error: "Choose no more than three evidence items for this letter.",
      });
      return;
    }
    if (
      preflight.requiresUserVoiceAnchor &&
      !selectedEvidence.some((item) => item.source === "user_answer")
    ) {
      sendJson(res, 400, {
        error: "A guided draft must use at least one candidate answer.",
      });
      return;
    }
    const plan = validateCoverLetterPlanForDraft(
      body.plan,
      selectedEvidence,
      sourceContext,
    );
    const proposal = await draftPreparedCoverLetter(
      {
        ...common,
        plan,
        selectedEvidence,
      },
      coverStats,
    );
    sendJson(res, 200, {
      ...proposal,
      model,
      provider,
      reasoningEffort,
      attempts: coverStats.attempts ?? 1,
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
        error: "The AI provider timed out. Try again or switch providers.",
      });
      return;
    }
    if (error instanceof Error && error.message === "Request is too large.") {
      sendJson(res, 413, {
        error:
          "Request is too large. Shorten the cover letter, resume, or job text.",
      });
      return;
    }
    const configMessage = safeConfigErrorMessage(
      error instanceof Error ? error.message : "",
    );
    if (configMessage) {
      sendJson(res, 400, { error: configMessage });
      return;
    }
    sendJson(res, 500, {
      error:
        "Could not tailor the cover letter. Check AI settings and try again.",
    });
  } finally {
    request.dispose();
  }
}
