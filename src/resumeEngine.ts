export type ResumeScore = {
  overall: number;
  keywordFit: number;
  bulletQuality: number;
  structure: number;
  concision: number;
};

export type StrictReviewVerdict = "STRONG FIT" | "REASONABLE FIT" | "STRETCH" | "DON'T APPLY";
export type StrictReviewStatus = "covered" | "missing" | "adjacent";
export type StrictReviewSeverity = "BLOCKER" | "HIGH" | "MEDIUM" | "LOW";

export type StrictReviewCoverage = {
  category: string;          // "Required tech" | "Required experience" | "Required years" | "Preferred"
  keyword: string;
  status: StrictReviewStatus;
  where: string;
};

export type StrictReviewGap = {
  gap: string;
  severity: StrictReviewSeverity;
  canHonestlyAdd: boolean;
  evidence: string;
  suggestedEdit: string;
};

export type StrictReviewRewrite = {
  original: string;
  rewrite: string;
  hits: string[];
};

export type StrictReviewRiskFlag = {
  bullet: string;
  risk: string;
  suggestion: string;
};

export type StrictReviewRecommendation = {
  applyAsIs: boolean;
  reason: string;
  topEdits: string[];
  coverLetterAngle: string;
};

export type StrictReview = {
  verdict: StrictReviewVerdict;
  verdictReason: string;
  coverage: StrictReviewCoverage[];
  gaps: StrictReviewGap[];
  rewrites: StrictReviewRewrite[];
  riskFlags: StrictReviewRiskFlag[];
  recommendation: StrictReviewRecommendation;
};

export type PolishedResume = {
  polishedText: string;
  coverLetterText?: string;
  source?: "ai" | "local";
  score: ResumeScore;
  topKeywords: string[];
  matchedKeywords: string[];
  missingKeywords: string[];
  strengths: string[];
  fixes: string[];
  trimmedBulletGroups: number;
  strictReview?: StrictReview;
};

export type ResumeAnalysis = Omit<PolishedResume, "polishedText" | "strengths" | "fixes">;

export type MatchBreakdown = {
  category: string;
  covered: string[];
  missing: string[];
};

export type ResumeDiff = {
  added: string[];
  removed: string[];
  metricPrompts: string[];
};

const ACTION_VERBS = [
  "accelerated",
  "achieved",
  "analyzed",
  "assisted",
  "built",
  "collaborated",
  "created",
  "delivered",
  "diagnosed",
  "designed",
  "developed",
  "drove",
  "enabled",
  "enforced",
  "extracted",
  "guided",
  "improved",
  "implemented",
  "launched",
  "led",
  "managed",
  "optimized",
  "owned",
  "performed",
  "provided",
  "reduced",
  "shipped",
  "streamlined",
  "supported"
];

const ROLE_KEYWORDS: Array<{ keyword: string; aliases: string[] }> = [
  { keyword: "react", aliases: ["react", "react.js", "reactjs"] },
  { keyword: "typescript", aliases: ["typescript", "type script"] },
  { keyword: "javascript", aliases: ["javascript", "java script", "js"] },
  { keyword: "node.js", aliases: ["node.js", "nodejs", "node"] },
  { keyword: "python", aliases: ["python"] },
  { keyword: "java", aliases: ["java"] },
  { keyword: "c++", aliases: ["c++", "cpp"] },
  { keyword: "sql", aliases: ["sql"] },
  { keyword: "postgresql", aliases: ["postgresql", "postgres", "postgreSQL".toLowerCase()] },
  { keyword: "django", aliases: ["django"] },
  { keyword: "django rest framework", aliases: ["django rest framework", "drf"] },
  { keyword: "rest api", aliases: ["rest api", "rest apis", "api", "apis"] },
  { keyword: "git", aliases: ["git"] },
  { keyword: "github", aliases: ["github"] },
  { keyword: "testing", aliases: ["testing", "tests", "unit test", "integration test"] },
  { keyword: "debugging", aliases: ["debugging", "debug", "troubleshoot", "troubleshooting"] },
  { keyword: "data structures", aliases: ["data structures", "data structure"] },
  { keyword: "algorithms", aliases: ["algorithms", "algorithm"] },
  { keyword: "object-oriented programming", aliases: ["object-oriented programming", "oop"] },
  { keyword: "full-stack", aliases: ["full-stack", "full stack"] },
  { keyword: "frontend", aliases: ["frontend", "front-end", "front end"] },
  { keyword: "backend", aliases: ["backend", "back-end", "back end"] },
  { keyword: "database", aliases: ["database", "databases", "data models", "relational"] },
  { keyword: "authentication", aliases: ["authentication", "auth", "jwt"] },
  { keyword: "html/css", aliases: ["html/css", "html", "css"] },
  { keyword: "tailwind css", aliases: ["tailwind css", "tailwind"] },
  { keyword: "material ui", aliases: ["material ui", "mui"] },
  { keyword: "api integration", aliases: ["api integration", "integrate api", "integrate apis"] },
  { keyword: "code reviews", aliases: ["code review", "code reviews"] },
  { keyword: "performance", aliases: ["performance", "responsive", "latency"] }
];

