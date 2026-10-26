// RoleFit's AI stages as MCP tools. Each builds the request the browser builds
// for its stage (the stage's saved provider, model and effort, the Profile and
// declared facts, the stage's instructions, the evidence-concern notices) and
// returns the app's result; none saves anything. Prompts, grounding and
// sanitizing stay on the server.

import { randomUUID } from "node:crypto";

import {
  parseCoverLetterFile,
  serializeCoverLetterFile
} from "@typeset/engine/lib/coverLetter.ts";
import { coerceDocStyle } from "@typeset/engine/lib/documentStyle.ts";
import { stripInlineMarks } from "@typeset/engine/lib/inlineMarksText.ts";
import { parseResumeFile, serializeResumeFile } from "@typeset/engine/lib/resumeFile.ts";
import { parseApplicationAnswerRevision } from "../shared/applicationAnswerStorage.ts";
import {
  applicationReviewEvidenceLimitError,
  localApplicationReview,
  sanitizeApplicationReviewResult
} from "../shared/applicationReviewContract.ts";
import { profileBackgroundLimitError } from "../shared/candidateProfileContract.ts";
import { sanitizeContentWarnings } from "../shared/contentWarnings.ts";
import { FIT_ASSESSMENT_PROMPT_VERSION, sanitizeFitAssessment } from "../shared/fitAssessmentContract.ts";
import { flattenResumeTargets, sanitizeResumePolishWireResult } from "../shared/resumePolishContract.ts";
import { AI_STAGES, type AiStageId } from "../src/config/aiStages.ts";
import { buildStageRequestFields } from "../src/lib/aiRequest.ts";
import { extractedFromAiOrLocal, type AiJobAnalysisFields } from "../src/lib/aiJobAnalysis.ts";
import { buildApplicationReviewInput } from "../src/lib/applicationReview.ts";
import { buildCandidateContext } from "../src/lib/candidateFacts.ts";
import { buildCoverLetterEvidence } from "../src/lib/coverLetterEvidence.ts";
import { parseCoverLetterBlockedFailure } from "../src/lib/coverLetterFailure.ts";
import { buildCoverLetterPreflight, type CoverLetterDetailValues } from "../src/lib/coverLetterPreflight.ts";
import { tailoredCoverLetterData } from "../src/lib/coverLetterTailoring.ts";
import { resolveResumeApplicantName } from "../src/lib/downloads.ts";
import { polishFitFindings } from "../src/lib/fitAssessmentLifecycle.ts";
import { extractJobPosting } from "../src/lib/jobExtract.ts";
import { proposalValue, resumeFitGapRows, type ResumeProposalDecision } from "../src/lib/resumeProposalDecisionState.ts";
import { acceptedTerminologyWarnings, applyResumeSuggestions } from "../src/lib/resumeProposalApply.ts";
import { heldBackSuggestions, proposalSuggestions } from "../src/lib/resumeProposalSuggestions.ts";
import { adviceNotOnResume, defaultResumePolishScopeModes, resumePolishScopeFromModes } from "../src/lib/resumePolishScope.ts";
import { serializeResumeData } from "../src/lib/resumeText.ts";
import type { PersistedSettings } from "../src/lib/settings.ts";
import {
  COVER_ACCEPTED_CONCERNS_WARNING,
  RESUME_POLISH_RESULT_WARNING,
  RESUME_POLISH_SOURCE_WARNING,
  RESUME_SOURCE_WARNING
} from "../src/lib/sourceConcernNotices.ts";
import { seedStage } from "../src/lib/stageSettings.ts";
import { affirmativeTerm, jobTerminology, type TerminologySnapshot } from "../src/resume/terminology.ts";
import type { ResumeProposalSuggestion } from "../src/resume/types.ts";
import {
  candidateProfile,
  documentText,
  isToolResult,
  type DocumentKind,
  type ReadDocument,
  type RoleFitClient,
  type Tool,
  type ToolResult
} from "./client.ts";

// A provider run can take minutes (one CLI attempt may take four, and Fit retries).
const AI_TIMEOUT_MS = 15 * 60_000;
const CACHED_PROPOSALS = 20;
// Provider runs one agent may have open at once; each is billed or a CLI run.
const MAX_PROVIDER_RUNS = 3;
const RUNS_PROVIDER =
  " Runs the provider, model and effort saved for this stage in RoleFit Settings (an API call billed to the " +
  "user's key, or a CLI run) and can take minutes; cancelling the call stops the run, and at most " +
  MAX_PROVIDER_RUNS + " run at once. Saves nothing. Warnings " +
  "are RoleFit's evidence checks; output without warnings is still not verified.";

const fail = (error: string): ToolResult => ({ ok: false, value: { error } });

