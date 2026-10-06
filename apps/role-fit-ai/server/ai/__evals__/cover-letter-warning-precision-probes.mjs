// Cover-letter evidence warnings fire on unsupported claims, not on honest prose.
// Each rule below was kept because the 2026-10-05 benchmark replay showed it removed
// false warnings on real letters; the recall it gives up is recorded in CONTINUITY.md.
// Synthetic fixtures only.
import assert from "node:assert/strict";
import { coverLetterParagraphClaims } from "../coverLetterParagraphEvidence.ts";
import { candidateClaimSentences } from "../coverLetterGroundingIssues.ts";
import { validateCoverLetterTailorOutput } from "../coverLetterContracts.ts";
import { findUngroundedNumericClaim } from "../sanitize.ts";
import { findUngroundedJdTerm, findUngroundedOutcomeClaim, ownershipStrength } from "../grounding.ts";

const resolved = { candidateName: "Jordan Lee", role: "Software Engineer, Continuous Deployment (Remote)", company: "Acme", recipientName: "", date: "July 28, 2026", greeting: "Dear Acme Hiring Team,", signoff: "Sincerely,\nJordan Lee" };
const atlas = "Atlas · Jan 2026 – Present · React, TypeScript, Django REST Framework, PostgreSQL";
const evidence = [
  { id: "r1", source: "resume", section: "Projects", entry: atlas, text: "Generated TypeScript types from Django OpenAPI schemas; CI runs 480+ Django tests against PostgreSQL." },
  { id: "r2", source: "resume", section: "Projects", entry: atlas, text: "Implemented duration-aware appointment conflict checks." },
  { id: "r3", source: "resume", section: "Projects", entry: "Beacon · Mar 2026 – Present · Node.js", text: "Built a Node.js CLI that standardizes tool setup across repositories." },
  { id: "r3b", source: "resume", section: "Projects", entry: "Beacon · Mar 2026 – Present · Node.js", text: "Shipped 12 adapters." },
  { id: "r4", source: "resume", section: "Technical Skills", entry: "Frontend", text: "React, React Query, Tailwind CSS" },
  { id: "p1", source: "profile", text: "## Atlas (personal project, Jan 2026–present)" },
  { id: "p2", source: "profile", text: "Deployed with AWS Amplify frontends and a Render-hosted Django backend." },
  { id: "p3", source: "profile", text: "## Beacon (personal project)" },
  { id: "p4", source: "profile", text: "Generates tool-specific adapters from shared workflow definitions." },
  { id: "p5", source: "profile", text: "## Clinic (professional employment)" },
  { id: "p6", source: "profile", text: "Redesigned room assignments to relieve intake bottlenecks." }
];
const jobText = "Acme needs a Software Engineer, Continuous Deployment (Remote) with ETL, Kafka, AWS, and continuous deployment experience.";
const warnings = (text, evidenceIds) => coverLetterParagraphClaims({ paragraphs: [{ text, evidenceIds, slotIds: [] }], evidence, authoredProse: "", jobText, resolved }).issues.map((issue) => `${issue.code}:${issue.unsupportedValue ?? ""}`);
const clean = (text, ids, label) => assert.deepEqual(warnings(text, ids), [], label);
const warns = (text, ids, pattern, label) => assert.match(warnings(text, ids).join(" | "), pattern, label);

// A "+" qualifier keeps a count with its noun.
assert.equal(findUngroundedNumericClaim("CI runs 480 Django tests.", "runs 480+ Django tests"), null);
assert.equal(findUngroundedNumericClaim("CI runs more than 480 Django tests.", "runs 480-plus Django tests"), null);
assert.equal(findUngroundedNumericClaim("CI runs 500 Django tests.", "runs 480+ Django tests"), "500 Django tests");
assert.equal(findUngroundedNumericClaim("customized ones are preserved", "installs only missing files"), null, "a number word ends at a word boundary");

// Whole-word concept matching.
assert.equal(findUngroundedJdTerm("keep rules from quietly drifting", "etl pipelines", "", { proseMode: true }), null, "etl is not inside quietly");
assert.equal(findUngroundedJdTerm("I built ETL pipelines.", "etl pipelines", "", { proseMode: true }), "etl");

