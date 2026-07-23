// JD-term grounding for tailor suggestions: a term that appears in the job
// description may be written into a proposedText ONLY if it already exists in
// the grounding corpus (every current field text in the tailor scope plus the
// user's honest context). The evidence field is model prose and can launder an
// inferred fact ("clinics run Windows"); the source text cannot.
//
// Three complementary detectors:
// 1. Capitalized tokens of 3+ chars (Windows, Flask, EKS) — proper-noun and
//    product names. The first word of the text is checked too unless it is a
//    normal résumé action verb, so "Kubernetes deployments…" can't slip in at
//    position 0. 1-2 char tokens (Go, ML, C#) are a known coverage gap.
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
const SHORT_TECH_TOKENS = new Set(["c#", "c++", "ml", "nlp"]);

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

function normalizePhrase(text: string): string {
  return text.replace(/[-/]+/g, " ");
}

// Token set for a corpus string: boundary periods freed (see stripBoundaryDots
// below) then split into [a-z0-9.#+] tokens. Both the JD and the grounding
// corpus are INVARIANT across the ~19 findUngroundedJdTerm calls a single review
// sanitize makes (identical multi-KB strings every time), and isTermGrounded
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
  ["ts", "typescript"], ["typescript", "ts"]
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
    return normalizePhrase(groundingText).includes(phrase);
  }
  for (const token of groundingTokens) {
    if (token === term) return true;
    if (TOKEN_ALIASES.get(term) === token) return true;
    if (token.startsWith(term) && INFLECTION_SUFFIX.test(token.slice(term.length))) return true;
    if (term.startsWith(token) && INFLECTION_SUFFIX.test(term.slice(token.length))) return true;
  }
  return false;
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
// "I have Kubernetes/Terraform/ML experience" still is. Resume-field surfaces
// (tailor + strict-review rewrites) leave it off and run all detectors.
export function findUngroundedJdTerm(
  proposedText: unknown,
  jobLower: string,
  grounding: string,
  options: { proseMode?: boolean } = {}
): string | null {
  if (!jobLower) return null;
  const proseMode = Boolean(options.proseMode);
  const markStripped = String(proposedText ?? "").replace(/<\/?(?:b|i|u)>/gi, " ");
  const proposedLower = markStripped.toLowerCase();
  // Boundary periods are freed before tokenizing (see stripBoundaryDots) so a
  // sentence-final "C#."/"ML." still produces the bare "c#"/"ml" token, for both
  // the lexicon sweeps below AND the grounding corpus that must ground them.
  // grounding + jobLower are INVARIANT corpora across a review's ~19 calls, so
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
      // A normal action verb is grammatical at the start of ANY sentence, not
      // only at absolute offset 0. Without the sentence-boundary check, a
      // truthful two-sentence bullet such as "Built APIs. Improved deploys."
      // falsely treats "Improved" as an invented proper-name claim.
      if (LEADING_ACTION_VERBS.has(token) && isProseSentenceStart(markStripped, match.index ?? 0)) continue;
      if (!jobLower.includes(token)) continue;
      if (!isGrounded(grounding, groundingTokens, token)) return match[0];
    }
  }

  // Detector 2: lowercase concept terms present in both the JD and the
  // proposed text but absent from the grounding corpus.
  for (const concept of LOWERCASE_TECH_CONCEPTS) {
    if (!proposedLower.includes(concept)) continue;
    if (!jobLower.includes(concept)) continue;
    if (!isGrounded(grounding, groundingTokens, concept)) return concept;
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
    if (!isGrounded(grounding, groundingTokens, name)) return name;
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
    if (LEADING_ACTION_VERBS.has(token) && isProseSentenceStart(markStripped, match.index ?? 0)) continue;
    if (!isGrounded(groundingLower, groundingTokens, token)) return match[0];
  }
  return findUngroundedCuratedClaimTerm(proposedText, grounding);
}

