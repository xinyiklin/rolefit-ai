// Cover-letter evidence warnings fire on unsupported claims, not on honest prose.
// Each rule below was kept because the 2026-10-05 benchmark replay showed it removed
// false warnings on real letters; the recall it gives up is recorded in CONTINUITY.md.
// Fixtures are invented (a library-lending app, a sandbox CLI, a marina job); never paste real resume, Profile, or letter text here.
import assert from "node:assert/strict";
import { coverLetterParagraphClaims } from "../coverLetterParagraphEvidence.ts";
import { candidateClaimSentences } from "../coverLetterGroundingIssues.ts";
import { validateCoverLetterTailorOutput } from "../coverLetterContracts.ts";
import { findUngroundedNumericClaim } from "../sanitize.ts";
import { coverLetterIssueWarnings } from "../coverLetterIssues.ts";
import { splitProfileEvidence } from "../../../src/lib/coverLetterEvidence.ts";
import { findUngroundedJdTerm, findUngroundedOutcomeClaim, ownershipStrength } from "../grounding.ts";

const resolved = { candidateName: "Jordan Lee", role: "Platform Engineer, Release Tooling (Remote)", company: "Acme", recipientName: "", date: "July 28, 2026", greeting: "Dear Acme Hiring Team,", signoff: "Sincerely,\nJordan Lee" };
const atlas = "Atlas · Jan 2026 – Present · Vue, TypeScript, FastAPI, MySQL";
const evidence = [
  { id: "r1", source: "resume", section: "Projects", entry: atlas, text: "Generated a typed client from the GraphQL schema; CI runs 310+ pytest cases against MySQL." },
  { id: "r2", source: "resume", section: "Projects", entry: atlas, text: "Added seat-hold expiry so two members cannot reserve the same copy." },
  { id: "r3", source: "resume", section: "Projects", entry: "Beacon · Mar 2026 – Present · Go", text: "Built a Go CLI that provisions sandbox environments across repositories." },
  { id: "r3b", source: "resume", section: "Projects", entry: "Beacon · Mar 2026 – Present · Go", text: "Shipped 12 adapters." },
  { id: "r4", source: "resume", section: "Technical Skills", entry: "Frontend", text: "Vue, Pinia, Tailwind CSS" },
  { id: "p1", source: "profile", text: "## Atlas (personal project, Jan 2026–present)" },
  { id: "p2", source: "profile", text: "Deployed on Fly.io with a managed MySQL instance." },
  { id: "p3", source: "profile", text: "## Beacon (personal project)" },
  { id: "p4", source: "profile", text: "Generates environment adapters from shared YAML definitions." },
  { id: "h1", source: "resume", section: "Experience", entry: "Operations Assistant · Mar 2023 – Present · Harbor", text: "Rescheduled berth assignments to clear arrival backlogs." },
  { id: "p5", source: "profile", text: "## Harbor (professional employment)" },
  { id: "p6", source: "profile", text: "Rescheduled berth assignments to clear arrival backlogs." }
];
const jobText = "Acme needs a Platform Engineer, Release Tooling (Remote) with ETL, Kafka, AWS, and continuous deployment experience.";
const warnings = (text, evidenceIds) => coverLetterParagraphClaims({ paragraphs: [{ text, evidenceIds, slotIds: [] }], evidence, authoredProse: "", jobText, resolved }).issues.map((issue) => `${issue.code}:${issue.unsupportedValue ?? ""}`);
const clean = (text, ids, label) => assert.deepEqual(warnings(text, ids), [], label);
const warns = (text, ids, pattern, label) => assert.match(warnings(text, ids).join(" | "), pattern, label);

// A "+" qualifier keeps a count with its noun.
assert.equal(findUngroundedNumericClaim("CI runs 310 pytest cases.", "runs 310+ pytest cases"), null);
assert.equal(findUngroundedNumericClaim("CI runs more than 310 pytest cases.", "runs 310-plus pytest cases"), null);
assert.equal(findUngroundedNumericClaim("CI runs 500 pytest cases.", "runs 310+ pytest cases"), "500 pytest cases");
assert.equal(findUngroundedNumericClaim("the remaining ones are archived", "archives stale files"), null, "a number word ends at a word boundary");

