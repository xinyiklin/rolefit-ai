import assert from "node:assert/strict";

import {
  appFitVerdict,
  applicationActivityDate,
  applicationSearchRank,
  fitAssessmentRank,
  fitAssessmentRunLabel,
  fitAssessmentVerdictLabel,
  hostLabel,
  postingIdIndex,
  postingIdentity,
  safeExternalUrl,
  safeExternalUrls
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
assert.match(assessmentLabel, /Codex · CLI \(gpt-5\.6-sol\)/, "assessment metadata names its provider and model");
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

console.log("application display probes: passed");
