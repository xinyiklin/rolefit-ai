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
  "supported",
  // Strong action verbs the local polisher's chooseActionVerb can emit (and that
  // recur in real bullets). Listed here so startsWithAction credits them in
  // bulletQuality — otherwise the polisher's own "Deployed …"/"Resolved …"
  // output, and genuine bullets led by these verbs, scored as having no action verb.
  "automated",
  "containerized",
  "coordinated",
  "deployed",
  "engineered",
  "integrated",
  "resolved",
  "strengthened",
  "validated"
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
  { keyword: "performance", aliases: ["performance", "latency"] },
  // Catalog coverage gaps surfaced by auditing this user's real applications:
  // cloud providers appear in well over half the saved JDs yet were entirely
  // absent here, so the editor's mechanical missing-keyword hints overlooked
  // genuine matches and the rewrite's skills section couldn't surface them.
  // These add recognition only; aliases avoid false-positive-prone bare words (e.g.
  // "golang" not bare "go", "spring boot" not bare "spring", "express.js" not
  // bare "express"). Multi-word/short terms (aws, c#, ci/cd, k8s) only become
  // matchable/extractable BECAUSE they are listed here — the generic token path
  // drops tokens <=3 chars and splits on slashes.
  // Deliberately NOT aliased (would fabricate a skill via a unit/common-noun
  // collision, since buildSummary/buildTechnicalSkills ASSERT a skill on any
  // match): "ml" (the milliliter unit — "5 ml per test"), "flask" (the lab
  // vessel), and bare container words "containers"/"containerized" (shipping/data
  // containers). Keep machine-learning/docker matching to their unambiguous forms.
  { keyword: "cloud", aliases: ["cloud"] },
  { keyword: "aws", aliases: ["aws", "amazon web services"] },
  { keyword: "azure", aliases: ["azure", "microsoft azure"] },
  { keyword: "google cloud", aliases: ["google cloud", "gcp", "google cloud platform"] },
  { keyword: "docker", aliases: ["docker"] },
  { keyword: "kubernetes", aliases: ["kubernetes", "k8s"] },
  { keyword: "ci/cd", aliases: ["ci/cd", "cicd", "ci cd", "continuous integration", "continuous delivery", "continuous deployment"] },
  { keyword: "microservices", aliases: ["microservices", "microservice"] },
  { keyword: "agile", aliases: ["agile"] },
  { keyword: "scrum", aliases: ["scrum"] },
  { keyword: "machine learning", aliases: ["machine learning"] },
  { keyword: "angular", aliases: ["angular"] },
  { keyword: "vue", aliases: ["vue", "vue.js", "vuejs"] },
  { keyword: "next.js", aliases: ["next.js", "nextjs"] },
  { keyword: "express", aliases: ["express.js", "expressjs"] },
  { keyword: "fastapi", aliases: ["fastapi", "fast api"] },
  { keyword: "spring boot", aliases: ["spring boot", "springboot"] },
  { keyword: "c#", aliases: ["c#", "csharp", "c sharp"] },
  { keyword: ".net", aliases: [".net", "dotnet", "asp.net"] },
  { keyword: "go", aliases: ["golang"] },
  { keyword: "graphql", aliases: ["graphql"] },
  { keyword: "mongodb", aliases: ["mongodb", "mongo"] },
  { keyword: "mysql", aliases: ["mysql"] },
  { keyword: "redis", aliases: ["redis"] },
  { keyword: "kafka", aliases: ["kafka"] },
  { keyword: "terraform", aliases: ["terraform"] }
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
  // Excluding it keeps the editor's mechanical missing-keyword hints from being
  // padded with prose noise. These hints do not score or review the resume.
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
  "within",
  // The stored/scored job text is this app's OWN jobExtract distiller output
  // (src/lib/jobExtract.ts), not raw prose: 66/67 saved JDs literally contain the
  // section headers "Tech Stack / Keywords:", "Seniority Signals:", "Domain
  // Signals:", and "Company / Product Context:". Those scaffold tokens are NOT
  // skills, yet extractKeywords was surfacing them as missing-keyword hints the
  // resume can never contain ("domain signals" appears in no resume). Dropping
  // the template furniture keeps the hints focused on job content. (These
  // affect only the generic-token path; ROLE_KEYWORDS alias matching, e.g.
  // "full-stack", is independent of STOP_WORDS.)
  "context",
  "domain",
  "keywords",
  // "product" is part of the distiller's "Company / Product Context:" scaffold label
  // emitted on essentially every JD, so leaving it un-stopworded makes it a SYSTEMATIC
  // phantom missing-keyword hint on every resume lacking the word. That systematic
  // noise outweighs losing it as a (weak, generic) keyword on the
  // occasional genuinely product-focused JD.
  "product",
  "seniority",
  "signals",
  "specified",
  "stack",
  "tech"
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