// RoleFit reads a resume as the candidate's own evidence.
const RESUME_IS_EVIDENCE =
  " RoleFit reads it as the candidate's own evidence: pass a saved resume or apply_resume_edits output, never " +
  "text you wrote, and pass resumeConcerns for wording with open warnings.";

const documentInput = (noun: string, extension: string, lister: string) => ({
  type: "object",
  description: `The ${noun}: a saved one by fileName (from ${lister}), or a complete .${extension} file as sourceText.` +
    (extension === "resume" ? RESUME_IS_EVIDENCE : ""),
  additionalProperties: false,
  properties: {
    fileName: { type: "string" },
    sourceText: { type: "string", description: `The complete .${extension} file text.` },
    label: { type: "string", maxLength: 200, description: "A name for sourceText, e.g. \"Tailored for Acme\"." }
  }
});

const resumeConcernsInput = {
  type: "array",
  items: { type: "string" },
  description:
    "The resumeConcerns apply_resume_edits returned for this resume (or any evidence concern on its wording). " +
    "RoleFit then tells the stage that wording is unverified, as the app does."
};

// An optional list of text, or a refusal naming the field.
function textList(value: unknown, name: string): string[] | ToolResult {
  if (value === undefined) return [];
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : fail(`${name}: must be a list of text`);
}

// The parsed resume itself, not its source: parsing assigns new element ids,
// and the suggestions target this parse's. `concerns` are the ones the polish
// was told about, which stay open whatever is accepted.
type ResumeProposal = {
  resume: ReturnType<typeof parseResumeFile>;
  suggestions: Map<string, ResumeProposalSuggestion>;
  terminology: TerminologySnapshot;
  concerns: string[];
};

