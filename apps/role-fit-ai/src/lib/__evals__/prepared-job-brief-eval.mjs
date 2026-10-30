import assert from "node:assert/strict";

import {
  assemblePreparedJobApplicationText,
  assemblePreparedJobTailoringText,
  buildPreparedJobBrief,
  buildSavedPreparedJobBrief,
  extractBenefitsFromPosting,
  preparedJobBriefFieldFromText,
  preparedJobBriefOmittedItems,
  preparedJobRoleContext,
  reconcilePreparedJobManualReviewFields,
  removePreparedJobRoleSummary
} from "../preparedJobBrief.ts";

const tailoringText = `Job Title:
Platform Engineer

Company / Product Context:
Acme builds developer infrastructure.

Core Responsibilities:
- Build deployment tooling
- Improve service reliability

Required Qualifications:
- TypeScript
- AWS

Preferred Qualifications:
- Kubernetes

Tech Stack / Keywords:
- TypeScript
- AWS

Seniority Signals:
- Own cross-team projects

Domain Signals:
- Developer tools`;

const rawPosting = `Platform Engineer
Responsibilities
Build deployment tooling.

Benefits
- Medical, dental, and vision insurance
- 401(k) match
- Paid time off

Equal opportunity employer`;

const brief = buildPreparedJobBrief(tailoringText, rawPosting);
assert.deepEqual(brief.responsibilities, ["Build deployment tooling", "Improve service reliability"]);
assert.deepEqual(brief.requiredQualifications, ["TypeScript", "AWS"]);
assert.deepEqual(brief.preferredQualifications, ["Kubernetes"]);
assert.deepEqual(brief.benefits, ["Medical, dental, and vision insurance", "401(k) match", "Paid time off"]);
assert.equal(brief.companyContext, "Acme builds developer infrastructure.");

assert.deepEqual(
  extractBenefitsFromPosting("We provide generous PTO and health insurance."),
  ["We provide generous PTO and health insurance."],
  "benefit cues recover a posting without a dedicated heading"
);

const editedResponsibilities = preparedJobBriefFieldFromText(
  "responsibilities",
  "Build APIs\nBuild APIs\nLead incident response"
);
assert.deepEqual(
  editedResponsibilities,
  ["Build APIs", "Lead incident response"],
  "manual list edits are trimmed and de-duplicated"
);

const rebuilt = assemblePreparedJobTailoringText(
  { role: "Platform Engineer", roleDescription: "Own reliable services." },
  {
    ...brief,
    responsibilities: editedResponsibilities
  }
);
assert.match(rebuilt, /Core Responsibilities:\n- Build APIs\n- Lead incident response/);
assert.doesNotMatch(
  rebuilt,
  /Medical|401\(k\)|Paid time off/,
  "benefits stay visible on Prepare without widening the tailoring prompt"
);

assert.match(
  rebuilt,
  /Company \/ Product Context:\nAcme builds developer infrastructure\.\nOwn reliable services\./,
  "legacy split context reaches one model-facing role context"
);
assert.equal(
  preparedJobRoleContext(
    { roleDescription: "Own reliable services." },
    brief
  ),
  "Acme builds developer infrastructure.\nOwn reliable services.",
  "Prepare presents legacy company and role prose as one editable value"
);

const sharedContext = "Build reliable developer infrastructure.";
const rebuiltWithoutDuplicateContext = assemblePreparedJobTailoringText(
  { role: "Platform Engineer", roleDescription: sharedContext },
  { ...brief, companyContext: sharedContext }
);
assert.equal(
  rebuiltWithoutDuplicateContext.match(/Build reliable developer infrastructure\./g)?.length,
  1,
  "equal legacy context values are emitted only once"
);

const applicationText = assemblePreparedJobApplicationText(
  { role: "Platform Engineer", roleDescription: "Own reliable services." },
  brief
);
assert.match(
  applicationText,
  /\n\nBenefits:\n- Medical, dental, and vision insurance\n- 401\(k\) match\n- Paid time off$/,
  "persisted prepared-job text retains benefits in a stable section"
);
assert.deepEqual(
  buildPreparedJobBrief(applicationText, applicationText).benefits,
  brief.benefits,
  "the persisted benefits section round-trips through the prepared brief"
);

const parsedStoredBrief = removePreparedJobRoleSummary(
  buildPreparedJobBrief(applicationText, applicationText),
  "Own reliable services."
);
assert.equal(
  parsedStoredBrief.companyContext,
  brief.companyContext,
  "reopening separates the persisted role summary from company context"
);
assert.equal(
  assemblePreparedJobApplicationText(
    { role: "Platform Engineer", roleDescription: "Own reliable services." },
    parsedStoredBrief
  ),
  applicationText,
  "repeated open and Apply cycles do not accumulate the role summary"
);

const explicitlyClearedBenefits = assemblePreparedJobApplicationText(
  { role: "Platform Engineer" },
  { ...brief, benefits: [] }
);
assert.deepEqual(
  buildPreparedJobBrief(explicitlyClearedBenefits, explicitlyClearedBenefits).benefits,
  [],
  "an explicit Not specified Benefits section round-trips as an intentional empty edit"
);

