// JD-term grounding for Resume Polish suggestions: a term that appears in the job
// description may be written into a proposedText ONLY if it already exists in
// the grounding corpus (every current field text in the resume scope plus the
// user's Profile). The evidence field is model prose and can launder an
// inferred fact ("clinics run Windows"); the source text cannot.
//
// Three complementary detectors:
// 1. Capitalized tokens of 3+ chars (Windows, Flask, EKS) — proper-noun and
//    product names. Sentence-initial words are checked too, except an action
//    verb the posting does not use as a name, so "Kubernetes deployments…" can't
//    slip in at position 0. 1-2 char tokens (Go, ML, C#) are a known coverage gap.
// 2. A lowercase tech-concept lexicon (microservices, devsecops, machine
//    learning…) — concept terms models insert without capitalization. This is
//    a deliberately curated mirror of the concept-class entries in
//    src/resume/keywords.ts ROLE_KEYWORDS (the TS module cannot be imported
//    from the Node server because of its extensionless TS import chain; keep
//    additions small and concept-class only — product names belong to
//    detector 1).
// 3. A bounded, token-anchored sweep over a curated lowercase tool/product
//    lexicon (LOWERCASE_TOOL_NAMES: terraform, snowflake, airflow…). Detector 1
//    only fires on [A-Z]-initial proposed tokens, so a model emitting a
//    lowercase-written product/tool name absent from the detector-2 concept
//    lexicon previously slipped through entirely — that was the gap. Only names
//    in this curated set are ever candidates, so no ordinary English word
//    (and, across, support…) can be flagged. Membership is token-anchored on
//    BOTH the JD and the proposed text (never substring) and routes through the
//    SAME isGrounded helper as detectors 1-2, so aliases (postgres↔postgresql,
//    k8s), inflections, and the known false-friend protections (Java≠JavaScript,
//    React≠reactive) all behave identically. The lexicon is a representative,
//    extensible starter set, not exhaustive — human review and the prompt
//    input-firewall rules remain the backstop for anything it misses.
//
// Matching is token-anchored: exact token, a known alias pair
// (postgres/postgresql, k8s/kubernetes), or a pure inflectional suffix
// (container/containerized). Prefix false-friends are rejected — Java is NOT
// grounded by JavaScript, React is NOT grounded by "reactive".

const LOWERCASE_TECH_CONCEPTS = [
  "microservices", "monolith", "service mesh", "distributed systems",
  "event-driven", "message queue", "pub/sub", "streaming", "etl",
  "data warehouse", "data lake", "data pipeline",
  "machine learning", "deep learning", "artificial intelligence",
  "neural network", "computer vision", "natural language processing",
  "model training", "model inference", "fine-tuning", "embeddings",
  "vector database", "prompt engineering", "retrieval-augmented",
  "devops", "devsecops", "mlops", "ci/cd", "continuous integration",
  "continuous deployment", "continuous delivery", "infrastructure as code",
  "infrastructure-as-code", "configuration management", "observability",
  "telemetry", "site reliability", "incident response",
  "serverless", "containerization", "container orchestration",
  "cloud-native", "multi-tenant", "autoscaling", "load balancing",
  "sharding", "replication", "high availability", "fault tolerance",
  "caching", "rate limiting",
  "penetration testing", "threat modeling", "zero trust", "single sign-on",
  "unit testing", "integration testing", "end-to-end testing",
  "test-driven", "test automation", "performance testing",
  "accessibility", "internationalization", "localization",
  "full-text search", "real-time", "websockets", "webhooks", "graphql",
  "grpc", "message broker", "object storage", "relational database",
  "security clearance", "golang"
];

// Specific evidence that establishes a concept or language (ARIA labels are
// accessibility work; Django is Python), or the written-out form of an abbreviation.
// Only specific-to-general holds: CI never implies CI/CD. Ambiguous lowercase names
// (flask, pandas) are left out.
const CONCEPT_EVIDENCE = new Map([
  ["oop", /(?<!\b(?:no|not|non|without|never)[\s-]+)\bobject[- ]oriented\b/i],
  ["accessibility", /\b(?:aria-[a-z]+|aria\s+(?:labels?|attributes?|roles?)|wcag|a11y|screen[- ]readers?)\b/i],
  ["observability", /\b(?:prometheus|grafana|datadog|opentelemetry)\b/i],
  ["containerization", /\b(?:docker(?:ized|file)?|podman)\b/i],
  ["python", /\b(?:django|fastapi|numpy|pytorch|pytest|scikit-learn)\b/i],
  ["relational database", /\b(?:postgres(?:ql)?|mysql|mariadb|sqlite|sql server)\b/i],
  ["continuous integration", /(?<!%\s?)\bci\b(?![/-]?cd\b)/i]
]);

// Curated lowercase-WRITTEN tool/product/library names for detector 3. These
// are single-token, distinctive product names that detector 1 (capitalized,
// [A-Z]-initial), detector 2 (LOWERCASE_TECH_CONCEPTS), and TOKEN_ALIASES do
// NOT already cover — the real gap the original finding cited (a model emitting
// "terraform" / "snowflake" / "airflow" in lowercase slipped past detector 1).
// Deliberately excludes names that collide with a common English word, whether
// as a substring OR a whole token — because detector 3 AUTO-DROPS a suggestion,
// a tool name that doubles as ordinary prose (spark, vault, consul, helm,
// puppet, vagrant, rails, celery, stripe) would risk deleting an honest bullet.
// Those fall back to detector 1 when capitalized ("Spark", "Rails") plus human
// review + the prompt input-firewall. This is a representative, extensible
// starter set, not exhaustive; human review remains the backstop for anything
// it misses. Add new tool names here — but never a plain-English word.
//
// PROSE-MODE BRAND COVERAGE (cover letters / application answers): prose mode
// skips detector 1 (capitalized tokens) because legitimate prose names the
// target company/role/product from the JD. That left CAPITALIZED BRANDED TOOLS
// not in any lexicon (Salesforce, Tableau, AWS, Java, Figma…) ungated, so a
// generated letter could claim a branded skill the candidate never used — the
// exact D002 failure. The simplest SAFE fix routes them through THIS set:
// detector 3 already lowercase-matches and runs in prose mode with token-anchored
// isGrounded discipline (so "java" cannot match inside "javascript", and a
// company proper noun like "Acme" / "Remodel Health" is never in the lexicon, so
// it is never flagged). The brands below are the vetted, NON-English-collision
// capitalized tool names. Deliberately OMITTED as plain-English-collision risks
// (a false drop would break an honest application — worse than missing one
// brand): Excel ("excel at"), Word, Access, Spark, Swift, Rust, Go, and Workday
// ("a long workday"). "azure" can mean the color but is overwhelmingly the cloud
// platform in this domain. "powerbi" only matches the solid-cased form ("power
// bi" tokenizes as two words) — harmless, kept for the solid form.
const LOWERCASE_TOOL_NAMES = new Set([
  "python", "javascript", "typescript",
  "terraform", "ansible", "jenkins", "gitlab", "argocd", "istio", "kafka",
  "rabbitmq", "redis", "memcached", "elasticsearch", "opensearch", "mongodb",
  "cassandra", "dynamodb", "mariadb", "sqlite", "snowflake", "databricks",
  "airflow", "hadoop", "flink", "nginx", "tomcat", "gunicorn", "django",
  "flask", "fastapi", "laravel", "symfony", "nestjs", "kotlin", "scala",
  "elixir", "erlang", "clojure", "pytorch", "tensorflow", "keras", "pandas",
  "numpy", "jupyter", "docker", "podman", "prometheus", "grafana", "datadog",
  "splunk", "kibana", "webpack", "vite", "eslint", "jest", "vitest", "cypress",
  "playwright", "selenium", "pytest", "twilio", "kubernetes",
  // Prose-mode capitalized brand additions (vetted non-English-collision).
  // "databricks"/"snowflake" already appear above. OMITTED here too: "sap"
  // ("sap the energy"), "looker" ("a good looker") — both plain-English nouns.
  "salesforce", "tableau", "aws", "azure", "gcp", "java", "figma", "jira",
  "hubspot", "powerbi", "servicenow", "netsuite", "marketo", "zendesk", "okta"
]);

// Detector 4: curated SHORT (1-3 char) tech tokens that detector 1's 3+ char
// minimum structurally misses. Only DISTINCTIVE, non-colliding tokens are
// included — the deliberate call the coverage gap requires. Collision-prone
// short tokens are EXCLUDED on purpose: bare "go" doubles as the English verb
// and the "go-to-market" compound, and single letters "r"/"c" appear constantly
// in ordinary prose; including them would false-positive and risk dropping honest
// content. "#"/"+" survive the token regex so "c#"/"c++" match token-anchored.
const SHORT_TOOL_TOKENS = new Set(["c#", "c++"]);
const SHORT_TECH_TOKENS = new Set([...SHORT_TOOL_TOKENS, "ml", "nlp"]);

const LEADING_ACTION_VERBS = new Set([
  "built", "led", "designed", "implemented", "created", "developed",
  "automated", "migrated", "reduced", "shipped", "integrated", "engineered",
  "coordinated", "supported", "gathered", "collected", "translated",
  "maintained", "wrote", "tuned", "improved", "refactored", "optimized",
  "streamlined", "delivered", "owned", "drove", "managed", "architected",
  "hardened", "expanded", "authored", "deployed", "configured",
  "administered", "monitored", "tested", "debugged", "documented",
  "presented", "partnered", "collaborated", "established", "introduced",
  "launched", "modernized", "consolidated", "standardized", "diagnosed",
  "resolved", "analyzed", "evaluated", "researched", "prototyped"
]);

// Further past-tense resume verbs. With LEADING_ACTION_VERBS they let
// actionVerbPast read base and gerund forms ("Build", "Optimizes", "Fixing").
const MORE_ACTION_VERBS = new Set([
  "added", "fixed", "removed", "replaced", "rewrote", "rebuilt", "ran", "made", "cut", "sped",
  "assisted", "helped", "contributed", "participated", "worked", "identified", "instrumented",
  "stabilized", "measured", "defined", "moved", "scaled", "secured", "validated", "exposed",
  "packaged", "published", "trained", "processed", "scheduled", "extended", "ported",
  "converted", "redesigned", "reviewed", "mentored", "triaged", "investigated", "profiled",
  "benchmarked", "indexed", "parsed", "simplified", "unified", "accelerated", "boosted",
  "decreased", "eliminated", "generated", "increased", "lowered", "prevented", "protected",
  "saved", "shortened", "strengthened", "upgraded", "adopted", "applied", "used", "handled",
  "tracked", "reported", "enabled", "achieved", "grew", "taught", "answered", "containerized",
  "planned", "guided", "covered", "backed", "verified", "kept", "set", "switched", "rolled", "backfilled"
]);

