// Offline probes for Resume Polish evidence-warning precision.
//
//   node server/ai/__evals__/resume-proposal-warning-precision-probes.mjs
//
// Each honest-paraphrase class measured in the 2026-10 benchmark must stay
// clean, and each paired fabrication must still warn. All text is synthetic.

import assert from "node:assert/strict";

import { flattenResumeTargets } from "../../../shared/resumePolishContract.ts";
import { sanitizeResumeProposal } from "../resumeProposal.ts";
import { normalizeResumeScope, resumeScopeToText } from "../resumeScope.ts";

const jobText = [
  "Job Title:\nBackend Engineer",
  "Core Responsibilities:\n- Build Django REST endpoints for logistics teams\n- Optimize slow PostgreSQL queries\n- Instrument the Celery queue",
  "Required Qualifications:\n- Database and backend development\n- Frontend experience with accessibility\n- Observability\n- CI/CD\n- Kafka and Storybook",
  "Tech Stack / Keywords:\n- Python, Django, PostgreSQL, React, Snowpipe, Azure Functions, C++ with Boost, and experience with Index"
].join("\n\n");

const entry = (id, titleLeft, bullets) => ({
  id, titleLeft, titleRight: "", subtitleLeft: "", subtitleRight: "",
  bullets: bullets.map((text, index) => ({ id: `${id}-b${index + 1}`, text }))
});

