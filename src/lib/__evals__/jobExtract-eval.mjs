import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import * as esbuild from "esbuild";

async function loadJobExtract() {
  const source = await readFile(new URL("../jobExtract.ts", import.meta.url), "utf8");
  const output = await esbuild.transform(source, { loader: "ts", format: "esm" });
  return import(`data:text/javascript;base64,${Buffer.from(output.code).toString("base64")}`);
}

function hasPlaceholder(text, label) {
  return new RegExp(`\\[manual input needed: ${label}`, "i").test(text);
}

const { extractJobPosting } = await loadJobExtract();

const americanAirlinesShape = `
Posting Start Date: 6/9/26
Location: DFW Headquarters Building 8 (DFW-SV08)
Cities: Fort Worth - TX
Requisition ID: 85706
Job Description
Intro
Join our American Airlines family and grow your expertise while supporting reliable airline software.
Why you'll love this job
As one diverse, high-performing team dedicated to technical excellence, you will deliver digital products that drive a more reliable and profitable airline.
What you'll do
As noted above, this list is intended to reflect the current job but there may be additional essential functions.
Writes, tests, and documents technical work products according to organizational standards and practices.
Efficiently debugs design-time and run-time problems caused by interactions with other services.
Designs new implementations and provides enhancements to existing architectures.
All you'll need for success
Minimum Qualifications- Education & Prior Job Experience
Bachelor's degree in Computer Science, Engineering, or equivalent experience/training.
1+ years of experience designing, developing, and implementing large-scale solutions in production environments.
Preferred Qualifications- Education & Prior Job Experience
Airline Industry experience
Skills, Licenses & Certifications
Programming Languages: Java, Python, C#, Javascript/Typescript
Deployment Technologies: Kubernetes, Docker
Source Control: GitHub, Azure DevOps
CICD: GitHub Actions, Azure DevOps
Integration/APIs Technologies: Kafka, REST, GraphQL
Test Automation: Selenium, Cypress, PyTest, Playwright
What you'll get
Travel Perks: Explore the world with flight benefits.
`;

const aa = extractJobPosting(americanAirlinesShape);
assert.equal(aa.tracking.title, undefined);
assert.equal(aa.tracking.company, "American Airlines");
assert.equal(aa.tracking.location, "DFW Headquarters Building 8 (DFW-SV08)");
assert(!hasPlaceholder(aa.tailoringText, "core responsibilities"));
assert(!hasPlaceholder(aa.tailoringText, "required qualifications"));
assert(!hasPlaceholder(aa.tailoringText, "tech stack or keywords"));
assert.match(aa.tailoringText, /Core Responsibilities:\n- Writes, tests, and documents technical work products/i);
assert.match(aa.tailoringText, /Required Qualifications:\n- Bachelor's degree/i);
assert.match(aa.tailoringText, /Tech Stack \/ Keywords:[\s\S]*JavaScript[\s\S]*Kubernetes[\s\S]*GraphQL/i);
assert.match(aa.tailoringText, /Domain Signals:\n- aviation/i);
assert(!/Cities: Fort Worth - TX|Airline Industry experience/.test(aa.tailoringText.match(/Job Title:\n(.+)/)?.[1] ?? ""));

const normalTitleShape = `
Software Engineer
General Information
Location: Austin, TX
Job Description
What you will do
Build APIs and write automated tests for customer-facing systems.
Required Qualifications
1+ years of experience with JavaScript and REST APIs.
`;

const normal = extractJobPosting(normalTitleShape);
assert.equal(normal.tracking.title, "Software Engineer");
assert.equal(normal.tracking.location, "Austin, TX");

// ATS metadata stack (Starbucks-shaped): bare "Job Category"/"Job Function"
// labels and the values stacked beneath them must not be mistaken for the title;
// a bare "Pay" label feeds the real range, and a "200 hours" count sitting next
// to a "base pay" sentence must NOT bleed in as $200/hr.
const atsMetadataStack = `
software engineer- ST, Seattle, WA
Seattle, Washington, United States
Job ID
260034646
Job Category
Technology
Job Function
Software Engineering
Job Level
Individual Contributor
Pay
111000-185000
Responsibilities
Build and operate reliable services.
You will accrue vacation up to a maximum of 200 hours (316 in CA) for roles at director or above.
The actual base pay offered to the successful candidate depends on many factors.
`;
const ats = extractJobPosting(atsMetadataStack);
assert.equal(ats.tracking.title, undefined); // "Job Category"/"Technology" are not titles
assert.equal(ats.tracking.salaryMin, 111000); // bare "Pay" label → real range
assert.equal(ats.tracking.salaryMax, 185000);
assert.equal(ats.tracking.salaryPeriod, "yr"); // not $200/hr from the vacation-hours bleed

// "Role:" section paragraph (Northwood-shaped): the label heads a prose
// paragraph, not the title — the "As a <Title> at <Company>" sentence recovers
// it; "Basic Qualifications" is a required-quals heading; a bare "Compensation"
// label feeds the range.
const roleSectionParagraph = `
Software Engineer – General (new grad / early career)
Location
Torrance, CA
Compensation
$120K – $140K • Offers Equity
Role:
As a Software Engineer at Northwood, you will be pivotal in designing and optimizing the global service that delivers connectivity to our customers. You will have ownership over key areas.
Basic Qualifications:
0-2 years of professional software development experience.
Completed bachelor's degree in Computer Science or related field.
Preferred Qualifications:
Proficiency in Rust, Golang, or C/C++.
`;
const roleSection = extractJobPosting(roleSectionParagraph);
assert.equal(roleSection.tracking.title, "Software Engineer"); // not the "Role:" paragraph
assert.equal(roleSection.tracking.company, "Northwood");
assert(!hasPlaceholder(roleSection.tailoringText, "required qualifications"));
assert.match(roleSection.tailoringText, /Required Qualifications:\n- 0-2 years/i);
assert.equal(roleSection.tracking.salaryMin, 120000);
assert.equal(roleSection.tracking.salaryMax, 140000);

// Perk dollar figures (Toyota-shaped): "$2,500 training budget", "$6,000
// adoption assistance" carry a currency token but no range/period/comp context —
// they are perks, not compensation, and must not fabricate a salary.
const perksWithDollars = `
Toyota Connected is looking for a Software Engineer to join our Mobility team.
Responsibilities
Write maintainable, tested code and ship features.
Required Qualifications
Experience writing clean, tested code in Java.
What's in it for you?
Annual $2,500 Training Budget to help you grow.
Adoption Assistance of $5,000 for regular adoptions or $6,000 for special needs.
Home office stipend of $1,000 to help furnish a remote office.
`;
const perks = extractJobPosting(perksWithDollars);
assert.equal(perks.tracking.salaryMin, undefined); // no fabricated salary from perks
assert.equal(perks.tracking.salaryMax, undefined);
assert(perks.manualReviewFields.includes("compensation"));
assert.equal(perks.tracking.title, "Software Engineer"); // prose role still recovered

console.log("jobExtract evals passed");
