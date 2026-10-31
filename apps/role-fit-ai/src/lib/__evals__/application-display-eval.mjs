import assert from "node:assert/strict";

import {
  appFitVerdict,
  applicationActivityDate,
  displayCompany,
  compareNextAction,
  isJobOnlySkippedApplication,
  applicationSearchRank,
  fitAssessmentRank,
  fitAssessmentRunLabel,
  fitAssessmentVerdictLabel,
  hostLabel,
  postingIdIndex,
  postingIdentity,
  safeExternalUrl,
  safeExternalUrls,
  splitFitWarnings
} from "../applicationDisplay.ts";

function application(overrides = {}) {
  return {
    id: "app-1",
    createdAt: "2026-08-08T12:00:00.000Z",
    updatedAt: "2026-08-08T12:00:00.000Z",
    status: "applied",
    fitAssessment: {
      resumeLabel: "Backend resume",
      result: {
        verdict: "STRONG",
        summary: "Grounded fit summary.",
        matches: [{
          jobExcerpt: "Build reliable backend services.",
          candidateSource: "RESUME",
          candidateExcerpt: "Built reliable backend services."
        }],
        gaps: []
      }
    },
    ...overrides
  };
}

assert.ok(
  fitAssessmentRank(application()) > fitAssessmentRank(application({
    fitAssessment: { ...application().fitAssessment, result: { ...application().fitAssessment.result, verdict: "LIMITED" } }
  })),
  "Fit Assessment remains available for explicit tracker sorting"
);
assert.deepEqual(
  ["LIMITED", "STRETCH", "REASONABLE", "STRONG"].map((verdict) => fitAssessmentVerdictLabel(verdict)),
  ["Limited", "Stretch", "Reasonable", "Strong"],
  "Fit verdict display stays to one canonical word everywhere"
);
assert.equal(appFitVerdict(application())?.label, "Strong");
const assessmentLabel = fitAssessmentRunLabel({
  ...application().fitAssessment,
  assessedAt: "2026-08-08T12:00:00.000Z",
  provider: "codex-cli",
  model: "gpt-5.6-sol",
  reasoningEffort: "medium",
  promptVersion: "fit-assessment-direct-rubric-v1"
});
assert.match(assessmentLabel, /^Last assessed /, "assessment metadata names its completion time");
assert.match(assessmentLabel, /OpenAI · CLI \(gpt-5\.6-sol\)/, "assessment metadata names its provider and model");
assert.match(assessmentLabel, /medium reasoning/, "assessment metadata names reasoning effort");
assert.match(assessmentLabel, /rubric v1$/, "assessment metadata names the rubric version");

assert.equal(safeExternalUrl(" https://jobs.example.com/role "), "https://jobs.example.com/role");
assert.equal(safeExternalUrl("http://jobs.example.com/role"), "http://jobs.example.com/role");
for (const unsafeUrl of [
  "javascript:alert(1)",
  "data:text/html,unsafe",
  "//jobs.example.com/role",
  "not a URL"
]) {
  assert.equal(safeExternalUrl(unsafeUrl), "", `stored posting URL stays inert: ${unsafeUrl}`);
  assert.equal(hostLabel(unsafeUrl), "", `unsafe posting URL has no clickable host: ${unsafeUrl}`);
}

assert.deepEqual(
  safeExternalUrls([
    " https://jobs.example.com/role ",
    "javascript:alert(1)",
    "https://board.example.com/role",
    "https://jobs.example.com/role"
  ]),
  ["https://jobs.example.com/role", "https://board.example.com/role"],
  "posting provenance keeps only safe, de-duplicated destinations"
);
assert.equal(
  applicationActivityDate(application({
    status: "not_applying",
    notApplyingAt: "2026-08-10T12:00:00.000Z",
    appliedAt: "2026-08-09T12:00:00.000Z"
  })),
  "2026-08-10T12:00:00.000Z",
  "skipped records display their decision date instead of an obsolete application date"
);
assert.equal(
  isJobOnlySkippedApplication(application({ status: "not_applying", notApplyingAt: "2026-08-10T12:00:00.000Z" })),
  true,
  "a skipped record without an application date remains job-only"
);
assert.equal(
  isJobOnlySkippedApplication(application({
    status: "not_applying",
    appliedAt: "2026-08-09T12:00:00.000Z",
    notApplyingAt: "2026-08-10T12:00:00.000Z"
  })),
  false,
  "a later-skipped application retains its application history"
);