const scope = normalizeResumeScope({
  version: 1,
  locked: { omittedIdentity: true, omittedContact: true, omittedSections: [] },
  sections: [
    {
      id: "experience", heading: "Experience", type: "standard", entries: [
        entry("logistics", "Backend Engineer", [
          "Built Django REST endpoints for carrier rate lookups used by the pricing and dispatch teams.",
          "Rewrote slow PostgreSQL queries for the shipment history page, cutting p95 page load from 4.1s to 1.3s.",
          "Added Prometheus metrics and Grafana dashboards for the Celery queue.",
          "Assisted senior engineers in migrating the payouts service from a cron script to Celery workers backed by Redis.",
          "Fixed 14 bugs from the QA backlog in the claims intake form, a jQuery front end.",
          "Cut the nightly warehouse load from 3 hours to 50 minutes by switching full refreshes to incremental dbt models.",
          "Built reusable React form components with keyboard navigation and ARIA labels.",
          "Maintained a Django admin used by operations staff to manage ferry schedules.",
          "Ran pytest on every pull request with GitHub Actions CI.",
          "Load-tested the payouts Celery workers on Redis before launch."
        ]),
        entry("mobile", "Release Engineer", [
          "Cut release branches for the mobile app every two weeks.",
          "Lowered the logging verbosity of the billing service."
        ]),
        entry("events", "Data Engineer", ["Streamed invoice events through Kafka consumers.", "Wrote helper functions for invoice parsing.", "Deployed the invoice parsers as Lambda handlers."])
      ]
    },
    {
      id: "projects", heading: "Projects", type: "standard", entries: [
        entry("ledger", "Ledger CLI", ["Python CLI that imports bank CSV exports and categorizes transactions.", "Helped a friend add CSV imports for monthly statements."]),
        entry("clinic", "Clinic Platform", ["Full-stack clinic scheduling platform with React, Node.js, Express, and PostgreSQL."]),
        entry("capstone", "Room Scheduler", ["Part of a 4-person team for the capstone room scheduler."]),
        entry("budget", "Budget App", ["Used Kafka.", "Built a Kafka consumer for invoices."]),
        entry("airflow", "Airflow Plugin", ["Contributor to the Apache Airflow scheduler plugin system."])
      ]
    },
    {
      id: "summary", heading: "Summary", type: "summary", entries: [
        entry("summary-entry", "", ["Backend engineer focused on payments reconciliation services in Python."])
      ]
    },
    {
      id: "skills", heading: "Skills", type: "skills", entries: [
        { id: "tools", titleLeft: "Tools", titleRight: "", subtitleLeft: "Python, Google Cloud, AWS", subtitleRight: "", bullets: [] },
        { id: "devtools", titleLeft: "Developer Tools", titleRight: "", subtitleLeft: "Git, Docker", subtitleRight: "", bullets: [] },
        { id: "mobile-skills", titleLeft: "Mobile", titleRight: "", subtitleLeft: "Swift, Core Data", subtitleRight: "", bullets: [] },
        { id: "analytics", titleLeft: "Analytics", titleRight: "", subtitleLeft: "SQL, Data Analytics", subtitleRight: "", bullets: [] },
        { id: "unlabeled", titleLeft: "", titleRight: "", subtitleLeft: "Python", subtitleRight: "", bullets: [] },
        { id: "practices", titleLeft: "Practices", titleRight: "", subtitleLeft: "DevOps, Agile", subtitleRight: "", bullets: [] }
      ]
    }
  ],
  contextSections: []
});
const candidateContext = "I used AWS S3 and EC2 for the ingestion service. I deployed a demo to Azure App Service. Built advanced Python tooling for the ingestion service. Called the OpenAI and Anthropic APIs from the triage bot. Integrates API providers (Mistral, Cohere) for summaries. Ran AI-assisted code review on every pull request. Practiced test-driven development on the ingestion service. Used Docker and the AWS SDKs for uploads. Paired with the team lead on schema design. Integrated Postgres and the Stripe APIs for billing. Built REST APIs (Django, PostgreSQL) for invoicing. Joined the team that co-led the platform migration. Used Docker Compose and the AWS SDK for uploads. Uses Claude Code and Codex daily for implementation, debugging, and pair debugging sessions. Have not used GitHub Copilot for security audits.\n## Ledger CLI (personal project)\n- Imports bank CSV exports and categorizes transactions with rule files.\n- 60 regression tests with fixture exports.\n- Category rules are validated against a JSON schema on load.\n- Parsers share one in-flight import lock.\n- Duplicate transaction detection for imported statements was contributed by a classmate.\n- Uses SQLite for local transaction storage.\n- 12 schema checks validate category rules against a JSON schema.\n## Room Scheduler (personal project with three classmates)\n- Room conflicts are checked with interval trees.\n## Clinic Platform\n- Appointment reminders are sent through a job queue.\n## Budget App (personal project)\n- Envelope budgets roll unspent amounts into the next month.\n## Budget App (agency rewrite)\n- Sync engine reconciles bank feeds nightly.";
const targets = flattenResumeTargets(scope, candidateContext);
const scopeText = resumeScopeToText(scope);
const bullet = (text) => {
  const target = targets.find((item) => item.kind === "bullet" && item.currentText === text);
  assert.ok(target, `fixture bullet exists: ${text}`);
  return target.targetId;
};
const skillRow = (entryId) => targets.find((item) => item.kind === "skill-list" && item.target.entryId === entryId).targetId;
const skills = skillRow("tools");
const devTools = skillRow("devtools");
const mobile = skillRow("mobile-skills");
const summary = targets.find((item) => item.sectionType === "summary").targetId;
const evidenceWarning = (list) => list.find((warning) => warning.startsWith("Not supported by provided evidence. "));

// An honest rewrite that only changes tense or skill order may settle as a no-op.
function warnings(targetId, replacement, mayBeNoOp = false) {
  const result = sanitizeResumeProposal({ status: "PROPOSAL", changes: [{ targetId, replacement }] }, targets, jobText, scopeText, candidateContext);
  if (mayBeNoOp && result.status === "NO_CHANGES") return [];
  assert.equal(result.changes.length, 1, `${replacement} remains a reviewable edit`);
  return result.changes[0].warnings ?? [];
}

// A new bullet names its entry; the sanitizer rejects a slot from another entry.
function added(entryId, replacement) {
  const slot = targets.find((item) => item.kind === "new-bullet" && item.target.entryId === entryId);
  assert.ok(slot, `fixture entry has linked Profile text: ${entryId}`);
  const result = sanitizeResumeProposal({ status: "PROPOSAL", changes: [{ targetId: slot.targetId, entryId, replacement }] }, targets, jobText, scopeText, candidateContext);
  assert.equal(result.changes.length, 1, `${replacement} remains a reviewable edit`);
  return result.changes[0].warnings ?? [];
}

