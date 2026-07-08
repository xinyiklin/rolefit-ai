// Offline, deterministic probes for the JD-term grounding gate and the
// strict-review grounding it now drives. No model calls, no network:
//
//   node server/ai/__evals__/grounding-probes.mjs
//
// Locks the 2026-06 anti-fabrication backstops:
// - detector 4 (short tech tokens C#/C++/ML/NLP), incl. sentence-final periods
// - proseMode (cover letter / answers): proper nouns allowed, skills still gated
// - the contract that jobLower/grounding are PRE-LOWERCASED by callers
// - sanitizeStrictReview dropping an ungrounded rewrite / blanking an ungrounded
//   suggestedEdit, while staying backward-compatible with the no-args call
// All fixture text is synthetic. Exit code is non-zero on any failure.

import { findUngroundedJdTerm } from "../grounding.ts";
import { sanitizeStrictReview } from "../sanitize.ts";
import { groundChangeSummary } from "../polish.ts";

const f = (proposed, job, grounding, opts) => findUngroundedJdTerm(proposed, job, grounding, opts);

// "What changed" summary honesty: the summary is free model prose (NOT derived
// from the sanitized suggestions), so it can claim a change that never landed.
// groundChangeSummary drops a bullet naming a JD tool/term absent from the
// tailored resume + honest context, keeping grounded/generic bullets.
const TAILORED = "languages: python, sql, javascript\ntools: git, docker, postgres";
const JOB = "we need python, sql, salesforce administration, and kubernetes orchestration. docker a plus.";
const gcs = (summary) => groundChangeSummary(summary, JOB, TAILORED);