// Compound adjectives and origin idioms are not outcomes; causal "led to" is not leadership.
assert.equal(findUngroundedOutcomeClaim("I build LLM-enabled features.", "Built features.", { candidateProse: true }), null);
assert.equal(findUngroundedOutcomeClaim("I enabled a new checkout.", "Built features.", { candidateProse: true }), "enable");
assert.equal(findUngroundedOutcomeClaim("Atlas grew out of problems I saw at the clinic.", "Built Atlas.", { candidateProse: true }), null);
assert.equal(findUngroundedOutcomeClaim("I grew revenue.", "Built Atlas.", { candidateProse: true }), "grow");
assert.equal(ownershipStrength("Troubleshooting with staff led me to develop Atlas."), 0);
assert.equal(ownershipStrength("I led the migration."), 3);

// The prepared role, company, and a team's name are not skill claims; denials claim nothing.
clean("I am applying for the Software Engineer, Continuous Deployment (Remote) role at Acme.", ["r1"], "the whole role title is a name");
clean("I would be glad to support the platform team at Acme.", ["r1"], "a team name is not a skill");
warns("I would be glad to support the Kafka platform team at Acme.", ["r1"], /kafka/i, "a team name that carries a tool stays checkable");
clean("I have not worked with Kafka, and I would expect to learn it on the job.", ["r1"], "a denial");
warns("I have built Kafka consumers for Atlas.", ["r1"], /kafka/i, "an affirmative Kafka claim still warns");
clean("Acme's 401(k) portal caught my attention.", ["r1"], "a plan name is not a count");
clean("It brings intake and review into one workflow.", ["r1"], "\"one\" is an article in prose");
assert.deepEqual(candidateClaimSentences("Acme's focus on tools that enable growth caught my attention because the role pairs building with testing.", resolved), [], "an employer-led sentence that only caught the candidate's attention is an employer statement");
assert.equal(candidateClaimSentences("Acme's focus on tools caught my attention, and I have built similar tools.", resolved).length, 1);

// A citation grounds its whole entry, including the Profile section that names it; a named entry is checked against itself.
clean("In Atlas I generated TypeScript types and ran 480+ Django tests, with frontends deployed on AWS Amplify.", ["r2"], "a sibling bullet and the linked Profile section ground the entry");
clean("Beacon is a Node.js CLI that generates tool-specific adapters.", ["r1"], "a named entry is checked against its own evidence even when uncited");
warns("Beacon runs 480+ Django tests against PostgreSQL.", ["r1"], /480/, "a named entry cannot borrow another entry's count");
warns("At Atlas I built a Kafka consumer.", ["r1"], /kafka/i, "a named entry is checked against its own evidence");
clean("Across the frontend and backend, I generated TypeScript types from OpenAPI schemas.", ["r1"], "a lowercase word is not the Frontend Skills row");

// A modal earlier in the clause makes an outcome an offer; compound adjectives carry no ownership; PostgreSQL is a relational database.
clean("My full-stack work would allow me to contribute to building new features and improving platform reliability.", ["r1"], "an offered outcome is not a record");
assert.equal(ownershipStrength("Building it meant the layered, API-driven approach your posting describes."), 0);
assert.equal(ownershipStrength("Co-led the migration."), 3, "co-led is still leadership");
clean("In Atlas I built relational database models in PostgreSQL.", ["r1"], "PostgreSQL grounds relational database");

// A value only the base letter supports is surfaced so the stale letter gets fixed; the resume and Profile still ground it when they state it.
const sourceOnly = coverLetterParagraphClaims({ paragraphs: [{ text: "At Clinic I redesigned room assignments, reducing patient wait times by more than 50%.", evidenceIds: ["p6", "source_letter"], slotIds: [] }], evidence, authoredProse: "I redesigned room assignments, reducing patient wait times by more than 50%.", jobText, resolved });
assert.equal(sourceOnly.issues.length, 0, "the authored letter still grounds its own claim");
assert.match(sourceOnly.warnings.join(" "), /"50%" comes only from your base letter/);
const stated = coverLetterParagraphClaims({ paragraphs: [{ text: "In Atlas, CI runs 480+ Django tests.", evidenceIds: ["r1", "source_letter"], slotIds: [] }], evidence, authoredProse: "CI runs 480+ Django tests.", jobText, resolved });
assert.deepEqual(stated.warnings, [], "a value the resume states draws no base-letter warning");

// Glued names are not counts, spelling variants count the same noun, and polarity is judged per clause.
assert.equal(findUngroundedNumericClaim("validated against 3GPP LTE specifications", "Built modem tests."), null, "3GPP is a name");
assert.equal(findUngroundedNumericClaim("more than 140 offline regression and adversarial evaluations", "140+ offline regression and adversarial evals"), null, "evaluations and evals count the same thing");
warns("I live in Queens and can work on site five days a week, and I would like to contribute to the team.", ["p5"], /five days/, "a factual clause survives an intent clause");
clean("I have not used Kafka, and I would like to learn it.", ["r1"], "a denial plus an intent claims nothing");

