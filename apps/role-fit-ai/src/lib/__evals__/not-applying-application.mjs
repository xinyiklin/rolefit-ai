import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { passApplicationForSession, updateNotApplyingJob } from "../notApplyingApplication.ts";
import { preparedApplicationRecord } from "../preparedApplicationRecord.ts";
import { newPreparationSession, preparationSessionForApplication } from "../preparationSession.ts";

const createdAt = "2026-08-01T12:00:00.000Z";
const now = "2026-08-10T12:00:00.000Z";
const base = (overrides = {}) => ({
  id: "job-1",
  title: "Engineer at Acme",
  company: "Acme",
  role: "Engineer",
  jobUrl: "https://example.com/jobs/1",
  jobDescription: "Prepared job snapshot",
  rawJobDescription: "Original posting",
  status: "interested",
  createdAt,
  updatedAt: createdAt,
  ...overrides
});

const prepared = preparedApplicationRecord({
  draft: base({ id: "fresh-1", createdAt: now, updatedAt: now }),
  existing: null,
  jobUrl: " https://example.com/jobs/1 ",
  preparedJobDescription: "Updated prepared job",
  jobRawText: "Captured source text",
  tracking: {
    company: "Acme",
    role: "Staff Engineer",
    location: "Remote",
    source: "Company site",
    salaryMin: 180000,
    salaryMax: 220000,
    salaryCurrency: "USD",
    salaryPeriod: "yr",
    workAuth: "US authorization required"
  },
  pipelineAiUsage: {
    "job-analysis": { source: "local" },
    "resume-polish": { source: "ai", provider: "must-not-persist" },
    cover: { source: "ai", provider: "must-not-persist" }
  },
  fitAssessmentPersistence: { action: "preserve" },
  now,
  usage: { mode: "job-only" }
});

assert.deepEqual(
  Object.keys(prepared.application.aiUsage ?? {}),
  ["job-analysis"],
  "a pass records job-analysis provenance without implying resume or cover work"
);
assert.equal(prepared.application.resumeUsed, undefined);
assert.equal(prepared.application.location, "Remote");
assert.equal(prepared.application.salaryMin, 180000);

const created = passApplicationForSession({
  session: newPreparationSession(),
  prepared: prepared.application,
  existing: null,
  matchedNotApplying: null,
  now,
  reason: "fit",
  note: "Requirements are too far from my background."
});
assert.equal(created?.operation, "create");
assert.equal(created?.application.status, "not_applying");
assert.equal(created?.application.notApplyingAt, now);
assert.equal(created?.application.notApplyingReason, "fit");
assert.equal(created?.application.appliedAt, undefined);
assert.equal(created?.application.resumeArtifacts, undefined);
assert.equal(created?.application.coverLetterArtifacts, undefined);

const draft = base({
  resumeUsed: "tailored",
  resumeArtifacts: { hasPdf: true, hasSource: false },
  coverLetterArtifacts: { hasPdf: false, hasSource: true }
});
const passedDraft = passApplicationForSession({
  session: preparationSessionForApplication(draft),
  prepared: prepared.application,
  existing: draft,
  matchedNotApplying: null,
  now,
  reason: "",
  note: ""
});
assert.equal(passedDraft?.operation, "update");
assert.equal(passedDraft?.application.id, draft.id, "passing a draft updates that exact identity");
assert.equal(passedDraft?.application.createdAt, createdAt);
assert.equal(passedDraft?.application.appliedAt, undefined);
assert.equal(passedDraft?.application.resumeUsed, undefined);
assert.equal(passedDraft?.application.resumeArtifacts, undefined);
assert.equal(passedDraft?.application.coverLetterArtifacts, undefined);

const priorDecision = base({
  id: "prior-pass",
  status: "not_applying",
  notApplyingAt: createdAt,
  notApplyingReason: "interest",
  notApplyingNote: "Not the right product area"
});
const repeated = passApplicationForSession({
  session: newPreparationSession({
    matchedApplicationId: priorDecision.id,
    matchedNotApplyingRecordId: priorDecision.id,
    confidence: "exact"
  }),
  prepared: prepared.application,
  existing: null,
  matchedNotApplying: priorDecision,
  now,
  reason: "constraints",
  note: "Location changed"
});
assert.equal(repeated?.operation, "update");
assert.equal(repeated?.application.id, priorDecision.id, "a repeated pass refreshes the prior decision record");
assert.equal(repeated?.application.createdAt, createdAt);
assert.equal(repeated?.application.notApplyingAt, now);
assert.equal(repeated?.application.notApplyingReason, "constraints");

const jobUpdate = updateNotApplyingJob({
  session: preparationSessionForApplication(priorDecision),
  prepared: prepared.application,
  existing: priorDecision
});
assert.equal(jobUpdate?.operation, "update");
assert.equal(jobUpdate?.application.notApplyingAt, createdAt, "job-only updates preserve the decision date");
assert.equal(jobUpdate?.application.notApplyingReason, "interest");
assert.equal(jobUpdate?.application.jobDescription, "Updated prepared job");

assert.equal(
  passApplicationForSession({
    session: preparationSessionForApplication(priorDecision),
    prepared: prepared.application,
    existing: priorDecision,
    matchedNotApplying: priorDecision,
    now,
    reason: "other",
    note: ""
  }),
  null,
  "an opened historical decision cannot be passed again in update-only mode"
);

const appSource = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const railSource = readFileSync(
  new URL("../../sections/tabs/prepare/PrepareApplicationRail.tsx", import.meta.url),
  "utf8"
);
const mastheadSource = readFileSync(new URL("../../sections/Masthead.tsx", import.meta.url), "utf8");
const dialogSource = readFileSync(new URL("../../sections/PassOnJobDialog.tsx", import.meta.url), "utf8");
const passFlowSource = readFileSync(new URL("../../hooks/usePassFlow.ts", import.meta.url), "utf8");

assert.match(railSource, /"Pass on this job"/, "the quiet action lives in the Prepare rail");
assert.doesNotMatch(mastheadSource, /Pass on this job/, "the masthead does not expose the pass action");
assert.match(dialogSource, /No application will be recorded\./);
assert.match(dialogSource, /"Save as not applying"/);
assert.match(passFlowSource, /Saved as Not applying\. RoleFit will recognize this posting if you encounter it again\./);
assert.doesNotMatch(passFlowSource, /getResumeArtifacts|saveApplicationDocument|coverLetterArtifacts/);
assert.match(appSource, /const passBlocker = !hasLoadedApplications[\s\S]{0,420}?pendingApplicationWrites/);

console.log("Not applying decision paths passed");
