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
prepared.application.attachments = [{
  fileName: "work-sample.pdf",
  label: "Work sample",
  size: 1_024,
  contentType: "application/pdf",
  savedAt: now
}];

const created = skipApplicationForSession({
  session: newPreparationSession(),
  prepared: prepared.application,
  matchedNotApplying: null,
  now,
  reasons: ["other", "fit", "location", "fit"],
  note: "Requirements are too far from my background."
});
assert.equal(created?.operation, "create");
assert.equal(created?.application.status, "not_applying");
assert.equal(created?.application.notApplyingAt, now);
assert.deepEqual(
  created?.application.notApplyingReasons,
  ["location", "fit", "other"],
  "every checked reason is stored once, in canonical order"
);
assert.equal(created?.application.appliedAt, undefined);
assert.equal(created?.application.resumeArtifacts, undefined);
assert.equal(created?.application.coverLetterArtifacts, undefined);
assert.equal(created?.application.attachments, undefined);

const priorDecision = base({
  id: "prior-skip",
  status: "not_applying",
  notApplyingAt: createdAt,
  notApplyingReasons: ["interest"],
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
  reasons: ["constraints", "compensation"],
  note: "Location changed"
});
assert.equal(repeated?.operation, "update");
assert.equal(repeated?.application.id, priorDecision.id, "a repeated skip refreshes the prior decision record");
assert.equal(repeated?.application.createdAt, createdAt);
assert.equal(repeated?.application.notApplyingAt, now);
assert.deepEqual(repeated?.application.notApplyingReasons, ["compensation", "constraints"]);

const jobUpdate = updateNotApplyingJob({
  session: preparationSessionForApplication(priorDecision),
  prepared: prepared.application,
  existing: priorDecision
});
assert.equal(jobUpdate?.operation, "update");
assert.equal(jobUpdate?.application.notApplyingAt, createdAt, "job-only updates preserve the decision date");
assert.deepEqual(jobUpdate?.application.notApplyingReasons, ["interest"], "job-only updates preserve the decision reasons");
assert.equal(jobUpdate?.application.notApplyingNote, "Not the right product area");
assert.equal(jobUpdate?.application.jobDescription, "Updated prepared job");

assert.equal(
  skipApplicationForSession({
    session: preparationSessionForApplication(priorDecision),
    prepared: prepared.application,
    matchedNotApplying: priorDecision,
    now,
    reasons: ["other"],
    note: ""
  }),
  null,
  "an opened historical decision cannot be skipped again in update-only mode"
);

const unexplained = skipApplicationForSession({
  session: newPreparationSession(),
  prepared: prepared.application,
  matchedNotApplying: null,
  now,
  reasons: [],
  note: "   "
});
assert.equal("notApplyingReasons" in (unexplained?.application ?? {}), false, "no reasons stores no reason field");
assert.equal("notApplyingNote" in (unexplained?.application ?? {}), false, "a blank note is not stored");
const longNote = skipApplicationForSession({
  session: newPreparationSession(),
  prepared: prepared.application,
  matchedNotApplying: null,
  now,
  reasons: ["other"],
  note: "x".repeat(2_500)
});
assert.equal(longNote?.application.notApplyingNote?.length, 2_000, "the decision note is capped at 2,000 characters");