// Review-driven negatives (2026-10-06): the relaxations must not open these holes.
assert.equal(findUngroundedNumericClaim("Reduced p95 latency from 800ms to 200ms.", "Reduced p95 latency for the claims API."), "800ms", "a glued unit is still a quantity");
assert.equal(findUngroundedNumericClaim("Held p95 under 500ms.", "Held p95 under 900ms."), "500ms", "a changed glued quantity warns");
assert.equal(findUngroundedNumericClaim("Finished 1st of 40 teams.", "Finished 1st of 40 teams."), null, "an ordinal grounds itself");
assert.equal(findUngroundedJdTerm("Built data pipelines for billing.", "experience building data pipelines", "built a billing service in django", { proseMode: true }), "data pipeline", "a plural concept still matches");
warns("I want to bring the experience of leading 12 Kafka migrations at Clinic to Acme.", ["p5"], /kafka|12 kafka/i, "an aspiration still carries its facts");
warns("I am interested in Acme because at Clinic I scaled Kafka to 2 million events per day.", ["p5"], /kafka|million/i, "interest does not hide a claim");
assert.match(coverLetterParagraphClaims({ paragraphs: [{ text: "I have built Kafka consumers at Clinic.", evidenceIds: ["p5"], slotIds: [] }], evidence, authoredProse: "", jobText: "Acme needs Kafka.", resolved: { ...resolved, role: "Backend Engineer - Kafka" } }).issues.map((issue) => issue.unsupportedValue).join(" "), /kafka/i, "a tool in the role title is still a claim elsewhere");
assert.deepEqual(coverLetterParagraphClaims({ paragraphs: [{ text: "I have built production Databricks pipelines at Clinic.", evidenceIds: ["p5"], slotIds: [] }], evidence, authoredProse: "", jobText: "Databricks needs Databricks pipeline builders.", resolved: { ...resolved, company: "Databricks" } }).issues.map((issue) => issue.unsupportedValue), ["Databricks"], "a company that is also a tool stays checkable as a tool");
assert.deepEqual(coverLetterParagraphClaims({ paragraphs: [{ text: "I would be glad to join Databricks and support Databricks' roadmap.", evidenceIds: ["p5"], slotIds: [] }], evidence, authoredProse: "", jobText: "Databricks is hiring.", resolved: { ...resolved, company: "Databricks" } }).issues, [], "the company used as a name is not a claim");
warns("At Clinic I built a scheduling system that served one million users.", ["p5"], /one million/i, "one million is a quantity");
warns("I have one year of professional clinic experience.", ["p5"], /one year/i, "one year is a duration");
warns("At Clinic I managed the 15-person intake team.", ["p5"], /15/, "a team name keeps its count");
warns("At Clinic I led the Kafka platform team.", ["p5"], /kafka/i, "a team name keeps its tool");
assert.equal(findUngroundedOutcomeClaim("Built an intake form that clinicians can complete in one step, which eliminated duplicate charting.", "Built an intake form."), "eliminate", "a modal in an earlier clause does not excuse a later outcome");
assert.equal(ownershipStrength("I led them to ship the migration."), 3, "leading people is leadership");
assert.equal(ownershipStrength("Self-directed the migration."), 3);
assert.equal(findUngroundedOutcomeClaim("Re-enabled nightly reports for clinicians.", "Wrote reports."), "enable", "a verb prefix keeps the verb");
assert.equal(findUngroundedNumericClaim("Built 1 dashboard.", "Built 1 dashboard tracking errors."), null, "a participle ends the counted phrase");
assert.equal(findUngroundedNumericClaim("Shipped 3 apps.", "Reviewed 3 applications for loans."), "3 apps", "apps and applications are different things");
clean("I generated TypeScript types from the OpenAPI schema and ran the suite against PostgreSQL.", ["r2"], "an unnamed sentence is grounded by a sibling bullet");
warns("In ATLAS I shipped 12 adapters.", ["r3b"], /12 adapters/, "a name written in caps still narrows to its own entry");
clean("I would be glad to support the platform team at Acme as a backend developer.", ["r1"], "a team name is not a skill even when the role title shares no words");

