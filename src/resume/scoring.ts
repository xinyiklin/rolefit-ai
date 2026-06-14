import { displayKeyword, extractKeywords, includesKeyword, startsWithAction } from "./keywords";
import { hasMetric, isBullet, isKnownSection, sectionName, stripBullet } from "./text";
import type { MatchBreakdown, ResumeAnalysis, ResumeScore } from "./types";

const SECTION_LABELS = ["summary", "experience", "skills", "education", "projects", "certifications"];

const MATCH_CATEGORIES: Array<{ category: string; keywords: string[] }> = [
  {
    category: "Required Experience",
    keywords: ["full-stack", "frontend", "backend", "api integration", "code reviews", "testing", "debugging"]
  },
  {
    category: "Knowledge Areas",
    keywords: ["data structures", "algorithms", "object-oriented programming", "database", "authentication", "performance"]
  },
  {
    category: "Required Skills",
    keywords: ["rest api", "git", "github", "testing", "debugging", "sql"]
  },
  {
    category: "Technical Skills",
    keywords: [
      "react",
      "typescript",
      "javascript",
      "node.js",
      "python",
      "java",
      "c++",
      "postgresql",
      "django",
      "django rest framework",
      "html/css",
      "tailwind css",
      "material ui"
    ]
  }
];

const clampScore = (score: number, minimum = 0) => Math.max(minimum, Math.min(100, Math.round(score)));

