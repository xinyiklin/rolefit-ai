import { applicationDocumentConflicts } from "./applicationReviewConflicts.ts";
import { analyzeCoverLetterTemplate } from "../src/lib/coverLetterTemplate.ts";
export const APPLICATION_REVIEW_CODES = [
  "completeness",
  "placeholder",
  "target",
  "unsupported_claim",
  "attribution",
  "coverage",
  "revision",
  "uncertain",
] as const;
export type ApplicationReviewDocument =
  "resume" | "coverLetter" | "application";
export type ApplicationReviewEvidence = {
  id: string;
  kind: "resume" | "context";
  label: string;
  text: string;
};
const MAX_REVIEW_EVIDENCE_ITEMS = 400;
const MAX_REVIEW_EVIDENCE_TEXT = 60_000;
const MAX_REVIEW_EVIDENCE_TOTAL = 120_000;

export function applicationReviewEvidenceLimitError(
  evidence: ApplicationReviewEvidence[],
): string | null {
  if (evidence.length > MAX_REVIEW_EVIDENCE_ITEMS)
    return `Final review supports up to ${MAX_REVIEW_EVIDENCE_ITEMS} evidence items. Shorten the resume or personal notes before retrying.`;
  if (
    evidence.some((item) => item.text.length > MAX_REVIEW_EVIDENCE_TEXT) ||
    evidence.reduce((total, item) => total + item.text.length, 0) >
      MAX_REVIEW_EVIDENCE_TOTAL
  )
    return "Final review evidence is too large. Shorten the resume or personal notes before retrying.";
  return null;
}

export type ApplicationReviewInput = {
  jobText: string;
  company: string;
  role: string;
  includeResume: boolean;
  includeCoverLetter: boolean;
  resumeText: string;
  coverLetterText: string;
  evidence: ApplicationReviewEvidence[];
};
export type ApplicationReviewFinding = {
  code: (typeof APPLICATION_REVIEW_CODES)[number];
  document: ApplicationReviewDocument;
  anchor: string;
  message: string;
  recovery: string;
  evidenceId?: string;
  sourceExcerpt?: string;
  dependencies: Array<
    "job" | "resume" | "coverLetter" | "evidence" | "settings"
  >;
};
export type ApplicationReviewResult = {
  findings: ApplicationReviewFinding[];
  complete: boolean;
  overflow: boolean;
  reviewedDocuments: Array<"resume" | "coverLetter">;
  completedAt: string;
  error?: string;
};

export function localApplicationReview(
  input: ApplicationReviewInput,
): ApplicationReviewResult {
  const findings: ApplicationReviewFinding[] = [];
  const add = (
    document: ApplicationReviewDocument,
    code: ApplicationReviewFinding["code"],
    anchor: string,
    message: string,
    recovery: string,
  ) =>
    findings.push({
      code,
      document,
      anchor,
      message,
      recovery,
      dependencies:
        code === "target"
          ? ["job", "coverLetter"]
          : document === "application"
            ? ["job", "evidence"]
            : [document],
    });
  const reviewedDocuments: Array<"resume" | "coverLetter"> = [];
  for (const [document, included, text] of [
    ["resume", input.includeResume, input.resumeText],
    ["coverLetter", input.includeCoverLetter, input.coverLetterText],
  ] as const) {
    if (!included) continue;
    if (!text.trim()) {
      add(
        document,
        "completeness",
        "",
        "This included document is empty.",
        "Add content or exclude this document.",
      );
      continue;
    }
    reviewedDocuments.push(document);
    const template = analyzeCoverLetterTemplate({ text });
    const tokens = [
      ...template.slots.map((slot) => slot.raw),
      ...template.structuredTemplate.flatMap((paragraph) =>
        paragraph.segments.flatMap((segment) =>
          segment.kind === "prose"
            ? [...segment.text.matchAll(/\b(?:TODO|TBD)\b/g)].map(
                (match) => match[0],
              )
            : [],
        ),
      ),
    ];
    for (const token of tokens) {
      add(
        document,
        "placeholder",
        token,
        "An unfinished placeholder remains.",
        "Replace it with supported finished text or remove it.",
      );
    }
    if (document === "coverLetter") {
      const target = text.match(
        /I am applying for the (.+?) role at ([^.\n]+)\./i,
      );
      if (
        target &&
        input.company &&
        input.role &&
        (target[1].toLowerCase() !== input.role.toLowerCase() ||
          !input.company.toLowerCase().startsWith(target[2].toLowerCase()))
      ) {
        add(
          document,
          "target",
          target[0],
          "The letter names a different application target.",
          "Confirm the company and role against the current posting.",
        );
      }
    }
  }
  if (!input.includeResume && !input.includeCoverLetter)
    add(
      "application",
      "completeness",
      "",
      "No materials included.",
      "Include a resume or cover letter to review.",
    );
  if (!input.jobText.trim() || !input.company.trim() || !input.role.trim())
    add(
      "application",
      "completeness",
      "",
      "The job target is incomplete.",
      "Confirm the posting, company, and role.",
    );
  if (!input.evidence.length && reviewedDocuments.length)
    add(
      "application",
      "uncertain",
      "",
      "Original candidate evidence is unavailable.",
      "Check factual claims against your own records; this review cannot establish their support.",
    );
  findings.push(...applicationDocumentConflicts(input));
  const overflow = findings.length > 12;
  return {
    findings: findings.slice(0, 12),
    complete: false,
    overflow,
    reviewedDocuments,
    completedAt: new Date().toISOString(),
  };
}

