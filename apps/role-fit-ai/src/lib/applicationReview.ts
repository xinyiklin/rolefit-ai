import { stripInlineMarks } from "@typeset/engine/lib/inlineMarksText.ts";
import { parseResumeData } from "./resumeText.ts";
import { buildCoverLetterEvidence } from "./coverLetterEvidence.ts";
import type {
  ApplicationReviewInput,
  ApplicationReviewFinding
} from "../../shared/applicationReviewContract.ts";

const plain = (value: string) => stripInlineMarks(value).replace(/\r\n?/g, "\n").trim();

export function buildApplicationReviewInput({
  jobText,
  company,
  role,
  includeResume,
  includeCoverLetter,
  resumeText,
  coverLetterText,
  originalResumeText,
  candidateContext
}: Omit<ApplicationReviewInput, "evidence"> & {
  originalResumeText: string;
  candidateContext: string;
}): ApplicationReviewInput {
  const evidence = buildCoverLetterEvidence({
    resumeData: originalResumeText.trim() ? parseResumeData(originalResumeText) : null,
    honestContext: candidateContext
  }).map((item) => ({
    id: item.id,
    kind: item.source === "resume" ? ("resume" as const) : ("context" as const),
    label:
      item.source === "resume"
        ? `Loaded resume evidence${includeResume ? "" : " (excluded from submission)"}`
        : "About you",
    text: plain([item.section, item.entry, item.text].filter(Boolean).join("\n"))
  }));
  return {
    jobText: plain(jobText),
    company: plain(company),
    role: plain(role),
    includeResume,
    includeCoverLetter,
    resumeText: includeResume ? plain(resumeText) : "",
    coverLetterText: includeCoverLetter ? plain(coverLetterText) : "",
    evidence
  };
}

export function applicationReviewDependencies(
  input: ApplicationReviewInput,
  settings: unknown
): Record<ApplicationReviewFinding["dependencies"][number], string> {
  return {
    job: JSON.stringify([input.jobText, input.company, input.role]),
    resume: JSON.stringify([input.includeResume, input.resumeText]),
    coverLetter: JSON.stringify([input.includeCoverLetter, input.coverLetterText]),
    evidence: JSON.stringify(input.evidence),
    settings: JSON.stringify(settings)
  };
}

export function reviewRequestIsCurrent(
  generation: number,
  currentGeneration: number,
  identity: string,
  currentIdentity: string,
  signal: AbortSignal
): boolean {
  return !signal.aborted && generation === currentGeneration && identity === currentIdentity;
}