const honest = [
  ["sentence-initial base verb", bullet("Built Django REST endpoints for carrier rate lookups used by the pricing and dispatch teams."),
    "Build Django REST endpoints for carrier rate lookups used by the pricing and dispatch teams."],
  ["sentence-initial verb swap", bullet("Rewrote slow PostgreSQL queries for the shipment history page, cutting p95 page load from 4.1s to 1.3s."),
    "Optimize slow PostgreSQL queries for the shipment history page, cutting p95 page load from 4.1s to 1.3s."],
  ["posting verb on instrumented evidence", bullet("Added Prometheus metrics and Grafana dashboards for the Celery queue."),
    "Instrument the Celery queue with Prometheus metrics and Grafana dashboards for observability."],
  ["own project restated with Built", bullet("Python CLI that imports bank CSV exports and categorizes transactions."),
    "Built a Python CLI that imports bank CSV exports and categorizes transactions."],
  ["database on a PostgreSQL entry", bullet("Rewrote slow PostgreSQL queries for the shipment history page, cutting p95 page load from 4.1s to 1.3s."),
    "Rewrote slow PostgreSQL database queries for the shipment history page, cutting p95 page load from 4.1s to 1.3s."],
  ["frontend and backend on a React/Node project", bullet("Full-stack clinic scheduling platform with React, Node.js, Express, and PostgreSQL."),
    "Built a full-stack clinic scheduling platform with a React frontend and a Node.js and Express backend on PostgreSQL."],
  ["accessibility from ARIA and keyboard evidence", bullet("Built reusable React form components with keyboard navigation and ARIA labels."),
    "Built accessible, reusable React form components with keyboard navigation and ARIA labels for accessibility."],
  ["parenthetical skill grounded part by part", skills, "Python, Google Cloud, AWS (S3, EC2)"],
  ["a skill containing a label word is not a label", skills, "Google Cloud, AWS, Python"],
  ["a framework named with a label word is a skill", mobile, "Core Data, Swift"],
  ["an analytics skill is not a label", skillRow("analytics"), "Data Analytics, SQL"],
  ["an unlabeled row's own item is not its label", skillRow("unlabeled"), "Python, Redis"],
  ["an existing label-like skill can be reordered", skillRow("practices"), "Agile, DevOps"],
  ["a grounded analytics skill can be added", skills, "Python, Google Cloud, AWS, Data Analytics"],
  ["a skill phrase containing a supporting verb", skillRow("practices"), "DevOps, Agile, AI-assisted code review"],
  ["a hyphenated practice is not an ownership claim", skillRow("practices"), "DevOps, Agile, Test-driven development"],
  ["a provider named inside an interface list", skills, "Python, Google Cloud, AWS, Cohere API"],
  ["a provider API named with its interface", skills, "Python, Google Cloud, AWS, OpenAI API, Anthropic API"],
  ["Python on a Django entry", bullet("Built Django REST endpoints for carrier rate lookups used by the pricing and dispatch teams."),
    "Built Python Django REST endpoints for carrier rate lookups used by the pricing and dispatch teams."],
  ["two listed providers sharing one interface", skills, "Python, Google Cloud, AWS, Mistral and Cohere APIs"],
  ["two listed providers joined by a slash", skills, "Python, Google Cloud, AWS, Mistral/Cohere APIs"],
  ["AI-assisted development from a named coding tool", skillRow("practices"), "DevOps, Agile, AI-assisted development (Codex, Claude Code)"],
  ["an AI-assisted activity named beside the tool", skillRow("practices"), "DevOps, Agile, AI-assisted debugging"],
  ["listed providers under an interface head", skills, "Python, Google Cloud, AWS, REST APIs (Mistral, Cohere)"],
  ["RESTful for REST", skills, "Python, Google Cloud, AWS, RESTful APIs"],
  ["a plural of a grounded skill phrase", skillRow("practices"), "DevOps, Agile, AI-assisted code reviews"],
  ["continuous integration for CI", bullet("Ran pytest on every pull request with GitHub Actions CI."),
    "Ran pytest on every pull request with GitHub Actions continuous integration."]
];
// A solo project's own evidence line supports an authorship verb for that same thing.
for (const [label, entryId, replacement] of [
  ["a solo project's counted tests", "ledger", "Built 60 regression tests with fixture exports."],
  ["a solo project's stated behavior", "ledger", "Implemented category rules validated against a JSON schema on load."],
  ["one followed by a participle is not a count", "ledger", "Built parsers with one shared in-flight import lock."],
  ["a count's purpose list reworded from its own line", "ledger", "Wrote 60 regression tests covering export parsing, fixture exports, and regression cases."],
  ["a purpose that belongs to a later count", "ledger", "Wrote 60 regression tests with fixture exports and ran 12 schema checks to validate category rules against a JSON schema."],
  ["a usage verb in the supporting line", "ledger", "Implemented local transaction storage in SQLite."]
]) {
  assert.deepEqual(added(entryId, replacement), [], `${label} carries no evidence warning`);
}
for (const [label, entryId, replacement, named] of [
  ["a count given another line's purpose", "ledger", "Wrote 60 regression tests with fixture exports to verify category rules against a JSON schema.", /ties this count to the purpose[^.]*: 60/],
  ["a feature said to be covered by another line's count", "ledger", "Wrote category rules validated against a JSON schema, covered by 60 regression tests.", /ties this count to the purpose[^.]*: 60/],
  ["a solo project's line that credits someone else", "ledger", "Built duplicate transaction detection for imported statements.", /Unsupported ownership/],
  ["a claim that credits someone else", "ledger", "Built category rules validated against a JSON schema with a classmate.", /Unsupported ownership/],
  ["managing inside a solo project", "ledger", "Built and managed category rules validated against a JSON schema on load.", /Unsupported ownership/],
  ["a team heading beside a solo heading", "budget", "Built a sync engine that reconciles bank feeds nightly.", /Unsupported ownership/],
  ["a count given a one-word purpose from nowhere", "ledger", "Wrote 60 regression tests with fixture exports to verify encryption.", /ties this count to the purpose[^.]*: 60/],
  ["a count given a purpose list its line does not name", "ledger", "Wrote 60 regression tests covering authentication, encryption, and payment reconciliation.", /ties this count to the purpose[^.]*: 60/],
  ["leading a solo project", "ledger", "Led development of 60 regression tests with fixture exports.", /Unsupported ownership/],
  ["two solo-project lines merged into one claim", "ledger", "Built 60 regression tests with fixture exports that validate category rules against a JSON schema.", /Unsupported ownership/],
  ["a project shared with classmates", "capstone", "Implemented room conflict checks with interval trees.", /Unsupported ownership/],
  ["a project whose heading does not call it solo", "clinic", "Implemented appointment reminders sent through a job queue.", /Unsupported ownership/]
]) {
  assert.match(evidenceWarning(added(entryId, replacement)) ?? "", named, `${label} still raises the evidence warning`);
}
for (const [label, targetId, replacement] of honest) {
  assert.deepEqual(warnings(targetId, replacement, true), [], `${label} carries no evidence warning`);
}

