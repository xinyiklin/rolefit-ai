import type { ResolvedCoverLetterContext } from "../../src/lib/coverLetterPreflight.ts";
import { evidencePolarity, evidenceSegments } from "../../shared/evidencePolarity.ts";
import { curatedClaimTerms, findUngroundedJdTerm, findUngroundedCuratedClaimTerm, findUngroundedOutcomeClaim } from "./grounding.ts";
import { findUngroundedNumericClaim, numericClaims } from "./sanitize.ts";
import type { CoverLetterValidationIssue } from "./coverLetterIssues.ts";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function claimSurfaceValue(claim: string, normalizedValue: string): string {
  return claim.match(new RegExp(escapeRegex(normalizedValue), "i"))?.[0] ?? normalizedValue;
}

// Employer-led prose is excluded only when its predicate is demonstrably a
// company or posting fact. Unknown or evaluative phrasing stays in the
// candidate claim surface so a paraphrase cannot bypass grounding by avoiding
// a finite list of comparison words.
const DIRECT_EMPLOYER_FACT =
  /^(?:used|built|ran|operated|developed|maintained|offered|provided|served|sought|needed|required|valued|prioritized|included|had\b|uses?|builds?|runs?|operates?|develops?|maintains?|offers?|provides?|serves?|seeks?|needs?|requires?|values?|prioritizes?|includes?|has\b|focus(?:es)? on|works? on|(?:is|are) (?:hiring|looking for|seeking|building|developing|operating|focused on|based (?:in|on)|located in|remote|hybrid|onsite|part of|responsible for))\b/i;
const POSSESSIVE_EMPLOYER_FACT =
  /^(?![^.!?]*\b(?:experience|expertise|background|track record|skills?|abilities|knowledge|proficiency|familiarity)\b)[^.!?]{0,120}\b(?:uses?|builds?|runs?|operates?|develops?|maintains?|offers?|provides?|serves?|needs?|requires?|values?|prioritizes?|includes?|has\b|focus(?:es)? on|works? on|is (?:built|based) on)\b/i;

const ATTENTION_IDIOM = /\b(?:caught|drew|holds?|has|got)\s+my\s+(?:attention|interest|eye)\b|\b(?:drew|draws|interests?|interested|appeals?|appealed|attracted|brought)\s+(?:to\s+)?me\b|\bwhat\s+(?:drew|brought|draws|brings)\s+me\b/gi;

// Employer/job statements may use posting facts, but they must never widen the
// candidate corpus. Mixed employer/candidate sentences stay in every gate.
export function candidateClaimSentences(
  text: string,
  resolved: ResolvedCoverLetterContext
): string[] {
  const company = resolved.company.trim();
  const candidateName = resolved.candidateName.trim();
  const employerStatement = company
    ? new RegExp(
        `^(?:${escapeRegex(company)}(?<possessive>['’]s?)?|(?:The company|The team|This role|The posting))\\s*(?:[,:;]\\s*)?(?<predicate>.+)$`,
        "i"
      )
    : /^(?:The company|The team|This role|The posting)\s*(?:[,:;]\s*)?(?<predicate>.+)$/i;
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
    .filter((sentence) => {
      if (!sentence) return false;
      // "caught my attention" or "drew me" makes no claim about the candidate.
      if (candidateReference.test(sentence.replace(ATTENTION_IDIOM, " "))) return true;
      const match = sentence.match(employerStatement);
      if (!match) return true;
      const predicate = match.groups?.predicate?.trim() ?? "";
      const factPattern = match.groups?.possessive
        ? POSSESSIVE_EMPLOYER_FACT
        : DIRECT_EMPLOYER_FACT;
      return !factPattern.test(predicate);
    });
}