const requisitionPosting = postingIdentity(application({
  rawJobDescription: "Requisition ID: JR-90210\nBuild reliable services.",
  jobUrl: "https://boards.greenhouse.io/acme/jobs/4012345"
}));
assert.equal(requisitionPosting?.id, "JR-90210", "the posting's own requisition id outranks an ATS id parsed from a link");
assert.equal(
  requisitionPosting?.label,
  "Requisition ID",
  "an employer requisition number is labeled as one rather than as a generic posting id"
);
for (const [text, expectedId, expectedLabel] of [
  ["Job ID: 2024-1180", "2024-1180", "Job ID"],
  ["Posting Number: 998877", "998877", "Posting number"],
  ["Position No. 445566", "445566", "Position number"]
]) {
  assert.deepEqual(
    postingIdentity(application({ rawJobDescription: text })),
    { id: expectedId, label: expectedLabel },
    `${text} preserves its identifier type for display`
  );
}
const linkOnlyPosting = postingIdentity(application({
  jobDescription: "Build reliable services.",
  jobUrl: "https://careers.example.com/role",
  sourceUrls: [{ url: "https://boards.greenhouse.io/acme/jobs/4012345", addedAt: "2026-08-08T12:00:00.000Z" }]
}));
assert.equal(linkOnlyPosting?.id, "4012345", "a posting id is recovered from any saved link, not just the primary one");
assert.equal(linkOnlyPosting?.label, "Greenhouse ID", "a board's internal id is displayed under that board's name");
assert.equal(
  postingIdentity(application({
    jobDescription: "Build reliable services.",
    jobUrl: "https://jobs.lever.co/acme/d290f1ee-6c54-4b01-90e6-d701748f0851"
  })),
  null,
  "an opaque UUID posting key is not presented as a readable posting id"
);
assert.equal(
  postingIdentity(application({ jobDescription: "Build reliable services.", jobUrl: "https://careers.example.com/role" })),
  null,
  "a record with no requisition id and no identifiable link shows no invented id"
);
assert.equal(
  postingIdentity(application({
    jobDescription: "Build reliable services.",
    jobUrl: "javascript://boards.greenhouse.io/acme/jobs/4012345"
  })),
  null,
  "an unsafe stored URL cannot contribute a posting id"
);
assert.deepEqual(
  [...postingIdIndex([
    application({ id: "app-req", rawJobDescription: "Job ID: 2024-1180" }),
    application({ id: "app-none", jobUrl: "https://careers.example.com/role" })
  ]).entries()],
  [["app-req", "2024-1180"], ["app-none", ""]],
  "search reads one derived id per application, including an explicit empty for records without one"
);

const exactCompanyRank = applicationSearchRank(application({
  company: "Docusign",
  role: "Software Engineer"
}), "docusign", "");
const companyPrefixRank = applicationSearchRank(application({
  company: "Docusign",
  role: "Software Engineer"
}), "docu", "");
const postingIdRank = applicationSearchRank(application({
  company: "Example Corp",
  role: "Software Engineer"
}), "4452", "4452092520");
const companySubstringRank = applicationSearchRank(application({
  company: "Acme Docusign Services",
  role: "Software Engineer"
}), "docu", "");
const roleRank = applicationSearchRank(application({
  company: "Example Corp",
  role: "Document Systems Engineer"
}), "docu", "");
assert.ok(
  exactCompanyRank !== null
    && companyPrefixRank !== null
    && postingIdRank !== null
    && companySubstringRank !== null
    && roleRank !== null
    && exactCompanyRank > companyPrefixRank
    && companyPrefixRank > postingIdRank
    && postingIdRank > companySubstringRank
    && companySubstringRank > roleRank,
  "identity search orders exact company, company prefix, posting id, company substring, then role/title matches"
);
const hiddenContentApplication = application({
  company: "Example Corp",
  role: "Software Engineer",
  roleDescription: "Maintain document workflows.",
  notes: "Ask about documentation ownership.",
  jobDescription: "Document technical processes and code changes."
});
assert.equal(
  applicationSearchRank(hiddenContentApplication, "docu", ""),
  null,
  "identity search excludes descriptions and notes"
);
const roleless = application({ company: "Acme", role: "", title: "Acme" });
for (const query of ["not", "set", "role", "role not set"]) {
  assert.equal(
    applicationSearchRank(roleless, query, ""),
    null,
    `search never matches the "Role not set" placeholder (${query})`
  );
}
assert.equal(
  applicationSearchRank(application({ company: "Acme", role: "  Notion Specialist " }), "notion", ""),
  2,
  "a stored role still ranks as a role match"
);

// A company-less record's title is its role ("role at company" without one).
assert.equal(
  displayCompany(application({ company: "", title: "Front-End Developer" })),
  "Front-End Developer",
  "a hyphen inside a word never cuts the title"
);
assert.equal(
  displayCompany(application({ company: "", title: "Full-Stack Engineer - Platform" })),
  "Full-Stack Engineer",
  "a spaced hyphen still separates the lead segment"
);
assert.equal(displayCompany(application({ company: "", title: "Acme · Engineer" })), "Acme");
assert.equal(displayCompany(application({ company: "", title: "Acme|Engineer" })), "Acme");
assert.equal(displayCompany(application({ company: " Real-Co ", title: "Front-End Developer" })), "Real-Co");
assert.equal(displayCompany(application({ company: "", title: "" })), "Unknown company");