const SECTION_LABELS = ["summary", "experience", "skills", "education", "projects", "certifications"];

const TECHNICAL_SECTION_NAMES = new Set(["core skills", "skills", "technical skills"]);

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

const STOP_WORDS = new Set([
  "about",
  "across",
  "after",
  "also",
  "and",
  "api",
  "apis",
  "are",
  "based",
  "been",
  "being",
  "but",
  "can",
  "candidate",
  "clean",
  "company",
  "design",
  "description",
  "engineer",
  "entry",
  "entry-level",
  "equivalent",
  "for",
  "from",
  "has",
  "have",
  "application",
  "applications",
  "into",
  "job",
  "level",
  "our",
  "per",
  "qualifications",
  "responsibilities",
  "rest",
  "role",
  "skills",
  "that",
  "the",
  "their",
  "this",
  "through",
  "using",
  "will",
  "with",
  "work",
  "write",
  "you",
  "your"
]);

const hasMetric = (text: string) => /(\d+%|\$\d+|\d+x|\d+\+|\b\d{2,}\b|hours?|days?|weeks?|months?)/i.test(text);
const isBullet = (line: string) => /^\s*[-*•]\s+/.test(line);
const stripBullet = (line: string) => line.replace(/^\s*[-*•]\s+/, "").trim();
const startsWithAction = (text: string) => ACTION_VERBS.includes(text.trim().split(/\s+/)[0]?.toLowerCase() ?? "");
const clampScore = (score: number, minimum = 0) => Math.max(minimum, Math.min(100, Math.round(score)));
const sectionName = (line: string) => line.trim().replace(/:$/, "").toLowerCase();
const isContactLine = (line: string) => /@|https?:\/\/|github\.com|linkedin\.com|\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/i.test(line);
const isKnownSection = (line: string) =>
  [
    "summary",
    "targeted summary",
    "core skills",
    "skills",
    "technical skills",
    "projects",
    "experience",
    "work experience",
    "education",
    "certifications"
  ].includes(sectionName(line));