const fabricated = [
  ["helping a friend claimed as built in a solo project", bullet("Helped a friend add CSV imports for monthly statements."),
    "Built CSV imports for monthly statements."],
  ["a used tool claimed as built from another line's verb", bullet("Used Kafka."), "Built the Kafka event bus for payments."],
  ["an invented count after one", bullet("Maintained a Django admin used by operations staff to manage ferry schedules."),
    "Maintained a Django admin used by operations staff to manage ferry schedules, with one failed sync per month."],
  ["a different product sharing a stem", skills, "Python, Google Cloud, AWS ECS"],
  ["an AI-assisted activity no tool line names", skillRow("practices"), "DevOps, Agile, AI-assisted data analysis"],
  ["an AI-assisted activity named only in a denial", skillRow("practices"), "DevOps, Agile, AI-assisted security audits"],
  ["a tool beside AI-assisted development that the line does not name", skillRow("practices"), "DevOps, Agile, AI-assisted development (Codex, Windsurf)"],
  ["an AI-assisted activity named on a line with no AI tool", skillRow("practices"), "DevOps, Agile, AI-assisted schema design"],
  ["a part beside AI-assisted development named only on another line", skillRow("practices"), "DevOps, Agile, AI-assisted development (Codex, Docker)"],
  ["sentence-initial posting-only product", bullet("Built Django REST endpoints for carrier rate lookups used by the pricing and dispatch teams."),
    "Snowpipe ingestion for carrier rate lookups used by the pricing and dispatch teams."],
  ["posting-only tool", bullet("Built reusable React form components with keyboard navigation and ARIA labels."),
    "Built reusable React form components in Storybook with keyboard navigation and ARIA labels."],
  ["tool from another entry", bullet("Added Prometheus metrics and Grafana dashboards for the Celery queue."),
    "Added Prometheus metrics and Grafana dashboards for the Celery and Kafka queues."],
  ["assisted work claimed directly", bullet("Assisted senior engineers in migrating the payouts service from a cron script to Celery workers backed by Redis."),
    "Migrated the payouts service from a cron script to Celery workers backed by Redis, working alongside senior engineers."],
  ["maintenance claimed as building", bullet("Maintained a Django admin used by operations staff to manage ferry schedules."),
    "Built a Django admin used by operations staff to manage ferry schedules."],
  ["own project claimed as leadership", bullet("Python CLI that imports bank CSV exports and categorizes transactions."),
    "Led development of a Python CLI that imports bank CSV exports and categorizes transactions."],
  ["the same number counting something else", bullet("Fixed 14 bugs from the QA backlog in the claims intake form, a jQuery front end."),
    "Resolved 14 production incidents in the jQuery claims intake form."],
  ["an invented number", bullet("Fixed 14 bugs from the QA backlog in the claims intake form, a jQuery front end."),
    "Fixed 40 QA-reported bugs in the jQuery front end of the claims intake form."],
  ["a reduction claimed as an increase", bullet("Cut the nightly warehouse load from 3 hours to 50 minutes by switching full refreshes to incremental dbt models."),
    "Increased warehouse throughput by switching full refreshes to incremental dbt models."],
  ["CI relabeled as CI/CD", bullet("Ran pytest on every pull request with GitHub Actions CI."),
    "Ran pytest on every pull request with GitHub Actions CI/CD."],
  ["posting-only part of a parenthetical skill", skills, "Python, Google Cloud, AWS (S3, EKS)"],
  ["category label prefix in a skill list", skills, "Languages: Python, Google Cloud, AWS"],
  ["category label as a skill", skills, "Python, Cloud & DevOps"],
  ["team capstone claimed as built", bullet("Part of a 4-person team for the capstone room scheduler."),
    "Built the capstone room scheduler."],
  ["open-source contribution claimed as built", bullet("Contributor to the Apache Airflow scheduler plugin system."),
    "Built the Apache Airflow scheduler plugin system."],
  ["summary role line claimed as built", summary,
    "Backend engineer who designed and built the payments reconciliation services in Python."],
  ["a sibling test bullet does not support the assisted design", bullet("Assisted senior engineers in migrating the payouts service from a cron script to Celery workers backed by Redis."),
    "Designed the payouts service migration from a cron script to Celery workers backed by Redis."],
  ["a count gains a severity modifier", bullet("Fixed 14 bugs from the QA backlog in the claims intake form, a jQuery front end."),
    "Fixed 14 critical security bugs in the claims intake form, a jQuery front end."],
  ["a count gains a magnitude", bullet("Fixed 14 bugs from the QA backlog in the claims intake form, a jQuery front end."),
    "Fixed 14K bugs from the QA backlog in the claims intake form, a jQuery front end."],
  ["cutting a release branch is not reducing build time", bullet("Cut release branches for the mobile app every two weeks."),
    "Reduced build times for the mobile app every two weeks."],
  ["a reduction about something else", bullet("Lowered the logging verbosity of the billing service."),
    "Shortened onboarding for the billing service."],
  ["posting-only product named like a verb", bullet("Built Django REST endpoints for carrier rate lookups used by the pricing and dispatch teams."),
    "Boost libraries for carrier rate lookups used by the pricing and dispatch teams."],
  ["compound category label prefix", devTools, "Developer Tools: Git, Docker"],
  ["the row's own label as a skill", devTools, "Git, Docker, Developer Tools"],
  ["label word as a parenthetical head", devTools, "Git, Docker, Tools (Kubernetes)"],
  ["posting composite from separate mentions", skills, "Python, Google Cloud, AWS, Azure (Functions)"],
  ["a posting product named like a verb", bullet("Built Django REST endpoints for carrier rate lookups used by the pricing and dispatch teams."),
    "Index dashboards for carrier rate lookups used by the pricing and dispatch teams."],
  ["the row's own non-category label", mobile, "Swift, Core Data, Mobile"],
  ["another row's label as a skill", skills, "Python, Google Cloud, AWS, Mobile"],
  ["a parenthetical part grounded only elsewhere", skills, "Python, Google Cloud, AWS (S3, Lambda)"],
  ["a proficiency qualifier", skills, "Python (advanced), Google Cloud, AWS"],
  ["a category label in parentheses", devTools, "Git, Docker (Developer Tools)"],
  ["a hyphenated category label", devTools, "Git, Docker, Developer-Tools"],
  ["an interface the evidence never names", skills, "Python, Google Cloud, AWS, Azure SDK"],
  ["an interface that belongs to another name", skills, "Python, Google Cloud, AWS, Docker SDK"],
  ["a role phrase from someone else's sentence", skills, "Python, Google Cloud, AWS, Team Lead"],
  ["a determiner is not a listed name", skills, "Python, Google Cloud, AWS, Postgres API"],
  ["a stack list after APIs is not an interface list", skills, "Python, Google Cloud, AWS, PostgreSQL API"],
  ["co-led stays a leadership claim", skills, "Python, Google Cloud, AWS, Co-led the platform migration"],
  ["text after a parenthetical", skills, "Python, Google Cloud, AWS, Docker (Compose) SDK"],
  ["a shared interface one name lacks", skills, "Python, Google Cloud, AWS, Mistral and Docker APIs"],
  ["a name under an interface head that lacks it", skills, "Python, Google Cloud, AWS, REST APIs (Mistral, Docker)"]
];
for (const [label, targetId, replacement] of fabricated) {
  assert.ok(evidenceWarning(warnings(targetId, replacement)), `${label} still raises the evidence warning`);
}