// The checked surface of a sentence: a denial ("I have not used Kafka") claims
// nothing, and the prepared role and company are names the letter must use,
// not skills ("AI/ML Engineer", "Continuous Deployment team").
function claimSurface(sentence: string, resolved: ResolvedCoverLetterContext): string {
  // Polarity is judged per clause: "I can work five days a week, and I would like
  // to contribute" keeps its factual half when the second half is only intent.
  let surface = evidenceSegments(sentence)
    .flatMap((segment) => segment.split(/[;:]\s+|,\s+(?:and|but|so|which|while|where|whereas)\s+|\s+(?:but|whereas)\s+|,\s+(?=(?:I|we)\b)|\s+(?:when|after|while|because|since|as|and)\s+(?=(?:I|we)\b)/))
    // Only a denial claims nothing; an aspiration ("I want to bring 12 Kafka
    // migrations") can still carry facts, so it stays on the surface.
    .filter((segment) => evidencePolarity(segment) !== "denied")
    .join(" ");
  // The whole prepared role title is a name the letter must use, even when it
  // carries a tool ("Backend Engineer - Kafka"); a lone "Kafka" elsewhere is
  // still a claim. The company is a name only where it is used as one
  // ("Databricks' roadmap", "to join Databricks"), so "built Databricks
  // pipelines" stays checkable when the employer is also a tool.
  const role = resolved.role.trim();
  if (role.length >= 3) {
    surface = surface.replace(
      new RegExp(`(?<![\\p{L}\\p{N}])(?:(?<=\\b(?:the|this|your|for|[A-Z][\\w]*['’]s)\\s)${escapeRegex(role)}|${escapeRegex(role)}(?=\\s+(?:role|position|opportunity|opening|posting)\\b))(?![\\p{L}\\p{N}])`, "giu"),
      " "
    );
  }
  const company = resolved.company.trim();
  if (company.length >= 3) {
    surface = surface.replace(
      new RegExp(`(?<![\\p{L}\\p{N}])(?:(?<=\\b(?:at|join|joining|about|why|within)\\s)${escapeRegex(company)}|${escapeRegex(company)}(?=['’](?:s\\b|\\s|$)|\\s+(?:team|engineering|hiring)\\b))(?![\\p{L}\\p{N}])`, "giu"),
      " "
    );
  }
  return surface
    // "the continuous deployment team", "Acme's platform team": a team's name is not a skill
    // claim, unless the name carries a count or a tool ("the 15-person Kafka team").
    .replace(/\b(?:the|your|its|their|[A-Z][\w'’]*(?:'s|’s))\s+((?:[\w/&-]+\s+){1,3})team\b/gi, (match, modifier) =>
      numericClaims(modifier).length > 0 || curatedClaimTerms(modifier).length > 0 ? match : match.replace(modifier, " "))
    // 401(k) and 403(b) are plan names, not counts.
    .replace(/\b40[13]\s*\([a-z]\)/gi, " ")
    // "one workflow", "one scheduling decision": an article in prose, not a count;
    // "one million users" and "one year" stay quantities.
    .replace(/(?<![a-z]-)\bone\b(?!\s+(?:thousand|million|billion|hundred|dozen|percent|years?|months?|weeks?|days?|hours?|minutes?)\b)/gi, " ");
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
  const surfaces = sentences.map((sentence) => claimSurface(sentence, resolved));
  const claims = surfaces.join(" ");
  const jobLower = jobText.toLowerCase();
  const groundingLower = grounding.toLowerCase();
  const issues: CoverLetterValidationIssue[] = [];
  const ungroundedTerm = findUngroundedCuratedClaimTerm(claims, grounding) || findUngroundedJdTerm(
    claims,
    jobLower,
    groundingLower,
    { proseMode: true }
  );
  if (ungroundedTerm) {
    const sentenceIndex = surfaces.findIndex(
      (surface) =>
        findUngroundedCuratedClaimTerm(surface, grounding) === ungroundedTerm ||
        findUngroundedJdTerm(surface, jobLower, groundingLower, { proseMode: true }) ===
          ungroundedTerm
    );
    const claim = sentenceIndex >= 0 ? sentences[sentenceIndex] : claims;
    const displayTerm = claimSurfaceValue(claim, ungroundedTerm);
    issues.push({
      code: "unsupported_job_term",
      category: "evidence",
      claim,
      unsupportedValue: displayTerm,
      detail: `${displayTerm} is not present in the resume or Profile.`,
      recovery: "add_evidence",
      repairMessage:
        `The letter claims "${ungroundedTerm}" for the candidate, but no supplied evidence supports it. Remove the claim or ground it in real evidence.`,
      ...(sentenceIndex >= 0 ? { sentenceIndex } : {})
    });
  }
  const ungroundedNumber = findUngroundedNumericClaim(claims, grounding);
  if (ungroundedNumber) {
    const sentenceIndex = surfaces.findIndex(
      (surface) => findUngroundedNumericClaim(surface, grounding) === ungroundedNumber
    );
    issues.push({
      code: "unsupported_number",
      category: "evidence",
      claim: sentenceIndex >= 0 ? sentences[sentenceIndex] : claims,
      unsupportedValue: ungroundedNumber,
      detail: `${ungroundedNumber} is not present in the resume or Profile.`,
      recovery: "add_evidence",
      repairMessage:
        "The letter states a number, scale, or duration that no supplied evidence contains. Remove it or use a figure the evidence states.",
      ...(sentenceIndex >= 0 ? { sentenceIndex } : {})
    });
  }
  const outcome = findUngroundedOutcomeClaim(claims, grounding, { candidateProse: true });
  if (outcome) {
    const sentenceIndex = surfaces.findIndex(
      (surface) =>
        findUngroundedOutcomeClaim(surface, grounding, { candidateProse: true }) === outcome
    );
    issues.push({
      code: "unsupported_outcome",
      category: "evidence",
      claim: sentenceIndex >= 0 ? sentences[sentenceIndex] : claims,
      unsupportedValue: outcome,
      detail: `The claimed ${outcome} outcome is not supported by the resume or Profile.`,
      recovery: "add_evidence",
      repairMessage:
        `The letter claims an outcome no evidence supports: "${outcome}". Describe only what the evidence records.`,
      ...(sentenceIndex >= 0 ? { sentenceIndex } : {})
    });
  }
  return issues;
}