const IRREGULAR_PAST = new Map([
  ["build", "built"], ["rebuild", "rebuilt"], ["write", "wrote"], ["rewrite", "rewrote"],
  ["run", "ran"], ["lead", "led"], ["drive", "drove"], ["make", "made"], ["speed", "sped"],
  ["cut", "cut"], ["grow", "grew"], ["teach", "taught"], ["keep", "kept"], ["set", "set"]
]);

// Product names that are also resume verbs stay claims at the start of a sentence.
const VERB_NAMED_PRODUCTS = new Set(["boost", "drive", "make", "parse", "scale"]);

// The canonical past form of any inflection of a listed resume action verb, or null.
export function actionVerbPast(word: string): string | null {
  const w = word.toLowerCase();
  const isPast = (form: string | undefined) => form !== undefined && (LEADING_ACTION_VERBS.has(form) || MORE_ACTION_VERBS.has(form));
  if (isPast(w)) return w;
  const bases = [w, w.replace(/s$/, ""), w.replace(/es$/, ""), w.replace(/ies$/, "y"), w.replace(/ing$/, ""), w.replace(/ing$/, "e"), w.replace(/(.)\1ing$/, "$1")];
  for (const base of bases) {
    const past = [IRREGULAR_PAST.get(base), `${base}ed`, `${base}d`, base.replace(/y$/, "ied"), base.replace(/([^aeiou][aeiou])([bgmnpt])$/, "$1$2$2ed")].find(isPast);
    if (past) return past;
  }
  return null;
}

// "Build", "Helped": a sentence-initial verb in any tense is capitalized by grammar.
// Acronyms ("RAN", "SET") are names, not verbs.
function isSentenceInitialVerb(text: string, index: number, word: string): boolean {
  const token = word.toLowerCase();
  return /^[A-Z][a-z]+$/.test(word) && !VERB_NAMED_PRODUCTS.has(token) && Boolean(actionVerbPast(token)) && isProseSentenceStart(text, index);
}

const OWNERSHIP_LEVELS: ReadonlyArray<{ level: number; pattern: RegExp }> = [
  { level: 3, pattern: /\b(?:architect(?:ed|ing)?|led|lead|leading|owned|owning|drove|driven|directed|headed|spearheaded|oversaw|orchestrated)\b/i },
  { level: 2, pattern: /\b(?:built|designed|implemented|developed|delivered|created|engineered|managed)\b/i },
  { level: 1, pattern: /\b(?:assisted|supported|contributed|helped|collaborated|coordinated|participated)\b/i }
];

// "led me to build", "led to fewer errors": causal, not leadership. "API-driven",
// "test-driven", "community-led": compound adjectives, not responsibility.
const CAUSAL_LED = /(?<!\b(?:i|we)\s+)\bled\s+(?:(?:me|us)\s+)?to\b/gi;
const COMPOUND_OWNERSHIP = /\b(?!co-|self-)[\w]+-(?:driven|led|owned|directed|headed)\b/gi;
// "Lead time" and "lead generation" are nouns, not leadership ("lead time-series"
// still leads).
const LEAD_NOUN = /\blead\s+(?:time|times|generation|scoring)\b(?!-)/gi;

export function ownershipStrength(value: string): number {
  const text = value.replace(CAUSAL_LED, " ").replace(COMPOUND_OWNERSHIP, " ").replace(LEAD_NOUN, " ");
  for (const { level, pattern } of OWNERSHIP_LEVELS) {
    if (pattern.test(text)) return level;
  }
  return 0;
}

// Resume Polish only: a bullet that opens with a plain or -s present ownership verb
// ("Build…", "Owns…") claims its past form's level. Kept out of ownershipStrength,
// whose other readers (Fit, cover letters, Answers) see sentences, titles and nouns.
const OWNERSHIP_LEVEL_BY_PAST = new Map<string, number>([
  ...["architected", "led", "owned", "drove", "directed", "headed", "spearheaded", "oversaw", "orchestrated"].map((verb) => [verb, 3] as const),
  ...["built", "designed", "implemented", "developed", "delivered", "created", "engineered", "managed"].map((verb) => [verb, 2] as const),
  ...["assisted", "supported", "contributed", "helped", "collaborated", "coordinated", "participated"].map((verb) => [verb, 1] as const)
]);
// Line-opening nouns that share a verb's spelling.
const PRESENT_LEAD_NOUN = /^(?:head\s+count|heads[-\s]+up|create\s+react|direct\s+(?:reports?|mail|deposit|experience|feedback|messag\w*|to)|design\s+(?:reviews?|docs?|documents?|systems?|patterns?|tokens?)|build\s+(?:systems?|times?|tools?|scripts?|pipelines?|failures?)|support\s+(?:tickets?|engineers?|team|rotation|queue)|help\s+desk|leads\s+(?:from|were|are|data|pipeline|import|list))\b/i;

// A word this opens is a noun phrase, not a verb ("Builds for the iOS app",
// "Leads were routed"): read only on the current bullet and evidence.
const NOUN_FOLLOWER = /^\s+(?:for|of|and|from|in|on|at|to|with|was|were|is|are)\b/i;

// `asSupport` reads a current bullet or evidence line: only the plain form, and
// never before a preposition, conjunction or "to be" verb. Puns such as "Design
// work…" can still read as the verb (a known limit).
function presentLeadOwnership(line: string, asSupport = false): { past: string; level: number } | null {
  const clause = line.replace(/<\/?(?:b|i|u)>/gi, "").replace(/^[\s\u2022\u00b7*\-\u2013\u2014]+/, "").replace(LEAD_NOUN, " ").trimStart();
  const word = clause.match(/^([A-Z][a-z]+)(?=\s)/)?.[1]?.toLowerCase();
  if (!word || VERB_NAMED_PRODUCTS.has(word) || PRESENT_LEAD_NOUN.test(clause)) return null;
  if (asSupport && NOUN_FOLLOWER.test(clause.slice(word.length))) return null;
  for (const base of new Set(asSupport ? [word] : [word, word.replace(/es$/, ""), word.replace(/s$/, "")])) {
    if (base.length < 3) continue;
    for (const past of [IRREGULAR_PAST.get(base), base === "oversee" ? "oversaw" : undefined, `${base}ed`, `${base}d`]) {
      const level = past ? OWNERSHIP_LEVEL_BY_PAST.get(past) : undefined;
      if (past && level) return { past, level };
    }
  }
  return null;
}

const OWNERSHIP_CONTEXT_STOPWORDS = new Set([
  "and", "the", "for", "with", "that", "this", "from", "into", "across",
  "work", "worked", "working", "role", "project", "projects", "team", "teams",
  "service", "services", "system", "systems", "platform", "platforms", "tool", "tools",
  "delivery", "delivered", "build", "built", "develop", "developed", "design", "designed",
  "implement", "implemented", "manage", "managed", "lead", "led", "leading", "owned",
  "owning", "drove", "driven", "directed", "headed", "architected", "spearheaded",
  "oversaw", "orchestrated", "support", "supported", "assist", "assisted", "contributed",
  "helped", "collaborated", "coordinated", "participated", "created", "engineered"
]);

function ownershipSupportSegments(value: string): string[] {
  return value
    .split(/(?:\r?\n|[.!?]+\s+)/)
    .map((segment) => segment.replace(/^[\s\u2022\u00b7*\-]+/, "").trim())
    .filter(Boolean);
}

function ownershipSupportIsTied(targetText: string, supportText: string): boolean {
  const targetTokens = distinctiveTokenKeys(targetText, OWNERSHIP_CONTEXT_STOPWORDS);
  if (!targetTokens.length) return false;
  const supportTokens = new Set(distinctiveTokenKeys(supportText, OWNERSHIP_CONTEXT_STOPWORDS));
  const overlap = targetTokens.filter((token) => supportTokens.has(token)).length;
  return overlap >= Math.min(2, targetTokens.length) && overlap * 2 >= targetTokens.length;
}

function leadingWord(value: string): string {
  return value.replace(/<\/?(?:b|i|u)>/gi, "").replace(/^[\s\u2022\u00b7*\-]+/, "").replace(/^I\s+/, "").match(/^[A-Za-z-]+/)?.[0] ?? "";
}

const SHARED_WORK_LEAD = /^(?:assist|support|contribut|help|collaborat|coordinat|participat|partner|pair|work|join|shadow)/i;

// "Assisted engineers in migrating…" credits others; "…by automating…" is the
// candidate's own means. Bare "Supported" usually means operating something.
function assistsOthersWork(value: string): boolean {
  const lead = leadingWord(value);
  if (/\bby\s+[a-z]+ing\b/i.test(value)) return false;
  return /^(?:assist|help|contribut|participat)(?:e|es|s|ed|ing)?$/i.test(lead)
    || (/^support(?:s|ed|ing)?$/i.test(lead) && /\bin\s+[a-z]+ing\b/i.test(value));
}

// Gerunds and bare verbs before any relative clause name the shared work:
// "Assisted engineers in migrating X, which used Redis" names only migrating.
function assistedWorkVerbs(value: string): Set<string> {
  const words = value.split(/[,;]|\b(?:which|that|who|where)\b/i)[0].split(/\s+/).slice(1).map((word) => word.replace(/[^A-Za-z-]/g, ""));
  return new Set(words.filter((word) => /ing$/i.test(word) || !/(?:s|ed)$/i.test(word))
    .map(actionVerbPast).filter((past): past is string => Boolean(past)));
}

const PARTIAL_ROLE = /\b(?:team|group|squad|member|part|contributor|collaborator|participant|assistant|intern(?:ship)?|course(?:work)?|class|curriculum|bootcamp|capstone|hackathon|volunteer|on-call|engineer|developer|analyst|scientist|tester|consultant|manager|lead|specialist|administrator|technician|researcher|student|swe|sde|sre)s?\b/i;
const PARTIAL_ACTIVITY = /\b(?:knowledge|experience|understanding|background|familiarity|proficiency|exposure|documentation|testing|qa|evaluation|monitoring|support|maintenance|research|reviews?|triage|migration|sessions?|mentorship|mentors?|tutoring|contributions?|work|hotfix(?:es)?|fix(?:es)?|patch(?:es)?|cleanup|audits?|assisting|helping|supporting|shadowing|pairing|pair-programmed|mentored|under|alongside)\b/i;
const AUTHORSHIP_VERBS = new Set(["built", "created", "designed", "developed", "engineered", "implemented", "wrote"]);