function normalizeText(text: string) {
  return text
    .toLowerCase()
    .replace(/\bpostgre\s*sql\b/g, "postgresql")
    .replace(/\bnodejs\b/g, "node.js")
    .replace(/\breactjs\b/g, "react")
    .replace(/\brestful\b/g, "rest")
    .replace(/[^a-z0-9+#./-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function keywordAliases(keyword: string) {
  return ROLE_KEYWORDS.find((item) => item.keyword === keyword)?.aliases ?? [keyword];
}

function includesKeyword(source: string, keyword: string) {
  const normalized = ` ${normalizeText(source)} `;
  return keywordAliases(keyword).some((alias) => {
    const cleaned = normalizeText(alias);
    return cleaned.length > 0 && normalized.includes(` ${cleaned} `);
  });
}

const titleCase = (text: string) =>
  text
    .split(" ")
    .filter(Boolean)
    .map((word) => {
      if (["api", "apis", "css", "html", "sql"].includes(word)) return word.toUpperCase();
      if (word === "javascript") return "JavaScript";
      if (word === "node.js") return "Node.js";
      if (word === "postgresql") return "PostgreSQL";
      if (word === "react") return "React";
      if (word === "rest") return "REST";
      if (word === "typescript") return "TypeScript";
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");

const unique = (items: string[]) => Array.from(new Set(items));
const sentenceCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const displayKeyword = (keyword: string) => titleCase(keyword);

export function extractKeywords(source: string, limit = 18) {
  const roleMatches = ROLE_KEYWORDS.filter(({ keyword }) => includesKeyword(source, keyword)).map(({ keyword }) => keyword);
  const words = source
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9+#.\s-]/g, " ")
    .split(/\s+/)
    .map((word) => word.replace(/^[^a-z0-9+#]+|[^a-z0-9+#]+$/g, ""))
    .filter((word) => word.length > 3 && !STOP_WORDS.has(word));

  const counts = new Map<string, number>();
  for (const word of words) {
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }

  const extracted = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word]) => word);

  return unique([...roleMatches, ...extracted]).slice(0, limit);
}

function scoreBullet(line: string, keywords: string[]) {
  const clean = stripBullet(line).toLowerCase();
  const keywordHits = keywords.filter((keyword) => includesKeyword(clean, keyword)).length;
  return keywordHits * 4 + (startsWithAction(clean) ? 3 : 0) + (hasMetric(clean) ? 3 : 0) - Math.max(0, clean.length - 180) / 60;
}

function polishBullet(line: string, keywords: string[], promptForMetric: boolean) {
  const original = stripBullet(line).replace(/\s+/g, " ").replace(/[.;]\s*$/, "");
  if (!original) return "";

  const weakLead = original
    .replace(/^(responsible for|worked on|helped with|used|utilized|created)\s+/i, "")
    .replace(/^(built|designed|developed|implemented|led|managed|optimized)\s+to\s+/i, "");
  let body = sentenceCase(weakLead);

  if (!startsWithAction(weakLead)) {
    body = `${chooseActionVerb(weakLead, keywords)} ${weakLead.charAt(0).toLowerCase()}${weakLead.slice(1)}`.trim();
  }

  if (body.length > 185) {
    body = `${body.slice(0, 182).replace(/\s+\S*$/, "")}...`;
  }

  if (promptForMetric && !hasMetric(body)) {
    body = `${body} [add metric: scope, scale, time saved, revenue, quality, or adoption]`;
  }

  return `- ${body}`;
}

function chooseActionVerb(text: string, keywords: string[]) {
  const normalized = normalizeText(text);
  if (/\b(migrat|transfer|onboard|coordinat)\w*/.test(normalized)) return "Coordinated";
  if (/\b(debug|troubleshoot|fix|resolved?)\b/.test(normalized)) return "Resolved";
  if (/\b(test|validated?|verified?|qa)\b/.test(normalized)) return "Validated";
  if (/\b(database|postgresql|sql|model|schema)\b/.test(normalized)) return "Designed";
  if (/\b(api|backend|server|endpoint)\b/.test(normalized)) return "Built";
  if (/\b(frontend|react|typescript|javascript|ui|interface)\b/.test(normalized)) return "Developed";
  if (keywords.some((keyword) => includesKeyword(normalized, keyword))) return "Delivered";
  return "Strengthened";
}

function condenseBulletGroups(lines: string[], keywords: string[]) {
  const output: string[] = [];
  let trimmedGroups = 0;
  let index = 0;

  while (index < lines.length) {
    if (!isBullet(lines[index])) {
      output.push(lines[index]);
      index += 1;
      continue;
    }

    const group: string[] = [];
    while (index < lines.length && isBullet(lines[index])) {
      group.push(lines[index]);
      index += 1;
    }

    const ranked = [...group].sort((a, b) => scoreBullet(b, keywords) - scoreBullet(a, keywords));
    if (group.length > 5) trimmedGroups += 1;
    output.push(...ranked.slice(0, 5).map((line, rankedIndex) => polishBullet(line, keywords, rankedIndex < 2)));
  }

  return { lines: output, trimmedGroups };
}

function trimBlankEdges(lines: string[]) {
  const output = [...lines];
  while (output.length && !output[0].trim()) output.shift();
  while (output.length && !output[output.length - 1].trim()) output.pop();
  return output;
}

function compactBlankLines(lines: string[]) {
  const output: string[] = [];
  for (const line of lines) {
    if (!line.trim() && !output[output.length - 1]?.trim()) continue;
    output.push(line);
  }
  return trimBlankEdges(output).join("\n");
}

function addSectionSpacing(lines: string[]) {
  const output: string[] = [];
  for (const line of lines) {
    if (isKnownSection(line) && output.length && output[output.length - 1].trim()) {
      output.push("");
    }
    output.push(line);
  }
  return output;
}

function splitResumeHeader(text: string) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const first = lines.findIndex((line) => line.trim());
  const name = first >= 0 ? lines[first].trim() : "";
  const contact = first >= 0 ? lines[first + 1]?.trim() ?? "" : "";

  if (name && contact && isContactLine(contact) && !isKnownSection(name)) {
    return {
      header: [name, contact],
      body: trimBlankEdges(lines.slice(first + 2))
    };
  }

  return {
    header: [] as string[],
    body: trimBlankEdges(first >= 0 ? lines.slice(first) : [])
  };
}

function skipSection(lines: string[], start: number) {
  let index = start + 1;
  while (index < lines.length && !isKnownSection(lines[index])) index += 1;
  return index;
}

function removeSections(lines: string[], labels: Set<string>) {
  const output: string[] = [];
  let index = 0;

  while (index < lines.length) {
    if (labels.has(sectionName(lines[index]))) {
      index = skipSection(lines, index);
      continue;
    }

    output.push(lines[index]);
    index += 1;
  }

  return trimBlankEdges(output);
}

function buildSummary(keywords: string[], resumeText: string) {
  const matched = keywords.filter((keyword) => includesKeyword(resumeText, keyword)).slice(0, 7);
  const skills = matched.length > 0 ? matched.map(titleCase).join(", ") : "React, TypeScript, APIs, debugging, and project delivery";

  return [
    "SUMMARY",
    `Computer Science graduate targeting entry-level full-stack and SDE roles, with hands-on project experience across ${skills}. Focused on clear user experiences, dependable APIs, and maintainable code grounded in truthful project evidence.`
  ];
}

function buildTechnicalSkills(keywords: string[], resumeText: string) {
  const resumeSkills = ROLE_KEYWORDS.filter(({ keyword }) => includesKeyword(resumeText, keyword)).map(({ keyword }) => keyword);
  const targetedSkills = keywords.filter((keyword) => resumeSkills.includes(keyword));
  const skills = unique([...targetedSkills, ...resumeSkills]).slice(0, 12).map(titleCase);

  if (skills.length < 4) return [];
  return ["TECHNICAL SKILLS", skills.join(" | ")];
}

function hasTechnicalSection(lines: string[]) {
  return lines.some((line) => TECHNICAL_SECTION_NAMES.has(sectionName(line)));
}

function localEngineLabel(polishedText: string, trimmedGroups: number) {
  return unique([
    "Local engine ranked bullets by role keyword evidence, action verbs, metrics, and concision.",
    polishedText.includes("[add metric") ? "Metric prompts mark stronger proof to add before submitting." : "Existing measurable proof was preserved.",
    trimmedGroups ? "Long bullet groups were trimmed to the strongest five items." : "Role sections stay at five bullets or fewer."
  ]).slice(0, 4);
}

function localEngineFixes(missingKeywords: string[], trimmedGroups: number) {
  return unique([
    missingKeywords.length ? `Add truthful evidence for: ${missingKeywords.slice(0, 6).join(", ")}.` : "Keyword coverage is strong; review for company-specific wording.",
    trimmedGroups ? "Review trimmed bullets and restore any must-have evidence manually." : "Replace every bracketed metric prompt with a real number or remove it.",
    "Use the AI version when available for finer phrasing, but keep this local draft as a safe copy-ready baseline."
  ]).slice(0, 4);
}

function scoreResume(resumeText: string, jobKeywords: string[], trimmedBulletGroups: number): ResumeScore {
  const matched = jobKeywords.filter((keyword) => includesKeyword(resumeText, keyword)).length;
  const bullets = resumeText.split("\n").filter(isBullet);
  const actionBullets = bullets.filter((line) => startsWithAction(stripBullet(line))).length;
  const metricBullets = bullets.filter((line) => hasMetric(line)).length;
  const evidenceBullets = bullets.filter((line) => jobKeywords.some((keyword) => includesKeyword(line, keyword))).length;
  const sections = SECTION_LABELS.filter((section) => new RegExp(`\\b${section}\\b`, "i").test(resumeText)).length;
  const longBullets = bullets.filter((line) => stripBullet(line).length > 175).length;

  const keywordFit = jobKeywords.length ? clampScore((matched / jobKeywords.length) * 100) : 0;
  const bulletQuality = bullets.length
    ? clampScore(((actionBullets / bullets.length) * 0.45 + (evidenceBullets / bullets.length) * 0.35 + (metricBullets / bullets.length) * 0.2) * 100, 20)
    : 35;
  const structure = clampScore((sections / 4) * 100);
  const concision = Math.max(35, 100 - longBullets * 8 - trimmedBulletGroups * 10);
  const overall = clampScore(keywordFit * 0.4 + bulletQuality * 0.25 + structure * 0.2 + concision * 0.15);

  return { overall, keywordFit, bulletQuality, structure, concision };
}

export function polishResume(resumeText: string, jobText: string): PolishedResume {
  const jobKeywords = extractKeywords(jobText);
  const { header, body } = splitResumeHeader(resumeText);
  const sourceBody = removeSections(body, new Set(["summary", "targeted summary", "core skills"]));
  const { lines, trimmedGroups } = condenseBulletGroups(sourceBody, jobKeywords);
  const bodyWithSkills = hasTechnicalSection(lines) ? lines : [...buildTechnicalSkills(jobKeywords, resumeText), "", ...lines];
  const polishedBody = bodyWithSkills.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const summary = buildSummary(jobKeywords, resumeText);
  const polishedText = normalizePolishedResume([...header, "", ...summary, "", polishedBody].join("\n").trim(), resumeText);
  const matchedKeywords = jobKeywords.filter((keyword) => includesKeyword(polishedText, keyword));
  const missingKeywords = jobKeywords.filter((keyword) => !includesKeyword(resumeText, keyword)).slice(0, 10);
  const score = scoreResume(polishedText, jobKeywords, trimmedGroups);

  return {
    polishedText,
    source: "local",
    score,
    topKeywords: jobKeywords,
    matchedKeywords,
    missingKeywords,
    strengths: localEngineLabel(polishedText, trimmedGroups),
    fixes: localEngineFixes(missingKeywords, trimmedGroups),
    trimmedBulletGroups: trimmedGroups
  };
}

export function draftCoverLetter(resumeText: string, jobText: string, polishedText = resumeText) {
  const source = splitResumeHeader(resumeText);
  const candidateName = source.header[0]?.trim() || "[Your name]";
  const jobKeywords = extractKeywords(jobText);
  const matchedKeywords = jobKeywords.filter((keyword) => includesKeyword(polishedText, keyword)).slice(0, 5);
  const skillLine = matchedKeywords.length
    ? matchedKeywords.map(titleCase).join(", ")
    : "full-stack development, APIs, debugging, and practical software projects";
  const evidenceBullets = polishedText
    .split("\n")
    .filter(isBullet)
    .sort((a, b) => scoreBullet(b, matchedKeywords) - scoreBullet(a, matchedKeywords))
    .slice(0, 2)
    .map((line) => stripBullet(line).replace(/\s*\[add metric:[^\]]+\]/gi, " [add metric]"));
  const evidenceLine =
    evidenceBullets.length > 0
      ? `Two examples I would bring to the role are: ${evidenceBullets.join("; ")}.`
      : "My project work gives me practical experience turning requirements into usable software while continuing to build depth as an entry-level engineer.";

  return [
    candidateName,
    "[Today's date]",
    "",
    "[Hiring manager]",
    "[Company]",
    "",
    "Dear [Hiring manager],",
    "",
    `I am applying for the [role title] role at [Company]. I am a Computer Science graduate focused on entry-level SDE and full-stack work, and my project experience aligns with the role through ${skillLine}.`,
    "",
    evidenceLine,
    "",
    "I am especially interested in roles where I can keep learning while contributing reliable code, clear API behavior, readable user-facing workflows, and steady debugging habits.",
    "",
    "I would welcome the chance to discuss how my projects and CS foundation can support your engineering team. Thank you for your time and consideration.",
    "",
    "Sincerely,",
    candidateName
  ].join("\n");
}

export function normalizePolishedResume(polishedText: string, sourceResumeText: string) {
  const source = splitResumeHeader(sourceResumeText);
  const polished = splitResumeHeader(polishedText);
  const header = polished.header.length ? polished.header : source.header;
  const headerSet = new Set(header.map((line) => line.trim()).filter(Boolean));
  const body = trimBlankEdges(polished.body).filter((line) => {
    const trimmed = line.trim();
    return trimmed && !headerSet.has(trimmed) && !isContactLine(trimmed);
  });
  const hasTechnicalSkills = body.some((line) => sectionName(line) === "technical skills");
  const output: string[] = [];
  let sawSummary = false;
  let sawSkills = false;
  let index = 0;

  while (index < body.length) {
    const line = body[index];
    const section = sectionName(line);

    if (section === "summary" || section === "targeted summary") {
      if (sawSummary) {
        index = skipSection(body, index);
        continue;
      }
      output.push("SUMMARY");
      sawSummary = true;
      index += 1;
      continue;
    }

    if ((section === "core skills" || section === "skills") && hasTechnicalSkills) {
      index = skipSection(body, index);
      continue;
    }

    if (section === "core skills" || section === "skills" || section === "technical skills") {
      if (sawSkills) {
        index = skipSection(body, index);
        continue;
      }
      output.push(section === "technical skills" ? line : "TECHNICAL SKILLS");
      sawSkills = true;
      index += 1;
      continue;
    }

    output.push(line);
    index += 1;
  }

  return compactBlankLines([...header, "", ...addSectionSpacing(output)]);
}

export function analyzeResumeText(resumeText: string, jobText: string): ResumeAnalysis {
  const jobKeywords = extractKeywords(jobText);
  const bulletGroupsOverLimit = resumeText
    .split(/\n{2,}/)
    .filter((group) => group.split("\n").filter(isBullet).length > 5).length;

  return {
    score: scoreResume(resumeText, jobKeywords, bulletGroupsOverLimit),
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

function comparableLine(line: string) {
  return normalizeText(
    stripBullet(line)
      .replace(/\[add metric:[^\]]+\]/gi, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

export function buildResumeDiff(sourceText: string, polishedText: string): ResumeDiff {
  const sourceLines = sourceText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 30 && !isContactLine(line));
  const polishedLines = polishedText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 30 && !isContactLine(line));
  const sourceSet = new Set(sourceLines.map(comparableLine).filter(Boolean));
  const polishedSet = new Set(polishedLines.map(comparableLine).filter(Boolean));
  const added = polishedLines.filter((line) => !sourceSet.has(comparableLine(line))).slice(0, 8);
  const removed = sourceLines.filter((line) => !polishedSet.has(comparableLine(line))).slice(0, 8);
  const metricPrompts = polishedLines.filter((line) => /\[add metric:/i.test(line)).slice(0, 6);

  return { added, removed, metricPrompts };
}
