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

function normalizePhrase(text) {
  return text.replace(/[-/]+/g, " ");
}

// The token regex keeps '.' (so node.js / .net survive), which means a
// sentence-final token glues its period: "C#." -> "c#.". Free a boundary period
// (followed by whitespace or end) into a space before tokenizing so a short
// token at a sentence end still matches the bare SHORT_TECH_TOKENS form — while
// internal periods (node.js, .net) stay intact. Mirrors keywords.ts includesKeyword.
function stripBoundaryDots(text) {
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
//
// options.proseMode — for free-form prose surfaces (cover letter, application
// answers) where naming the target company/role/product FROM the JD is expected
// and legitimate. It skips detector 1 (which flags every capitalized JD token,
// company and role names included) and relies on the curated tech-skill lexicons
// (detectors 2-4) instead, so "excited about Acme's roadmap" is NOT flagged while
// "I have Kubernetes/Terraform/ML experience" still is. Resume-field surfaces
// (tailor + strict-review rewrites) leave it off and run all detectors.
export function findUngroundedJdTerm(proposedText, jobLower, grounding, options = {}) {
  if (!jobLower) return null;
  const proseMode = Boolean(options.proseMode);
  const markStripped = String(proposedText ?? "").replace(/<\/?(?:b|i|u)>/gi, " ");
  const proposedLower = markStripped.toLowerCase();
  // Boundary periods are freed before tokenizing (see stripBoundaryDots) so a
  // sentence-final "C#."/"ML." still produces the bare "c#"/"ml" token, for both
  // the lexicon sweeps below AND the grounding corpus that must ground them.
  const groundingTokens = new Set(stripBoundaryDots(grounding).match(/[a-z0-9.#+]+/g) ?? []);
  // Token sets used by the bounded lexicon sweeps (detectors 3-4). Matching is
  // token-anchored (set membership) on BOTH the JD and the proposed text,
  // never substring, so "java" cannot match inside "javascript" — the same
  // discipline as isGrounded.
  const proposedTokens = new Set(stripBoundaryDots(proposedLower).match(/[a-z0-9.#+]+/g) ?? []);
  const jobTokens = new Set(stripBoundaryDots(jobLower).match(/[a-z0-9.#+]+/g) ?? []);

  // Detector 1: capitalized tokens of 3+ chars, including a non-verb first
  // word. Distinctive short tokens (C#, ML, NLP) are picked up by detector 4;
  // the rest are out of scope here — substring checks at 1-2 chars are too noisy.
  // Skipped in proseMode: it flags every capitalized JD token (company/role names
  // included), which is exactly what legitimate cover-letter/answer prose says.
  if (!proseMode) {
    for (const match of markStripped.matchAll(/\b[A-Z][A-Za-z0-9.+#]{2,}\b/g)) {
      const token = match[0].toLowerCase();
      if (match.index === 0 && LEADING_ACTION_VERBS.has(token)) continue;
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