// An application later moved to Skipped keeps what was sent when the same
// posting is skipped again or its job facts are saved: only job-only skips
// drop application date, documents, and their AI receipts.
const sentArtifacts = {
  appliedAt: "2026-08-02T12:00:00.000Z",
  resumeUsed: "tailored",
  resumeArtifacts: { hasPdf: false, hasSource: true, fileName: "Resume.resume", savedAt: "2026-08-02T12:00:00.000Z" },
  coverLetterArtifacts: { hasPdf: true, hasSource: false, fileName: "Cover.pdf", savedAt: "2026-08-02T12:00:00.000Z" },
  attachments: [{ fileName: "sample.pdf", label: "Sample", size: 10, contentType: "application/pdf", savedAt: "2026-08-02T12:00:00.000Z" }]
};
const laterSkipped = base({
  id: "later-skipped",
  status: "not_applying",
  notApplyingAt: createdAt,
  notApplyingReasons: ["interest"],
  notApplyingNote: "Lost interest after applying",
  ...sentArtifacts,
  aiUsage: {
    "job-analysis": { source: "local" },
    "resume-polish": { source: "ai", provider: "codex-cli", model: "gpt-6.1-sol" },
    "cover-polish": { source: "ai", provider: "codex-cli", model: "gpt-6.1-sol" }
  }
});
const keptHistory = (application) => ({
  appliedAt: application?.appliedAt,
  resumeUsed: application?.resumeUsed,
  resumeArtifacts: application?.resumeArtifacts,
  coverLetterArtifacts: application?.coverLetterArtifacts,
  attachments: application?.attachments
});
const reskipped = skipApplicationForSession({
  session: newPreparationSession({
    matchedApplicationId: laterSkipped.id,
    matchedNotApplyingRecordId: laterSkipped.id,
    confidence: "exact"
  }),
  prepared: prepared.application,
  matchedNotApplying: laterSkipped,
  now,
  reasons: ["compensation"],
  note: "Pay changed"
});
assert.equal(reskipped?.operation, "update");
assert.equal(reskipped?.application.id, laterSkipped.id);
assert.deepEqual(keptHistory(reskipped?.application), sentArtifacts, "re-skipping keeps the application date and sent documents");
assert.deepEqual(reskipped?.application.notApplyingReasons, ["compensation"], "the decision itself still updates");
assert.equal(reskipped?.application.notApplyingAt, now);
assert.equal(reskipped?.application.notApplyingNote, "Pay changed");
assert.deepEqual(
  Object.keys(reskipped?.application.aiUsage ?? {}).sort(),
  ["cover-polish", "job-analysis", "resume-polish"],
  "document AI receipts survive while Job analysis is refreshed"
);
assert.equal(reskipped?.application.aiUsage["job-analysis"], prepared.application.aiUsage["job-analysis"]);
assert.equal(reskipped?.application.aiUsage["resume-polish"], laterSkipped.aiUsage["resume-polish"], "the kept receipt is the record's own");

const laterSkippedJobUpdate = updateNotApplyingJob({
  session: preparationSessionForApplication(laterSkipped),
  prepared: prepared.application,
  existing: laterSkipped
});
assert.deepEqual(keptHistory(laterSkippedJobUpdate?.application), sentArtifacts, "Save job updates keeps the sent application");
assert.equal(laterSkippedJobUpdate?.application.notApplyingAt, createdAt);
assert.deepEqual(laterSkippedJobUpdate?.application.notApplyingReasons, ["interest"]);
assert.equal(laterSkippedJobUpdate?.application.notApplyingNote, "Lost interest after applying");
assert.equal(laterSkippedJobUpdate?.application.aiUsage["resume-polish"]?.source, "ai");