// Cues that mark a JD region as a hard requirement vs. a nice-to-have. A
// keyword found only under a "preferred/bonus" heading counts for less than one
// under "requirements/qualifications".
const REQUIRED_CUES = /\b(require|required|requirement|must[\s-]?have|minimum|qualification|responsibilit|what you[\s']?ll do|basic qualification)\b/i;
const PREFERRED_CUES = /\b(prefer|preferred|nice[\s-]?to[\s-]?have|bonus|a plus|good to have|desired|ideally|optional)\b/i;

// Split a JD into required vs. preferred regions by scanning line-by-line. Most
// JDs lead with the core role, so text starts in the "required" bucket; a
// preferred cue flips subsequent lines to "preferred" until a required cue
// flips it back. When a JD has no cue words at all, everything stays required —
// which degrades gracefully to equal weighting.
function splitJobRequirements(jobText: string): { required: string; preferred: string } {
  const required: string[] = [];
  const preferred: string[] = [];
  let bucket: "required" | "preferred" = "required";
  for (const line of jobText.split("\n")) {
    if (REQUIRED_CUES.test(line)) bucket = "required";
    else if (PREFERRED_CUES.test(line)) bucket = "preferred";
    (bucket === "preferred" ? preferred : required).push(line);
  }
  return { required: required.join("\n"), preferred: preferred.join("\n") };
}

// Coverage of job keywords, weighting required matches at full value and
// preferred-only matches at half — so missing a "must-have" hurts the score
// more than missing a "nice-to-have".
function scoreKeywordFit(resumeText: string, jobKeywords: string[], jobText: string): { keywordFit: number; matched: number } {
  if (!jobKeywords.length) return { keywordFit: 0, matched: 0 };
  const { required, preferred } = splitJobRequirements(jobText);
  let totalWeight = 0;
  let earnedWeight = 0;
  let matched = 0;
  for (const keyword of jobKeywords) {
    const preferredOnly = includesKeyword(preferred, keyword) && !includesKeyword(required, keyword);
    const weight = preferredOnly ? 0.5 : 1;
    totalWeight += weight;
    if (includesKeyword(resumeText, keyword)) {
      earnedWeight += weight;
      matched += 1;
    }
  }
  return { keywordFit: totalWeight ? clampScore((earnedWeight / totalWeight) * 100) : 0, matched };
}

const SENIOR_TERMS = /\b(senior|staff|principal|lead|sr\.?|architect|head of|manager)\b/i;
const JUNIOR_TERMS = /\b(junior|jr\.?|entry[\s-]?level|intern|internship|new[\s-]?grad|early[\s-]?career|associate)\b/i;
const TITLE_ROLE_CUES = /\b(engineer|developer|architect|programmer|analyst|scientist|designer|sre)\b/i;
const EXPLICIT_TITLE_CUES =
  /\b(engineering manager|software engineering manager|development manager|manager,\s*software engineering|senior manager|technical lead|tech lead|team lead|lead engineer|lead developer|frontend lead|front-end lead|backend lead|back-end lead|full[\s-]?stack lead|platform lead|data lead|mobile lead|web lead|devops lead|product manager|project manager|program manager)\b/i;
const NON_TITLE_HEADER_CUES = /^(requirements?|responsibilities|qualifications?|skills|about|benefits|what you[\s']?ll do|what we)/i;

// A posting's role title is usually the first short title-like header line,
// sometimes after a company/banner line. Stop at the first plausible title so
// early prose like "collaborate with senior engineers" cannot override a junior
// title above it.
function jobTitleLine(jobText: string): string {
  return jobText
    .split("\n")
    .map((line) => line.trim().replace(/^(job title|role|position)\s*:\s*/i, ""))
    .filter((line) => line.length > 0)
    .slice(0, 5)
    .find(
      (line) =>
        line.length <= 80 &&
        line.split(/\s+/).length <= 7 &&
        !/[.!?]$/.test(line) &&
        !NON_TITLE_HEADER_CUES.test(line) &&
        (TITLE_ROLE_CUES.test(line) || EXPLICIT_TITLE_CUES.test(line))
    ) ?? "";
}

const isSeniorRole = (jobText: string) => SENIOR_TERMS.test(jobTitleLine(jobText));
const isJuniorRole = (jobText: string) => JUNIOR_TERMS.test(jobTitleLine(jobText));

// The lowest year count a JD asks for, e.g. "3+ years" or "3-5 years" -> 3.
function requiredYears(jobText: string): number | null {
  const found = [...jobText.matchAll(/(\d{1,2})\s*\+?\s*(?:-\s*\d{1,2}\s*)?years?/gi)]
    .map((m) => Number(m[1]))
    .filter((n) => Number.isFinite(n) && n > 0 && n < 40);
  return found.length ? Math.min(...found) : null;
}

// Resume text with the education section dropped, so a degree's date span
// (e.g. "2021-2025") is not mistaken for years of professional experience.
// Lines under an EDUCATION header are skipped until the next known section.
function professionalExperienceText(resumeText: string): string {
  const kept: string[] = [];
  let inEducation = false;
  for (const line of resumeText.split("\n")) {
    if (isKnownSection(line)) inEducation = sectionName(line) === "education";
    if (!inEducation) kept.push(line);
  }
  return kept.join("\n");
}

// Rough years of *professional* experience implied by the resume's date ranges
// (earliest to latest four-digit year), excluding the education section.
// Returns null when there isn't enough dated work history to estimate — e.g. a
// new-grad resume — so we don't guess.
function resumeYears(resumeText: string): number | null {
  const years = [...professionalExperienceText(resumeText).matchAll(/\b(?:19|20)\d{2}\b/g)]
    .map((m) => Number(m[0]))
    .filter((y) => y >= 1980 && y <= 2035);
  if (years.length < 2) return null;
  const span = Math.max(...years) - Math.min(...years);
  return span > 0 ? span : null;
}

// Alignment between the seniority/years the JD asks for and what the resume
// shows. Neutral (75) when the JD gives no seniority signal, so roles that
// don't specify aren't penalized.
function scoreSeniority(resumeText: string, jobText: string): number {
  const needYears = requiredYears(jobText);
  const seniorRole = isSeniorRole(jobText);
  const juniorRole = isJuniorRole(jobText);
  if (needYears === null && !seniorRole && !juniorRole) return 75;

  const haveYears = resumeYears(resumeText);
  let score = 75;
  if (needYears !== null) {
    score = haveYears === null ? 60 : clampScore((haveYears / needYears) * 100, 25);
  }
  // A senior posting met by a resume with little datable history reads as a
  // stretch; a junior posting is easy to clear.
  if (seniorRole && (haveYears ?? 0) < 3) score = Math.min(score, 55);
  if (juniorRole) score = Math.max(score, 80);
  return clampScore(score);
}

export function scoreResume(resumeText: string, jobKeywords: string[], jobText: string, trimmedBulletGroups: number): ResumeScore {
  const bullets = resumeText.split("\n").filter(isBullet);
  const actionBullets = bullets.filter((line) => startsWithAction(stripBullet(line))).length;
  const metricBullets = bullets.filter((line) => hasMetric(line)).length;
  const evidenceBullets = bullets.filter((line) => jobKeywords.some((keyword) => includesKeyword(line, keyword))).length;
  const sections = SECTION_LABELS.filter((section) => new RegExp(`\\b${section}\\b`, "i").test(resumeText)).length;
  const longBullets = bullets.filter((line) => stripBullet(line).length > 175).length;

  const { keywordFit } = scoreKeywordFit(resumeText, jobKeywords, jobText);
  const bulletQuality = bullets.length
    ? clampScore(((actionBullets / bullets.length) * 0.45 + (evidenceBullets / bullets.length) * 0.35 + (metricBullets / bullets.length) * 0.2) * 100, 20)
    : 35;
  const structure = clampScore((sections / 4) * 100);
  const concision = Math.max(35, 100 - longBullets * 8 - trimmedBulletGroups * 10);
  const seniority = scoreSeniority(resumeText, jobText);
  let overall = clampScore(
    keywordFit * 0.4 + bulletQuality * 0.2 + seniority * 0.15 + structure * 0.15 + concision * 0.1
  );

  // Rubric guardrail: when the JD states a seniority bar (required years or a
  // senior-level title) and the resume clearly misses it, keep the overall out
  // of "reasonable" territory regardless of how strong keywords/formatting are.
  // Seniority's 15% weight alone can't enforce this — a polished new-grad resume
  // would otherwise score in the high 70s against a senior role.
  // Graduated seniority guardrail. The old flat min(overall, 69) pinned EVERY
  // near-miss to exactly 69 — the brittle top edge of STRETCH. Now the cap
  // scales with the seniority gap (clearly-underqualified caps lower than a
  // one-level-junior candidate), and the trigger drops to <65 so a candidate
  // within ~a year of the bar isn't capped at all.
  const seniorityRequired = requiredYears(jobText) !== null || isSeniorRole(jobText);
  if (seniorityRequired && seniority < 65) {
    overall = Math.min(overall, 55 + Math.round(seniority * 0.2));
  }

  return { overall, keywordFit, bulletQuality, structure, concision, seniority };
}

export function analyzeResumeText(resumeText: string, jobText: string): ResumeAnalysis {
  const jobKeywords = extractKeywords(jobText);
  const bulletGroupsOverLimit = resumeText
    .split(/\n{2,}/)
    .filter((group) => group.split("\n").filter(isBullet).length > 5).length;

  return {
    score: scoreResume(resumeText, jobKeywords, jobText, bulletGroupsOverLimit),
    topKeywords: jobKeywords,
    matchedKeywords: jobKeywords.filter((keyword) => includesKeyword(resumeText, keyword)),
    missingKeywords: jobKeywords.filter((keyword) => !includesKeyword(resumeText, keyword)).slice(0, 10),
    trimmedBulletGroups: bulletGroupsOverLimit
  };
}

export function analyzeMatchBreakdown(resumeText: string, jobText: string): MatchBreakdown[] {
  return MATCH_CATEGORIES.map(({ category, keywords }) => {
    const relevant = keywords.filter((keyword) => includesKeyword(jobText, keyword));
    const covered = relevant.filter((keyword) => includesKeyword(resumeText, keyword)).map(displayKeyword);
    const missing = relevant.filter((keyword) => !includesKeyword(resumeText, keyword)).map(displayKeyword);

    return {
      category,
      covered,
      missing
    };
  }).filter((group) => group.covered.length > 0 || group.missing.length > 0);
}