// Whole-word concept matching.
assert.equal(findUngroundedJdTerm("keep rules from quietly drifting", "etl pipelines", "", { proseMode: true }), null, "etl is not inside quietly");
assert.equal(findUngroundedJdTerm("I built ETL pipelines.", "etl pipelines", "", { proseMode: true }), "etl");

// Compound adjectives and origin idioms are not outcomes; causal "led to" is not leadership.
assert.equal(findUngroundedOutcomeClaim("I build LLM-enabled features.", "Built features.", { candidateProse: true }), null);
assert.equal(findUngroundedOutcomeClaim("I enabled a new checkout.", "Built features.", { candidateProse: true }), "enable");
assert.equal(findUngroundedOutcomeClaim("Atlas grew out of problems I saw at the marina.", "Built Atlas.", { candidateProse: true }), null);
assert.equal(findUngroundedOutcomeClaim("I grew revenue.", "Built Atlas.", { candidateProse: true }), "grow");
assert.equal(ownershipStrength("Helping members at the desk led me to develop Atlas."), 0);
assert.equal(ownershipStrength("I led the migration."), 3);

// The prepared role, company, and a team's name are not skill claims; denials claim nothing.
clean("I am applying for the Platform Engineer, Release Tooling (Remote) role at Acme.", ["r1"], "the whole role title is a name");
clean("I would be glad to support the platform team at Acme.", ["r1"], "a team name is not a skill");
warns("I would be glad to support the Kafka platform team at Acme.", ["r1"], /kafka/i, "a team name that carries a tool stays checkable");
clean("I have not worked with Kafka, and I would expect to learn it on the job.", ["r1"], "a denial");
warns("I have built Kafka consumers for Atlas.", ["r1"], /kafka/i, "an affirmative Kafka claim still warns");
clean("Acme's 401(k) portal caught my attention.", ["r1"], "a plan name is not a count");
clean("It brings arrivals and inspections into one workflow.", ["r1"], "\"one\" is an article in prose");
assert.deepEqual(candidateClaimSentences("Acme's focus on tools that enable growth caught my attention because the role pairs building with testing.", resolved), [], "an employer-led sentence that only caught the candidate's attention is an employer statement");
assert.equal(candidateClaimSentences("Acme's focus on tools caught my attention, and I have built similar tools.", resolved).length, 1);

// A citation grounds its whole entry, including the Profile section that names it; a named entry is checked against itself.
clean("In Atlas I generated a typed client and ran 310+ pytest cases, deployed on Fly.io.", ["r2"], "a sibling bullet and the linked Profile section ground the entry");
clean("Beacon is a Go CLI that generates environment adapters.", ["r1"], "a named entry is checked against its own evidence even when uncited");
warns("Beacon runs 310+ pytest cases against MySQL.", ["r1"], /310/, "a named entry cannot borrow another entry's count");
warns("At Atlas I built a Kafka consumer.", ["r1"], /kafka/i, "a named entry is checked against its own evidence");
clean("Across the frontend and backend, I generated a typed client from the GraphQL schema.", ["r1"], "a lowercase word is not the Frontend Skills row");

// A modal earlier in the clause makes an outcome an offer; compound adjectives carry no ownership; MySQL is a relational database.
clean("My full-stack work would allow me to contribute to building new features and improving platform reliability.", ["r1"], "an offered outcome is not a record");
assert.equal(ownershipStrength("Building it meant the layered, API-driven approach your posting describes."), 0);
assert.equal(ownershipStrength("Co-led the migration."), 3, "co-led is still leadership");
clean("In Atlas I built relational database models in MySQL.", ["r1"], "MySQL grounds relational database");

