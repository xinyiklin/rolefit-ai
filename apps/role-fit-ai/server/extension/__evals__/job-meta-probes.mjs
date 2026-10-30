import assert from "node:assert/strict";
import { extractJobMeta, jobBoardHeader, jobBoardTitleMeta } from "../index.ts";
import { extractJobPosting } from "../../../src/lib/jobExtract.ts";

// extractJobMeta reads the page title and text the extension captured from any
// site, synchronously inside the analyze route, so its parses must stay linear
// and must keep reading the title formats the popup preview relies on.

let failures = 0;
function probe(name, run) {
  try {
    run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${name}: ${error?.message ?? error}`);
  }
}

probe("LinkedIn page titles name the role and employer", () => {
  assert.deepEqual(extractJobMeta("", "Backend Engineer at Acme | LinkedIn"), { title: "Backend Engineer", company: "Acme" });
  assert.deepEqual(
    extractJobMeta("", "Front-End Engineer at Acme Corp | LinkedIn"),
    { title: "Front-End Engineer", company: "Acme Corp" }
  );
  assert.deepEqual(extractJobMeta("", "Senior SRE At Big Co - LinkedIn"), { title: "Senior SRE", company: "Big Co" });
  assert.deepEqual(extractJobMeta("", "Engineer at Coca-Cola | LinkedIn"), { title: "Engineer", company: "Coca-Cola" }, "a hyphenated employer stays whole");
  assert.deepEqual(extractJobMeta("", "Engineer at Rolls-Royce - LinkedIn"), { title: "Engineer", company: "Rolls-Royce" });
  assert.deepEqual(extractJobMeta("", "Engineer at Acme | Careers"), { title: "Engineer at Acme" }, "no LinkedIn marker");
});

probe("Indeed page titles name the role and employer", () => {
  assert.deepEqual(
    extractJobMeta("", "Software Engineer - Acme Corp - New York, NY | Indeed.com"),
    { title: "Software Engineer", company: "Acme Corp" }
  );
  assert.deepEqual(
    extractJobMeta("", "Software Engineer - Acme Corp - New York, NY - Indeed.com"),
    { title: "Software Engineer", company: "Acme Corp" },
    "a trailing - Indeed.com marks the same Indeed form"
  );
});

probe("hyphenated titles stay whole and do not become the employer", () => {
  assert.deepEqual(
    extractJobMeta("", "Front-End Developer - Acme Corp - Austin, TX | Indeed.com"),
    { title: "Front-End Developer", company: "Acme Corp" }
  );
  assert.deepEqual(
    extractJobMeta("", "Co-op Student, Data - Acme - Toronto, ON | Indeed.com"),
    { title: "Co-op Student, Data", company: "Acme" }
  );
  assert.deepEqual(extractJobMeta("", "Front-End Developer - Acme Corp - Austin, TX - Indeed.com"), { title: "Front-End Developer", company: "Acme Corp" });
  assert.deepEqual(extractJobMeta("", "Full-Stack Engineer | Acme Careers"), { title: "Full-Stack Engineer" });
  assert.deepEqual(extractJobMeta("", "Full-Stack Engineer | Acme | LinkedIn"), { title: "Full-Stack Engineer", company: "Acme" });
});

probe("Handshake page titles name the role and employer ahead of LinkedIn", () => {
  assert.deepEqual(
    extractJobMeta("", "Platform Engineer - Data Tools | Example Clinic Co | Handshake"),
    { title: "Platform Engineer - Data Tools", company: "Example Clinic Co" }
  );
  assert.deepEqual(
    extractJobMeta("", "Engineering Manager at Scale | LinkedIn | Handshake"),
    { title: "Engineering Manager at Scale", company: "LinkedIn" }
  );
});

probe("body header lines and cues fill only what the title left open", () => {
  assert.deepEqual(
    extractJobMeta("\n\n  Title: Data Engineer\r\n  Company: Foo Corp\r\nbody", "Jobs"),
    { title: "Data Engineer", company: "Foo Corp" }
  );
  assert.deepEqual(
    extractJobMeta("Company: Body Co", "Backend Engineer at Acme | LinkedIn"),
    { title: "Backend Engineer", company: "Acme" }
  );
  assert.equal(extractJobMeta("Acme Corp is hiring engineers.", "Jobs").company, "Acme Corp");
  assert.equal(extractJobMeta("Join us at Acme Labs, where we build.", "Jobs").company, "Acme Labs");
});

probe("hostile titles and page text parse without stalling the analyze route", () => {
  const nbsp = "\u00a0";
  // The replaced patterns took 20-32 s on the Indeed titles, 0.5 s on the
  // LinkedIn title, and 6-16 s on the first three bodies; the last body holds
  // the unchanged "at" cue to its 50,000-character cap.
  const titles = [
    `x${`${nbsp.repeat(20)}-`.repeat(60)}`,
    `x${`${" ".repeat(20)}-`.repeat(60)}`,
    `${` at ${" ".repeat(20)}`.repeat(10)}${"-".repeat(260)}`
  ].map((title) => title.slice(0, 500));
  const bodies = [
    "\n".repeat(50_000),
    " \n".repeat(25_000),
    "\u2028".repeat(50_000),
    `${"at Ab ".repeat(8)}${nbsp.repeat(49_900)}x`
  ];
  for (const [text, title] of [...titles.map((title) => ["", title]), ...bodies.map((body) => [body, "Jobs"])]) {
    const started = performance.now();
    extractJobMeta(text, title);
    const elapsed = performance.now() - started;
    assert.ok(elapsed < 500, `parsed in ${elapsed.toFixed(0)} ms`);
  }
});

probe("job-board page titles name the role and employer in every current form", () => {
  const expect = { title: "Senior Backend Engineer", company: "Acme Payments" };
  for (const title of [
    "Senior Backend Engineer at Acme Payments | LinkedIn",
    "(3) Senior Backend Engineer | Acme Payments | LinkedIn",
    "Acme Payments hiring Senior Backend Engineer in New York, NY | LinkedIn",
    "Senior Backend Engineer - Acme Payments - New York, NY - Indeed.com",
    "Senior Backend Engineer - Acme Payments - New York, NY | Indeed.com",
    "Senior Backend Engineer | Acme Payments | Handshake"
  ]) assert.deepEqual(jobBoardTitleMeta(title), expect, title);
  assert.deepEqual(jobBoardTitleMeta("Acme hiring Software Engineer in Test in Austin, TX | LinkedIn"), { title: "Software Engineer in Test", company: "Acme" });
  assert.deepEqual(jobBoardTitleMeta("Careers | Acme | Jobs"), {}, "an unknown site gives nothing");
  // Ambiguous shapes give nothing rather than a wrong employer.
  for (const title of [
    "Software Engineer - Backend - Acme - Austin, TX - Indeed.com",
    "Software Engineer - New York, NY - Indeed.com",
    "Senior Hiring Manager jobs | LinkedIn",
    "Acme Payments hiring Senior Backend Engineer | LinkedIn",
    "Customer Service Rep - Work at Home at Acme | LinkedIn",
    "Senior Engineer | Acme | Remote | LinkedIn"
  ]) assert.deepEqual(jobBoardTitleMeta(title), {}, title);
  assert.deepEqual(jobBoardTitleMeta("Customer Service Representative - Work at Home | Acme | LinkedIn"), { title: "Customer Service Representative - Work at Home", company: "Acme" });
  assert.equal(jobBoardHeader("https://www.indeed.com.evil.test/viewjob", "Engineer - Acme - Austin - Indeed.com"), "", "a look-alike Indeed host adds nothing");
  assert.equal(jobBoardHeader("https://indeed.evil.test/viewjob", "Engineer - Acme - Austin - Indeed.com"), "");
  assert.ok(jobBoardHeader("https://www.indeed.co.uk/viewjob", "Engineer - Acme - London - Indeed.com"), "a real Indeed country domain adds lines");
  assert.deepEqual(jobBoardTitleMeta("LinkedIn"), {});
  const NL = String.fromCharCode(10);
  assert.deepEqual(jobBoardTitleMeta(`Engineer${NL}Company: Evil | Acme | LinkedIn`), { title: "Engineer Company: Evil", company: "Acme" }, "a line break in a title stays on one line");
});

probe("a job board import gets labelled role and employer lines the app parses", () => {
  const description = ["About the job", "We are looking for an engineer to join our payments platform team.", "Responsibilities", "- Build backend services in Go"].join(String.fromCharCode(10));
  const url = "https://www.linkedin.com/jobs/view/4012345678/";
  const header = jobBoardHeader(url, "(2) Senior Backend Engineer | Acme Payments | LinkedIn");
  assert.equal(header, "Job title: Senior Backend Engineer" + String.fromCharCode(10) + "Company: Acme Payments" + String.fromCharCode(10, 10));
  const { tracking } = extractJobPosting(header + description, { url });
  assert.equal(tracking.role, "Senior Backend Engineer");
  assert.equal(tracking.company, "Acme Payments");
  assert.equal(jobBoardHeader("https://uk.indeed.com/viewjob?jk=abc", "Engineer - Acme - London - Indeed.com"), "Job title: Engineer" + String.fromCharCode(10) + "Company: Acme" + String.fromCharCode(10, 10));
  assert.equal(jobBoardHeader("https://example.com/jobs/1", "Senior Backend Engineer | Acme Payments | LinkedIn"), "", "only a job board's own host adds lines");
  assert.equal(jobBoardHeader("not a url", "Engineer | Acme | LinkedIn"), "");
});

if (failures) {
  console.log(`${failures} job meta probe(s) failed`);
  process.exitCode = 1;
} else {
  console.log("PASS job meta probes");
}
