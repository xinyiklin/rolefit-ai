import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { skipApplicationForSession, updateNotApplyingJob } from "../notApplyingApplication.ts";
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
  status: "not_applying",
  createdAt,
  updatedAt: createdAt,
  ...overrides
});

const prepared = preparedApplicationRecord({
  base: base({ id: "fresh-1", createdAt: now, updatedAt: now }),
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
  "a skip records job-analysis provenance without implying resume or cover work"
);
assert.equal(prepared.application.resumeUsed, undefined);
assert.equal(prepared.application.location, "Remote");
assert.equal(prepared.application.salaryMin, 180000);

const created = skipApplicationForSession({
  session: newPreparationSession(),
  prepared: prepared.application,
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

const priorDecision = base({
  id: "prior-skip",
  status: "not_applying",
  notApplyingAt: createdAt,
  notApplyingReason: "interest",
  notApplyingNote: "Not the right product area"
});
const repeated = skipApplicationForSession({
  session: newPreparationSession({
    matchedApplicationId: priorDecision.id,
    matchedNotApplyingRecordId: priorDecision.id,
    confidence: "exact"
  }),
  prepared: prepared.application,
  matchedNotApplying: priorDecision,
  now,
  reason: "constraints",
  note: "Location changed"
});
assert.equal(repeated?.operation, "update");
assert.equal(repeated?.application.id, priorDecision.id, "a repeated skip refreshes the prior decision record");
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
  skipApplicationForSession({
    session: preparationSessionForApplication(priorDecision),
    prepared: prepared.application,
    matchedNotApplying: priorDecision,
    now,
    reason: "other",
    note: ""
  }),
  null,
  "an opened historical decision cannot be skipped again in update-only mode"
);

const appSource = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const railSource = readFileSync(
  new URL("../../sections/tabs/prepare/PrepareApplicationRail.tsx", import.meta.url),
  "utf8"
);
const mastheadSource = readFileSync(new URL("../../sections/Masthead.tsx", import.meta.url), "utf8");
const dialogSource = readFileSync(new URL("../../sections/SkipJobDialog.tsx", import.meta.url), "utf8");
const skipFlowSource = readFileSync(new URL("../../hooks/useSkipFlow.ts", import.meta.url), "utf8");

assert.match(railSource, /"Skip & save job"/, "the quiet action lives in the Prepare rail");
assert.doesNotMatch(mastheadSource, /Skip & save job/, "the masthead does not expose the skip action");
assert.match(dialogSource, /No application is recorded\./);
assert.match(dialogSource, /"Save as skipped"/);
assert.match(skipFlowSource, /Saved as Skipped\. RoleFit will recognize this posting if you encounter it again\./);
assert.doesNotMatch(skipFlowSource, /getResumeArtifacts|saveApplicationDocument|coverLetterArtifacts/);
assert.match(appSource, /const skipBlocker = !hasLoadedApplications[\s\S]{0,420}?pendingApplicationWrites/);

console.log("Skipped decision paths passed");