// A value only the base letter supports is surfaced so the stale letter gets fixed; the resume and Profile still ground it when they state it.
const sourceOnly = coverLetterParagraphClaims({ paragraphs: [{ text: "At Harbor I rescheduled berth assignments, cutting arrival waits by more than 35%.", evidenceIds: ["p6", "source_letter"], slotIds: [] }], evidence, authoredProse: "I rescheduled berth assignments, cutting arrival waits by more than 35%.", jobText, resolved });
assert.equal(sourceOnly.issues.length, 0, "the authored letter still grounds its own claim");
assert.match(sourceOnly.warnings.join(" "), /"35%" comes only from your base letter/);
const stated = coverLetterParagraphClaims({ paragraphs: [{ text: "In Atlas, CI runs 310+ pytest cases.", evidenceIds: ["r1", "source_letter"], slotIds: [] }], evidence, authoredProse: "CI runs 310+ pytest cases.", jobText, resolved });
assert.deepEqual(stated.warnings, [], "a value the resume states draws no base-letter warning");

// Glued names are not counts, spelling variants count the same noun, and polarity is judged per clause.
assert.equal(findUngroundedNumericClaim("validated against 3GPP LTE specifications", "Built modem tests."), null, "3GPP is a name");
assert.equal(findUngroundedNumericClaim("more than 90 nightly contract and smoke evaluations", "90+ nightly contract and smoke evals"), null, "evaluations and evals count the same thing");
warns("I live in Hoboken and can work on site five days a week, and I would like to contribute to the team.", ["p5"], /five days/, "a factual clause survives an intent clause");
clean("I have not used Kafka, and I would like to learn it.", ["r1"], "a denial plus an intent claims nothing");