const checks = [
  // --- changeSummary honesty: overclaims of unlanded changes are dropped ---
  ["summary: ungrounded 'added Salesforce' overclaim dropped",
    gcs(["Added Salesforce administration to your Skills section."]).length === 0],
  ["summary: ungrounded 'Kubernetes' overclaim dropped",
    gcs(["Highlighted Kubernetes orchestration across your tooling."]).length === 0],
  ["summary: grounded bullet (Python/SQL in tailored resume) kept",
    gcs(["Reorganized your Skills to surface Python and SQL first."]).length === 1],
  ["summary: generic 'tightened wording' bullet kept (no JD term)",
    gcs(["Tightened wording and removed redundancy."]).length === 1],
  ["summary: mixed batch keeps only the honest bullets",
    gcs([
      "Reorganized your Skills to surface Python and SQL first.",
      "Added Salesforce administration to your Skills section.",
      "Emphasized your Docker experience."
    ]).length === 2],
  ["summary: empty list passes through unchanged", gcs([]).length === 0],

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

  // --- deliberate exclusion: collision-prone short tokens never flagged ---
  ["bare 'go' is NOT flagged (verb / go-to-market collision)", f("our go-to-market plan", "go developer wanted", "", { proseMode: true }) === null],

  // --- sanitizeStrictReview grounding (resume-field rewrites) ---
  ["ungrounded rewrite is dropped, grounded kept", (() => {
    const out = sanitizeStrictReview(
      { verdict: "STRETCH", rewrites: [
        { original: "Built APIs", rewrite: "Built Kubernetes-orchestrated APIs" },
        { original: "Led team", rewrite: "Led a 3-person engineering team" }
      ] },
      "kubernetes required",
      "Built REST APIs in Python. Led a 3-person team."
    );
    return out.rewrites.length === 1 && /3-person/.test(out.rewrites[0].rewrite);
  })()],
  ["ungrounded suggestedEdit is blanked, gap stays", (() => {
    const out = sanitizeStrictReview(
      { verdict: "STRETCH", gaps: [
        { gap: "No Terraform", severity: "HIGH", evidenceType: "none", suggestedEdit: "Provisioned infra with Terraform" }
      ] },
      "terraform required",
      "Shipped Python services."
    );
    return out.gaps.length === 1 && out.gaps[0].suggestedEdit === "";
  })()],
  ["backward-compatible: no job/grounding -> no grounding drops", (() => {
    const out = sanitizeStrictReview({ verdict: "STRETCH", rewrites: [
      { original: "a", rewrite: "Built Kubernetes things" },
      { original: "b", rewrite: "Led a team" }
    ] });
    return out.rewrites.length === 2;
  })()],

  // --- Fix 2: advisory review prose (coverLetterAngle, topEdits[],
  // --- riskFlags[].suggestion) is prose-grounded like suggestedEdit. On an
  // --- ungrounded JD skill term the STRING is blanked (or the topEdits item
  // --- dropped), never the parent object; a grounded term survives untouched.
  // --- proseMode is used, so company/role proper nouns are allowed. ---
  ["review: ungrounded coverLetterAngle (Kubernetes not in resume) is blanked, review kept", (() => {
    const out = sanitizeStrictReview(
      { verdict: "STRETCH", recommendation: { coverLetterAngle: "Frame your Kubernetes orchestration experience as the through-line for this platform role." } },
      "kubernetes orchestration required",
      "Built REST APIs in Python. Shipped Docker images."
    );
    return out !== null && out.recommendation.coverLetterAngle === "";
  })()],
  ["review: grounded coverLetterAngle (Python/Docker in resume) survives", (() => {
    const out = sanitizeStrictReview(
      { verdict: "REASONABLE FIT", recommendation: { coverLetterAngle: "Lead with your Python services and Docker delivery work — both map directly to this team." } },
      "python and docker required",
      "Built REST APIs in Python. Shipped Docker images."
    );
    return out.recommendation.coverLetterAngle.length > 0 && /Python/.test(out.recommendation.coverLetterAngle);
  })()],
  ["review: ungrounded topEdits item dropped, grounded items kept (parent survives)", (() => {
    const out = sanitizeStrictReview(
      { verdict: "STRETCH", recommendation: { topEdits: [
        "Surface your Python REST work first.",       // grounded -> kept
        "Add Kubernetes cluster operations to skills.", // ungrounded JD term -> dropped
        "Highlight your Docker delivery pipeline."      // grounded -> kept
      ] } },
      "python, docker, kubernetes required",
      "Built REST APIs in Python. Shipped Docker images."
    );
    return out.recommendation.topEdits.length === 2
      && out.recommendation.topEdits.every((e) => !/Kubernetes/i.test(e));
  })()],
  ["review: ungrounded riskFlags.suggestion blanked, flag (bullet+risk) kept", (() => {
    const out = sanitizeStrictReview(
      { verdict: "STRETCH", riskFlags: [
        { bullet: "Optimized the reporting pipeline.", risk: "Interviewer may probe scale.", suggestion: "Reframe as Kubernetes-scaled throughput." }
      ] },
      "kubernetes required",
      "Built REST APIs in Python."
    );
    return out.riskFlags.length === 1
      && out.riskFlags[0].risk.length > 0
      && out.riskFlags[0].suggestion === "";
  })()],
  ["review: grounded riskFlags.suggestion survives", (() => {
    const out = sanitizeStrictReview(
      { verdict: "STRETCH", riskFlags: [
        { bullet: "Optimized the reporting pipeline.", risk: "Interviewer may probe scale.", suggestion: "Quantify the Python pipeline's throughput improvement." }
      ] },
      "python required",
      "Built REST APIs in Python."
    );
    return out.riskFlags.length === 1 && /Python/.test(out.riskFlags[0].suggestion);
  })()],
  ["review: company proper noun in coverLetterAngle is NOT blanked (proseMode allows it)", (() => {
    const out = sanitizeStrictReview(
      { verdict: "REASONABLE FIT", recommendation: { coverLetterAngle: "Connect your Python delivery record to Acme's platform-reliability mission." } },
      "acme is hiring a python engineer",
      "Built REST APIs in Python."
    );
    // "Acme" is a proper noun (not in the tool lexicon) and Python is grounded,
    // so the angle survives intact.
    return /Acme/.test(out.recommendation.coverLetterAngle);
  })()],

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

let failures = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failures++;
}
console.log(`\n${checks.length - failures}/${checks.length} probes passed.`);
process.exit(failures ? 1 : 0);