// Profile grouping follows the shared linker: no headings means one line per group, a grouping heading does not absorb nested entries, a nested heading naming another entry is its own group, skills rows never link.
const flat = [
  { id: "f1", source: "resume", section: "Projects", entry: atlas, text: "Built Atlas." },
  { id: "f2", source: "profile", text: "Atlas uses PostgreSQL." },
  { id: "f3", source: "profile", text: "Beacon streams events through Kafka." }
];
const flatIssues = coverLetterParagraphClaims({ paragraphs: [{ text: "I streamed events through Kafka.", evidenceIds: ["f2"], slotIds: [] }], evidence: flat, authoredProse: "", jobText, resolved }).issues;
assert.match(flatIssues.map((issue) => issue.unsupportedValue).join(" "), /kafka/i, "lines under no heading do not ground each other");
const nested = [
  { id: "n1", source: "resume", section: "Projects", entry: atlas, text: "Built Atlas." },
  { id: "n2", source: "resume", section: "Projects", entry: "Beacon · Mar 2026 – Present · Node.js", text: "Built Beacon." },
  { id: "n3", source: "profile", text: "# Projects" },
  { id: "n4", source: "profile", text: "## Atlas (personal project)" },
  { id: "n5", source: "profile", text: "Atlas uses PostgreSQL." },
  { id: "n6", source: "profile", text: "### Beacon" },
  { id: "n7", source: "profile", text: "Beacon streams events through Kafka." },
  { id: "n8", source: "resume", section: "Technical Skills", entry: "Cloud", text: "AWS, Docker" },
  { id: "n9", source: "profile", text: "## Cloud cost notes" },
  { id: "n10", source: "profile", text: "Tuned Kafka retention to cut cloud cost." }
];
const nestedCheck = (text, ids) => coverLetterParagraphClaims({ paragraphs: [{ text, evidenceIds: ids, slotIds: [] }], evidence: nested, authoredProse: "", jobText, resolved }).issues.map((issue) => issue.unsupportedValue).join(" ");
assert.match(nestedCheck("In Atlas I streamed events through Kafka.", ["n5"]), /kafka/i, "a nested heading naming another entry is not the parent's evidence");
assert.match(nestedCheck("I streamed events through Kafka.", ["n1"]), /kafka/i, "a grouping heading does not pool entries");
assert.match(nestedCheck("I tuned Kafka retention.", ["n8"]), /kafka/i, "a Skills row never links a Profile section");
assert.equal(nestedCheck("I use PostgreSQL in Atlas.", ["n1"]), "", "a linked section still grounds its entry");