// Review-driven negatives (2026-10-06): the relaxations must not open these holes.
assert.equal(findUngroundedNumericClaim("Reduced p95 latency from 800ms to 200ms.", "Reduced p95 latency for the claims API."), "800ms", "a glued unit is still a quantity");
assert.equal(findUngroundedNumericClaim("Held p95 under 500ms.", "Held p95 under 900ms."), "500ms", "a changed glued quantity warns");
assert.equal(findUngroundedNumericClaim("Finished 1st of 40 teams.", "Finished 1st of 40 teams."), null, "an ordinal grounds itself");
assert.equal(findUngroundedJdTerm("Built data pipelines for billing.", "experience building data pipelines", "built a billing service in django", { proseMode: true }), "data pipeline", "a plural concept still matches");
warns("I want to bring the experience of leading 12 Kafka migrations at Harbor to Acme.", ["p5"], /kafka|12 kafka/i, "an aspiration still carries its facts");
warns("I am interested in Acme because at Harbor I scaled Kafka to 2 million events per day.", ["p5"], /kafka|million/i, "interest does not hide a claim");
assert.match(coverLetterParagraphClaims({ paragraphs: [{ text: "I have built Kafka consumers at Harbor.", evidenceIds: ["p5"], slotIds: [] }], evidence, authoredProse: "", jobText: "Acme needs Kafka.", resolved: { ...resolved, role: "Backend Engineer - Kafka" } }).issues.map((issue) => issue.unsupportedValue).join(" "), /kafka/i, "a tool in the role title is still a claim elsewhere");
assert.deepEqual(coverLetterParagraphClaims({ paragraphs: [{ text: "I have built production Databricks pipelines at Harbor.", evidenceIds: ["p5"], slotIds: [] }], evidence, authoredProse: "", jobText: "Databricks needs Databricks pipeline builders.", resolved: { ...resolved, company: "Databricks" } }).issues.map((issue) => issue.unsupportedValue), ["Databricks"], "a company that is also a tool stays checkable as a tool");
assert.deepEqual(coverLetterParagraphClaims({ paragraphs: [{ text: "I would be glad to join Databricks and support Databricks' roadmap.", evidenceIds: ["p5"], slotIds: [] }], evidence, authoredProse: "", jobText: "Databricks is hiring.", resolved: { ...resolved, company: "Databricks" } }).issues, [], "the company used as a name is not a claim");
warns("At Harbor I built a slip-booking system that served one million users.", ["p5"], /one million/i, "one million is a quantity");
warns("I have one year of professional marina experience.", ["p5"], /one year/i, "one year is a duration");
warns("At Harbor I managed the 15-person arrivals team.", ["p5"], /15/, "a team name keeps its count");
warns("At Harbor I led the Kafka platform team.", ["p5"], /kafka/i, "a team name keeps its tool");
assert.equal(findUngroundedOutcomeClaim("Built an arrival form that dock staff can complete in one step, which eliminated duplicate logbooks.", "Built an arrival form."), "eliminate", "a modal in an earlier clause does not excuse a later outcome");
assert.equal(ownershipStrength("I led them to ship the migration."), 3, "leading people is leadership");
assert.equal(ownershipStrength("Self-directed the migration."), 3);
assert.equal(findUngroundedOutcomeClaim("Re-enabled nightly reports for members.", "Wrote reports."), "enable", "a verb prefix keeps the verb");
assert.equal(findUngroundedNumericClaim("Built 1 dashboard.", "Built 1 dashboard tracking errors."), null, "a participle ends the counted phrase");
assert.equal(findUngroundedNumericClaim("Shipped 3 apps.", "Reviewed 3 applications for loans."), "3 apps", "apps and applications are different things");
clean("I generated a typed client from the GraphQL schema and ran the suite against MySQL.", ["r2"], "an unnamed sentence is grounded by a sibling bullet");
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
  { id: "n2", source: "resume", section: "Projects", entry: "Beacon · Mar 2026 – Present · Go", text: "Built Beacon." },
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
const harborJob = "Acme needs Go, Kafka, Airflow, Snowflake, and Databricks experience.";
const harborCheck = (text, company = "Acme", role = resolved.role) => coverLetterParagraphClaims({ paragraphs: [{ text, evidenceIds: ["p5"], slotIds: [] }], evidence, authoredProse: "", jobText: harborJob, resolved: { ...resolved, company, role } }).issues.map((issue) => issue.unsupportedValue ?? "").join(" ");
assert.match(harborCheck("Having never used Go, I shipped 12 Go services at Harbor."), /12 go|go/i, "a denial does not hide the facts after it");
assert.match(harborCheck("Never content with manual deploys, I migrated 40 services to Kafka at Harbor."), /kafka|40/i);
assert.match(harborCheck("No outage occurred when I moved 40 services to Kafka at Harbor."), /kafka|40/i);
assert.match(harborCheck("I have deep experience with Snowflake.", "Snowflake"), /snowflake/i, "a company that is a tool stays a claim after \"with\"");
assert.match(harborCheck("At Harbor I integrated the Databricks API.", "Databricks"), /databricks/i);
assert.equal(harborCheck("I would be glad to join Snowflake and support the Snowflake team.", "Snowflake"), "", "the company in an employer frame is a name");
assert.match(harborCheck("At Harbor I was a Senior Kafka Engineer.", "Acme", "Senior Kafka Engineer"), /kafka/i, "a past title that carries a tool is a claim");
assert.equal(harborCheck("I am applying for the Senior Kafka Engineer role at Acme.", "Acme", "Senior Kafka Engineer"), "", "the applied-for title is a name");
assert.match(harborCheck("At Harbor I joined the twelve engineer arrivals team."), /twelve/i, "a word-number team size stays a count");
assert.match(harborCheck("At Harbor I worked with fifty-one engineers."), /fifty-one/i);
assert.match(harborCheck("At Harbor I cut late returns by one percent."), /one percent/i);
const twins = [
  { id: "t1", source: "resume", section: "Experience", entry: "Software Engineer · Jan 2022 – Present · Harbor", text: "Built Django services." },
  { id: "t2", source: "resume", section: "Experience", entry: "Software Engineer · Jun 2019 – Dec 2021 · Bank", text: "Operated 40 Kafka clusters." }
];
assert.match(coverLetterParagraphClaims({ paragraphs: [{ text: "As a Software Engineer at Harbor, I operated 40 Kafka clusters.", evidenceIds: ["t1"], slotIds: [] }], evidence: twins, authoredProse: "", jobText: harborJob, resolved }).issues.map((issue) => issue.unsupportedValue).join(" "), /kafka|40/i, "same-title entries never pool");
const stacked = [
  { id: "s1", source: "resume", section: "Projects", entry: "Atlas · Jan 2026 – Present · Python", text: "Built Atlas." },
  { id: "s2", source: "profile", text: "## Python" },
  { id: "s3", source: "profile", text: "Wrote 40 Kafka consumers at Bank." }
];
assert.match(coverLetterParagraphClaims({ paragraphs: [{ text: "In Atlas I wrote 40 Kafka consumers.", evidenceIds: ["s1"], slotIds: [] }], evidence: stacked, authoredProse: "", jobText: harborJob, resolved }).issues.map((issue) => issue.unsupportedValue).join(" "), /kafka|40/i, "a stack segment never links a Profile heading");
assert.equal(findUngroundedNumericClaim("Rendered charts at 60fps.", "Rendered charts."), "60fps", "a glued metric stays a quantity");
assert.equal(findUngroundedNumericClaim("I bring 5yrs of Kafka work.", "Built Kafka consumers."), "5yrs");
assert.equal(findUngroundedNumericClaim("Shipped 2FA for the portal.", "Shipped 2FA for the portal."), null);
assert.equal(findUngroundedNumericClaim("Built 18 dashboards.", "Migrated to React 18\nBuilt dashboards for members."), "18 dashboards", "a head noun never crosses a line");
assert.equal(findUngroundedNumericClaim("Built 1 dashboard and APIs.", "Built 1 dashboard."), null, "a conjunction ends the counted phrase");
assert.equal(findUngroundedNumericClaim("Fixed 14 critical bugs.", "Fixed 14 bugs; each was critical."), null, "a modifier stated with a period still counts");
assert.equal(findUngroundedOutcomeClaim("Built a log dock staff can open from every office that eliminated duplicate entries.", "Built a shared log."), "eliminate", "a modal before a relative pronoun does not excuse the outcome");
assert.equal(findUngroundedOutcomeClaim("In May I shipped a scheduler that reduced late returns.", "Shipped a scheduler.", { candidateProse: true }), "reduce", "the month May is not a modal");

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

