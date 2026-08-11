import type { Application } from "../hooks/useApplications.ts";
import type { ExtractedJobTracking } from "./jobExtract.ts";
import {
  atsPostingKey,
  findDuplicateApplications,
  jdFingerprint,
  jdSimilarity,
  normalizeCompanyName,
  normalizeJobUrl,
  normalizeRoleTitle,
  requisitionIdFromText
} from "./jobIdentity.ts";

export type PreparedSourceCandidate = {
  url: string;
  sourceText: string;
  tracking: ExtractedJobTracking;
};

const COMPARABLE_DESCRIPTION_TOKENS = 50;

function explicitPostingKey(url: string) {
  return atsPostingKey(url)?.key ?? "";
}

export function preparedSourceAppearsDifferent(
  saved: Application,
  candidate: PreparedSourceCandidate
): boolean {
  const savedText = (saved.rawJobDescription || saved.jobDescription || "").trim();
  const candidateText = candidate.sourceText.trim();
  const savedPostingKey = explicitPostingKey(saved.jobUrl);
  const candidatePostingKey = explicitPostingKey(candidate.url);
  if (savedPostingKey && candidatePostingKey) {
    return savedPostingKey !== candidatePostingKey;
  }

  const savedReqId = requisitionIdFromText(savedText);
  const candidateReqId = requisitionIdFromText(candidateText);
  if (savedReqId && candidateReqId && savedReqId !== candidateReqId) return true;

  const savedCompany = normalizeCompanyName(saved.company);
  const candidateCompany = normalizeCompanyName(candidate.tracking.company);
  if (savedCompany && candidateCompany && savedCompany !== candidateCompany) return true;

  const savedRole = normalizeRoleTitle(saved.role || saved.title);
  const candidateRole = normalizeRoleTitle(candidate.tracking.role || candidate.tracking.title);
  const roleConflict = Boolean(savedRole && candidateRole && savedRole !== candidateRole);
  const savedFingerprint = jdFingerprint(savedText);
  const candidateFingerprint = jdFingerprint(candidateText);
  const descriptionsComparable =
    savedFingerprint.size >= COMPARABLE_DESCRIPTION_TOKENS
    && candidateFingerprint.size >= COMPARABLE_DESCRIPTION_TOKENS;
  const similarity = descriptionsComparable
    ? jdSimilarity(savedFingerprint, candidateFingerprint)
    : 1;
  const sameNormalizedUrl = Boolean(
    saved.jobUrl.trim()
    && candidate.url.trim()
    && normalizeJobUrl(saved.jobUrl.trim()) === normalizeJobUrl(candidate.url.trim())
  );

  // A reused generic/company URL is not enough to replace a saved posting when
  // the substantive description or role has changed.
  if (sameNormalizedUrl) {
    return descriptionsComparable && (similarity < 0.45 || (roleConflict && similarity < 0.75));
  }

  const recognizedRelationship = findDuplicateApplications(
    {
      jobUrl: candidate.url,
      jobText: candidateText,
      company: candidate.tracking.company,
      role: candidate.tracking.role || candidate.tracking.title,
      location: candidate.tracking.location
    },
    [saved]
  ).length > 0;
  if (recognizedRelationship) return false;

  // Corrections to the same company/title remain update-safe even when a short
  // or heavily edited source cannot satisfy the duplicate scorer.
  if (savedCompany && savedCompany === candidateCompany && savedRole && savedRole === candidateRole) {
    return descriptionsComparable && similarity < 0.45;
  }

  return true;
}
