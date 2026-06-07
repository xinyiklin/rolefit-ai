import { normalizeText, titleCase, unique } from "./text";

export const ACTION_VERBS = [
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

export const ROLE_KEYWORDS: Array<{ keyword: string; aliases: string[] }> = [
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

export const startsWithAction = (text: string) =>
  ACTION_VERBS.includes(text.trim().split(/\s+/)[0]?.toLowerCase() ?? "");

function keywordAliases(keyword: string) {
  return ROLE_KEYWORDS.find((item) => item.keyword === keyword)?.aliases ?? [keyword];
}

export function includesKeyword(source: string, keyword: string) {
  const normalized = ` ${normalizeText(source)} `;
  return keywordAliases(keyword).some((alias) => {
    const cleaned = normalizeText(alias);
    return cleaned.length > 0 && normalized.includes(` ${cleaned} `);
  });
}

export const displayKeyword = (keyword: string) => titleCase(keyword);

export function extractKeywords(source: string, limit = 18) {
  const roleMatches = ROLE_KEYWORDS.filter(({ keyword }) => includesKeyword(source, keyword)).map(({ keyword }) => keyword);
  const tokens = source
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9+#.\s-]/g, " ")
    .split(/\s+/)
    .map((word) => word.replace(/^[^a-z0-9+#]+|[^a-z0-9+#]+$/g, ""))
    .filter(Boolean);
  const isContentWord = (word: string) => word.length > 3 && !STOP_WORDS.has(word);

  const counts = new Map<string, number>();
  const bump = (term: string, by: number) => counts.set(term, (counts.get(term) ?? 0) + by);
  for (let i = 0; i < tokens.length; i += 1) {
    const word = tokens[i];
    if (!isContentWord(word)) continue;
    bump(word, 1);
    // Capture multi-word skills ("machine learning", "project management",
    // "incident response") that single-token frequency misses — this is what
    // makes the score work for roles outside the built-in web-dev catalog.
    const next = tokens[i + 1];
    if (next && isContentWord(next)) bump(`${word} ${next}`, 1.5);
  }

  const extracted = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word]) => word);

  return unique([...roleMatches, ...extracted]).slice(0, limit);
}
