// Offline, deterministic probes for the shared JD-term grounding gate.
//
//   node server/ai/__evals__/grounding-probes.mjs
//
// Locks the 2026-06 anti-fabrication backstops:
// - detector 4 (short tech tokens C#/C++/ML/NLP), incl. sentence-final periods
// - proseMode (cover letter / answers): proper nouns allowed, skills still gated
// - the contract that jobLower/grounding are PRE-LOWERCASED by callers
// All fixture text is synthetic. Exit code is non-zero on any failure.

import assert from "node:assert/strict";

import {
  findUngroundedClaimTerm,
  findUngroundedJdTerm,
  findUngroundedOutcomeClaim,
  hasUnsupportedOwnershipIncrease,
  isClaimTermGroundedInSource
} from "../grounding.ts";

const f = (proposed, job, grounding, opts) => findUngroundedJdTerm(proposed, job, grounding, opts);

const checks = [
  ["every upward ownership step is gated",
    hasUnsupportedOwnershipIncrease(
      "Managed JavaScript billing integrations.",
      "Contributed to JavaScript billing integrations.",
      ""
    )],
  ["unrelated sibling leadership cannot authorize the target",
    hasUnsupportedOwnershipIncrease(
      "Oversaw JavaScript billing integrations.",
      "Supported JavaScript billing integrations.",
      "Led Kubernetes infrastructure migrations."
    )],
  ["tied honest evidence can substantiate the same ownership",
    !hasUnsupportedOwnershipIncrease(
      "Orchestrated JavaScript billing integrations.",
      "Supported JavaScript billing integrations.",
      "At Acme I orchestrated the JavaScript billing integrations."
    )],
  ["ordinary outcome detector rejects invented outage/revenue results",
    findUngroundedOutcomeClaim("Prevented outages and protected revenue.", "Built a deterministic fallback.") === "prevent"],
  ["ordinary outcome detector accepts a result stated in evidence",
    findUngroundedOutcomeClaim("Prevented outages.", "The fallback prevented outages.") === null],
  ["candidate prose permits conditional future impact",
    findUngroundedOutcomeClaim("I could improve reliability in this role.", "Built Python APIs.", { candidateProse: true }) === null],
  ["candidate prose rejects a resume-style fragment with a fabricated outcome",
    findUngroundedOutcomeClaim("Built Python APIs that prevented outages.", "Built Python APIs.", { candidateProse: true }) === "prevent"],

  // --- detector 4: distinctive short tokens detector 1's 3-char floor misses ---
  ["lowercase nlp flagged (detector1 needs a capital)", f("built nlp models", "nlp role", "") === "nlp"],
  ["c++ flagged ungrounded", f("wrote a c++ engine", "c++ required", "") === "c++"],
  ["c# grounded by corpus -> null", f("strong c# work", "c# developer", "expert in c# and dotnet") === null],

  // --- finding-1 regression lock: a sentence-final short token still matches ---
  ["sentence-final 'C#.' flagged (boundary period freed)", f("My strongest language is C#.", "c# required", "") === "c#"],
  ["sentence-final 'ML.' flagged", f("My focus has been ML.", "ml engineer", "") === "ml"],
  // grounding corpus is pre-lowercased by callers (the contract); a sentence-final
  // 'c#.' in it must still ground a bare 'c#' thanks to stripBoundaryDots.
  ["sentence-final corpus token grounds it", f("strong C#.", "c# required", "i use c#. daily") === null],
  ["sentence-final long-form claim grounds without swallowing punctuation",
    isClaimTermGroundedInSource("GraphQL.", "Required: GraphQL services.")],
  ["internal period preserved (node.js not split)", f("ran node.js services", "node.js required", "node.js in prod") === null],

  // --- detector 2: hyphen/slash concepts ground via phrase normalization ---
  // Regression lock: "real-time"/"ci/cd"/"event-driven"/"cloud-native" tokenize
  // on hyphen/slash, so they must match as a normalized phrase, not a token. A
  // term literally present in the resume must NOT be flagged ungrounded.
  ["real-time grounded by hyphenated corpus term",
    f("Built real-time streaming services", "real-time data required", "shipped real-time pipelines at scale") === null],
  ["ci/cd grounded by slash corpus term",
    f("Automated ci/cd pipelines", "ci/cd required", "owned the ci/cd pipeline in jenkins") === null],
  ["event-driven grounded by hyphenated corpus term",
    f("Designed event-driven services", "event-driven architecture wanted", "built event-driven microservices") === null],
  // ...but a truly ungrounded hyphen concept is still flagged (safety preserved).
  ["ungrounded 'event-driven' still flagged",
    f("Designed event-driven services", "event-driven required", "wrote some python scripts") === "event-driven"],

  // --- proseMode: proper nouns allowed, skills still gated (cover/answers) ---
  ["proseMode allows company proper noun", f("excited about Acme platform", "acme corp hiring", "", { proseMode: true }) === null],
  ["non-prose flags the same proper noun", f("excited about Acme platform", "acme corp hiring", "") === "Acme"],
  ["proseMode still flags a tool skill", f("I have Kubernetes experience", "kubernetes required", "", { proseMode: true }) === "kubernetes"],
  ["proseMode still flags a short token", f("strongest in C#", "c# developer", "", { proseMode: true }) === "c#"],
  ["proseMode clean when grounded", f("I have Kubernetes experience", "kubernetes required", "ran kubernetes clusters", { proseMode: true }) === null],
  ["second-sentence action verb is grammar, not an invented proper claim",
    findUngroundedClaimTerm(
      "Built JavaScript reporting tools. Improved the deployment workflow.",
      "Built JavaScript reporting tools and maintained the deployment workflow."
    ) === null],

  // --- deliberate exclusion: collision-prone short tokens never flagged ---
  ["bare 'go' is NOT flagged (verb / go-to-market collision)", f("our go-to-market plan", "go developer wanted", "", { proseMode: true }) === null],

  // --- Fix C: memoized corpus tokenization is behaviorally invisible. The
  // --- module memoizes the JD + grounding token sets (invariant across a
  // --- review's ~19 calls) in a tiny FIFO cache. Repeated calls on identical
  // --- corpora must return IDENTICAL results, and cache eviction (>4 distinct
  // --- corpora) must not change any answer. Cross-call state via the shared
  // --- (never-mutated) cached Set is the risk this locks against. ---
  ["memoized tokenization: repeated identical corpora return identical results", (() => {
    const job = "requires kubernetes, terraform, and python.";
    const grounding = "built python services and rest apis for the reporting platform.";
    const proposed = "provisioned terraform modules for the platform.";
    // Same corpora, called many times: memoized token sets must not drift.
    const results = [];
    for (let i = 0; i < 25; i++) results.push(f(proposed, job, grounding));
    const allEqual = results.every((r) => r === results[0]);
    // Terraform is in the JD + proposal but NOT the grounding -> flagged every time.
    return allEqual && results[0] === "terraform";
  })()],
  ["memoized tokenization: grounded term stays grounded across repeats", (() => {
    const job = "requires python and docker.";
    const grounding = "shipped python services in docker containers.";
    const proposed = "maintained the python service and its docker image.";
    const results = [];
    for (let i = 0; i < 25; i++) results.push(f(proposed, job, grounding));
    return results.every((r) => r === null);
  })()],
  ["memoized tokenization: cache eviction (>4 distinct corpora) does not change answers", (() => {
    // Cycle through more distinct (job, grounding) corpus pairs than the cache
    // holds, twice, and confirm each pair's verdict is stable — proving eviction
    // + re-tokenization reproduce the fresh-tokenize result exactly.
    const cases = [
      { job: "needs kafka.", grounding: "wrote go services.", proposed: "ran kafka streams.", want: "kafka" },
      { job: "needs redis.", grounding: "wrote go services.", proposed: "used redis caching.", want: "redis" },
      { job: "needs mongodb.", grounding: "wrote go services.", proposed: "queried mongodb.", want: "mongodb" },
      { job: "needs nginx.", grounding: "wrote go services.", proposed: "configured nginx.", want: "nginx" },
      { job: "needs jenkins.", grounding: "wrote go services.", proposed: "set up jenkins.", want: "jenkins" },
      { job: "needs python.", grounding: "built python jobs.", proposed: "wrote python jobs.", want: null }
    ];
    const first = cases.map((c) => f(c.proposed, c.job, c.grounding));
    const second = cases.map((c) => f(c.proposed, c.job, c.grounding));
    return cases.every((c, i) =>
      first[i] === c.want && second[i] === c.want && first[i] === second[i]
    );
  })()]
];

// Floor: silently deleting a check must shrink the gate loudly, not quietly.
// Raise this number whenever you ADD a check above.
assert(checks.length >= 25, `grounding probe count dropped below the floor (25): found ${checks.length}`);

let failures = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failures++;
}
console.log(`\n${checks.length - failures}/${checks.length} probes passed.`);
process.exit(failures ? 1 : 0);
