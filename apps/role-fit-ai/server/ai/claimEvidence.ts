import {
  findUngroundedCuratedClaimTerm,
  curatedClaimTerms,
  findUngroundedOutcomeClaim,
  hasUnsupportedOwnershipIncrease,
  isTermGrounded
} from "./grounding.ts";
import { findUngroundedNumericClaim } from "./sanitize.ts";

export function evidenceSegments(value: string): string[] {
  return [...new Intl.Segmenter("en", { granularity: "sentence" }).segment(value)]
    .flatMap(({ segment }) =>
      segment.split(/[\r\n;]+|\s+but\s+|,\s*(?=not\b|never\b)|\s+and\s+(?=not\b|never\b)/i)
    )
    .map((text) => text.trim())
    .filter(Boolean);
}

// Advice may mention absent facts without asserting them. Only explicit candidate
// prose here is checked as a factual claim; ordinary editorial instructions are not.
export function explicitAdviceClaims(advice: string): string[] {
  return evidenceSegments(advice).filter((sentence) => /^\s*["“']?(?:I|my|we|our)\b/i.test(sentence));
}

export function evidencePolarity(segment: string): "affirmative" | "denied" | "aspirational" {
  const text = segment.replace(/\bnot only\b/gi, "");
  if (
    /\b(?:no (?:[\w+-]+\s+){0,4}experience|without experience|(?:never|not) (?:used|use|worked|built|developed|learned|experienced|familiar|proficient|skilled)|(?:have|has)(?:\s+not|n't) (?:used|worked|built|developed)|(?:do|did)(?:\s+not|n't) (?:use|work|build|develop)|lack(?:s|ing)? (?:experience|knowledge|skills?)|unfamiliar with)\b/i.test(
      text
    ) ||
    /^(?:no|not|never)\b/i.test(text.trim())
  )
    return "denied";
  if (
    /\b(?:interested in|want to|hope to|plan to|would like to|(?:am|is|are|currently|started|still) learning|^learning|would (?:use|build|work|learn)|could (?:use|build|work|learn)|learning goals?|aspir(?:e|ing)|intend to)\b/i.test(
      text
    )
  )
    return "aspirational";
  return "affirmative";
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