// Floor: deleting a case must shrink the probe loudly. Raise these when adding cases.
assert.ok(honest.length >= 27 && fabricated.length >= 51, "warning precision probe count dropped below the floor");
console.log(`resume proposal warning precision probes: ${honest.length} clean, ${fabricated.length} warned`);

// A warning names the first unsupported term, number, or skill it found.
const django = "Built Django REST endpoints for carrier rate lookups used by the pricing and dispatch teams.";
for (const [label, targetId, replacement, named] of [
  ["a posting-only tool", bullet(django), "Built Django REST endpoints with Kafka for carrier rate lookups used by the pricing and dispatch teams.", "Kafka"],
  ["an invented count", bullet("Fixed 14 bugs from the QA backlog in the claims intake form, a jQuery front end."),
    "Fixed 40 bugs from the QA backlog in the claims intake form, a jQuery front end.", "40"],
  ["an unsupported skill", skills, "Python, Google Cloud, AWS, Terraform", "Terraform"]
]) {
  assert.match(evidenceWarning(warnings(targetId, replacement)) ?? "", new RegExp(`\\b${named}\\b`, "i"), `${label} is named in its warning`);
}

// Every kind of concern in one edit is named, not only the first.
const inflated = evidenceWarning(warnings(bullet("Assisted senior engineers in migrating the payouts service from a cron script to Celery workers backed by Redis."),
  "Led the Kafka migration of the payouts service from a cron script to Celery workers backed by Redis, cutting costs 40%.")) ?? "";