// Curated-only companion to findUngroundedClaimTerm. Extraction surfaces such
// as Distill legitimately paraphrase ordinary prose, so treating every new
// capitalized word as a factual claim would false-drop useful duties. Concrete
// technology concepts, branded tools, and distinctive short tech tokens are a
// narrower class: if one appears in model-authored extraction prose, it must be
// present in the source posting. Keeping this helper beside the owning lexicons
// avoids a second, inevitably drifting technology list in distill.ts.
export function findUngroundedCuratedClaimTerm(proposedText: unknown, grounding: unknown): string | null {
  const groundingLower = String(grounding ?? "").toLowerCase();
  const groundingTokens = tokenize(groundingLower);
  const proposedLower = String(proposedText ?? "").replace(/<\/?(?:b|i|u)>/gi, " ").toLowerCase();
  const proposedTokens = new Set(stripBoundaryDots(proposedLower).match(/[a-z0-9.#+]+/g) ?? []);

  for (const concept of LOWERCASE_TECH_CONCEPTS) {
    if (proposedLower.includes(concept) && !isGrounded(groundingLower, groundingTokens, concept)) return concept;
  }
  for (const name of LOWERCASE_TOOL_NAMES) {
    if (proposedTokens.has(name) && !isGrounded(groundingLower, groundingTokens, name)) return name;
  }
  for (const token of SHORT_TECH_TOKENS) {
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

type OutcomeClaimFamily = Readonly<{
  label: string;
  pattern: RegExp;
}>;

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
  { label: "eliminate", pattern: /\beliminat(?:e|es|ed|ing)\b/i },
  { label: "enable", pattern: /\benabl(?:e|es|ed|ing)\b/i },
  { label: "generate", pattern: /\bgenerat(?:e|es|ed|ing)\b/i },
  // "growing" is frequently an adjective ("a growing customer base"), so
  // keep this family to unambiguous past/result forms.
  { label: "grow", pattern: /\bgrew\b|\bgrown\b/i },
  { label: "improve", pattern: /\bimprov(?:e|es|ed|ing)\b/i },
  { label: "increase", pattern: /\bincreas(?:e|es|ed|ing)\b/i },
  { label: "lower", pattern: /\blower(?:s|ed|ing)?\b/i },
  { label: "prevent", pattern: /\bprevent(?:s|ed|ing)?\b/i },
  { label: "protect", pattern: /\bprotect(?:s|ed|ing)?\b/i },
  { label: "reduce", pattern: /\breduc(?:e|es|ed|ing)\b/i },
  { label: "save", pattern: /\bsav(?:e|es|ed|ing)\b/i },
  { label: "shorten", pattern: /\bshorten(?:s|ed|ing)?\b/i },
  { label: "strengthen", pattern: /\bstrengthen(?:s|ed|ing)?\b/i },
  { label: "streamline", pattern: /\bstreamlin(?:e|es|ed|ing)\b/i }
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

function outcomeAttributionIsConditional(sentence: string, index: number): boolean {
  const clausePrefix = sentence.slice(Math.max(0, index - 64), index);
  return /\b(?:would|could|can|will|may|might)\b[^.;!?]*$/i.test(clausePrefix)
    || /\b(?:aim|hope|plan|seek|intend)(?:s|ed|ing)?\s+to\b[^.;!?]*$/i.test(clausePrefix);
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
      const match = family.pattern.exec(sentence);
      if (!match || outcomeAttributionIsConditional(sentence, match.index)) continue;
      factualOutcomeVerb = true;
      if (!family.pattern.test(source)) return family.label;
    }
    if (!factualOutcomeVerb) continue;
    for (const family of OUTCOME_NOUN_FAMILIES) {
      const match = family.pattern.exec(sentence);
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
  for (const match of prose.matchAll(properToken)) {
    const token = match[0];
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
// absent from the grounding corpus. The one shared shape behind five hand-rolled
// copies (strict-review advisory prose, the change summary, cover letters, and
// application answers/role descriptions) so the proseMode grounding contract
// lives in one place. Callers pass ALREADY-LOWERCASED jobLower/groundingLower
// (the same pre-lowercased contract findUngroundedJdTerm documents) and do their
// own one-time lowercasing, so the helper never re-lowercases a multi-KB corpus
// per call. `text` itself is not required to be lowercased (findUngroundedJdTerm
// lowercases it internally).
export function proseHasUngroundedTerm(text: unknown, jobLower: string, groundingLower: string): boolean {
  return Boolean(text) && Boolean(findUngroundedJdTerm(text, jobLower, groundingLower, { proseMode: true }));
}

// Alias/inflection-aware grounding check for a SINGLE term (a claimed hit
// keyword), exposed so the tailor sanitizer's hit-keyword gate shares the exact
// same discipline as findUngroundedJdTerm (which routes through isGrounded).
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
  // The grounding corpus repeats across a review's per-hit isTermGrounded calls,
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
