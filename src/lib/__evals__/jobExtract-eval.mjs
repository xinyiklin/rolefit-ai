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

console.log("jobExtract evals passed");