const fitWarnings = [
  "Match 1: this requirement is repeated.",
  "Gap 2: source reference could not be confirmed. Quoted text is unconfirmed.",
  "Eligibility: reported conflict was downgraded to Check; the supplied context does not establish a clear conflict.",
  "Verdict: not supported by provided evidence; no supporting candidate finding was supplied.",
  "Gap 3: this requirement overlaps another finding."
];
const fitResult = (eligibility) => ({
  status: "ASSESSED",
  verdict: "STRETCH",
  summary: "Relevant overlap with important gaps.",
  matches: [{ jobExcerpt: "Python services", candidateSource: "RESUME", candidateExcerpt: "Built Python services" }],
  gaps: ["Kubernetes", "On-call ownership"],
  eligibility,
  warnings: fitWarnings
});
assert.deepEqual(
  splitFitWarnings(fitResult({ status: "CHECK", jobExcerpt: "US work authorization" })),
  {
    general: [fitWarnings[3], fitWarnings[4]],
    matches: [["This requirement is repeated."]],
    gaps: [[], ["Source reference could not be confirmed. Quoted text is unconfirmed."]],
    eligibility: ["Reported conflict was downgraded to Check; the supplied context does not establish a clear conflict."]
  },
  "finding warnings move beside their finding; out-of-range findings and verdict warnings stay general"
);
assert.deepEqual(
  splitFitWarnings(fitResult({ status: "CLEAR" })).general,
  [fitWarnings[2], fitWarnings[3], fitWarnings[4]],
  "a CLEAR eligibility is not shown, so its warning stays general with its label"
);
assert.deepEqual(splitFitWarnings(undefined), { general: [], matches: [], gaps: [], eligibility: [] });
assert.deepEqual(
  splitFitWarnings({ ...fitResult(undefined) }).general,
  [fitWarnings[2], fitWarnings[3], fitWarnings[4]],
  "an Eligibility warning without an eligibility finding stays general"
);
assert.deepEqual(
  splitFitWarnings({ status: "INSUFFICIENT_JOB_INFORMATION", summary: "Add details.", matches: [], gaps: [], warnings: fitWarnings }),
  { general: fitWarnings, matches: [], gaps: [], eligibility: [] },
  "insufficient job information shows no findings, so every warning stays general"
);

// Month dividers group by the same local calendar day each row shows.
{
  const { execFileSync } = await import("node:child_process");
  const moduleUrl = new URL("../applicationDisplay.ts", import.meta.url).href;
  const script = `const m = await import(${JSON.stringify(moduleUrl)});
const iso = "2026-07-01T03:00:00.000Z";
process.stdout.write(JSON.stringify([m.formatMonthLabel(iso), m.formatCompactDate(iso), m.formatMonthLabel("2026-07-01"), m.formatMonthLabel("not a date")]));`;
  const [month, day, dateOnly, invalid] = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    env: { ...process.env, TZ: "America/Los_Angeles", LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" },
    encoding: "utf8"
  }));
  assert.equal(day, "Jun 30", "the row shows the local day");
  assert.equal(month, "June 2026", "its divider is that local day's month, not the UTC one");
  assert.equal(dateOnly, "July 2026", "a date-only value stays on its calendar day");
  assert.equal(invalid, "not a d", "an unparseable value shows its raw year-month text");
  const table = (await import("node:fs")).readFileSync(new URL("../../sections/tracker/TrackerTableView.tsx", import.meta.url), "utf8");
  assert.match(table, /const label = formatMonthLabel\(applicationActivityDate\(app\)\);/, "the table's dividers use the local-day month label");
  assert.doesNotMatch(table, /iso\.slice\(0, 10\)/, "and never slice a UTC date");
}

// Next action sorts follow-ups by date, not by their yearless month-name label.
{
  const followup = (id, followupAt) => application({ id, followupAt });
  const dates = ["2026-10-28", "2026-11-02T12:00:00.000Z", "2026-12-01", "2027-01-05", "2026-08-03"];
  const order = dates.map((at, i) => followup(`f${i}`, at)).sort((a, b) => compareNextAction(a, b)).map((app) => app.followupAt);
  assert.deepEqual(order, ["2026-08-03", "2026-10-28", "2026-11-02T12:00:00.000Z", "2026-12-01", "2027-01-05"], "follow-ups sort by date across months and years");
  const others = [
    [application({ id: "draft", status: "draft" }), null],
    [application({ id: "quiet100" }), { silentDays: 100 }],
    [followup("due", "2026-12-01"), null],
    [application({ id: "waiting" }), null],
    [application({ id: "quiet34" }), { silentDays: 34 }],
    [followup("soon", "2026-11-02"), null]
  ];
  const ids = others.slice().sort(([a, na], [b, nb]) => compareNextAction(a, b, na, nb)).map(([app]) => app.id);
  assert.deepEqual(ids, ["waiting", "draft", "soon", "due", "quiet34", "quiet100"], "other labels keep their label order and no-response days stay numeric");
  assert.ok(compareNextAction(followup("bad", "someday"), followup("ok", "2026-11-02")) !== 0, "an unparseable follow-up still compares by its label");
  const tracker = (await import("node:fs")).readFileSync(new URL("../../sections/tabs/TrackerTab.tsx", import.meta.url), "utf8");
  assert.match(tracker, /case "nextAction":\s*return compareNextAction\(a, b, noResponse\.get\(a\.id\), noResponse\.get\(b\.id\)\);/, "the tracker's Next action sort uses the date-aware comparator");
}

console.log("application display probes: passed");