function reviewedApplicationDocuments(
  input: ApplicationReviewInput,
): Array<"resume" | "coverLetter"> {
  return [
    ...(input.includeResume && input.resumeText.trim()
      ? ["resume" as const]
      : []),
    ...(input.includeCoverLetter && input.coverLetterText.trim()
      ? ["coverLetter" as const]
      : []),
  ];
}

export function mergeApplicationReviewFindings(
  local: ApplicationReviewFinding[],
  incoming: ApplicationReviewFinding[],
): ApplicationReviewFinding[] {
  const key = (finding: ApplicationReviewFinding) =>
    JSON.stringify([
      finding.code,
      finding.document,
      finding.code === "placeholder"
        ? finding.anchor.replace(/^[\[<{]+|[\]}>]+$/g, "").trim()
        : finding.anchor,
    ]);
  const seen = new Set(local.map(key));
  const findings = [...local];
  for (const finding of incoming) {
    const identity = key(finding);
    if (seen.has(identity)) continue;
    seen.add(identity);
    findings.push(finding);
  }
  return findings;
}

export function sanitizeApplicationReviewFinding(
  raw: unknown,
  input: ApplicationReviewInput,
  actual = reviewedApplicationDocuments(input),
): ApplicationReviewFinding | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const finding = raw as ApplicationReviewFinding;
  if (
    !APPLICATION_REVIEW_CODES.includes(finding.code) ||
    !["resume", "coverLetter", "application"].includes(finding.document) ||
    typeof finding.anchor !== "string" ||
    finding.anchor.length > 1000 ||
    typeof finding.message !== "string" ||
    !finding.message ||
    finding.message.length > 400 ||
    typeof finding.recovery !== "string" ||
    !finding.recovery ||
    finding.recovery.length > 400 ||
    !Array.isArray(finding.dependencies) ||
    !finding.dependencies.length ||
    finding.dependencies.some(
      (dependency) =>
        !["job", "resume", "coverLetter", "evidence", "settings"].includes(
          dependency,
        ),
    )
  )
    return null;
  const doc =
    finding.document === "resume"
      ? input.resumeText
      : finding.document === "coverLetter"
        ? input.coverLetterText
        : "";
  if (
    finding.document !== "application" &&
    !actual.includes(finding.document) &&
    finding.code !== "completeness"
  )
    return null;
  if (finding.anchor && !doc.includes(finding.anchor)) return null;
  if (finding.sourceExcerpt !== undefined) {
    const source =
      finding.evidenceId === "current_resume" &&
      ["attribution", "uncertain"].includes(finding.code)
        ? input.resumeText
        : finding.evidenceId === "current_cover_letter" &&
            ["attribution", "uncertain"].includes(finding.code)
          ? input.coverLetterText
          : finding.evidenceId === "job_posting"
            ? input.jobText
            : input.evidence.find((item) => item.id === finding.evidenceId)
                ?.text;
    if (
      typeof finding.sourceExcerpt !== "string" ||
      !finding.sourceExcerpt ||
      finding.sourceExcerpt.length > 1000 ||
      !source?.includes(finding.sourceExcerpt)
    )
      return null;
  }
  return finding;
}

export function sanitizeApplicationReviewResult(
  raw: unknown,
  input: ApplicationReviewInput,
): ApplicationReviewResult | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as ApplicationReviewResult;
  if (
    !Array.isArray(value.findings) ||
    value.findings.length > 12 ||
    typeof value.complete !== "boolean" ||
    typeof value.overflow !== "boolean" ||
    typeof value.completedAt !== "string" ||
    !Number.isFinite(Date.parse(value.completedAt)) ||
    !Array.isArray(value.reviewedDocuments)
  )
    return null;
  const actual = reviewedApplicationDocuments(input);
  if (
    value.reviewedDocuments.length !== actual.length ||
    value.reviewedDocuments.some((doc) => !actual.includes(doc))
  )
    return null;
  if (
    value.findings.some(
      (finding) => !sanitizeApplicationReviewFinding(finding, input, actual),
    )
  )
    return null;
  return {
    findings: value.findings,
    complete: value.complete && !value.overflow,
    overflow: value.overflow,
    reviewedDocuments: actual,
    completedAt: value.completedAt,
    ...(typeof value.error === "string" && value.error.length <= 400
      ? { error: value.error }
      : {}),
  };
}