// Job-only decisions still store nothing an application would, even when the
// Draft being skipped carries Polish receipts from its Answers session.
const polishedDraft = base({
  id: "draft-2",
  status: "draft",
  aiUsage: { "job-analysis": { source: "local" }, "resume-polish": { source: "ai" }, "cover-polish": { source: "ai" } }
});
const draftSkipped = skipApplicationForSession({
  session: preparationSessionForApplication(polishedDraft),
  prepared: { ...prepared.application, ...sentArtifacts },
  matchedNotApplying: null,
  existingDraft: polishedDraft,
  now,
  reasons: [],
  note: ""
});
assert.equal(draftSkipped?.operation, "update");
assert.deepEqual(Object.keys(draftSkipped?.application.aiUsage ?? {}), ["job-analysis"], "a skipped Draft keeps no document receipts");
const undatedSkip = skipApplicationForSession({
  session: newPreparationSession({ matchedApplicationId: "undated", matchedNotApplyingRecordId: "undated", confidence: "exact" }),
  prepared: prepared.application,
  matchedNotApplying: base({ id: "undated", status: "not_applying", notApplyingAt: createdAt, aiUsage: polishedDraft.aiUsage }),
  now,
  reasons: [],
  note: ""
});
assert.deepEqual(Object.keys(undatedSkip?.application.aiUsage ?? {}), ["job-analysis"], "a job-only decision keeps no document receipts");
for (const [label, application] of [
  ["a new skip", created?.application],
  ["a repeated job-only skip", repeated?.application],
  ["a skipped Draft", draftSkipped?.application],
  ["job-only Save job updates", jobUpdate?.application]
]) {
  assert.deepEqual(
    keptHistory(application),
    { appliedAt: undefined, resumeUsed: undefined, resumeArtifacts: undefined, coverLetterArtifacts: undefined, attachments: undefined },
    `${label} stores no application date or documents`
  );
}

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
assert.match(skipFlowSource, /"Saved as skipped"/);
assert.match(skipFlowSource, /RoleFit will recognize this posting if you encounter it again\./);
assert.doesNotMatch(skipFlowSource, /getResumeArtifacts|saveApplicationDocument|coverLetterArtifacts/);
assert.match(
  appSource,
  /const skipBlocker = trackerReadinessBlocker[\s\S]{0,420}?pendingApplicationWrites/,
  "Skip uses the shared tracker readiness recovery copy before pending-write checks"
);

// The opt-in Polish review's receipt follows the Polish run it describes into the
// record: a reviewed run carries it, an unreviewed run clears an older one, and
// an excluded resume leaves the stored pair alone.
const reviewedPolish = { source: "ai", provider: "codex-cli", model: "gpt-6.1-sol", reasoningEffort: "medium", attempts: 1 };
const reviewReceipt = { source: "ai", provider: "codex-cli", model: "gpt-6.1-sol", reasoningEffort: "medium", attempts: 1 };
const applyRecord = (existing, pipelineAiUsage, includeResume = true) => preparedApplicationRecord({
  base: base({ id: existing?.id ?? "fresh-2", status: "applied", createdAt: now, updatedAt: now }),
  existing,
  jobUrl: "https://example.com/jobs/1",
  preparedJobDescription: "Prepared job",
  jobRawText: "Captured source text",
  tracking: { company: "Acme", role: "Engineer" },
  pipelineAiUsage,
  fitAssessmentPersistence: { action: "preserve" },
  now,
  usage: { mode: "application", includeResume, includeCoverLetter: false, resumeUsed: "tailored" }
}).application.aiUsage;
assert.deepEqual(
  applyRecord(null, { "job-analysis": { source: "local" }, "resume-polish": reviewedPolish, "resume-polish-review": reviewReceipt })["resume-polish-review"],
  reviewReceipt,
  "a new application records the review that ran on its resume"
);
const draftWithReview = base({
  id: "draft-1",
  status: "draft",
  aiUsage: { "job-analysis": { source: "local" }, "resume-polish": reviewedPolish, "resume-polish-review": reviewReceipt }
});
const unreviewed = applyRecord(draftWithReview, { "job-analysis": { source: "local" }, "resume-polish": { ...reviewedPolish, attempts: 2 } });
assert.equal("resume-polish-review" in unreviewed, false, "a later unreviewed Polish clears the earlier review receipt");
assert.equal(unreviewed["resume-polish"].attempts, 2);
assert.deepEqual(
  applyRecord(draftWithReview, { "job-analysis": { source: "local" } }, false)["resume-polish-review"],
  reviewReceipt,
  "an excluded resume leaves its stored Polish and review receipts alone"
);

console.log("Skipped decision paths passed");
