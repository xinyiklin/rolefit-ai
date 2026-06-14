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
  { keyword: "node.js", aliases: ["node.js", "nodejs"] },
  { keyword: "python", aliases: ["python"] },
  { keyword: "java", aliases: ["java"] },
  { keyword: "c++", aliases: ["c++", "cpp"] },
  { keyword: "sql", aliases: ["sql"] },
  { keyword: "postgresql", aliases: ["postgresql", "postgres", "postgreSQL".toLowerCase()] },
  { keyword: "django", aliases: ["django"] },
  { keyword: "django rest framework", aliases: ["django rest framework", "drf"] },
  { keyword: "rest api", aliases: ["rest api", "rest apis", "restful"] },
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
  { keyword: "database", aliases: ["database", "databases", "data models"] },
  { keyword: "authentication", aliases: ["authentication", "auth", "jwt"] },
  { keyword: "html/css", aliases: ["html/css", "html", "css"] },
  { keyword: "tailwind css", aliases: ["tailwind css", "tailwind"] },
  { keyword: "material ui", aliases: ["material ui", "mui"] },
  { keyword: "api integration", aliases: ["api integration", "integrate api", "integrate apis"] },
  { keyword: "code reviews", aliases: ["code review", "code reviews"] },
  { keyword: "performance", aliases: ["performance", "latency"] }
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
  "build",
  "building",
  "but",
  "can",
  "candidate",
  "clean",
  "company",
  "design",
  "description",
  "develop",
  "developing",
  "engineer",
  "entry",
  "entry-level",
  "equivalent",
  "experience",
  "for",
  "from",
  "has",
  "have",
  "application",
  "applications",
  "improvements",
  "into",
  "job",
  "level",
  "maintain",
  "maintaining",
  "our",
  "per",
  "preferred",
  "qualifications",
  "requirements",
  "responsibilities",
  "rest",
  "role",
  "skills",
  "strong",
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
  "written",
  "years",
  "you",
  "your",
  // Generic JD-prose filler that is not a skill and forms no useful skill bigram.
  // keywordFit (40% of the score) is coverage of extractKeywords(jobText); these
  // padded into the keyword set as guaranteed "misses", deflating a genuinely
  // strong resume's fit purely from verbose postings. Removing them never invents
  // coverage — it only stops counting prose noise as a missing requirement.
  "ability",
  "code",
  "deep",
  "discipline",
  "etc",
  "exposure",
  "familiarity",
  "help",
  "ideal",
  "including",
  "join",
  "looking",
  "mentor",
  "passion",
  "passionate",
  "professional",
  "such",
  "team",
  "teams",
  "within"
]);

export const startsWithAction = (text: string) =>
  ACTION_VERBS.includes(text.trim().split(/\s+/)[0]?.toLowerCase() ?? "");

function keywordAliases(keyword: string) {
  return ROLE_KEYWORDS.find((item) => item.keyword === keyword)?.aliases ?? [keyword];
}

export function includesKeyword(source: string, keyword: string) {
  // normalizeText keeps '.' so internal-period terms survive (node.js, .net,
  // 3.5). But a sentence-ending period stays glued to the word ("Used Python.")
  // and, because matching is space-boundary anchored, blocked an honest match.
  // Turn a period at a token boundary (followed by whitespace) into a space;
  // internal periods are followed by a non-space char and are left intact.
  const normalized = ` ${normalizeText(source)} `.replace(/\.(?=\s)/g, " ");
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
    // A bigram that occurs once is usually sentence noise ("preferred strong",
    // a company name), and its 1.5 boost would crowd out real single-mention
    // skills. Require a repeat (2 × 1.5 = 3) before a bigram can rank.
    .filter(([term, count]) => !term.includes(" ") || count >= 3)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word]) => word);

  return unique([...roleMatches, ...extracted]).slice(0, limit);
}