export function createAiTools(client: RoleFitClient): Tool[] {
  const proposals = new Map<string, ResumeProposal>();

  type Stage = { fields: ReturnType<typeof buildStageRequestFields>; settings: PersistedSettings; candidateContext: string; customInstructions: string };

  // The stage's request fields and, for stages that read the Profile, the
  // candidate context; an over-limit Profile declines them, as in the app.
  async function stage(id: AiStageId, readsProfile = true): Promise<Stage | ToolResult> {
    const read = await client.readSettings();
    if (isToolResult(read)) return read;
    const { settings } = read;
    const profile = candidateProfile(settings);
    const profileError = readsProfile ? profileBackgroundLimitError(profile.profileBackground) : null;
    if (profileError) return fail(`Profile too long: ${profileError}`);
    const override = settings.stageCustomInstructions?.[id];
    return {
      fields: buildStageRequestFields(seedStage(id, settings)),
      settings,
      candidateContext: readsProfile ? buildCandidateContext(profile.profileBackground, profile.declaredFacts) : "",
      customInstructions: AI_STAGES.find((item) => item.id === id)?.supportsInstructions
        ? override?.trim() ? override : settings.customInstructions ?? ""
        : ""
    };
  }

  async function readDocument(kind: DocumentKind, input: unknown, name: string): Promise<ReadDocument | ToolResult> {
    if (!input || typeof input !== "object" || Array.isArray(input)) return fail(`${name}: give fileName or sourceText.`);
    const { fileName, sourceText, label } = input as Record<string, unknown>;
    if ((fileName === undefined) === (sourceText === undefined)) return fail(`${name}: give exactly one of fileName and sourceText.`);
    if (fileName !== undefined) {
      const read = await client.workspaceVariant(kind, fileName);
      return read.ok ? read.value as ReadDocument : read;
    }
    if (typeof sourceText !== "string" || !sourceText) return fail(`${name}.sourceText: required .${kind} text.`);
    const text = documentText(kind, sourceText, `${name}.sourceText`);
    if (!text.ok) return text;
    const named = typeof label === "string" && label.trim() ? label.trim() : `${kind}.${kind}`;
    return { fileName: named, label: named, text: text.value as string, sourceText };
  }

  let providerRuns = 0;
  async function post(path: string, body: unknown, signal?: AbortSignal): Promise<ToolResult> {
    if (providerRuns >= MAX_PROVIDER_RUNS) {
      return fail(`${MAX_PROVIDER_RUNS} RoleFit AI calls are already running; wait for one to finish or cancel it.`);
    }
    providerRuns += 1;
    try {
      return await client.request("POST", path, body, { timeoutMs: AI_TIMEOUT_MS, signal });
    } finally {
      providerRuns -= 1;
    }
  }

  function suggestionSummary(suggestion: ResumeProposalSuggestion, bulletText: Map<string, string>) {
    const order = (ids: string[] | undefined) => (ids ?? []).map((id) => bulletText.get(id) ?? "");
    return {
      id: suggestion.id,
      kind: suggestion.kind ?? "rewrite",
      section: suggestion.sectionHeading,
      ...(suggestion.kind === "reorder"
        ? { currentOrder: order(suggestion.originalOrder), proposedOrder: order(suggestion.proposedOrder) }
        : { currentText: suggestion.currentText, proposedText: suggestion.proposedText }),
      reason: suggestion.reason,
      ...(suggestion.evidence === "profile" ? { evidence: "profile", profileSource: suggestion.profileSource } : {}),
      ...(suggestion.profileEvidence ? { profileEvidence: suggestion.profileEvidence } : {}),
      ...(suggestion.warnings?.length ? { warnings: suggestion.warnings } : {})
    };
  }

  return [
    {
      name: "analyze_job",
      title: "Analyze job",
      description:
        "Turn a raw job posting into RoleFit's job brief, as Prepare does. `jobDescription` is the brief to " +
        "polish against and to save as the record's jobDescription; keep the posting as rawJobDescription. " +
        "`tracking` holds the facts it found (title, company, role, location, pay); `manualReviewFields` names " +
        "the ones it could not find. If the AI analysis fails, the brief comes from RoleFit's local extractor and " +
        "`aiError` says why." + RUNS_PROVIDER,
      inputSchema: {
        type: "object",
        required: ["text"],
        additionalProperties: false,
        properties: {
          text: { type: "string", description: "The full posting text." },
          url: { type: "string", description: "The posting's URL, when known." }
        }
      },
      async run({ text, url }, signal) {
        if (typeof text !== "string" || !text.trim()) return fail("text: required posting text");
        if (url !== undefined && typeof url !== "string") return fail("url: must be a string");
        const link = url || undefined;
        let extracted = extractJobPosting(text, { url: link });
        let source = "local";
        let aiError: string | undefined;
        if (text.trim().length >= 40) {
          const context = await stage("job-analysis", false);
          if (isToolResult(context)) return context;
          const analyzed = await post("/api/job-analysis", { text, url: link, ...context.fields }, signal);
          if (signal?.aborted) return analyzed;
          const fields = analyzed.value as Partial<AiJobAnalysisFields> & { source?: string; error?: string };
          if (analyzed.ok && fields.source === "ai") {
            const result = extractedFromAiOrLocal(fields, text, link, context.fields, extracted);
            extracted = result.extracted;
            source = result.source;
            if (result.failure) aiError = result.failure.detail;
          } else {
            aiError = fields.error ?? "The job analysis returned no usable result.";
          }
        }
        return {
          ok: true,
          value: {
            source,
            jobDescription: extracted.tailoringText,
            rawJobDescription: text,
            tracking: extracted.tracking,
            manualReviewFields: extracted.manualReviewFields,
            ...(aiError ? { aiError } : {})
          }
        };
      }
    },
    {
      name: "assess_fit",
      title: "Assess fit",
      description:
        "Run RoleFit's Fit Assessment of a resume and the Profile against a posting. `fitAssessment` is the " +
        "snapshot to send unchanged as application.fitAssessment in commit_application, or to polish_resume. " +
        "Its verdict is advisory; RoleFit never decides whether to apply." + RUNS_PROVIDER,
      inputSchema: {
        type: "object",
        required: ["jobText", "resume"],
        additionalProperties: false,
        properties: {
          jobText: { type: "string", description: "The raw posting text (rawJobDescription), not the brief." },
          resume: documentInput("resume", "resume", "list_resumes")
        }
      },
      async run({ jobText, resume }, signal) {
        if (typeof jobText !== "string" || !jobText.trim()) return fail("jobText: required posting text");
        const document = await readDocument("resume", resume, "resume");
        if (isToolResult(document)) return document;
        const context = await stage("fit-assessment");
        if (isToolResult(context)) return context;
        const assessed = await post("/api/job-analysis", {
          text: jobText,
          mode: "fit-assessment",
          resumeText: document.text,
          candidateContext: context.candidateContext,
          ...context.fields
        }, signal);
        if (!assessed.ok) return assessed;
        const body = assessed.value as Record<string, unknown>;
        const result = sanitizeFitAssessment(body.fitAssessment);
        if (!result) return fail(typeof body.fitAssessmentError === "string" && body.fitAssessmentError ? body.fitAssessmentError : "Fit Assessment returned no usable screening.");
        // What ran, falling back to what was asked for, as the app records it.
        const used = (key: "provider" | "model" | "reasoningEffort") =>
          typeof body[key] === "string" && (body[key] as string).trim() ? (body[key] as string).trim() : context.fields[key];
        return {
          ok: true,
          value: {
            fitAssessment: {
              result,
              resumeLabel: document.label ?? document.fileName,
              assessedAt: new Date().toISOString(),
              provider: used("provider"),
              model: used("model"),
              reasoningEffort: used("reasoningEffort"),
              ...(typeof body.attempts === "number" && Number.isFinite(body.attempts) ? { attempts: Math.max(1, Math.min(9, Math.round(body.attempts))) } : {}),
              promptVersion: FIT_ASSESSMENT_PROMPT_VERSION
            }
          }
        };
      }
    },
    {
      name: "polish_resume",
      title: "Polish resume",
      description:
        "Run RoleFit's Resume Polish: one grounded proposal of edits to the resume's bullets and skills for a job " +
        "brief, using the app's default section scope. Each suggestion has an id, its current and proposed text " +
        "(or bullet order), the reason, and any evidence warnings; `heldBack` lists edits the optional review " +
        "held back and `review` says whether that review ran; `fitGaps` says how the edits relate to each Fit gap. " +
        "Nothing changes until apply_resume_edits; pass it `proposalId` and the ids you accept. Proposals are " +
        "kept in this MCP session only, newest " + CACHED_PROPOSALS + "." + RUNS_PROVIDER,
      inputSchema: {
        type: "object",
        required: ["resume", "jobDescription"],
        additionalProperties: false,
        properties: {
          resume: documentInput("resume", "resume", "list_resumes"),
          jobDescription: { type: "string", description: "The job brief from analyze_job (or the record's jobDescription)." },
          fitAssessment: { type: "object", description: "A fitAssessment snapshot from assess_fit or a record, for the same posting." },
          resumeConcerns: resumeConcernsInput
        }
      },
      async run({ resume, jobDescription, fitAssessment, resumeConcerns }, signal) {
        if (typeof jobDescription !== "string" || jobDescription.trim().length < 40) return fail("jobDescription: the job brief is required (at least 40 characters).");
        const concerns = textList(resumeConcerns, "resumeConcerns");
        if (isToolResult(concerns)) return concerns;
        const document = await readDocument("resume", resume, "resume");
        if (isToolResult(document)) return document;
        let fitResult = null;
        if (fitAssessment !== undefined) {
          fitResult = sanitizeFitAssessment((fitAssessment as { result?: unknown } | null)?.result);
          if (!fitResult) return fail("fitAssessment: must be a snapshot from assess_fit or a saved record.");
        }
        const context = await stage("resume-polish");
        if (isToolResult(context)) return context;
        const parsed = parseResumeFile(document.sourceText);
        const { data } = parsed;
        const scope = resumePolishScopeFromModes(data, defaultResumePolishScopeModes(data));
        const targets = flattenResumeTargets(scope, context.candidateContext);
        if (!targets.length) return fail("This resume has no section RoleFit polishes by default.");
        // A snapshot cannot confirm which resume or Profile it assessed.
        const fitFindings = fitResult ? polishFitFindings(fitResult, true) : null;
        const polished = await post("/api/resume-polish", {
          ...context.fields,
          mode: "resume-proposal",
          resumeScope: scope,
          jobText: jobDescription,
          candidateContext: context.candidateContext,
          ...(fitFindings ? { fitFindings } : {}),
          sourceWarnings: concerns.length ? [RESUME_POLISH_SOURCE_WARNING] : undefined,
          customInstructions: context.customInstructions,
          boldBulletKeywords: context.settings.boldBulletKeywords ?? true,
          ...(context.settings.resumePolishReview ? { reviewEdits: true } : {})
        }, signal);
        if (!polished.ok) return polished;
        const wire = sanitizeResumePolishWireResult(polished.value);
        if (!wire || wire.omittedTargetCount > targets.length) return fail("Resume Polish returned an invalid outcome.");
        let suggestions;
        let heldBack;
        try {
          suggestions = proposalSuggestions(wire, scope, context.candidateContext);
          heldBack = heldBackSuggestions(wire, scope, context.candidateContext);
        } catch (error) {
          return fail(error instanceof Error ? error.message : "Resume Polish returned edits for targets it was not sent.");
        }
        if (wire.status === "PROPOSAL" && !suggestions.length) return fail("Resume Polish returned no usable proposal edits.");
        const proposalId = randomUUID();
        const terminology = jobTerminology(jobDescription);
        const supportedText = flattenResumeTargets(scope).map((target) => target.currentText).join("\n");
        proposals.set(proposalId, {
          resume: parsed,
          suggestions: new Map([...suggestions, ...heldBack.map((item) => item.suggestion)].map((suggestion) => [suggestion.id, suggestion])),
          terminology: { ...terminology, inputKey: proposalId, terms: terminology.terms.filter(({ keyword }) => affirmativeTerm(supportedText, keyword)) },
          concerns
        });
        for (const key of [...proposals.keys()].slice(0, Math.max(0, proposals.size - CACHED_PROPOSALS))) proposals.delete(key);
        const bulletText = new Map(data.sections.flatMap((section) => section.items.flatMap((entry) =>
          entry.bullets.map((bullet) => [bullet.id, stripInlineMarks(bullet.text)] as const))));
        const warnings = [...(wire.warnings ?? []), ...(concerns.length ? [RESUME_POLISH_RESULT_WARNING] : [])];
        const advice = adviceNotOnResume(wire.advice, data, context.candidateContext);
        // Every gap sent, read as the app reads it: an edit the review held back
        // addresses nothing until it is restored.
        const fitGaps = resumeFitGapRows({ fitFindings: fitFindings ?? undefined, fitGaps: wire.fitGaps }, suggestions, () => "pending")
          .map((row) => ({ gap: row.jobExcerpt, status: row.status, suggestionIds: row.suggestions.map((suggestion) => suggestion.id) }));
        return {
          ok: true,
          value: {
            proposalId,
            status: wire.status,
            ...(wire.summary.length ? { summary: wire.summary } : {}),
            ...(wire.withheld.count ? { withheld: wire.withheld } : {}),
            ...(wire.omittedTargetCount ? { omittedTargetCount: wire.omittedTargetCount } : {}),
            ...(wire.review ? { review: wire.review.outcome } : {}),
            suggestions: suggestions.map((suggestion) => suggestionSummary(suggestion, bulletText)),
            heldBack: heldBack.map((item) => ({ ...suggestionSummary(item.suggestion, bulletText), heldBackReason: item.reason, ...(item.note ? { note: item.note } : {}) })),
            ...(fitGaps.length ? { fitGaps } : {}),
            ...(advice?.length ? { advice } : {}),
            ...(warnings.length ? { warnings } : {})
          }
        };
      }
    },
    {
      name: "apply_resume_edits",
      title: "Apply resume edits",
      description:
        "Accept edits from a polish_resume proposal and get the resulting resume, applied exactly as the editor's " +
        "Accept does. `accept` lists suggestion ids (held-back ones included when you restore them); `edits` " +
        "replaces an accepted rewrite's or addition's proposed text with your own, which RoleFit has not checked. " +
        "Returns the new .resume source to save with commit_application or a first submission, its plain text, " +
        "each accepted edit's warnings, `resumeConcerns` (every open concern on the new resume: those the polish " +
        "was given plus the accepted edits' warnings; pass it to every later stage that uses this resume), and " +
        "`terminologyWarnings` for supported job terms the accepted edits dropped. Saves nothing.",
      inputSchema: {
        type: "object",
        required: ["proposalId", "accept"],
        additionalProperties: false,
        properties: {
          proposalId: { type: "string" },
          accept: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string" } },
          edits: { type: "object", additionalProperties: { type: "string" }, description: "Suggestion id to the text to use instead." }
        }
      },
      async run({ proposalId, accept, edits }) {
        const proposal = typeof proposalId === "string" ? proposals.get(proposalId) : undefined;
        if (!proposal) return fail("proposalId: unknown or expired; run polish_resume again.");
        if (!Array.isArray(accept) || !accept.length || accept.some((id) => typeof id !== "string")) return fail("accept: list the suggestion ids to accept.");
        const overrides = (edits ?? {}) as Record<string, unknown>;
        if (typeof overrides !== "object" || Array.isArray(overrides)) return fail("edits: must map suggestion ids to text.");
        const issues: string[] = [];
        const accepted: { suggestion: ResumeProposalSuggestion; value: string }[] = [];
        for (const id of new Set(accept as string[])) {
          const suggestion = proposal.suggestions.get(id);
          if (!suggestion) { issues.push(`accept: ${id} is not in this proposal`); continue; }
          const override = overrides[id];
          if (override !== undefined && (typeof override !== "string" || suggestion.kind === "reorder" || suggestion.kind === "remove")) {
            issues.push(`edits.${id}: only a rewrite or an addition takes replacement text`);
            continue;
          }
          const value = (override as string | undefined) ?? proposalValue(suggestion);
          if ((!suggestion.kind || suggestion.kind === "add") && !value.trim()) { issues.push(`edits.${id}: must not be empty`); continue; }
          accepted.push({ suggestion, value });
        }
        for (const id of Object.keys(overrides)) if (!(accept as string[]).includes(id)) issues.push(`edits.${id}: not in accept`);
        if (issues.length) return { ok: false, value: { error: "Nothing was applied.", issues } };
        const data = applyResumeSuggestions(proposal.resume.data, accepted);
        let sourceText: string;
        try {
          sourceText = serializeResumeFile(data, coerceDocStyle(proposal.resume.documentStyle));
        } catch (error) {
          return fail(`Nothing was applied: the edited resume is not a valid .resume (${error instanceof Error ? error.message : String(error)}).`);
        }
        const decisions: Record<string, ResumeProposalDecision> = Object.fromEntries(
          accepted.map(({ suggestion, value }) => [suggestion.id, { kind: "accepted", text: value }])
        );
        const terminologyWarnings = acceptedTerminologyWarnings(
          { terminology: proposal.terminology }, proposal.terminology.inputKey, [...proposal.suggestions.values()], decisions, data
        );
        const warnings = accepted.flatMap(({ suggestion, value }) => {
          const notes = [...(suggestion.warnings ?? []), ...(value !== proposalValue(suggestion) ? ["Your replacement text was not checked by RoleFit."] : [])];
          return notes.length ? [{ id: suggestion.id, warnings: notes }] : [];
        });
        // Concerns the polish was told about stay open whatever was accepted.
        const resumeConcerns = [...new Set([...proposal.concerns, ...warnings.flatMap((item) => item.warnings)])];
        return {
          ok: true,
          value: {
            applied: accepted.length,
            sourceText,
            text: serializeResumeData(data),
            ...(warnings.length ? { warnings } : {}),
            ...(resumeConcerns.length ? { resumeConcerns } : {}),
            ...(terminologyWarnings.length ? { terminologyWarnings } : {})
          }
        };
      }
    },
    {
      name: "polish_cover_letter",
      title: "Polish cover letter",
      description:
        "Run RoleFit's Cover letter Polish: one grounded whole-letter proposal from the current letter, the resume, " +
        "the Profile and a job brief. When RoleFit needs a detail first (role, company, or a private fact a " +
        "template placeholder asks for), it returns status needs-input with `missing` and `slots`; ask the user and " +
        "send their answers back as `details` and `slotAnswers` (RoleFit treats them as the candidate's evidence, so " +
        "never supply them yourself). On success `text` is the proposed letter and `sourceText` the .cover with it " +
        "applied (letterhead and formatting kept), to use or discard; if you use it, pass its `concerns` as " +
        "coverConcerns the next time you polish that letter." + RUNS_PROVIDER,
      inputSchema: {
        type: "object",
        required: ["coverLetter", "resume", "jobDescription"],
        additionalProperties: false,
        properties: {
          coverLetter: documentInput("current cover letter", "cover", "list_cover_letters"),
          resume: documentInput("resume the letter draws on", "resume", "list_resumes"),
          jobDescription: { type: "string", description: "The job brief from analyze_job (or the record's jobDescription)." },
          company: { type: "string" },
          role: { type: "string" },
          details: { type: "object", additionalProperties: { type: "string" }, description: "The user's values for `missing` keys (candidate_name, role, company)." },
          slotAnswers: { type: "object", additionalProperties: { type: "string" }, description: "Slot id to the private fact the user gave for it." },
          resumeConcerns: resumeConcernsInput,
          coverConcerns: { type: "array", items: { type: "string" }, description: "The `concerns` of an earlier polish_cover_letter result this letter came from." }
        }
      },
      async run({ coverLetter, resume, jobDescription, company, role, details, slotAnswers, resumeConcerns, coverConcerns }, signal) {
        if (typeof jobDescription !== "string" || jobDescription.trim().length < 40) return fail("jobDescription: the job brief is required (at least 40 characters).");
        for (const [name, value] of Object.entries({ company, role })) {
          if (value !== undefined && typeof value !== "string") return fail(`${name}: must be a string`);
        }
        for (const [name, value] of Object.entries({ details, slotAnswers })) {
          if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value) || Object.values(value).some((item) => typeof item !== "string"))) {
            return fail(`${name}: must map keys to text`);
          }
        }
        const resumeNotes = textList(resumeConcerns, "resumeConcerns");
        if (isToolResult(resumeNotes)) return resumeNotes;
        const letterNotes = textList(coverConcerns, "coverConcerns");
        if (isToolResult(letterNotes)) return letterNotes;
        const letter = await readDocument("cover", coverLetter, "coverLetter");
        if (isToolResult(letter)) return letter;
        const resumeDocument = await readDocument("resume", resume, "resume");
        if (isToolResult(resumeDocument)) return resumeDocument;
        const context = await stage("cover-polish");
        if (isToolResult(context)) return context;
        const current = parseCoverLetterFile(letter.sourceText);
        const resumeData = parseResumeFile(resumeDocument.sourceText).data;
        const answers = (slotAnswers ?? {}) as Record<string, string>;
        const values = (details ?? {}) as CoverLetterDetailValues;
        const preflight = buildCoverLetterPreflight({
          text: letter.text,
          candidateName: resolveResumeApplicantName(
            stripInlineMarks(current.data.header?.name ?? "").trim() ? current.data.header?.name : resumeData.header?.name,
            resumeDocument.text
          ),
          role: role as string | undefined,
          company: company as string | undefined,
          values,
          slotAnswers: answers
        });
        const slots = preflight.template.userInputSlots.map((slot) => ({ id: slot.id, prompt: slot.normalizedPrompt }));
        // An answer is evidence only for a fact this letter's template asks for, as in the app.
        const unasked = Object.keys(answers).filter((key) => !slots.some((slot) => slot.id === key));
        if (unasked.length) {
          return { ok: false, value: { error: "Nothing was sent.", issues: unasked.map((key) => `slotAnswers.${key}: not a slot this letter asks for`), slots } };
        }
        if (!preflight.canTailor) {
          return {
            ok: true,
            value: {
              status: "needs-input",
              blockers: preflight.blockers,
              missing: preflight.missingFields.map(({ key, label, reason }) => ({ key, label, reason })),
              slots
            }
          };
        }
        const evidenceItems = buildCoverLetterEvidence({
          resumeData,
          candidateContext: context.candidateContext,
          slotAnswers: answers,
          slotLabels: Object.fromEntries(slots.map((slot) => [slot.id, slot.prompt]))
        });
        if (!evidenceItems.some((item) => item.source === "resume")) return fail("resume: has no content the letter can draw on.");
        // Only evidence concerns about accepted wording carry forward.
        const sourceWarnings = sanitizeContentWarnings([
          ...(resumeNotes.length ? [RESUME_SOURCE_WARNING] : []),
          ...(letterNotes.length ? [COVER_ACCEPTED_CONCERNS_WARNING, ...letterNotes] : [])
        ]) ?? [];
        const polished = await post("/api/cover-polish", {
          ...context.fields,
          sourceCoverLetterText: letter.text.trim(),
          jobText: jobDescription,
          customInstructions: context.customInstructions,
          sourceWarnings,
          detailValues: values,
          resolvedContext: preflight.resolved,
          evidenceItems,
          slotAnswers: answers
        }, signal);
        if (!polished.ok) {
          const blocked = parseCoverLetterBlockedFailure(polished.value);
          return blocked
            ? { ok: false, value: { error: "Cover letter Polish was blocked; the letter is unchanged.", issues: blocked.issues } }
            : polished;
        }
        const result = polished.value as Record<string, unknown>;
        if (result.status !== "ready" || typeof result.coverLetterText !== "string" || !result.coverLetterText.trim()
          || !Array.isArray(result.bodyParagraphs) || !Array.isArray(result.evidenceUsed)) {
          return fail("Cover letter Polish returned no usable letter.");
        }
        const warnings = sanitizeContentWarnings(result.warnings) ?? [];
        const concerns = sanitizeContentWarnings(result.concerns ?? []) ?? [];
        const proposed = tailoredCoverLetterData(current.data, result.coverLetterText);
        return {
          ok: true,
          value: {
            status: "ready",
            text: result.coverLetterText,
            sourceText: serializeCoverLetterFile(proposed, current.style),
            ...(warnings.length ? { warnings } : {}),
            ...(concerns.length ? { concerns } : {}),
            ...(preflight.warnings.length ? { notes: preflight.warnings } : {}),
            evidenceUsed: result.evidenceUsed
          }
        };
      }
    },
    {
      name: "draft_answer",
      title: "Draft answer",
      description:
        "Draft an answer to one application question with RoleFit's answer stage, for a saved tracker record " +
        "(commit a Draft first). It reads the record's job brief and posting, and its saved resume unless you pass " +
        "`resume`. The result is an answer revision to save unchanged with add_application_answers. If it asks " +
        "for a clarification, ask the user and call again with their reply as `clarification`; to revise a draft, " +
        "send it as previousAnswer with a `refinement`. RoleFit treats `clarification` and `explicitFacts` as the " +
        "candidate's evidence, so they must come from the user." + RUNS_PROVIDER,
      inputSchema: {
        type: "object",
        required: ["id", "question"],
        additionalProperties: false,
        properties: {
          id: { type: "string", description: "The record id from search_applications." },
          question: { type: "string", description: "The employer's question, exactly as written." },
          questionId: { type: "string", description: "Keep the same id when redrafting the same question." },
          questionRevision: { type: "integer", minimum: 1, description: "Raise it when the question text changed." },
          resume: documentInput("resume to answer from", "resume", "list_resumes"),
          resumeConcerns: resumeConcernsInput,
          previousAnswer: {
            type: "object",
            required: ["id", "text"],
            additionalProperties: false,
            properties: { id: { type: "string" }, text: { type: "string" } }
          },
          refinement: { type: "string", description: "How to change previousAnswer; it is never evidence." },
          clarification: { type: "string", description: "The user's reply to the clarification asked for." },
          explicitFacts: { type: "array", items: { type: "string" }, description: "Facts the user stated for this answer." }
        }
      },
      async run({ id, question, questionId, questionRevision, resume, resumeConcerns, previousAnswer, refinement, clarification, explicitFacts }, signal) {
        if (typeof question !== "string" || !question.trim()) return fail("question: required text");
        const concerns = textList(resumeConcerns, "resumeConcerns");
        if (isToolResult(concerns)) return concerns;
        const record = await client.getApplication(id);
        if (isToolResult(record)) return record;
        if (!record.jobDescription?.trim()) return fail("This record has no job brief (jobDescription) to answer against.");
        let resumeText: string;
        if (resume !== undefined) {
          const document = await readDocument("resume", resume, "resume");
          if (isToolResult(document)) return document;
          resumeText = document.text;
        } else {
          const saved = await client.applicationDocument(record.id, "resume", record.resumeArtifacts);
          if (saved && !saved.ok) return saved;
          const text = (saved?.value as { text?: string } | undefined)?.text;
          if (!text) return fail("This record has no saved .resume source; pass `resume`.");
          resumeText = text;
        }
        const context = await stage("application-answers");
        if (isToolResult(context)) return context;
        const turn = {
          applicationId: record.id,
          question: {
            id: typeof questionId === "string" && questionId ? questionId : `q-${randomUUID()}`,
            revision: Number.isSafeInteger(questionRevision) ? questionRevision as number : 1,
            text: question
          },
          answerRevisionId: randomUUID()
        };
        const drafted = await post("/api/application-answers", {
          ...context.fields,
          mode: "conversation",
          ...turn,
          previousAnswer,
          refinement,
          clarification,
          explicitFacts,
          resumeText,
          jobText: record.jobDescription,
          rawJobText: record.rawJobDescription ?? "",
          candidateContext: context.candidateContext,
          customInstructions: context.customInstructions,
          sourceWarnings: concerns.length ? [RESUME_SOURCE_WARNING] : undefined
        }, signal);
        if (!drafted.ok) return drafted;
        const answer = parseApplicationAnswerRevision((drafted.value as { answer?: unknown }).answer);
        // Saved facts come only from the user, so a generated revision may never carry them.
        if (!answer || !answer.generation || !answer.sources || answer.userFacts !== undefined
          || answer.id !== turn.answerRevisionId || answer.applicationId !== record.id || answer.questionId !== turn.question.id
          || answer.questionRevision !== turn.question.revision || answer.question !== turn.question.text) {
          return fail("The answer did not match this question. Draft it again.");
        }
        return { ok: true, value: { answer } };
      }
    },
    {
      name: "review_application",
      title: "Review application",
      description:
        "Run RoleFit's Final application review over a saved record's resume and cover letter against its " +
        "posting, checking claims against the original resume (`baseResume`) and the Profile. It reviews only " +
        "documents saved with editable source and never application answers; it changes and submits nothing. " +
        "When the review cannot run (the provider failed, or the Profile or evidence is over its limit), the result is " +
        "an error that still carries RoleFit's local checks." + RUNS_PROVIDER,
      inputSchema: {
        type: "object",
        required: ["id"],
        additionalProperties: false,
        properties: {
          id: { type: "string", description: "The record id from search_applications." },
          baseResume: { type: "string", description: "fileName of the saved resume the tailored one came from (list_resumes); without it, claims are checked against the Profile only." }
        }
      },
      async run({ id, baseResume }, signal) {
        const record = await client.getApplication(id);
        if (isToolResult(record)) return record;
        const resume = await client.applicationDocument(record.id, "resume", record.resumeArtifacts);
        if (resume && !resume.ok) return resume;
        const cover = await client.applicationDocument(record.id, "cover", record.coverLetterArtifacts);
        if (cover && !cover.ok) return cover;
        const resumeText = (resume?.value as { text?: string } | undefined)?.text ?? "";
        const coverLetterText = (cover?.value as { text?: string } | undefined)?.text ?? "";
        if (!resumeText && !coverLetterText) return fail("This record has no resume or cover letter saved as editable source to review.");
        let originalResumeText = "";
        if (baseResume !== undefined) {
          const base = await client.workspaceVariant("resume", baseResume);
          if (!base.ok) return base;
          originalResumeText = (base.value as { text: string }).text;
        }
        // The Profile limit is checked here, not by stage(), so a decline still
        // carries RoleFit's local checks, as in the app.
        const context = await stage("application-review", false);
        if (isToolResult(context)) return context;
        const profile = candidateProfile(context.settings);
        const input = buildApplicationReviewInput({
          jobText: record.rawJobDescription?.trim() || record.jobDescription || "",
          company: record.company ?? "",
          role: record.role || record.title || "",
          includeResume: Boolean(resumeText),
          includeCoverLetter: Boolean(coverLetterText),
          resumeText,
          coverLetterText,
          originalResumeText,
          candidateContext: buildCandidateContext(profile.profileBackground, profile.declaredFacts)
        });
        const profileError = profileBackgroundLimitError(profile.profileBackground);
        const declined = profileError ? `Profile too long: ${profileError}` : applicationReviewEvidenceLimitError(input.evidence);
        if (declined) return { ok: false, value: { ...localApplicationReview(input), error: declined, complete: false } };
        const reviewed = await post("/api/application-review", { ...input, ...context.fields }, signal);
        if (!reviewed.ok) return reviewed;
        const result = sanitizeApplicationReviewResult(reviewed.value, input);
        if (!result) return fail("The final review returned an invalid result.");
        return { ok: !result.error, value: result };
      }
    }
  ];
}
