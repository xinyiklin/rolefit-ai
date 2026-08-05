import type { ResolvedCoverLetterContext } from "../../src/lib/coverLetterPreflight.ts";
import { findUngroundedJdTerm, findUngroundedOutcomeClaim } from "./grounding.ts";
import { findUngroundedNumericClaim } from "./sanitize.ts";
import type { CoverLetterValidationIssue } from "./coverLetterIssues.ts";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function claimSurfaceValue(claim: string, normalizedValue: string): string {
  return claim.match(new RegExp(escapeRegex(normalizedValue), "i"))?.[0] ?? normalizedValue;
}

// Employer/job statements may use posting facts, but they must never widen the
// candidate corpus. Mixed employer/candidate sentences stay in every gate.
function candidateClaimSentences(
  text: string,
  resolved: ResolvedCoverLetterContext
): string[] {
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
  return [...new Intl.Segmenter("en", { granularity: "sentence" }).segment(text)]
    .flatMap(({ segment }) => segment.split(/[\r\n]+/))
    .map((sentence) => sentence.trim())
    .filter(
      (sentence) =>
        sentence && (!employerSubject.test(sentence) || candidateReference.test(sentence))
    );
}

export function coverLetterGroundingIssues({
  coverLetterText,
  jobText,
  grounding,
  resolved
}: {
  coverLetterText: string;
  jobText: string;
  grounding: string;
  resolved: ResolvedCoverLetterContext;
}): CoverLetterValidationIssue[] {
  const sentences = candidateClaimSentences(coverLetterText, resolved);
  const claims = sentences.join(" ");
  const jobLower = jobText.toLowerCase();
  const groundingLower = grounding.toLowerCase();
  const issues: CoverLetterValidationIssue[] = [];
  const ungroundedTerm = findUngroundedJdTerm(
    claims,
    jobLower,
    groundingLower,
    { proseMode: true }
  );
  if (ungroundedTerm) {
    const sentenceIndex = sentences.findIndex(
      (sentence) =>
        findUngroundedJdTerm(sentence, jobLower, groundingLower, { proseMode: true }) ===
        ungroundedTerm
    );
    const claim = sentenceIndex >= 0 ? sentences[sentenceIndex] : claims;
    const displayTerm = claimSurfaceValue(claim, ungroundedTerm);
    issues.push({
      code: "unsupported_job_term",
      category: "evidence",
      claim,
      unsupportedValue: displayTerm,
      detail: `${displayTerm} is not present in the resume or personal context.`,
      recovery: "add_evidence",
      repairMessage:
        `The letter claims "${ungroundedTerm}" for the candidate, but no supplied evidence supports it. Remove the claim or ground it in real evidence.`,
      ...(sentenceIndex >= 0 ? { sentenceIndex } : {})
    });
  }
  const ungroundedNumber = findUngroundedNumericClaim(claims, grounding);
  if (ungroundedNumber) {
    const sentenceIndex = sentences.findIndex(
      (sentence) => findUngroundedNumericClaim(sentence, grounding) === ungroundedNumber
    );
    issues.push({
      code: "unsupported_number",
      category: "evidence",
      claim: sentenceIndex >= 0 ? sentences[sentenceIndex] : claims,
      unsupportedValue: ungroundedNumber,
      detail: `${ungroundedNumber} is not present in the resume or personal context.`,
      recovery: "add_evidence",
      repairMessage:
        "The letter states a number, scale, or duration that no supplied evidence contains. Remove it or use a figure the evidence states.",
      ...(sentenceIndex >= 0 ? { sentenceIndex } : {})
    });
  }
  const outcome = findUngroundedOutcomeClaim(claims, grounding, { candidateProse: true });
  if (outcome) {
    const sentenceIndex = sentences.findIndex(
      (sentence) =>
        findUngroundedOutcomeClaim(sentence, grounding, { candidateProse: true }) === outcome
    );
    issues.push({
      code: "unsupported_outcome",
      category: "evidence",
      claim: sentenceIndex >= 0 ? sentences[sentenceIndex] : claims,
      unsupportedValue: outcome,
      detail: `The claimed ${outcome} outcome is not supported by the resume or personal context.`,
      recovery: "add_evidence",
      repairMessage:
        `The letter claims an outcome no evidence supports: "${outcome}". Describe only what the evidence records.`,
      ...(sentenceIndex >= 0 ? { sentenceIndex } : {})
    });
  }
  return issues;
}