// A single verbless line naming a thing ("Python CLI that imports bank CSV exports")
// presents it as the candidate's own; role, team, coursework, and activity lines do not.
// The proposal must name that thing: every distinctive word of the head phrase.
function namesHeadPhrase(proposed: string, line: string): boolean {
  const head = line.split(/\s(?:for|to|on|in|of|at|with|from|by|via|that|which|who|using|featuring|including|powered)\b|[,;:(\u2014\u2013]/i)[0];
  const named = new Set(distinctiveTokenKeys(proposed, OWNERSHIP_CONTEXT_STOPWORDS));
  const tokens = distinctiveTokenKeys(head, OWNERSHIP_CONTEXT_STOPWORDS);
  return tokens.length > 0 && tokens.every((token) => named.has(token));
}

function describesOwnWork(value: string): boolean {
  const word = leadingWord(value);
  return Boolean(word) && !/[\r\n]/.test(value) && !actionVerbPast(word) && !/(?:ly|ed|ing)$|^responsible$/i.test(word)
    && !PARTIAL_ROLE.test(value) && !PARTIAL_ACTIVITY.test(value) && !/^\S+\s+(?:of|to|on|in|for|with|at)\b/i.test(value.trim());
}

const SOLO_PROJECT = /\b(?:personal|solo|independent|individual|side|hobby)\s+project\b|\bsole\s+(?:developer|author|engineer|maintainer)\b/i;
const OTHERS_WORK = /\b(?:teams?|teammates?|group|squad|members?|contributors?|collaborators?|colleagues?|coworkers?|classmates?|friends?|brothers?|sisters?|cousins?|roommates?|partners?|peers?|mentors?|maintainers?|vendors?|contractors?|agency|upstream|third[- ]party|open[- ]source|community|assist\w*|help\w*|contribut\w*|participat\w*|collaborat\w*|pair\w*|shadow\w*|alongside|inherited|adapted|forked?|starter|templates?|tutorials?|course\w*|class|bootcamp|capstone|hackathon)\b/i;
const USE_WORDS = new Set(["use", "uses", "used", "using"]);

// Every Profile heading linked to the entry must call it a solo project
// ("## Ledger (personal project)"); one team heading leaves the entry shared.
export function declaresSoloProject(profileText: string): boolean {
  const headings = profileText.split(/\r?\n/).filter((line) => /^#{1,6}\s/.test(line));
  return /^#{1,6}\s/.test(profileText.trimStart()) && headings.every((heading) => SOLO_PROJECT.test(heading) && !OTHERS_WORK.test(heading));
}

// In a solo project, one evidence line supports an authorship verb for the thing it
// states: 80% of the claim's words come from that line and nobody else is credited.
export function soloProjectSupportsAuthorship(proposed: string, currentText: string, supportText: string): boolean {
  if (!AUTHORSHIP_VERBS.has(actionVerbPast(leadingWord(proposed)) ?? "") || ownershipStrength(proposed) !== 2
    || /\bmanaged\b/i.test(proposed) || OTHERS_WORK.test(proposed) || OTHERS_WORK.test(currentText)) return false;
  const words = (value: string) => distinctiveTokenKeys(value, OWNERSHIP_CONTEXT_STOPWORDS).filter((token) => !USE_WORDS.has(token));
  const claimed = words(proposed);
  return claimed.length >= 3 && ownershipSupportSegments(supportText).some((segment) => {
    if (OTHERS_WORK.test(segment)) return false;
    const stated = new Set(words(segment));
    return claimed.filter((token) => stated.has(token)).length >= claimed.length * 0.8;
  });
}

const CHECK_VERB_STEM = String.raw`(?:validat|verif|test|check|cover|ensur|guard|catch|confirm|exercis)`;
// "… to verify X", "… covering X" after the count; "X, covered by …" before it.
const PURPOSE_AFTER = new RegExp(String.raw`\b(?:(?:to|that|which)\s+${CHECK_VERB_STEM}(?:e|es|s|y|ies|ed)?|${CHECK_VERB_STEM}y?ing)\s+([^;.,]+)[^;.]*`, "i");
const PURPOSE_BEFORE = new RegExp(String.raw`([^;.,]+),?\s+(?:and\s+)?\b${CHECK_VERB_STEM}i?ed\s+(?:by|with|through|using|via)\s+[^;.,]*$`, "i");
const COUNT = /(?<![\w.])\d[\d,]*\+?(?![\w.]*\d)/g;

// A count keeps the scope of its own evidence line: "135 tests" plus a validation
// layer on another line is not "135 tests that verify the validation layer".
export function findCountWithUnstatedPurpose(proposed: string, evidence: string): string | null {
  const plain = proposed.replace(/<\/?(?:b|i|u)>/gi, "");
  const segments = ownershipSupportSegments(evidence);
  const counts = [...plain.matchAll(COUNT)];
  for (const [index, match] of counts.entries()) {
    const digits = match[0].replace(/[,+]/g, "");
    const lines = segments.filter((segment) => new RegExp(String.raw`(?<![\d.,])${digits}(?![\d])`).test(segment.replace(/(?<=\d),(?=\d)/g, "")));
    if (!lines.length) continue;
    // A purpose belongs to the nearest count, so the search stops at the next one.
    const after = plain.slice(match.index + match[0].length, counts[index + 1]?.index).match(PURPOSE_AFTER);
    const previous = counts[index - 1];
    const before = plain.slice(previous ? previous.index + previous[0].length : 0, match.index).match(PURPOSE_BEFORE);
    // The purpose's first item, or the whole list of them, may be what the line names.
    const named = (purpose: string) => {
      const tokens = distinctiveTokenKeys(purpose, OWNERSHIP_CONTEXT_STOPWORDS);
      return tokens.length > 0 && lines.some((line) => {
        const stated = new Set(distinctiveTokenKeys(line, OWNERSHIP_CONTEXT_STOPWORDS));
        return tokens.filter((token) => stated.has(token)).length * 2 >= tokens.length;
      });
    };
    const purposes = after ? [after[1], after[0]] : before ? [before[1]] : [];
    if (purposes.some((purpose) => distinctiveTokenKeys(purpose, OWNERSHIP_CONTEXT_STOPWORDS).length > 0) && !purposes.some(named)) return match[0];
  }
  return null;
}

export function hasUnsupportedOwnershipIncrease(
  proposed: string,
  currentText: string,
  supportText: string,
  semanticTarget = currentText || proposed,
  { presentLead = false }: { presentLead?: boolean } = {}
): boolean {
  // The proposal's own present-tense lead counts in full. On the current bullet
  // and evidence it counts only for the same verb ("Build…" supports "Built…"),
  // so a verb-shaped noun ("Direct messaging…") never stands in for another claim.
  const proposedPresent = presentLead ? presentLeadOwnership(proposed) : null;
  const proposedPast = proposedPresent?.past ?? actionVerbPast(leadingWord(proposed));
  const strength = (value: string) => {
    if (!presentLead) return ownershipStrength(value);
    const present = value === proposed ? proposedPresent : presentLeadOwnership(value, true);
    const counts = present && (value === proposed || present.past === proposedPast);
    return Math.max(ownershipStrength(value), counts ? present.level : 0);
  };
  const currentLevel = strength(currentText);
  const singleLine = !/[\r\n]/.test(currentText);
  // Claiming the assisted work itself ("Migrated…" from "Assisted … in migrating…")
  // is an increase; only evidence led by that same verb supports it.
  const assistedVerbs = singleLine && currentLevel <= 1 && assistsOthersWork(currentText) ? assistedWorkVerbs(currentText) : new Set<string>();
  const proposedLead = actionVerbPast(leadingWord(proposed));
  const claimsAssistedWork = Boolean(proposedLead && assistedVerbs.has(proposedLead) && !SHARED_WORK_LEAD.test(leadingWord(proposed)))
    && strength(proposed) < 2;
  const level = (value: string) => claimsAssistedWork && actionVerbPast(leadingWord(value)) === proposedLead
    ? Math.max(2, strength(value))
    : strength(value);
  const proposedLevel = level(proposed);
  if (proposedLevel <= currentLevel) return false;
  if (proposedLevel === 2 && currentLevel === 0 && AUTHORSHIP_VERBS.has(proposedLead ?? "")
    && describesOwnWork(currentText) && namesHeadPhrase(proposed, currentText)) return false;
  return !ownershipSupportSegments(supportText).some((segment) =>
    level(segment) >= proposedLevel
    && ownershipSupportIsTied(semanticTarget, segment)
  );
}

function normalizePhrase(text: string): string {
  return text.replace(/[-/]+/g, " ").replace(/\brestful\b/gi, "rest");
}

// Token set for a corpus string: boundary periods freed (see stripBoundaryDots
// below) then split into [a-z0-9.#+] tokens. Both the JD and the grounding
// corpus repeat across one request's grounding checks (identical multi-KB
// strings every time), and isTermGrounded
// re-tokenizes the same grounding corpus once per hit. Memoize on the raw string
// with a tiny FIFO-evicted cache: corpora are per-request strings, so 4 entries
// covers the JD + a couple of grounding variants in flight without the cache
// growing unbounded. Callers pass the corpus PRE-LOWERCASED (the documented
// contract), so the key is the exact string the caller already holds.
// Only corpus arguments route through here — the per-call proposedText/term
// tokenization varies every call and is deliberately NOT memoized.
const TOKENIZE_CACHE_MAX = 4;
const tokenizeCache = new Map<string, Set<string>>();
function tokenize(corpus: string): Set<string> {
  const cached = tokenizeCache.get(corpus);
  if (cached) return cached;
  const tokens = new Set(stripBoundaryDots(corpus).match(/[a-z0-9.#+]+/g) ?? []);
  tokenizeCache.set(corpus, tokens);
  if (tokenizeCache.size > TOKENIZE_CACHE_MAX) {
    // FIFO eviction: drop the oldest inserted key (Map preserves insertion order).
    // size > MAX proves at least one key exists, so keys().next().value is a string.
    tokenizeCache.delete(tokenizeCache.keys().next().value!);
  }
  return tokens;
}

// The token regex keeps '.' (so node.js / .net survive), which means a
// sentence-final token glues its period: "C#." -> "c#.". Free a boundary period
// (followed by whitespace or end) into a space before tokenizing so a short
// token at a sentence end still matches the bare SHORT_TECH_TOKENS form — while
// internal periods (node.js, .net) stay intact. Mirrors keywords.ts includesKeyword.
function stripBoundaryDots(text: string): string {
  return text.replace(/\.(?=\s|$)/g, " ");
}

// Common shorthand families where the long and short forms are the SAME
// technology — the only prefix pairs allowed to ground each other.
const TOKEN_ALIASES = new Map([
  ["postgres", "postgresql"], ["postgresql", "postgres"],
  ["k8s", "kubernetes"], ["kubernetes", "k8s"],
  ["js", "javascript"], ["javascript", "js"],
  ["ts", "typescript"], ["typescript", "ts"],
  ["rest", "restful"], ["restful", "rest"]
]);

// Pure inflectional suffixes: grammatical variants of the same word.
const INFLECTION_SUFFIX = /^(?:s|es|ed|d|ing|ized|ised|izing|ization)$/;

// Single-word terms match token-anchored, never by substring: exact token,
// a known alias pair, or one token being the other plus a pure inflectional
// suffix (container/containerized, test/testing). Prefix false-friends are
// rejected — JavaScript must NOT ground "Java", "reactive" must NOT ground
// "React", "graph" must NOT ground "GraphQL". Multi-word terms match as a
// hyphen/slash-normalized phrase.
function isGrounded(groundingText: string, groundingTokens: Set<string>, term: string): boolean {
  // Decide phrase-vs-token on the NORMALIZED term, not raw `term.includes(" ")`.
  // normalizePhrase turns hyphens/slashes into spaces, so "real-time", "ci/cd",
  // "event-driven", and "cloud-native" become multi-word phrases. The token loop
  // below can never ground them: groundingTokens split on hyphen/slash, so
  // "real-time" tokenizes to "real"+"time" and the single term "real-time" would
  // match no token — silently dropping an honest suggestion whose term is right
  // there in the resume. Matching the normalized phrase against the normalized
  // corpus fixes that (and matches this module's documented "hyphen/slash-
  // normalized phrase" contract).
  const phrase = normalizePhrase(term);
  if (phrase.includes(" ")) {
    const corpus = normalizePhrase(groundingText);
    // "code reviews" matches "code review"; short last words ("ECS", "APIs") never lose their s.
    return corpus.includes(phrase)
      || (/[a-z]{4,}s$/i.test(phrase) && new RegExp(`${phrase.slice(0, -1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`, "i").test(corpus));
  }
  for (const token of groundingTokens) {
    if (token === term) return true;
    if (TOKEN_ALIASES.get(term) === token) return true;
    if (token.startsWith(term) && INFLECTION_SUFFIX.test(token.slice(term.length))) return true;
    if (term.startsWith(token) && INFLECTION_SUFFIX.test(term.slice(token.length))) return true;
  }
  return false;
}

function isConceptGrounded(groundingText: string, groundingTokens: Set<string>, term: string): boolean {
  return isGrounded(groundingText, groundingTokens, term) || Boolean(CONCEPT_EVIDENCE.get(term)?.test(groundingText));
}

// isTermGrounded, also counting specific evidence for a concept (ARIA labels → accessibility).
export function isConceptTermGrounded(term: string, grounding: string): boolean {
  return isTermGrounded(term, grounding) || Boolean(CONCEPT_EVIDENCE.get(term.toLowerCase())?.test(grounding));
}

// Returns the first ungrounded JD term found in proposedText, or null.
// All inputs are matched case-insensitively; `jobLower` and `grounding` must
// already be lower-cased by the caller.
//
// options.proseMode — for free-form prose surfaces (cover letter, application
// answers) where naming the target company/role/product FROM the JD is expected
// and legitimate. It skips detector 1 (which flags every capitalized JD token,
// company and role names included) and relies on the curated tech-skill lexicons
// (detectors 2-4) instead, so "excited about Acme's roadmap" is NOT flagged while
// "I have Kubernetes/Terraform/ML experience" still is. Resume-field rewrites
// leave it off and run all detectors.
export function findUngroundedJdTerm(
  proposedText: unknown,
  jobLower: string,
  grounding: string,
  options: { proseMode?: boolean; jobText?: string } = {}
): string | null {
  if (!jobLower) return null;
  const proseMode = Boolean(options.proseMode);
  const markStripped = String(proposedText ?? "").replace(/<\/?(?:b|i|u)>/gi, " ");
  const proposedLower = markStripped.toLowerCase();
  // Boundary periods are freed before tokenizing (see stripBoundaryDots) so a
  // sentence-final "C#."/"ML." still produces the bare "c#"/"ml" token, for both
  // the lexicon sweeps below AND the grounding corpus that must ground them.
  // grounding + jobLower are invariant corpora across repeated checks, so
  // they route through the memoized tokenize(); proposedTokens varies per call
  // and is tokenized fresh.
  const groundingTokens = tokenize(grounding);
  // Token sets used by the bounded lexicon sweeps (detectors 3-4). Matching is
  // token-anchored (set membership) on BOTH the JD and the proposed text,
  // never substring, so "java" cannot match inside "javascript" — the same
  // discipline as isGrounded.
  const proposedTokens = new Set(stripBoundaryDots(proposedLower).match(/[a-z0-9.#+]+/g) ?? []);
  const jobTokens = tokenize(jobLower);

  // Detector 1: capitalized tokens of 3+ chars, including a non-verb first
  // word. Distinctive short tokens (C#, ML, NLP) are picked up by detector 4;
  // the rest are out of scope here — substring checks at 1-2 chars are too noisy.
  // Skipped in proseMode: it flags every capitalized JD token (company/role names
  // included), which is exactly what legitimate cover-letter/answer prose says.
  if (!proseMode) {
    for (const match of markStripped.matchAll(/\b[A-Z][A-Za-z0-9.+#]{2,}\b/g)) {
      const token = match[0].toLowerCase();
      if (!jobLower.includes(token)) continue;
      // Unless the posting uses that word as a name ("experience with Index").
      if (isSentenceInitialVerb(markStripped, match.index ?? 0, match[0]) && !jobNamesWord(options.jobText ?? "", match[0])) continue;
      if (!isConceptGrounded(grounding, groundingTokens, token)) return match[0];
    }
  }

  // Detector 2: lowercase concept terms present in both the JD and the
  // proposed text but absent from the grounding corpus.
  for (const concept of LOWERCASE_TECH_CONCEPTS) {
    const whole = conceptPattern(concept);
    if (!whole.test(proposedLower)) continue;
    if (!whole.test(jobLower)) continue;
    if (!isConceptGrounded(grounding, groundingTokens, concept)) return concept;
  }

  // Detector 3: bounded lexicon sweep. Only names in the curated
  // LOWERCASE_TOOL_NAMES set are ever candidates, so no ordinary English word
  // can be flagged. A name is flagged only when it is a real token in BOTH the
  // JD and the proposed text yet absent from the grounding corpus — closing the
  // gap where a lowercase product/tool name not in the detector-2 concept
  // lexicon (terraform, snowflake, airflow) evaded detector 1's [A-Z]-initial
  // requirement. Routed through the SAME isGrounded helper, so aliases/
  // inflections still ground and false-friends (Java/JavaScript, React/reactive)
  // are still rejected.
  for (const name of LOWERCASE_TOOL_NAMES) {
    if (!jobTokens.has(name)) continue;
    if (!proposedTokens.has(name)) continue;
    if (!isConceptGrounded(grounding, groundingTokens, name)) return name;
  }

  // Detector 4: distinctive short tech tokens (C#, C++, ML, NLP) below detector
  // 1's 3-char floor. Token-anchored set membership on BOTH the JD and the
  // proposed text, routed through isGrounded — identical discipline to detector 3,
  // so no ordinary word is ever a candidate (the set excludes collision-prone
  // short tokens). Runs in prose mode too: these are unambiguous skill tokens.
  for (const token of SHORT_TECH_TOKENS) {
    if (!jobTokens.has(token)) continue;
    if (!proposedTokens.has(token)) continue;
    if (!isGrounded(grounding, groundingTokens, token)) return token;
  }

  return null;
}

// Whole-word concept matching: "etl" must not match inside "quietly".
const CONCEPT_PATTERNS = new Map<string, RegExp>();
function conceptPattern(concept: string): RegExp {
  let pattern = CONCEPT_PATTERNS.get(concept);
  if (!pattern) {
    pattern = new RegExp(`(?<![a-z0-9])${concept.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:e?s)?(?![a-z0-9])`);
    CONCEPT_PATTERNS.set(concept, pattern);
  }
  return pattern;
}

// After a lowercase word ("experience with Boost") or inside "C++/Boost" a capitalized
// word is a name; after a heading comma ("Engineer, Build and Release") it is not.
function jobNamesWord(jobText: string, word: string): boolean {
  return new RegExp(String.raw`(?:(?:^|[\s(])[a-z][a-z0-9+#.-]*\s+|[/(]\s*)${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\b`).test(jobText);
}

// General claim-term gate for resume-field rewrites. The JD-specific gate above
// catches keyword stuffing, but an invented metric/tool/employer that is NOT in
// the JD must not become invisible to sanitization. This companion checks the
// same curated concepts/tools/short tokens plus capitalized proper-claim tokens
// without requiring the term to appear in the JD. It deliberately remains a
// conservative lexical backstop, not a semantic verifier: ordinary lowercase
// rephrasing is left to the evidence + numeric gates and human review.
export function findUngroundedClaimTerm(proposedText: unknown, grounding: unknown): string | null {
  const groundingLower = String(grounding ?? "").toLowerCase();
  const groundingTokens = tokenize(groundingLower);
  const markStripped = String(proposedText ?? "").replace(/<\/?(?:b|i|u)>/gi, " ");

  for (const match of markStripped.matchAll(/\b[A-Z][A-Za-z0-9.+#]{2,}\b/g)) {
    const token = match[0].toLowerCase();
    if (isConceptGrounded(groundingLower, groundingTokens, token)) continue;
    if (!isSentenceInitialVerb(markStripped, match.index ?? 0, match[0])) return match[0];
  }
  return findUngroundedCuratedClaimTerm(proposedText, grounding);
}

// Curated-only companion to findUngroundedClaimTerm. Extraction surfaces such
// as Job analysis legitimately paraphrase ordinary prose, so treating every new
// capitalized word as a factual claim would false-drop useful duties. Concrete
// technology concepts, branded tools, and distinctive short tech tokens are a
// narrower class: if one appears in model-authored extraction prose, it must be
// present in the source posting. Keeping this helper beside the owning lexicons
// avoids a second, inevitably drifting technology list in jobAnalysis.ts.
export function curatedClaimTerms(value: unknown): string[] {
  const text = String(value ?? "").replace(/<\/?(?:b|i|u)>/gi, " ").toLowerCase();
  const tokens = new Set(stripBoundaryDots(text).match(/[a-z0-9.#+]+/g) ?? []);
  return [...new Set([
    ...LOWERCASE_TECH_CONCEPTS.filter((concept) => conceptPattern(concept).test(text)),
    ...[...SHORT_TECH_TOKENS, ...LOWERCASE_TOOL_NAMES, ...SHORT_TOOL_TOKENS].filter((term) => tokens.has(term))
  ])];
}

export function findUngroundedCuratedClaimTerm(proposedText: unknown, grounding: unknown): string | null {
  const groundingLower = String(grounding ?? "").toLowerCase();
  const groundingTokens = tokenize(groundingLower);
  return curatedClaimTerms(proposedText).find((term) => !isConceptGrounded(groundingLower, groundingTokens, term)) ?? null;
}

// Fit uses named tools without requiring literal wording for broader concepts.
export function findUngroundedToolClaimTerm(proposedText: unknown, grounding: unknown): string | null {
  const groundingLower = String(grounding ?? "").toLowerCase();
  const groundingTokens = tokenize(groundingLower);
  const proposedLower = String(proposedText ?? "").replace(/<\/?(?:b|i|u)>/gi, " ").toLowerCase();
  const proposedTokens = new Set(stripBoundaryDots(proposedLower).match(/[a-z0-9.#+]+/g) ?? []);
  for (const name of LOWERCASE_TOOL_NAMES) {
    if (proposedTokens.has(name) && !isGrounded(groundingLower, groundingTokens, name)) return name;
  }
  for (const token of SHORT_TOOL_TOKENS) {
    if (proposedTokens.has(token) && !isGrounded(groundingLower, groundingTokens, token)) return token;
  }
  return null;
}

function isProseSentenceStart(text: string, index: number): boolean {
  const prefix = text.slice(0, index);
  // Beginning of the response, a new line, or the first word after terminal
  // punctuation (with optional closing quotes/brackets) is ordinary sentence
  // capitalization, not evidence of a proper-name claim by itself.
  return /(?:^|[.!?]["')\]]*\s+|[\r\n]\s*)$/.test(prefix);
}

// evidence: what grounds the claim when it differs from the claim's own forms ("2x"
// grounds "doubled"). needsObject: the verb states a result only before a measure or
// an outcome noun ("raised coverage to 85%", not "raised concerns").
type OutcomeClaimFamily = Readonly<{
  label: string;
  pattern: RegExp;
  evidence?: RegExp;
  needsObject?: boolean;
}>;

// A multiplier's base form is a verb only after "to" or "help" ("helped double revenue");
// "double precision", "a double major", "double-checked", and "doubled as" claim nothing.
const MULTIPLIER_ADJECTIVE_NOUNS = String.raw`precision|digits?|quotes?|clicks?|entry|spac\w*|check\w*|counting|booking|majors?|minors?|shifts?|duty|degrees?|time|down|up|as`;
const multiplierVerb = (stem: string, base: string) =>
  new RegExp(String.raw`\b${stem}(?:ed|es|ing)\b(?!-|\s+(?:as|down|up)\b)|(?<=\b(?:to|help(?:ed|s|ing)?(?:\s+[a-z]+){0,2}?)\s+)${base}\b(?!-|\s+(?:${MULTIPLIER_ADJECTIVE_NOUNS})\b)`, "i");
// The result as a factor ("2x", "two-fold", "twice as"; not "2x AWS Certified") or a percent rise.
const multiplierEvidence = (stem: string, base: string, factor: number, word: string, times: string, percent: number) =>
  new RegExp(String.raw`${multiplierVerb(stem, base).source}|\b${factor}(?:\.0)?\s?[x×](?![a-z])(?!\s*(?:aws|gcp|azure|certified|certifications?|winner|champion|awards?|hackathon)\b)|\b(?:${word}|${factor})[- ]?fold\b|\b${times}\s+(?:as|the|more|faster|higher)\b|\b${percent}\s?%\s+(?:increase|more|higher|growth|gain|faster)\b|\b(?:grew|grow|rose|increased|increasing|up|jumped|boosted|raised)(?:\s+[a-z]+){0,3}?(?:\s+by)?\s+${percent}\s?%`, "i");
// A cut by half or a 50% reduction ("reduced build times 50%"), never a 50% increase.
const HALVING_EVIDENCE = /\bhalv(?:ed|es|ing)\b(?!-)|\b(?:in|by) half\b|\b(?:cut(?:s|ting)?|reduc(?:e|es|ed|ing)|lower(?:s|ed|ing)?|dropp?(?:s|ed|ing)?|decreas(?:e|es|ed|ing)|slash(?:es|ed|ing)?|trimm?(?:s|ed|ing)?|shr(?:ank|unk|inking)|fell|down)\b[^.;\n]{0,40}?\b50\s?%|\b50\s?%\s+(?:fewer|less|lower|reduction|cut|drop|decrease|faster|smaller|cheaper|shorter)\b/i;

// Ordinary-English achievement claims need their own grounding backstop. The
// technology/proper-name and numeric gates cannot see an invented outcome such
// as "prevented outages" or "protected revenue" because every word is common
// prose. Keep this list focused on result-bearing verbs/nouns rather than broad
// resume action verbs such as built/implemented/developed, which are routinely
// used for faithful paraphrases.
const OUTCOME_VERB_FAMILIES: readonly OutcomeClaimFamily[] = Object.freeze([
  { label: "accelerate", pattern: /\baccelerat(?:e|es|ed|ing)\b/i },
  { label: "achieve", pattern: /\bachiev(?:e|es|ed|ing)\b/i },
  { label: "avoid", pattern: /\bavoid(?:s|ed|ing)?\b/i },
  { label: "boost", pattern: /\bboost(?:s|ed|ing)?\b/i },
  { label: "cut", pattern: /\bcuts?\b|\bcutting\b/i },
  { label: "decrease", pattern: /\bdecreas(?:e|es|ed|ing)\b/i },
  { label: "double", pattern: multiplierVerb("doubl", "double"), evidence: multiplierEvidence("doubl", "double", 2, "two", "twice", 100) },
  { label: "drop", pattern: /\bdrop(?:s|ped|ping)?\b/i, needsObject: true },
  { label: "eliminate", pattern: /\beliminat(?:e|es|ed|ing)\b/i },
  { label: "enable", pattern: /\benabl(?:e|es|ed|ing)\b/i },
  { label: "generate", pattern: /\bgenerat(?:e|es|ed|ing)\b/i },
  // "growing" is frequently an adjective ("a growing customer base"), so
  // keep this family to unambiguous past/result forms.
  { label: "grow", pattern: /\bgrew\b|\bgrown\b/i },
  { label: "halve", pattern: /\bhalv(?:ed|ing)\b(?!-)|(?<=\b(?:to|help(?:ed|s|ing)?)\s+)halve\b/i, evidence: HALVING_EVIDENCE },
  // "halves" and "slashes" are also plural nouns ("two halves", "trailing slashes").
  { label: "halve", pattern: /(?<!\b(?:two|three|the|both|its|their|into|in|of)\s+)\bhalves\b(?!\s+of\b)/i, evidence: HALVING_EVIDENCE, needsObject: true },
  { label: "improve", pattern: /\bimprov(?:e|es|ed|ing)\b/i },
  { label: "increase", pattern: /\bincreas(?:e|es|ed|ing)\b/i },
  { label: "lift", pattern: /\blift(?:s|ed|ing)?\b/i, needsObject: true },
  { label: "lower", pattern: /\blower(?:s|ed|ing)?\b/i },
  // "to minimize dropped messages" is a purpose; "(helped) minimize downtime" is a result.
  { label: "maximize", pattern: /\bmaximi[sz](?:es|ed|ing)\b|(?<=\bhelp(?:ed|s|ing)?\s+(?:to\s+)?)maximi[sz]e\b|(?<!\bto\s+)\bmaximi[sz]e\b/i, evidence: /\bmaximi[sz](?:e|es|ed|ing)\b/i },
  { label: "minimize", pattern: /\bminimi[sz](?:es|ed|ing)\b|(?<=\bhelp(?:ed|s|ing)?\s+(?:to\s+)?)minimi[sz]e\b|(?<!\bto\s+)\bminimi[sz]e\b/i, evidence: /\bminimi[sz](?:e|es|ed|ing)\b/i },
  { label: "prevent", pattern: /\bprevent(?:s|ed|ing)?\b/i },
  { label: "protect", pattern: /\bprotect(?:s|ed|ing)?\b/i },
  { label: "quadruple", pattern: multiplierVerb("quadrupl", "quadruple"), evidence: multiplierEvidence("quadrupl", "quadruple", 4, "four", "four times", 300) },
  { label: "raise", pattern: /\brais(?:e|es|ed|ing)\b/i, needsObject: true },
  { label: "reduce", pattern: /\breduc(?:e|es|ed|ing)\b/i },
  { label: "save", pattern: /\bsav(?:e|es|ed|ing)\b/i },
  { label: "shorten", pattern: /\bshorten(?:s|ed|ing)?\b/i },
  { label: "shrink", pattern: /\bshr(?:ink|inks|ank|unk|inking)\b/i, needsObject: true },
  { label: "slash", pattern: /\bslash(?:ed|ing)\b(?!-)|(?<=\b(?:to|help(?:ed|s|ing)?)\s+)slash\b(?!-)/i },
  { label: "slash", pattern: /(?<!\b(?:two|the|forward|back|trailing|leading|double|with|and|of)\s+)\bslashes\b/i, needsObject: true },
  { label: "strengthen", pattern: /\bstrengthen(?:s|ed|ing)?\b/i },
  { label: "streamline", pattern: /\bstreamlin(?:e|es|ed|ing)\b/i },
  { label: "trim", pattern: /\btrim(?:s|med|ming)?\b/i, needsObject: true },
  { label: "triple", pattern: multiplierVerb("tripl", "triple"), evidence: multiplierEvidence("tripl", "triple", 3, "three", "three times", 200) }
]);

const OUTCOME_NOUN_FAMILIES: readonly OutcomeClaimFamily[] = Object.freeze([
  { label: "adoption", pattern: /\badoption\b/i },
  { label: "availability", pattern: /\bavailability\b/i },
  { label: "churn", pattern: /\bchurn\b/i },
  { label: "conversion", pattern: /\bconversions?\b/i },
  { label: "cost", pattern: /\bcosts?\b/i },
  { label: "defect", pattern: /\bdefects?\b/i },
  { label: "downtime", pattern: /\bdowntime\b/i },
  { label: "efficiency", pattern: /\befficien(?:cy|cies)\b/i },
  { label: "error", pattern: /\berrors?\b/i },
  { label: "incident", pattern: /\bincidents?\b/i },
  { label: "latency", pattern: /\blatency\b/i },
  { label: "loss", pattern: /\bloss(?:es)?\b/i },
  { label: "outage", pattern: /\boutages?\b/i },
  { label: "performance", pattern: /\bperformance\b/i },
  { label: "profit", pattern: /\bprofits?\b/i },
  { label: "reliability", pattern: /\breliability\b/i },
  { label: "retention", pattern: /\bretention\b/i },
  { label: "revenue", pattern: /\brevenue\b/i },
  { label: "risk", pattern: /\brisks?\b/i },
  { label: "satisfaction", pattern: /\bsatisfaction\b/i },
  { label: "saving", pattern: /\bsavings?\b/i },
  { label: "throughput", pattern: /\bthroughput\b/i }
]);

function proseOutcomeIsCandidateClaim(sentence: string): boolean {
  const firstWord = sentence.trimStart().match(/^[A-Za-z]+/)?.[0]?.toLowerCase() ?? "";
  return /\b(?:i|me|my|we|us|our)\b/i.test(sentence)
    || LEADING_ACTION_VERBS.has(firstWord)
    || OUTCOME_VERB_FAMILIES.some(({ pattern }) => pattern.test(sentence.trimStart().split(/\s+/, 1)[0] ?? ""));
}

// A modal or intent verb anywhere earlier in the clause makes the outcome an offer,
// not a record: "would allow me to contribute to ... improving platform reliability".
function outcomeAttributionIsConditional(sentence: string, index: number): boolean {
  const clausePrefix = sentence.slice(0, index).split(/[,;]\s+|\s+(?:that|which|who)\s+/).at(-1) ?? "";
  return /\b(?:would|could|can|will|might)\b[^.;!?]*$/i.test(clausePrefix)
    || /\bmay\b[^.;!?]*$/.test(clausePrefix)
    || /\b(?:aim|hope|plan|seek|intend|want|wish|eager)(?:s|ed|ing)?\s+to\b[^.;!?]*$/i.test(clausePrefix)
    || /(?:['’]d\s+(?:like|love|want|hope)|\b(?:excited|ready|thrilled|keen|glad|happy|love|like))\s+to\b[^.;!?]*$/i.test(clausePrefix);
}

// "LLM-enabled features" or "cost-aware" is a compound adjective, not a claimed result.
function standaloneOutcomeMatch(pattern: RegExp, sentence: string): { index: number; end: number } | null {
  for (const match of sentence.matchAll(new RegExp(pattern.source, "gi"))) {
    const index = match.index ?? 0;
    if (index > 0 && sentence[index - 1] === "-" && !/\b(?:re|pre|un|de|co)-$/i.test(sentence.slice(0, index))) continue;
    if (/^\s+out\s+of\b/i.test(sentence.slice(index + match[0].length))) continue;
    return { index, end: index + match[0].length };
  }
  return null;
}

// A measure or result noun later in the clause ("raised coverage to 85%"); a raised or
// dropped problem ("raised concerns", "drop malicious traffic") is no result.
const RAISED_OR_DROPPED_NOUNS = new Set(["risk", "incident", "outage", "error", "defect", "loss"]);
function outcomeObjectFollows(sentence: string, end: number, problemsCount = false): boolean {
  const clause = sentence.slice(end).split(/[,;:]|\b(?:and|but|while|which|that|who|so|when|whenever|if|after|before|until|once)\b/i)[0]
    // "performance risks" or "latency concerns" are what was raised, not a result.
    .replace(/\b[\w-]+\s+(?:risks?|issues?|concerns?|questions?|flags?|alerts?|tickets?|bugs?)\b/gi, " ");
  return /\d\s*(?:%|x\b|percent)|\b(?:by|to)\s+[~$€£]?\d|\bfrom\s+[~$€£]?\d[^,;]*?\bto\s+[~$€£]?\d|\b(?:dozens|hundreds|thousands|millions|billions)\b|\b(?:coverage|sales|engagement|speed|uptime|signups?|productivity)\b/i.test(clause)
    || OUTCOME_NOUN_FAMILIES.some(({ label, pattern }) => (problemsCount || !RAISED_OR_DROPPED_NOUNS.has(label)) && pattern.test(clause));
}

// Returns the first unsupported ordinary-language achievement family. Resume
// rewrites use the strict default. Free-form cover/application prose opts into
// candidateProse so target-company statements and future/conditional intent are
// not mistaken for claims about work the candidate already performed.
export function findUngroundedOutcomeClaim(
  text: unknown,
  grounding: unknown,
  options: { candidateProse?: boolean } = {}
): string | null {
  const plain = String(text ?? "").replace(/<\/?(?:b|i|u)>/gi, " ");
  const source = String(grounding ?? "");
  if (!plain.trim()) return null;

  for (const sentence of plain.split(/(?:[.!?]+\s+|[\r\n]+)/)) {
    if (!sentence.trim()) continue;
    if (options.candidateProse && !proseOutcomeIsCandidateClaim(sentence)) continue;

    let factualOutcomeVerb = false;
    for (const family of OUTCOME_VERB_FAMILIES) {
      const match = standaloneOutcomeMatch(family.pattern, sentence);
      if (!match || outcomeAttributionIsConditional(sentence, match.index)) continue;
      if (family.needsObject && !outcomeObjectFollows(sentence, match.end, family.label === "halve" || family.label === "slash")) continue;
      factualOutcomeVerb = true;
      if (!family.pattern.test(source) && !family.evidence?.test(source)) return family.label;
    }
    if (!factualOutcomeVerb) continue;
    for (const family of OUTCOME_NOUN_FAMILIES) {
      const match = standaloneOutcomeMatch(family.pattern, sentence);
      if (!match || outcomeAttributionIsConditional(sentence, match.index)) continue;
      if (!family.pattern.test(source)) return family.label;
    }
  }
  return null;
}

const PROPER_SUBJECT_CLAIM_VERBS = new Set([
  "is", "was", "has", "had", "led", "built", "launched", "offers", "offered", "develops", "developed",
  "creates", "created", "designs", "designed", "delivers", "delivered", "manages", "managed", "owns", "owned",
  "operates", "operated", "provides", "provided", "produces", "produced", "founded", "acquired", "maintains",
  "maintained", "supports", "supported", "implements", "implemented", "transformed", "achieved", "reduced",
  "increased", "grew", "scaled", "deployed", "migrated", "introduced", "invented", "runs", "ran", "works",
  "specializes", "focuses", "serves"
]);

function sentenceLeadingTokenActsAsEntitySubject(text: string, endIndex: number): boolean {
  // Entity-subject claims put the predicate immediately after the name:
  // "Fabricated led/built/launched/offers ...". Skip only lightweight
  // punctuation between them; a general adverbial starter such as "Over the
  // past..." or "Additionally, I..." has a non-claim next word and is grammar.
  const next = text.slice(endIndex).match(/^[\s,:;—-]*([A-Za-z]+)/)?.[1]?.toLowerCase() ?? "";
  return PROPER_SUBJECT_CLAIM_VERBS.has(next);
}

// ---------------------------------------------------------------------------
// Affiliation claims: a workplace or school the candidate claims. The explicit, role,
// and bare "at"/"for" frames are specified in AGENTS.md ("Numbers, outcomes, and workplaces").

// A run of capitalized words ("Bank of America", "O'Neil Labs", "eBay") that ends at a possessive.
const AFFILIATION_WORD = String.raw`(?:\p{Lu}|\p{Ll}(?=\p{Lu}))[\p{L}\p{N}.&-]*(?:['’](?![sS]?(?![\p{L}\p{N}]))[\p{L}\p{N}.&-]+)*`;
const AFFILIATION_NAME = new RegExp(String.raw`(?<![\p{L}\p{N}])(?!(?:At|As|In|For|With|While|Back|Before|After|During|Since|The|My|Our|I|We)\b)${AFFILIATION_WORD}(?:[ \t]+(?:(?:of|&)[ \t]+)?(?!(?:I|We|My|Our|In|At|For|With|And|But|As|The|To|On|By)\b)${AFFILIATION_WORD})*(?:['’][sS]?(?![\p{L}\p{N}]))?`, "gu");
// Names coordinated before this one ("at Beta Corp and Stripe", "at both Stripe, Plaid, and") share its frame.
const COORDINATED_BEFORE = new RegExp(String.raw`(?:${AFFILIATION_WORD}(?:,\s*|\s+)(?:(?:and|or|&)\s+)?)+$`, "u");
const COORDINATED_AFTER = new RegExp(String.raw`^(?:\s*,\s*(?:(?:and|or|&)\s+)?|\s+(?:and|or|&)\s+)(?!(?:I|We)\b)${AFFILIATION_WORD}(?:[ \t]+${AFFILIATION_WORD})*`, "u");
const EXPLICIT_AFFILIATION = /(?:\b(?:while|back|previously|formerly|earlier)\s+(?:at|with)|\b(?:interned|interning)\s+(?:at|with|for)|\b(?:worked|employed)\s+(?:at|for|by)|\b(?:studied|studying)\s+at|\bmy\s+(?:[\w-]+\s+){0,2}?(?:time|years?|months?|tenure|stint|role|job|internship|days|studies)\s+(?:at|with)|\b(?:joined|attended|(?:co-?)?founded|(?:graduated|graduating)\s+from|graduate\s+of|alumn(?:us|a|i|ae)?\s+of|alum\s+of)|\b(?:degree|diploma|bachelor['’]?s|master['’]?s|associate['’]?s|mba|bba|ph\.?d\.?|doctorate|b\.?sc?\.?|m\.?sc?\.?|b\.?a\.?|m\.?a\.?|b\.?eng\.?|m\.?eng\.?)(?![a-z])[^;!?]{0,40}?\b(?:from|at))\s+(?:the\s+)?$/i;
// "a Stanford graduate", "Stripe, where I built…", "my former employer, Stripe".
const EXPLICIT_AFFILIATION_SUFFIX = /^(?:['’]s?)?\s+(?:graduate|grad|alum(?:nus|na|ni|nae)?)\b|^,\s+where\s+(?:I|we)\s+(?!would\b|will\b|could\b|['’])/i;
const EXPLICIT_AFFILIATION_APPOSITIVE = /\b(?:former|previous|last|old)\s+(?:employer|company|job|school|university|college)\s*,\s*$/i;
const ROLE_NOUNS = String.raw`engineer|developer|intern|employee|contractor|consultant|designer|analyst|scientist|manager|hire`;
const ROLE_AFFILIATION = /(?:\bas\s+(?:a|an|the)\s+(?:[\w'’-]+\s+){0,4}?(?:at|for|with)|\b(?:engineer|developer|intern|contractor|consultant|freelancer|designer|analyst|scientist|manager|lead|architect|researcher|student|fellow|employee)s?\s+(?:at|for|with)|\b(?:work|works|working|currently|was|were)\s+(?:at|for))\s+(?:the\s+|both\s+)?$/i;
const ROLE_NOUN_AFTER = new RegExp(String.raw`^\s+(?:[\w-]+\s+){0,2}(?:${ROLE_NOUNS})s?\b`, "i");
const PLACE_AFFILIATION = /\b(?:at|for)\s+(?:the\s+|both\s+|either\s+)?$/i;
// A talk or demo at a conference is an event, not a workplace; so is a named event.
const EVENT_BEFORE = /\b(?:presented|presenting|spoke|speaking|talked|demoed|exhibited|lectured)\b[^,;.!?]*$/i;
const EVENT_NAME = /(?:Con|Conference|Summit|Celebration|Expo|Meetup|Hackathon|Festival|Week|Forum|Workshop|Symposium|Camp|Fair|Day|Talks?)$/;
// Someone else's workplace: "My sister, an engineer at Stripe".
const OTHER_PERSON = /\b(?:my|his|her|their|our)\s+(?:sister|brother|friend|mentor|manager|colleague|partner|father|mother|parent|wife|husband|cousin|uncle|aunt|classmate|roommate|son|daughter)\b[^.;!?]*$/i;
const AFFILIATION_CLAUSE_BREAK = /[,;:]|\b(?:and|but|which|that|while|so|because|where|who|whereas|though|although)\b/i;
const AFFILIATION_INTENT = /\b(?:would|could|can|will|might|should|want|wants|hope|hoping|plan|aim|eager|excited|seek|seeking|join|joining|forward)\b|\b(?:love|like)\s+to\b|['’](?:d|ll)\b/i;
const PAST_STATE = /\b(?:was|were|had|spent|spoke|wrote|ran|made|took|gave|taught|held|kept|met|won|began|sold|brought|drove|did)\b/i;
const NOT_PAST_ADJECTIVES = new Set(["interested", "excited", "based", "focused", "skilled", "experienced", "motivated", "dedicated", "detailed", "advanced", "related", "needed", "required", "preferred", "distributed", "automated", "impressed", "inspired", "drawn", "struck", "pleased", "thrilled", "amazed"]);
// Words that may follow a name without making it a modifier ("at Stripe for four years").
const AFTER_NAME_FREE = /^(?:for|of|to|in|on|at|by|with|from|as|and|or|but|during|since|until|where|when|while|which|who|that|then|before|after|over|across|through|between|alongside|i|we|[a-z]+ing|[a-z]+ly)$/;
// "Boston College" is not "Boston University", but "Stanford University" is "Stanford".
const INSTITUTION_KINDS = /\b(?:university|college|institute|school|polytechnic|academy|seminary|conservatory)\b/gi;
const AFFILIATION_GENERIC_WORDS = new Set(["university", "college", "institute", "school", "polytechnic", "academy", "inc", "corp", "corporation", "llc", "ltd", "labs", "lab", "technologies", "technology", "group", "company", "co", "of", "the", "&"]);
// Dates, holidays, and departments ("dashboards for Finance and Operations") are not workplaces.
const NOT_AFFILIATION_NAMES = /^(?:Q[1-4]|January|February|March|April|May|June|July|August|September|October|November|December|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Christmas|Thanksgiving|Easter|Halloween|Hanukkah|New Year|Black Friday|Cyber Monday|Finance|Operations|Ops|Product|Support|Sales|Marketing|Engineering|Legal|HR|Design|Data|Security|Compliance|Accounting|Research|IT|Customer Success|Customer Support|People|Inc|LLC|Ltd|Corp|Co|GmbH|PLC|LLP)$/;

type AffiliationClaim = { name: string; index: number; end: number };

const affiliationKey = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
// "Harbor, Inc." and "Harbor Labs" are Harbor; "Harbor Freight" is another company.
const employerKey = (value: string) => affiliationKey(value).replace(/(?:\s+(?:inc|llc|ltd|corp|corporation|co|company|labs?|technologies|technology|group|hq))+$/, "");

// A past action or a first-person present one ("I build APIs at Stripe") reports work; feelings do not.
const FIRST_PERSON_PRESENT_ACTION = /\b(?:I|[Ww]e)\s+(?:currently\s+|now\s+)?(?!(?:am|are|was|were|would|could|should|will|can|may|might|want|hope|plan|love|like|think|believe|admire|appreciate|enjoy|look|feel|see|know|wish|aim|read|follow|hear|notice|learn|watch|meet)\b)[a-z]+(?<!ed)\b/;
function clauseHasPastAction(clause: string): boolean {
  return PAST_STATE.test(clause) || FIRST_PERSON_PRESENT_ACTION.test(clause) || (clause.match(/[A-Za-z]+/g) ?? []).some((word) => {
    const lower = word.toLowerCase();
    return actionVerbPast(lower) === lower || (/^[a-z]{3,}(?<!e)ed$/.test(lower) && !NOT_PAST_ADJECTIVES.has(lower));
  });
}

// `employers` (the target employer) count only in an explicit frame or an "At <employer>,"
// opening that reports work ("At Harbor, I built…").
function affiliationClaims(text: string, employers: readonly string[] = []): AffiliationClaim[] {
  const employerKeys = new Set(employers.map(employerKey).filter((key) => key.length >= 2));
  const claims: AffiliationClaim[] = [];
  for (const match of text.matchAll(AFFILIATION_NAME)) {
    const index = match.index ?? 0;
    const name = match[0].replace(/[.'’]+s?$/, "").replace(/['’]s$/, "");
    if (/^(?:I|We|My|Our)$/.test(name) || NOT_AFFILIATION_NAMES.test(name) || EVENT_NAME.test(name) || curatedClaimTerms(name).length > 0) continue;
    const rawBefore = text.slice(0, index);
    // A coordinated name takes the frame of the list it ends: "at Beta Corp and Stripe".
    const listed = rawBefore.slice(-160).match(COORDINATED_BEFORE)?.[0] ?? "";
    const before = listed && /(?:,|\b(?:and|or|&))\s*$/.test(listed) ? rawBefore.slice(0, rawBefore.length - listed.length) : rawBefore;
    const after = text.slice(index + match[0].length);
    // "Stripe's payments team" is still the workplace; "Stripe headquarters" or "Harbor's open house" is not.
    const possessive = /['’]s?$/.test(match[0]);
    const team = possessive && /^\s*(?:[\w-]+\s+){0,2}(?:team|org|group|division|office|lab)s?\b/.test(after);
    // "ex-Stripe" and "a former Stripe engineer" claim a workplace; "a former Harbor customer" does not.
    const former = /\b(?:former\s+|ex-)$/i.test(before) && (ROLE_NOUN_AFTER.test(after) || /^(?:['’]s)?\s*(?:[,.;:)]|$)/.test(after));
    if (((EXPLICIT_AFFILIATION.test(before) || EXPLICIT_AFFILIATION_APPOSITIVE.test(before)) && (!possessive || team)) || former || EXPLICIT_AFFILIATION_SUFFIX.test(after)) {
      claims.push({ name, index, end: index + name.length });
      continue;
    }
    // "as a Stripe engineer", "As Stripe's first payments engineer", and "on Stripe's payments team" name a workplace too.
    const role = ROLE_AFFILIATION.test(before) || (/\b(?:a|an|as)\s+$/i.test(before) && ROLE_NOUN_AFTER.test(after));
    if (!role && !PLACE_AFFILIATION.test(before) && !(team && /\b(?:on|in|with|within)\s+(?:the\s+)?$/i.test(before))) continue;
    if ((!role && EVENT_BEFORE.test(before)) || OTHER_PERSON.test(before)) continue;
    // The word after the name (past any names coordinated with it) shows whether it is a modifier.
    // After a coordinated list any lowercase word is its noun ("Medicare and Medicaid billing").
    let tail = after;
    for (let more = tail.match(COORDINATED_AFTER); more; more = tail.match(COORDINATED_AFTER)) tail = tail.slice(more[0].length);
    const next = tail.match(/^\s+([a-z][\w-]*)/)?.[1];
    const nextIsVerb = next !== undefined && (actionVerbPast(next) === next || /^(?:was|is|taught|gave|showed|let|had|made)$|^[a-z]{3,}(?<!e)ed$/.test(next));
    const modifier = next !== undefined && (tail !== after || before !== rawBefore ? !/^(?:and|or|but|for|to|in|on|at|by|with|from|as|during|since|until|where|when|while|which|who|that)$/.test(next) : !AFTER_NAME_FREE.test(next)) && !nextIsVerb;
    if (!ROLE_NOUN_AFTER.test(after) && (possessive ? !team : modifier)) continue;
    // A sentence that opens "At Stripe," or "Previously, at Stripe," is about the clause after it.
    const sentenceBefore = before.split(/[.!?]\s+/).at(-1) ?? "";
    const sentenceAfter = after.split(/[.!?](?:\s|$)/)[0];
    const opening = /^\s*(?:At|As)\s/.test(sentenceBefore) && !AFFILIATION_CLAUSE_BREAK.test(sentenceBefore);
    const following = `${sentenceBefore} ${sentenceAfter.replace(/^\s*,/, "").split(AFFILIATION_CLAUSE_BREAK)[0]}`;
    let clause = opening ? following : `${before.split(AFFILIATION_CLAUSE_BREAK).at(-1)}${after.split(AFFILIATION_CLAUSE_BREAK)[0]}`;
    if (!opening && !clauseHasPastAction(clause.replace(name, " ")) && clause.replace(name, " ").trim().split(/\s+/).length <= 3) clause = following;
    if (AFFILIATION_INTENT.test(clause)) continue;
    const reportsWork = clauseHasPastAction(clause.replace(name, " "));
    if (employerKeys.has(employerKey(name)) && !(opening && /^\s*At\s/.test(sentenceBefore) && reportsWork)) continue;
    if (!role && !reportsWork) continue;
    claims.push({ name, index, end: index + name.length });
  }
  return claims;
}

// As a phrase, or word by word when the evidence beside it names no other institution kind
// and no "State"/"Tech" the claim lacks ("University of Michigan" is not "Michigan State").
function affiliationGrounded(name: string, evidence: unknown): boolean {
  if (isTermGrounded(name, evidence)) return true;
  const words = name.split(/\s+/).filter((word) => !AFFILIATION_GENERIC_WORDS.has(word.toLowerCase().replace(/[.,]+$/, "")));
  if (!words.length || !words.every((word) => isTermGrounded(word, evidence))) return false;
  const kinds = new Set((name.match(INSTITUTION_KINDS) ?? []).map((kind) => kind.toLowerCase()));
  if (!kinds.size) return true;
  const claimed = name.toLowerCase();
  const first = words[0].replace(/[.,]+$/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...String(evidence ?? "").matchAll(new RegExp(String.raw`(?:\S+\s+){0,3}\b${first}\b(?:\s+\S+){0,3}`, "gi"))].some((near) => {
    const nearKinds = (near[0].match(INSTITUTION_KINDS) ?? []).map((kind) => kind.toLowerCase());
    const distinguishing = (near[0].match(/\b(?:state|tech|a&m)\b/gi) ?? []).map((word) => word.toLowerCase());
    return (!nearKinds.length || nearKinds.some((kind) => kinds.has(kind))) && distinguishing.every((word) => claimed.includes(word));
  });
}

export function findUngroundedAffiliation(text: string, evidence: unknown, employers: readonly string[] = []): string | null {
  return affiliationClaims(text, employers).find((claim) => !affiliationGrounded(claim.name, evidence))?.name ?? null;
}

// Answers carry no company field: the target employer is the name the posting introduces
// itself with, never a customer, competitor, or school it mentions elsewhere.
function postingEmployerNames(jobText: string): string[] {
  const name = String.raw`(${AFFILIATION_WORD}(?:[ \t]+${AFFILIATION_WORD}){0,3})`;
  const cues = [
    new RegExp(String.raw`^\s*[^\n]{0,80}?(?:\s[-–—|@]\s|\bat\s+)${name}\s*$`, "gmu"),
    new RegExp(String.raw`^\s*(?:[Cc]ompany|[Ee]mployer|[Oo]rganization)\s*:\s*${name}`, "gmu"),
    new RegExp(String.raw`(?:^|[.!?]\s+|\n)\s*(?:At\s+${name},\s+(?:we|our|you)\b|(?:Join|About|Why|Welcome to|We are|We're)\s+${name})`, "gu"),
    new RegExp(String.raw`(?:^|[.!?]\s+|\n)\s*${name}(?:['’]s\s+(?:mission|team|culture|values|benefits|employees|people|platform|products?|customers)\b|\s+(?:is|was|are|has|have|builds|makes|helps|provides|offers|powers|serves|creates|develops|operates|runs|delivers)\b(?!\s+(?:a|an)\s+(?:plus|bonus|must)\b))`, "gu")
  ];
  return [...new Set(cues.flatMap((cue) => [...jobText.matchAll(cue)].flatMap((match) => match.slice(1).filter(Boolean))))];
}

// Proper-name gate for application prose. Unlike resume-field rewrites, a
// truthful answer is expected to name the target company/product from the JD,
// so candidate evidence is not the only allowed source. Reject an unsupported
// mid-sentence TitleCase/CamelCase/all-caps token only when it appears in neither
// the candidate evidence nor the job text. Prompt-required [add: ...]
// placeholders are questions to the user, not asserted facts, so they are
// removed before scanning. At sentence start, simple TitleCase is grammatical
// unless it directly acts as the subject of a bounded claim verb ("Fabricated
// led ..."). Internal-CamelCase and all-caps tokens remain intrinsically
// claim-shaped even in first position; this avoids a vocabulary allowlist whose
// inevitable omissions reject ordinary transitions such as "Additionally".
export function findUngroundedProseProperClaimTerm(
  text: unknown,
  candidateEvidence: unknown,
  jobText: unknown
): string | null {
  const prose = String(text ?? "")
    // Preserve line breaks/rough offsets so sentence-start detection after a
    // placeholder still sees the same structure while ignoring its contents.
    .replace(/\[(?:add|insert|todo)\b[^\]]*\]/gi, (placeholder) => placeholder.replace(/[^\r\n]/g, " "))
    .replace(/<\/?(?:b|i|u)>/gi, " ");
  const properToken = /\b(?:[A-Z][A-Za-z0-9.+#]{2,}|[a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*)\b/g;
  // The posting grounds the target employer and the names it discusses, never a
  // workplace or school the candidate claims ("At Plaid I built…", "a Stanford graduate").
  const job = String(jobText ?? "");
  const affiliations = job ? affiliationClaims(prose, postingEmployerNames(job)) : [];
  for (const match of prose.matchAll(properToken)) {
    const token = match[0];
    const affiliation = affiliations.find((claim) => (match.index ?? 0) >= claim.index && (match.index ?? 0) < claim.end);
    if (affiliation) {
      if (affiliationGrounded(affiliation.name, candidateEvidence)) continue;
      return token;
    }
    if (isTermGrounded(token, candidateEvidence) || isTermGrounded(token, jobText)) continue;
    const sentenceStart = isProseSentenceStart(prose, match.index ?? 0);
    if (sentenceStart) {
      const letters = token.replace(/[^A-Za-z]/g, "");
      const internalCamelCase = /[a-z][A-Z]/.test(token);
      const allCaps = letters.length >= 2 && letters === letters.toUpperCase();
      if (!internalCamelCase && !allCaps && !sentenceLeadingTokenActsAsEntitySubject(prose, (match.index ?? 0) + token.length)) {
        continue;
      }
    }
    return token;
  }
  return null;
}

// Prose-surface grounding predicate: true when `text` names a JD skill term
// absent from the grounding corpus. Shared by proposal feedback, cover letters,
// and application-answer/job-analysis prose so the proseMode grounding contract
// lives in one place. Callers pass ALREADY-LOWERCASED jobLower/groundingLower
// (the same pre-lowercased contract findUngroundedJdTerm documents) and do their
// own one-time lowercasing, so the helper never re-lowercases a multi-KB corpus
// per call. `text` itself is not required to be lowercased (findUngroundedJdTerm
// lowercases it internally).
export function proseHasUngroundedTerm(text: unknown, jobLower: string, groundingLower: string): boolean {
  return Boolean(text) && Boolean(findUngroundedJdTerm(text, jobLower, groundingLower, { proseMode: true }));
}

// Alias/inflection-aware grounding check for a SINGLE claimed term. It shares
// the exact discipline used by findUngroundedJdTerm (which routes through
// isGrounded).
// Without this the hit gate did a raw substring `grounding.includes(word)` that
// is alias-blind: once grounding narrowed to a single entry's text, an honest
// edit whose entry spells a tech in its short/alias form (k8s, postgres, ts)
// while the hit names the long form (Kubernetes, PostgreSQL, TypeScript) was
// false-dropped. `term` and `grounding` may be any case; both are lowercased
// here. Multi-word terms ("machine learning") match as a normalized phrase.
export function isTermGrounded(term: unknown, grounding: unknown): boolean {
  // Free only sentence-final punctuation; internal product punctuation such as
  // node.js and the leading dot in .NET remains intact. Coverage/gap keywords
  // are model prose and commonly arrive as "GraphQL." — treating that period
  // as part of the technology token silently drops otherwise exact evidence.
  const t = stripBoundaryDots(String(term ?? "").trim().toLowerCase()).trim();
  if (!t) return false;
  const groundingLower = String(grounding ?? "").toLowerCase();
  // The grounding corpus repeats across per-claim isTermGrounded calls,
  // so route it through the same memoized tokenize() as findUngroundedJdTerm.
  const groundingTokens = tokenize(groundingLower);
  return isGrounded(groundingLower, groundingTokens, t);
}

// Collision-safe claim grounding for extracted gaps/skills. The general alias
// map intentionally treats TS and TypeScript as equivalent for honest resume
// rewrites, but requirement extraction must not read the clearance acronym
// TS/SCI as TypeScript (likewise net-zero/.NET and common short-token phrases).
export function isClaimTermGroundedInSource(term: unknown, source: unknown): boolean {
  const rawTerm = stripBoundaryDots(String(term ?? "").trim()).trim();
  const rawSource = String(source ?? "");
  const normalized = rawTerm.toLowerCase();
  if (/\.net\b/i.test(rawTerm)) return /(?:^|[^a-z0-9])\.net(?![-a-z0-9])/i.test(rawSource);
  if (/^typescript$/i.test(rawTerm)) {
    return /\bTypeScript\b/i.test(rawSource)
      || /(?:^|[^A-Za-z0-9/])TS(?!\s*\/\s*SCI\b|[A-Za-z0-9])/i.test(rawSource);
  }
  if (normalized === "go") {
    return /\bGolang\b/i.test(rawSource) || /(?:^|[^A-Za-z0-9])Go(?![-&A-Za-z0-9+#])/.test(rawSource);
  }
  if (normalized === "c") return /(?:^|[^A-Za-z0-9])C(?![-&A-Za-z0-9+#])/.test(rawSource);
  if (normalized === "r") return /(?:^|[^A-Za-z0-9])R(?![-&A-Za-z0-9+#])/.test(rawSource);
  return isTermGrounded(rawTerm, rawSource);
}

// ---------------------------------------------------------------------------
// Distinctive-token anchoring for ownership support.

const ROLE_TOKEN_CANONICAL = new Map([
  ["postgresql", "postgres"], ["postgres", "postgres"],
  ["k8s", "kubernetes"], ["kubernetes", "kubernetes"],
  ["typescript", "typescript"], ["ts", "typescript"]
]);

// Light morphology keeps grounding paraphrase-friendly without turning it into
// semantic guesswork: "building" can match "build" and "services" can match
// "service", but an invented domain/tool still has no matching token.
function tokenKey(token: string): string {
  let key = token;
  if (key.length > 5 && key.endsWith("ies")) key = `${key.slice(0, -3)}y`;
  else if (key.length > 5 && key.endsWith("ing")) key = key.slice(0, -3).replace(/(.)\1$/, "$1");
  else if (key.length > 4 && key.endsWith("ed")) key = key.slice(0, -2).replace(/(.)\1$/, "$1");
  else if (key.length > 4 && key.endsWith("s")) key = key.slice(0, -1);
  return ROLE_TOKEN_CANONICAL.get(key) ?? key;
}

const normalizeForTokens = (value: unknown): string =>
  String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function distinctiveTokenKeys(value: unknown, stopwords: Set<string>): string[] {
  return [...new Set(normalizeForTokens(value)
    .split(" ")
    .filter((token: string) => token.length >= 3 && !stopwords.has(token))
    .map(tokenKey)
    .filter(Boolean))] as string[];
}
