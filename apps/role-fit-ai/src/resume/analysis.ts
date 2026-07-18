import { extractKeywords, includesKeyword } from "./keywords";
import { isBullet } from "./text";
import type { ResumeAnalysis } from "./types";

// Deterministic document analysis intentionally excludes fit scoring. It keeps
// only mechanical information used by the editor/tailor workflow; AI Review is
// the sole owner of numeric fit, verdict, coverage, and recommendation.
export function analyzeResumeText(resumeText: string, jobText: string): ResumeAnalysis {
  const jobKeywords = extractKeywords(jobText);
  const bulletGroupsOverLimit = resumeText
    .split(/\n{2,}/)
    .filter((group) => group.split("\n").filter(isBullet).length > 5).length;

  return {
    missingKeywords: jobKeywords.filter((keyword) => !includesKeyword(resumeText, keyword)).slice(0, 10),
    trimmedBulletGroups: bulletGroupsOverLimit
  };
}