const blankBrief = {
  companyContext: "Existing legacy context still satisfies the unified field.",
  responsibilities: [],
  requiredQualifications: [],
  preferredQualifications: [],
  techKeywords: [],
  senioritySignals: [],
  domainSignals: [],
  benefits: []
};
assert.deepEqual(
  reconcilePreparedJobManualReviewFields(
    {
      role: " ",
      title: "",
      company: "",
      location: "",
      jobType: "",
      salaryMin: null,
      salaryMax: null,
      roleDescription: ""
    },
    blankBrief,
    ["job description", "Custom recruiter note", "COMPANY"]
  ),
  [
    "Custom recruiter note",
    "job description",
    "role title",
    "company",
    "location",
    "job type",
    "compensation",
    "responsibilities",
    "required qualifications",
    "tech stack keywords",
    "benefits"
  ],
  "canonical extraction gaps are recomputed while unknown gaps are preserved"
);

assert.deepEqual(
  reconcilePreparedJobManualReviewFields(
    {
      title: "Platform Engineer",
      company: "Acme",
      location: "Remote",
      jobType: "Full-time",
      salaryMin: 120_000,
      roleDescription: "Own reliable services."
    },
    brief,
    [
      "job description",
      "ROLE TITLE",
      "company",
      "location",
      "job type",
      "compensation",
      "role context",
      "responsibilities",
      "required qualifications",
      "tech stack keywords",
      "benefits",
      "Check relocation policy"
    ]
  ),
  ["Check relocation policy"],
  "populated fields remove canonical gaps, including the aggregate description gap, without dropping unknown gaps"
);

// Every analyzed item reaches the editor, and the brief keeps what the user
// types; items past the 9,000-character budget are counted, never lost quietly.
{
  const tracking = { role: "Platform Engineer", roleDescription: "" };
  const keywords = Array.from({ length: 22 }, (_, index) => `Tool${index + 1}`);
  const analyzed = assemblePreparedJobTailoringText(tracking, {
    companyContext: "", responsibilities: ["Own services"], requiredQualifications: ["Five years"], preferredQualifications: [],
    techKeywords: keywords, senioritySignals: [], domainSignals: [], benefits: []
  });
  const brief = buildPreparedJobBrief(analyzed);
  assert.deepEqual(brief.techKeywords, keywords, "all 22 analyzed keywords reach the brief");
  assert.ok(assemblePreparedJobApplicationText(tracking, brief).includes("Tool22"), "and the saved application");
  assert.equal(preparedJobBriefFieldFromText("techKeywords", [...keywords, "Tool23", "Tool24", "Kubernetes"].join(String.fromCharCode(10))).length, 25, "a typed item is never cut by count");
  assert.equal(preparedJobBriefOmittedItems(tracking, brief), 0);
  // Items that start with a number or end like a page-loaded announcement are sent whole.
  assert.equal(preparedJobBriefOmittedItems(tracking, { ...brief, requiredQualifications: ["3.0 GPA or higher", "1) Bachelor's degree"], techKeywords: ["2.5D rendering"], responsibilities: ["Confirm the dashboard page is loaded"] }), 0);
  // Saved and reopened, typed items past any count stay in the brief.
  const typed = { ...brief, techKeywords: Array.from({ length: 30 }, (_, index) => `Typed${index + 1}`) };
  const reopened = buildPreparedJobBrief(assemblePreparedJobApplicationText(tracking, typed));
  assert.equal(reopened.techKeywords.length, 30, "a save and reopen keeps every typed item that fits");
  const withBenefits = { ...brief, benefits: Array.from({ length: 20 }, (_, index) => `Benefit ${index + 1}`) };
  assert.equal(buildSavedPreparedJobBrief(assemblePreparedJobApplicationText(tracking, withBenefits)).benefits.length, 20, "a reopened application keeps every saved benefit");
  // Items the renderer merges (curly vs straight quotes) are both sent, so neither is omitted.
  assert.equal(preparedJobBriefOmittedItems(tracking, { ...brief, requiredQualifications: ["Don’t panic", "Don't panic"] }), 0);
  // A list too long for the budget is cut mid-item; the fragment never counts as sent.
  const oversized = { ...brief, techKeywords: Array.from({ length: 1200 }, (_, index) => `Keyword${index}`) };
  const sentText = assemblePreparedJobTailoringText(tracking, oversized);
  const wholeSent = oversized.techKeywords.filter((item) => sentText.includes(`- ${item}
`) || sentText.endsWith(`- ${item}`)).length;
  assert.equal(preparedJobBriefOmittedItems(tracking, oversized) >= oversized.techKeywords.length - wholeSent, true, "every item not sent whole is counted");
  const long = (index) => `Requirement ${index}: ${"detail ".repeat(38)}`;
  const full = { ...brief, requiredQualifications: Array.from({ length: 40 }, (_, index) => long(index)) };
  const omitted = preparedJobBriefOmittedItems(tracking, full);
  assert.ok(omitted > 0, "items past the brief budget are counted");
  const sent = assemblePreparedJobTailoringText(tracking, full);
  assert.equal(full.requiredQualifications.filter((item) => !sent.includes(item.slice(0, 20))).length >= omitted, true, "the count matches items Polish does not receive");
}

console.log("Prepared job brief eval passed");
