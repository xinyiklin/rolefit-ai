import { evidencePolarity, evidenceSegments } from "./claimEvidence.ts";

export function isAffirmativeFitEvidence(evidence: string, corpus = evidence): boolean {
  return evidencePolarity(evidence) === "affirmative" && !evidenceSegments(corpus).some(
    (part) => part.includes(evidence) && evidencePolarity(part) !== "affirmative"
  );
}

// These checks catch explicit conflicts, not semantic equivalence or overall fit.
export function hasFitEvidenceConflict(requirement: string, evidence: string, corpus = evidence): boolean {
  if (!isAffirmativeFitEvidence(evidence, corpus)) return true;
  const personalSourceExcluded = /\b(?:personal|academic|volunteer|coursework)\b[^.;:\n]{0,60}\b(?:not|excluded|insufficient)\b|\b(?:excluding|not)\s+(?:personal|academic|volunteer|coursework)\b/i.test(requirement);
  if (/\b(?:professional|paid|industry|commercial)\b/i.test(requirement) &&
    (!/\b(?:personal|academic|volunteer|coursework)\b/i.test(requirement) || personalSourceExcluded) &&
    /\b(?:personal|academic|volunteer|coursework)\b/i.test(evidence) &&
    !/\b(?:professional|paid|industry|commercial|employment|employed)\b/i.test(evidence)) return true;
  return false;
}

export function explicitEligibilityConflict(job: string, candidate: string): boolean {
  if (/\b(?:unless|except|if|provided|depending|case.by.case)\b/i.test(job)) return false;
  if (/\b(?:no|not|without)\b.*\bsponsor/i.test(job) &&
    /\b(?:need|require)\b.*\bsponsor/i.test(candidate) && !/\b(?:not|never)\b/i.test(candidate)) return true;
  if (/\b(?:must|required)\b.*\bclearance/i.test(job) &&
    /\b(?:no|not|lack)\b.*\bclearance/i.test(candidate)) return true;
  return /\b(?:must|required)\b.*\bauthori[sz]ed/i.test(job) && /\bnot\b.*\bauthori[sz]ed/i.test(candidate);
}