for (const part of [/Kafka/, /40%/, /Unsupported ownership or responsibility/]) assert.match(inflated, part, "an edit with several unsupported claims names each kind");
assert.doesNotMatch(inflated, /merge separate facts|\.\.$/, "a supporting line promoted to leading is never worded as a merge");

// A building verb the entry uses elsewhere, with no one line behind this claim, adds the merge hint.
assert.doesNotMatch(evidenceWarning(warnings(bullet("Streamed invoice events through Kafka consumers."), "Built Kafka consumers that streamed invoice events.")) ?? "",
  /merge separate facts/, "an entry with no building verb keeps the plain ownership wording");
assert.match(evidenceWarning(warnings(bullet("Ran pytest on every pull request with GitHub Actions CI."), "Built pytest runs on every pull request with GitHub Actions CI.")) ?? "",
  /Unsupported ownership or responsibility; no single evidence line/, "an entry that built other things gets the merge hint");

// Churn settles as a no-op: nothing a screener learns changes.
const settle = (targetId, replacement, posting = jobText) =>
  sanitizeResumeProposal({ status: "PROPOSAL", changes: [{ targetId, replacement }] }, targets, posting, scopeText, candidateContext);
for (const [label, targetId, replacement] of [
  ["a tense-only rewrite", bullet(django), "Builds Django REST endpoints for carrier rate lookups used by the pricing and dispatch teams."],
  ["a dropped article", bullet(django), "Built Django REST endpoints for carrier rate lookups used by pricing and dispatch teams."],
  ["a one-word cut", bullet("Maintained a Django admin used by operations staff to manage ferry schedules."),
    "Maintained a Django admin used by staff to manage ferry schedules."],
  ["a skill order that moves no posting skill forward", skills, "Google Cloud, AWS, Python"]
]) {
  const result = settle(targetId, replacement);
  assert.equal(result.status, "NO_CHANGES", `${label} is a no-op`);
  assert.deepEqual(result.withheld, { count: 0, reasons: ["UNCHANGED"] }, `${label} is not a withholding`);
}
for (const [label, targetId, replacement, posting] of [
  ["a trim that frees real space", bullet(django), "Built Django REST endpoints for carrier rate lookups."],
  ["a clause moved to the front", bullet("Cut the nightly warehouse load from 3 hours to 50 minutes by switching full refreshes to incremental dbt models."),
    "Switched full refreshes to incremental dbt models, cutting the nightly warehouse load from 3 hours to 50 minutes."],
  ["a newly bolded keyword", bullet(django), "Built <b>Django</b> REST endpoints for carrier rate lookups used by the pricing and dispatch teams."],
  ["a rounded count", bullet("Fixed 14 bugs from the QA backlog in the claims intake form, a jQuery front end."),
    "Fixed 10+ bugs from the QA backlog in the claims intake form, a jQuery front end."],
  ["a casing fix", bullet(django), "Built Django REST Endpoints for carrier rate lookups used by the pricing and dispatch teams."],
  ["a swapped preposition", bullet("Cut the nightly warehouse load from 3 hours to 50 minutes by switching full refreshes to incremental dbt models."),
    "Cut the nightly warehouse load to 3 hours from 50 minutes by switching full refreshes to incremental dbt models."],
  ["an added symbol", bullet("Fixed 14 bugs from the QA backlog in the claims intake form, a jQuery front end."),
    "Fixed ~14 bugs from the QA backlog in the claims intake form, a jQuery front end."],
  ["a skill order that leads with a posting skill", devTools, "Docker, Git", `${jobText}\n- Docker`],
  ["a skill the posting names by one word", devTools, "Docker, Git", `${jobText}\n- Docker Compose`],
  ["a skill casing fix", skillRow("practices"), "Devops, Agile"],
  ["a newly bolded skill", devTools, "<b>Git</b>, Docker"],
  ["a deduplicated skill list", skillRow("unlabeled"), "Python, Redis"]
]) {
  assert.equal(settle(targetId, replacement, posting).changes.length, 1, `${label} stays a reviewable edit`);
}

const repeated = sanitizeResumeProposal({ status: "PROPOSAL", changes: [
  { targetId: bullet(django), replacement: "Builds Django REST endpoints for carrier rate lookups used by the pricing and dispatch teams." },
  { targetId: bullet(django), replacement: "Built Django REST endpoints for carrier rate lookups." }
] }, targets, jobText, scopeText, candidateContext);
assert.deepEqual([repeated.changes.length, repeated.withheld.reasons.sort()], [0, ["MALFORMED", "UNCHANGED"]], "a second rewrite of a no-op target is still a duplicate");
