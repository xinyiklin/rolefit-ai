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
  findUngroundedCuratedClaimTerm,
  findUngroundedJdTerm,
  findUngroundedOutcomeClaim,
  hasUnsupportedOwnershipIncrease,
  isClaimTermGroundedInSource
} from "../grounding.ts";
import { findUngroundedNumericClaim } from "../sanitize.ts";
import { candidateClaimIssue } from "../claimEvidence.ts";

const f = (proposed, job, grounding, opts) => findUngroundedJdTerm(proposed, job, grounding, opts);
const assisted = "Assisted senior engineers in migrating the payouts service from a cron script to Celery workers backed by Redis.";
const qaBugs = "Fixed 14 bugs from the QA backlog in the claims intake form, a jQuery front end.";

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

  // --- 2026-10 warning precision: honest paraphrases stay clean, fabrication still flags ---
  ...["Build", "Optimize", "Instrument", "Helped", "Fixing", "Reduces"].map((verb) => [
    `sentence-initial verb "${verb}" is grammar, not a proper-name claim`,
    findUngroundedClaimTerm(`${verb} the Celery queue for dispatch.`, "Built and rewrote the Celery queue for dispatch.") === null
      && f(`${verb} the Celery queue for dispatch.`, `${verb.toLowerCase()} queues\n${verb} the Celery queue`, "built and rewrote the celery queue for dispatch.") === null
  ]),
  ["sentence-initial product name not in evidence is still a claim",
    findUngroundedClaimTerm("Snowpipe ingestion for carrier rate lookups.", "Built Django REST endpoints for carrier rate lookups.") === "Snowpipe"],
  ["sentence-initial JD product name not in evidence is still flagged",
    f("Looker dashboards for dispatch teams.", "experience with looker required", "built django endpoints for dispatch teams.") === "Looker"],
  ["verbless own-project line restated with Built is not an ownership increase",
    !hasUnsupportedOwnershipIncrease("Built a Python CLI that imports bank CSV exports.", "Python CLI that imports bank CSV exports and categorizes transactions.", "Python CLI that imports bank CSV exports and categorizes transactions.")],
  ["verbless own-project line still cannot become leadership",
    hasUnsupportedOwnershipIncrease("Led a Python CLI that imports bank CSV exports.", "Python CLI that imports bank CSV exports and categorizes transactions.", "Python CLI that imports bank CSV exports and categorizes transactions.")],
  ["maintaining is not building",
    hasUnsupportedOwnershipIncrease("Built a Django admin for ferry schedules.", "Maintained a Django admin for ferry schedules.", "Maintained a Django admin for ferry schedules.")],
  ["an empty new-bullet slot still needs ownership evidence",
    hasUnsupportedOwnershipIncrease("Built a Django admin for ferry schedules.", "", "Worked on ferry schedule tooling.")],
  ["assisted work rewritten to lead with a direct verb is inflation",
    hasUnsupportedOwnershipIncrease("Migrated the payouts service from a cron script to Celery workers backed by Redis, working alongside senior engineers.", assisted, assisted)],
  ["assisted validation rewritten as Added is inflation",
    hasUnsupportedOwnershipIncrease("Added input validation to the Java Spring claims intake service alongside senior engineers.", "Assisted senior engineers in adding input validation to the Java Spring claims intake service.", "Assisted senior engineers in adding input validation to the Java Spring claims intake service.")],
  ["helping framing kept is not inflation",
    !hasUnsupportedOwnershipIncrease("Helped migrate the payouts service from a cron script to Celery workers backed by Redis.", assisted, assisted)],
  ["tied direct-action evidence supports the direct rewrite",
    !hasUnsupportedOwnershipIncrease("Migrated the payouts service from a cron script to Celery workers backed by Redis.", assisted, `${assisted}\nI migrated the payouts service from a cron script to Celery workers backed by Redis.`)],
  ["supporting a team by automating is the candidate's own work",
    !hasUnsupportedOwnershipIncrease("Automated weekly reports for the finance team.", "Supported the finance team by automating weekly reports.", "Supported the finance team by automating weekly reports.")],
  ["supporting others in their migration is still assistive",
    hasUnsupportedOwnershipIncrease("Migrated the billing service to PostgreSQL.", "Supported senior engineers in migrating the billing service to PostgreSQL.", "Supported senior engineers in migrating the billing service to PostgreSQL.")],
  ["a count's noun phrase is part of the claim, so a new modifier is reviewed",
    findUngroundedNumericClaim("Fixed 14 QA-reported bugs in the jQuery front end.", qaBugs) !== null
      && findUngroundedNumericClaim("Fixed 14 bugs from the QA backlog.", qaBugs) === null],
  ["the same number cannot count a different thing",
    findUngroundedNumericClaim("Resolved 14 production incidents in the claims intake form.", qaBugs) === "14 production"],
  ["a changed count is still flagged", findUngroundedNumericClaim("Fixed 40 QA-reported bugs.", qaBugs) === "40 QA-reported"],
  ["a shared modifier is not the counted noun", findUngroundedNumericClaim("Launched 5 new services.", "Onboarded 5 new engineers.") === "5 new services"],
  ["a list comma does not glue the next word to a number",
    findUngroundedNumericClaim("Migrated to Vite and React 18, reducing bundle size.", "Migrated to Vite and React 18, trimming bundle size.") === null],
  ["a reduction verb needs its own evidence; synonym swaps are churn the prompt forbids",
    findUngroundedOutcomeClaim("Reduced the nightly load from 3 hours to 50 minutes.", "Cut the nightly load from 3 hours to 50 minutes.") === "reduce"
      && findUngroundedOutcomeClaim("Cut the nightly load from 3 hours to 50 minutes.", "Cut the nightly load from 3 hours to 50 minutes.") === null],
  ["a reduction never grounds an increase",
    findUngroundedOutcomeClaim("Increased warehouse throughput.", "Cut the nightly warehouse load.") === "increase"],
  ["specific evidence establishes a concept",
    f("Checked React forms for accessibility.", "accessibility required", "built react forms with keyboard navigation and aria labels.") === null
      && findUngroundedCuratedClaimTerm("Added observability with Prometheus metrics.", "Added Prometheus metrics and Grafana dashboards.") === null
      && findUngroundedCuratedClaimTerm("Docker containerization.", "Packaged services with Docker.") === null],
  ["a concept with no specific evidence is still flagged",
    findUngroundedCuratedClaimTerm("Added observability to the queue.", "Wrote Celery tasks.") === "observability"],
  ["plain CI never implies CI/CD", f("Built CI/CD with GitHub Actions.", "ci/cd required", "ran tests in github actions ci.") === "ci/cd"],

  // --- 2026-10 review regressions: precision fixes must not reopen fabrication ---
  ...[
    "Part of a 4-person team for the capstone room scheduler.",
    "Contributor to the Apache Airflow scheduler plugin system.",
    "Coursework in distributed systems and Kafka stream processing.",
    "Member of the payouts team that moved the cron script to Celery workers.",
    "Intern on the payouts reconciliation service.",
    "Backend engineer focused on payments reconciliation services in Python."
  ].map((line) => [`participation or role line "${line.slice(0, 24)}…" cannot become Built`,
    hasUnsupportedOwnershipIncrease("Built the scheduler, plugin system, stream processing, and reconciliation services.", line, line)]),
  ["an unrelated direct verb does not support the assisted work",
    hasUnsupportedOwnershipIncrease("Designed the payouts service migration to Celery workers.", assisted, `${assisted}\nLoad-tested the payouts Celery workers on Redis before launch.`)
      && hasUnsupportedOwnershipIncrease("Migrated the payouts service to Celery workers backed by Redis.", assisted, `${assisted}\nLoad-tested the payouts Celery workers on Redis before launch.`)],
  ["learning or documenting is not building", ["Learned", "Documented", "Attended"].every((verb) =>
    hasUnsupportedOwnershipIncrease("Built the payouts Celery workers.", "", `${verb} the payouts Celery workers.`))],
  ["a multi-line baseline with a role title gains no assisted-work warning",
    !hasUnsupportedOwnershipIncrease("Maintained the billing dashboard reports.", "Assistant Engineer\nHelped with billing dashboard reports.", "Assistant Engineer\nHelped with billing dashboard reports.")],
  ...[
    "Basic knowledge of Kafka consumers for invoice events.",
    "Hands-on experience with Kafka consumers for invoice events.",
    "Studying Kafka consumers for invoice events.",
    "Code reviews for the Kafka consumers of invoice events.",
    "QA testing of Kafka consumers for invoice events.",
    "Bootcamp curriculum covering Kafka consumers for invoice events.",
    "Tutoring sessions on Kafka consumers for invoice events.",
    "Mentorship from staff on Kafka consumers for invoice events.",
    "Payments squad for Kafka consumers of invoice events.",
    "Backend SWE focused on Kafka consumers for invoice events.",
    "Kafka consumer documentation and QA for invoice events.",
    "Kafka consumer monitoring and alert triage for invoice events.",
    "Invoice event consumers, shadowing the platform manager."
  ].map((line) => [`knowledge, activity, or role line "${line.slice(0, 26)}…" cannot become Built`,
    hasUnsupportedOwnershipIncrease("Built Kafka consumers for invoice events.", line, line)]),
  ["an own-work line supports only authorship of the same thing",
    hasUnsupportedOwnershipIncrease("Built the company payments platform.", "Python CLI that imports bank CSV exports.", "Python CLI that imports bank CSV exports.")
      && hasUnsupportedOwnershipIncrease("Managed the Python CLI that imports bank CSV exports.", "Python CLI that imports bank CSV exports.", "Python CLI that imports bank CSV exports.")],
  ["the assisted verb's support does not carry design or building along",
    hasUnsupportedOwnershipIncrease("Migrated and designed the payouts service on Celery workers.", assisted, `${assisted}\nMigrated the payouts service cron jobs to Celery workers.`)],
  ["only the assisted work names assisted verbs, not nouns or relative clauses",
    !hasUnsupportedOwnershipIncrease("Used Redis while assisting senior engineers in migrating the payouts service.", "Assisted senior engineers in migrating the payouts service, which used Redis.", "Assisted senior engineers in migrating the payouts service, which used Redis.")],
  ["helping by doing names the candidate's own means",
    !hasUnsupportedOwnershipIncrease("Automated weekly reports for the finance team.", "Helped the finance team by automating weekly reports.", "Helped the finance team by automating weekly reports.")],
  ["restating shared work with a shared-work verb is not inflation",
    !hasUnsupportedOwnershipIncrease("Supported the on-call rotation for payouts alongside senior engineers.", "Helped senior engineers in supporting the on-call rotation for payouts.", "Helped senior engineers in supporting the on-call rotation for payouts.")],
  ["a denied concept is not entailed by specific evidence",
    candidateClaimIssue("Ran accessibility audits and added ARIA labels to the intake forms.", "Added ARIA labels to the intake forms. No accessibility experience beyond labels.") !== null],
  ["a person or lowercase phrase is not observability evidence",
    findUngroundedCuratedClaimTerm("Added observability to the queue.", "Reported to Dr. Jaeger on the queue.") === "observability"
      && findUngroundedCuratedClaimTerm("Added observability to the queue.", "Gave the queue a new relic of the old cron jobs.") === "observability"],
  ...["Scale AI labeling helpers for dispatch.", "Drive sync helpers for dispatch.", "Make targets for dispatch builds.", "Indeed job-feed helpers for dispatch."].map((text) =>
    [`a product named like a verb is still a claim: ${text.split(" ")[0]}`, findUngroundedClaimTerm(text, "Built Django endpoints for dispatch teams.") !== null]),
  ["a capitalized heading word in the posting is not a product name",
    f("Build Django endpoints for dispatch.", "senior engineer, build and release", "built django endpoints for dispatch.", { jobText: "Senior Engineer, Build and Release" }) === null
      && f("Lead the dispatch API rewrite.", "tech lead", "led the dispatch api rewrite.", { jobText: "Tech Lead" }) === null],
  ...[
    "Bug fixes for the payments API.",
    "Unit tests for the billing service in Python.",
    "Feature flags for the checkout page.",
    "Accessibility audit of the patient portal.",
    "Checkout service rewrite, pairing with a mentor.",
    "Payments API work with Alice.",
    "Payments API hotfix."
  ].map((line) => [`work on a thing "${line.slice(0, 24)}…" is not building it`,
    hasUnsupportedOwnershipIncrease(`Built the ${line.split(/ (?:for|of) the | rewrite/)[1]?.replace(/[.,].*$/, "") ?? "service"}.`, line, line)]),
  ["an own-work line still supports Built when the rewrite names its thing",
    !hasUnsupportedOwnershipIncrease("Built a real-time chat app with WebSockets and Redis.", "Real-time chat app with WebSockets and Redis.", "Real-time chat app with WebSockets and Redis.")],
  ["a present-tense assist line rewritten as the assisted action is inflation",
    hasUnsupportedOwnershipIncrease("Switch nightly archive uploads to S3 multipart transfers.", "Assist infrastructure engineers in switching nightly archive uploads to S3 multipart transfers.", "Assist infrastructure engineers in switching nightly archive uploads to S3 multipart transfers.")],
  ["an acronym is a name, not a sentence-initial verb",
    f("RAN tooling for the billing service.", "skills: ran, o-ran, 5g core", "built billing service tooling.", { jobText: "Skills: RAN, O-RAN, 5G core" }) === "RAN"],
  ["a Python framework is Python evidence, never against a denial",
    f("Built Python services for dispatch.", "python required", "built django rest endpoints for dispatch.") === null
      && findUngroundedClaimTerm("Built Python services for dispatch.", "Built Django REST endpoints for dispatch.") === null
      && candidateClaimIssue("Wrote Python services for dispatch.", "Built Django REST endpoints for dispatch.") === null
      && candidateClaimIssue("Wrote Python services for dispatch.", "Built Django REST endpoints for dispatch. No production Python experience.") !== null
      && findUngroundedClaimTerm("Built Django admin pages.", "Built Python scripts.") === "Django"
      && findUngroundedClaimTerm("Wrote Python scripts.", "Fed the red pandas at the zoo.") === "Python"],
  ["OOP abbreviates written-out object-oriented evidence, never the reverse",
    findUngroundedClaimTerm("Applied OOP design to the invoice parser.", "Wrote an object-oriented invoice parser.") === null
      && findUngroundedClaimTerm("Applied OOP design to the invoice parser.", "Wrote an invoice parser.") === "OOP"
      && findUngroundedClaimTerm("Applied OOP design to the invoice parser.", "Wrote procedural scripts with no object-oriented design.") === "OOP"
      && findUngroundedClaimTerm("Applied SOLID design to the invoice parser.", "Wrote an object-oriented invoice parser.") === "SOLID"],
  ...[["Handled 10k requests per second.", "Handled 10k requests per day."], ["Served 2M customers.", "Served 2M users."], ["Ran 3 dozen services.", "Ran 3 dozen tests."]].map(([claim, source]) =>
    [`a magnitude keeps the counted noun and rate: ${claim}`, findUngroundedNumericClaim(claim, source) !== null && findUngroundedNumericClaim(source, source) === null]),
  ["a lower verb than the assisted work is not inflation",
    !hasUnsupportedOwnershipIncrease("Tested the payouts service migration to Celery workers.", assisted, assisted)],
  ...[["Processed 2B rows.", "Processed 2 rows."], ["Optimized 50K queries.", "Optimized 50 queries."], ["Scaled to 3x nodes.", "Scaled to 3 nodes."],
    ["Trained 5 hundred engineers.", "Trained 5 engineers."], ["Served 4k users.", "Served 4 users."]].map(([claim, source]) =>
    [`a magnitude is part of the number: ${claim}`, findUngroundedNumericClaim(claim, source) !== null]),
  ["a count cannot gain a severity or seniority modifier",
    findUngroundedNumericClaim("Fixed 14 critical security bugs.", qaBugs) !== null
      && findUngroundedNumericClaim("Fixed 14 production bugs.", qaBugs) !== null
      && findUngroundedNumericClaim("Onboarded 5 senior engineers.", "Onboarded 5 engineers.") !== null],
  ...[["Reduced build times for the mobile app.", "Cut release branches for the mobile app."],
    ["Reduced deploy time for the billing service.", "Led the cut-over of the billing service."],
    ["Reduced the onboarding backlog.", "Worked through budget cuts on the onboarding team."],
    ["Decreased page load time.", "Trimmed unused dependencies from the page bundle."],
    ["Shortened onboarding for new billing engineers.", "Lowered the logging verbosity of the billing service."]].map(([claim, source]) =>
    [`another sense or object of a reduction verb is not evidence: ${claim}`, findUngroundedOutcomeClaim(claim, source) !== null]),
  ["ambiguous words do not establish a concept",
    f("Added observability to the honeycomb layout.", "observability required", "built a honeycomb layout for the gallery.") === "observability"
      && f("Built forms for accessibility.", "accessibility required", "worked with aria on the forms team.") === "accessibility"
      && f("Built forms for accessibility.", "accessibility required", "added keyboard navigation shortcuts for power users.") === "accessibility"],
  ["a verb the posting uses as a name is still a claim at sentence start",
    f("Boost libraries for carrier rate lookups.", "experience with c++ and boost.", "built django endpoints for carrier rate lookups.", { jobText: "Experience with C++ and Boost." }) === "Boost"
      && f("Build Django endpoints for carrier rate lookups.", "- build django endpoints", "built django endpoints for carrier rate lookups.", { jobText: "Responsibilities:\n- Build Django endpoints" }) === null],

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
assert(checks.length >= 119, `grounding probe count dropped below the floor (119): found ${checks.length}`);

let failures = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failures++;
}
console.log(`\n${checks.length - failures}/${checks.length} probes passed.`);
process.exit(failures ? 1 : 0);