// Second review (2026-10-06): a denial governs only its own clause; a company or title is a name only in its frame;
// same-title entries never pool; stack and location segments never link; glued metrics stay quantities; counts stay on their line.
const clinicJob = "Clinic Acme needs Go, Kafka, Airflow, Snowflake, and Databricks experience.";
const clinicCheck = (text, company = "Acme", role = resolved.role) => coverLetterParagraphClaims({ paragraphs: [{ text, evidenceIds: ["p5"], slotIds: [] }], evidence, authoredProse: "", jobText: clinicJob, resolved: { ...resolved, company, role } }).issues.map((issue) => issue.unsupportedValue ?? "").join(" ");
assert.match(clinicCheck("Having never used Go, I shipped 12 Go services at Clinic."), /12 go|go/i, "a denial does not hide the facts after it");
assert.match(clinicCheck("Never content with manual deploys, I migrated 40 services to Kafka at Clinic."), /kafka|40/i);
assert.match(clinicCheck("No outage occurred when I moved 40 services to Kafka at Clinic."), /kafka|40/i);
assert.match(clinicCheck("I have deep experience with Snowflake.", "Snowflake"), /snowflake/i, "a company that is a tool stays a claim after \"with\"");
assert.match(clinicCheck("At Clinic I integrated the Databricks API.", "Databricks"), /databricks/i);
assert.equal(clinicCheck("I would be glad to join Snowflake and support the Snowflake team.", "Snowflake"), "", "the company in an employer frame is a name");
assert.match(clinicCheck("At Clinic I was a Senior Kafka Engineer.", "Acme", "Senior Kafka Engineer"), /kafka/i, "a past title that carries a tool is a claim");
assert.equal(clinicCheck("I am applying for the Senior Kafka Engineer role at Acme.", "Acme", "Senior Kafka Engineer"), "", "the applied-for title is a name");
assert.match(clinicCheck("At Clinic I joined the twelve engineer intake team."), /twelve/i, "a word-number team size stays a count");
assert.match(clinicCheck("At Clinic I worked with fifty-one engineers."), /fifty-one/i);
assert.match(clinicCheck("At Clinic I cut no-shows by one percent."), /one percent/i);
const twins = [
  { id: "t1", source: "resume", section: "Experience", entry: "Software Engineer · Jan 2022 – Present · Clinic", text: "Built Django services." },
  { id: "t2", source: "resume", section: "Experience", entry: "Software Engineer · Jun 2019 – Dec 2021 · Bank", text: "Operated 40 Kafka clusters." }
];
assert.match(coverLetterParagraphClaims({ paragraphs: [{ text: "As a Software Engineer at Clinic, I operated 40 Kafka clusters.", evidenceIds: ["t1"], slotIds: [] }], evidence: twins, authoredProse: "", jobText: clinicJob, resolved }).issues.map((issue) => issue.unsupportedValue).join(" "), /kafka|40/i, "same-title entries never pool");
const stacked = [
  { id: "s1", source: "resume", section: "Projects", entry: "Atlas · Jan 2026 – Present · Python", text: "Built Atlas." },
  { id: "s2", source: "profile", text: "## Python" },
  { id: "s3", source: "profile", text: "Wrote 40 Kafka consumers at Bank." }
];
assert.match(coverLetterParagraphClaims({ paragraphs: [{ text: "In Atlas I wrote 40 Kafka consumers.", evidenceIds: ["s1"], slotIds: [] }], evidence: stacked, authoredProse: "", jobText: clinicJob, resolved }).issues.map((issue) => issue.unsupportedValue).join(" "), /kafka|40/i, "a stack segment never links a Profile heading");
assert.equal(findUngroundedNumericClaim("Rendered charts at 60fps.", "Rendered charts."), "60fps", "a glued metric stays a quantity");
assert.equal(findUngroundedNumericClaim("I bring 5yrs of Kafka work.", "Built Kafka consumers."), "5yrs");
assert.equal(findUngroundedNumericClaim("Shipped 2FA for the portal.", "Shipped 2FA for the portal."), null);
assert.equal(findUngroundedNumericClaim("Built 18 dashboards.", "Migrated to React 18\nBuilt dashboards for clinicians."), "18 dashboards", "a head noun never crosses a line");
assert.equal(findUngroundedNumericClaim("Built 1 dashboard and APIs.", "Built 1 dashboard."), null, "a conjunction ends the counted phrase");
assert.equal(findUngroundedNumericClaim("Fixed 14 critical bugs.", "Fixed 14 bugs; each was critical."), null, "a modifier stated with a period still counts");
assert.equal(findUngroundedOutcomeClaim("Built a chart clinicians can open from every exam room that eliminated duplicate charting.", "Built a shared chart."), "eliminate", "a modal before a relative pronoun does not excuse the outcome");
assert.equal(findUngroundedOutcomeClaim("In May I shipped a scheduler that reduced no-shows.", "Shipped a scheduler.", { candidateProse: true }), "reduce", "the month May is not a modal");

// A cited deterministic slot is dropped, never repaired.
const sourceContext = { rawTemplateText: "", structuredTemplate: [], authoredProse: "", slots: [
  { id: "slot:role", raw: "[Role]", normalizedPrompt: "role", paragraphIndex: 0, occurrence: 1, resolution: { kind: "deterministic", field: "role", value: resolved.role } },
  { id: "slot:gen", raw: "[Why]", normalizedPrompt: "why", paragraphIndex: 0, occurrence: 1, resolution: { kind: "generate", source: "job_context" } }
] };
const body = `I am applying for the ${resolved.role} role at Acme. `.repeat(2);
const validated = validateCoverLetterTailorOutput({ value: { bodyParagraphs: [{ text: body, evidenceIds: ["r1"], slotIds: ["slot:role", "slot:gen"] }, { text: body, evidenceIds: ["r1"], slotIds: [] }] }, evidence, sourceContext, resolved });
assert.equal(validated.issues.filter((issue) => issue.blocking).length, 0, "a deterministic slot id is not a technical defect");
assert.deepEqual(validated.output.bodyParagraphs[0].slotIds, ["slot:gen"]);
const unknown = validateCoverLetterTailorOutput({ value: { bodyParagraphs: [{ text: body, evidenceIds: ["r1"], slotIds: ["slot:missing"] }, { text: body, evidenceIds: ["r1"], slotIds: [] }] }, evidence, sourceContext, resolved });
assert.equal(unknown.issues.filter((issue) => issue.blocking && issue.code === "unresolved_template").length, 1, "an id the source never had still blocks");

console.log("cover-letter warning precision probes passed");