// Third review (2026-10-06, exact head): a percent keeps its metric; the attention idiom exempts only a closed clause;
// a trailing denial drops only itself and a governing denial keeps the fact it frames; the role is a name only in an
// application frame and the company only in an employer frame; a private slot warns; Profile owners go by position;
// a bracketed heading keeps its place; Skills rows are never named; 30d is a duration; "who" ends a counted phrase.
assert.match(String(findUngroundedNumericClaim("Delivered 25 percent lower hosting costs.", "Reduced p95 latency by 25 percent for the loans API.")), /25 percent/, "a percent keeps its own metric");
assert.equal(findUngroundedNumericClaim("Cut hosting costs by 25 percent.", "Cut hosting costs by 25 percent."), null);
assert.match(harborCheck("Acme uses Kafka and Airflow, which drew me after years building Kafka pipelines at Harbor."), /kafka/i, "an idiom mid-sentence does not hide the candidate clause after it");
assert.deepEqual(candidateClaimSentences("Acme's work on Kafka caught my attention.", resolved), [], "an idiom that closes the sentence is an employer statement");
assert.match(harborCheck("At Harbor I shipped 40 Kafka consumers with no prior experience."), /kafka|40/i, "a trailing denial drops only itself");
assert.match(harborCheck("Never once did I miss a deadline while shipping 40 Kafka consumers at Harbor."), /kafka|40/i, "a governing denial keeps the fact it frames");
assert.match(harborCheck("Not one outage in 2 years of running Kafka at Harbor."), /kafka|2 years/i);
assert.equal(harborCheck("I have not used Kafka in production."), "", "a plain denial still claims nothing");
assert.match(harborCheck("As the Senior Kafka Engineer at Harbor, I shipped consumers.", "Acme", "Senior Kafka Engineer"), /kafka/i, "a title outside an application frame is a claim");
assert.equal(harborCheck("I would be glad to contribute as a Senior Kafka Engineer at Acme.", "Acme", "Senior Kafka Engineer"), "", "\"as a <role> at <Company>\" is an application frame");
assert.equal(harborCheck("Your Senior Kafka Engineer posting asks for Go.", "Acme", "Senior Kafka Engineer"), "", "\"<role> posting\" is a frame");
assert.match(harborCheck("I bring three years of Databricks engineering experience from Harbor.", "Databricks"), /databricks/i, "\"<Company> engineering\" is not a frame");
assert.match(harborCheck("At Harbor I scheduled jobs within Databricks.", "Databricks"), /databricks/i, "\"within <Company>\" is not a frame");
assert.match(harborCheck("At Harbor I configured Datadog's agent across 6 hosts.", "Datadog"), /datadog/i, "a possessive before a tool noun stays a claim");
assert.equal(harborCheck("I would be glad to join Databricks' engineering team.", "Databricks"), "", "the company's team is a name");
const privateSlot = { rawTemplateText: "", structuredTemplate: [], authoredProse: "", slots: [
  { id: "slot:ref", raw: "[Referrer's name]", normalizedPrompt: "referrer's name", paragraphIndex: 0, occurrence: 1, resolution: { kind: "needs_input", question: "Provide the private factual detail requested by referrer's name." } }
] };
const referral = validateCoverLetterTailorOutput({ value: { bodyParagraphs: [{ text: `${body}Pat Kim referred me.`, evidenceIds: ["r1"], slotIds: ["slot:ref"] }, { text: body, evidenceIds: ["r1"], slotIds: [] }] }, evidence, sourceContext: privateSlot, resolved });
assert.equal(referral.issues.filter((issue) => issue.blocking).length, 0, "a cited private slot never blocks or repairs");
assert.match(coverLetterIssueWarnings(referral.issues).join(" "), /^Paragraph 1: .*private-detail slot/, "a cited private slot warns on its paragraph");
assert.deepEqual(referral.output.bodyParagraphs[0].slotIds, []);
const profileItems = (text) => splitProfileEvidence(text).map((line, index) => ({ id: `q${index}`, source: "profile", text: line }));
const atlasOnly = { id: "a1", source: "resume", section: "Projects", entry: "Atlas · Jan 2026 – Present · Python", text: "Built Atlas." };
const twice = [atlasOnly, { id: "w1", source: "resume", section: "Experience", entry: "Analyst · 2019 – 2021 · Bank", text: "Wrote reports." }, ...profileItems("## Atlas\nAtlas uses MySQL.\n## Ideas I never shipped\n### Atlas\nPlanned 40 Kafka consumers.")];
assert.match(coverLetterParagraphClaims({ paragraphs: [{ text: "For Atlas I planned 40 Kafka consumers.", evidenceIds: ["a1"], slotIds: [] }], evidence: twice, authoredProse: "", jobText: harborJob, resolved }).issues.map((issue) => issue.unsupportedValue).join(" "), /kafka|40/i, "a same-text heading under an unrelated parent is not the linked one");
const bracketed = [atlasOnly, ...profileItems("## Atlas\nAtlas uses MySQL.\n## Beacon [add dates]\nBeacon streams 40 events per second through Kafka.")];
assert.ok(bracketed.some((item) => item.text === "## Beacon"), "a bracketed heading keeps its place without the slot");
assert.match(coverLetterParagraphClaims({ paragraphs: [{ text: "In Atlas I streamed 40 events per second through Kafka.", evidenceIds: ["a1"], slotIds: [] }], evidence: bracketed, authoredProse: "", jobText: harborJob, resolved }).issues.map((issue) => issue.unsupportedValue).join(" "), /kafka|40/i, "lines under a bracketed heading do not fall into the previous section");
const cloud = [...evidence, { id: "k2", source: "resume", section: "Technical Skills", entry: "Cloud", text: "AWS, Docker, Terraform" }];
const cloudCheck = (text, ids) => coverLetterParagraphClaims({ paragraphs: [{ text, evidenceIds: ids, slotIds: [] }], evidence: cloud, authoredProse: "", jobText: "Acme needs AWS and Terraform.", resolved }).issues.map((issue) => issue.unsupportedValue).join(" ");
assert.match(cloudCheck("Cloud work at Harbor meant I provisioned AWS with Terraform.", ["h1"]), /terraform/i, "a Skills row is never a named entry");
assert.equal(cloudCheck("I have used Terraform.", ["k2"]), "", "a cited Skills row still grounds its tools");
assert.match(String(findUngroundedNumericClaim("Cut onboarding from 30d to 7d.", "Cut onboarding time.")), /30d/, "30d is a duration");
assert.equal(findUngroundedNumericClaim("Rendered 3D charts.", "Rendered charts."), null, "3D is a name");
assert.equal(findUngroundedNumericClaim("Mentored 1 intern who ships weekly.", "Mentored 1 intern."), null, "a relative pronoun ends the counted phrase");

