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
const LOWERCASE_TOOL_NAMES = new Set([
  "terraform", "ansible", "jenkins", "gitlab", "argocd", "istio", "kafka",
  "rabbitmq", "redis", "memcached", "elasticsearch", "opensearch", "mongodb",
  "cassandra", "dynamodb", "mariadb", "sqlite", "snowflake", "databricks",
  "airflow", "hadoop", "flink", "nginx", "tomcat", "gunicorn", "django",
  "flask", "fastapi", "laravel", "symfony", "nestjs", "kotlin", "scala",
  "elixir", "erlang", "clojure", "pytorch", "tensorflow", "keras", "pandas",
  "numpy", "jupyter", "docker", "podman", "prometheus", "grafana", "datadog",
  "splunk", "kibana", "webpack", "vite", "eslint", "jest", "vitest", "cypress",
  "playwright", "selenium", "pytest", "twilio", "kubernetes"
]);

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

function normalizePhrase(text) {
  return text.replace(/[-/]+/g, " ");
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
function isGrounded(groundingText, groundingTokens, term) {
  if (term.includes(" ")) {
    return normalizePhrase(groundingText).includes(normalizePhrase(term));
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
export function findUngroundedJdTerm(proposedText, jobLower, grounding) {
  if (!jobLower) return null;
  const markStripped = String(proposedText ?? "").replace(/<\/?(?:b|i|u)>/gi, " ");
  const proposedLower = markStripped.toLowerCase();
  const groundingTokens = new Set(grounding.match(/[a-z0-9.#+]+/g) ?? []);
  // Token sets used by the bounded lexicon sweep (detector 3). Matching is
  // token-anchored (set membership) on BOTH the JD and the proposed text,
  // never substring, so "java" cannot match inside "javascript" — the same
  // discipline as isGrounded.
  const proposedTokens = new Set(proposedLower.match(/[a-z0-9.#+]+/g) ?? []);
  const jobTokens = new Set(jobLower.match(/[a-z0-9.#+]+/g) ?? []);

  // Detector 1: capitalized tokens of 3+ chars, including a non-verb first
  // word. 1-2 char tokens (Go, ML, QA, C#) are out of scope — substring
  // checks against the JD are too noisy at that length; concept coverage for
  // some of them comes from the lexicon (golang, machine learning).
  for (const match of markStripped.matchAll(/\b[A-Z][A-Za-z0-9.+#]{2,}\b/g)) {
    const token = match[0].toLowerCase();
    if (match.index === 0 && LEADING_ACTION_VERBS.has(token)) continue;
    if (!jobLower.includes(token)) continue;
    if (!isGrounded(grounding, groundingTokens, token)) return match[0];
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

  return null;
}
