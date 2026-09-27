import { evidenceSegments, evidencePolarity } from "../../shared/evidencePolarity.ts";
export { evidenceSegments, evidencePolarity } from "../../shared/evidencePolarity.ts";
import {
  findUngroundedCuratedClaimTerm,
  curatedClaimTerms,
  findUngroundedOutcomeClaim,
  hasUnsupportedOwnershipIncrease,
  isTermGrounded
} from "./grounding.ts";
import { findUngroundedNumericClaim } from "./sanitize.ts";

// Advice may mention absent facts without asserting them. Only explicit candidate
// prose here is checked as a factual claim; ordinary editorial instructions are not.
export function explicitAdviceClaims(advice: string): string[] {
  return evidenceSegments(advice).filter((sentence) => /^\s*["“']?(?:I|my|we|our)\b/i.test(sentence));
}

export function affirmativeEvidenceForTerm(term: string, evidence: string): boolean {
  const mentions = evidenceSegments(evidence).filter((segment) => isTermGrounded(term, segment));
  return (
    mentions.some((segment) => evidencePolarity(segment) === "affirmative") &&
    !mentions.some((segment) => evidencePolarity(segment) === "denied")
  );
}

export function affirmativeEvidence(evidence: string): string {
  return evidenceSegments(evidence)
    .filter((segment) => evidencePolarity(segment) === "affirmative")
    .join("\n");
}

export function hasContradictoryClaimEvidence(claim: string, evidence: string): boolean {
  const sources = evidenceSegments(evidence);
  return curatedClaimTerms(affirmativeEvidence(claim)).some((term) =>
    sources.some((source) => evidencePolarity(source) === "affirmative" && isTermGrounded(term, source)) &&
    sources.some((source) => evidencePolarity(source) === "denied" && isTermGrounded(term, source))
  );
}

export function candidateClaimIssue(
  claim: string,
  evidence: string,
  original = "",
  ownershipEvidence = evidence
): string | null {
  if (hasContradictoryClaimEvidence(claim, evidence)) return "Conflicting candidate evidence";
  const affirmative = affirmativeEvidence(evidence);
  const term = findUngroundedCuratedClaimTerm(claim, affirmative);
  if (term) return `Unsupported technology or skill: ${term}`;
  const number = findUngroundedNumericClaim(claim, affirmative);
  if (number) return `Unsupported measurement or duration: ${number}`;
  if (hasUnsupportedOwnershipIncrease(claim, original, affirmativeEvidence(ownershipEvidence)))
    return "Unsupported ownership or responsibility";
  const outcome = findUngroundedOutcomeClaim(claim, affirmative, { candidateProse: true });
  return outcome ? `Unsupported outcome: ${outcome}` : null;
}