// Fourth review (2026-10-06): a governing denial drops only its own verb phrase; the role title needs its article;
// a tool-ish employer noun is not a name frame; a slot-only heading keeps its place; honest denials and idioms stay quiet;
// "30d" counts days.
assert.match(harborCheck("Not one of the 40 Kafka consumers I shipped at Harbor lost data."), /kafka|40/i, "a clause-initial denial keeps the facts after it");
assert.match(harborCheck("Never once did I miss a page across the 12 Kafka clusters I ran at Harbor."), /kafka|12/i);
assert.match(harborCheck("No one else at Harbor shipped as many Kafka consumers as my 40."), /kafka|40/i);
assert.match(harborCheck("I have no Kafka experience beyond the 40 Kafka consumers I shipped at Harbor."), /kafka|40/i);
assert.equal(harborCheck("Although I didn't use Kafka at Harbor, I built the scheduling service."), "", "a contraction denial claims nothing");
assert.equal(harborCheck("At Harbor I didn't use Kafka."), "");
assert.equal(harborCheck("Though I have never used Apache Kafka, I would learn it quickly."), "", "a two-word object is still the denial's");
assert.equal(harborCheck("I have not used Airflow or Kafka in production."), "");
assert.match(harborCheck("My previous Senior Kafka Engineer role at Harbor taught me scheduling.", "Acme", "Senior Kafka Engineer"), /kafka/i, "a past title before \"role\" is a claim");
assert.match(harborCheck("I held a Senior Kafka Engineer position at Harbor.", "Acme", "Senior Kafka Engineer"), /kafka/i);
assert.equal(harborCheck("Acme's Senior Kafka Engineer opening asks for Go.", "Acme", "Senior Kafka Engineer"), "", "the company's own opening is a frame");
assert.match(harborCheck("At Harbor I instrumented the scheduling service with Datadog's platform.", "Datadog"), /datadog/i, "a possessive before a product noun stays a claim");
assert.match(harborCheck("I built the scheduling service on Snowflake's products.", "Snowflake"), /snowflake/i);
assert.equal(harborCheck("Snowflake's roadmap is why I am applying.", "Snowflake"), "", "a possessive before an employer noun is a name");
const northwind = { ...resolved, company: "Northwind" };
assert.deepEqual(candidateClaimSentences("Northwind's focus on Kafka drew me to this role.", northwind), [], "an idiom that lands on the role is still closed");
assert.deepEqual(candidateClaimSentences("Northwind's focus on Kafka drew me in.", northwind), []);
assert.deepEqual(candidateClaimSentences("Northwind's focus on Kafka caught my eye early.", northwind), []);
const slotOnly = [{ id: "b1", source: "resume", section: "Projects", entry: "Beacon · Mar 2026 – Present · Go", text: "Built Beacon." }, ...profileItems("## Beacon\nBeacon provisions sandboxes.\n## [Project name]\nRuns 12 Airflow DAGs nightly.")];
assert.ok(slotOnly.some((item) => /^## \(untitled\)$/.test(item.text)), "a slot-only heading keeps its level");
assert.match(coverLetterParagraphClaims({ paragraphs: [{ text: "Beacon taught me to run 12 Airflow DAGs nightly.", evidenceIds: ["b1"], slotIds: [] }], evidence: slotOnly, authoredProse: "", jobText: "Acme needs Airflow.", resolved }).issues.map((issue) => issue.unsupportedValue).join(" "), /airflow|12/i, "lines under a slot-only heading do not fall into the previous section");
assert.equal(findUngroundedNumericClaim("Cut onboarding to 30d.", "Cut onboarding to 30 days."), null, "30d counts days");

console.log("cover-letter warning precision probes passed");
