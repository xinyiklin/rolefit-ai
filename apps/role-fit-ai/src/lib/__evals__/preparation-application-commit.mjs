import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  preparationPrimaryAction,
  preparationSessionForApplication,
  newPreparationSession
} from "../preparationSession.ts";
import { appliedApplicationForSession, retriedCreateOverEarlier } from "../preparationApplication.ts";
import { skipApplicationForSession } from "../notApplyingApplication.ts";

const createdAt = "2026-01-10T00:00:00.000Z";
const appliedAt = "2026-01-11T00:00:00.000Z";
const now = "2026-08-10T12:00:00.000Z";
const application = (overrides = {}) => ({
  id: "saved-1",
  title: "Engineer at Acme",
  jobUrl: "https://example.com/jobs/1",
  jobDescription: "Prepared posting",
  status: "applied",
  createdAt,
  appliedAt,
  updatedAt: appliedAt,
  notes: "Keep me",
  ...overrides
});
const preparedRecord = application({
  id: "fresh-1",
  status: "applied",
  createdAt: now,
  appliedAt: undefined,
  updatedAt: now,
  jobDescription: "Updated prepared posting",
  notes: undefined
});

assert.deepEqual(
  preparationPrimaryAction(newPreparationSession()),
  { kind: "apply", label: "Apply", busyLabel: "Applying…", receipt: "Application saved" },
  "new preparation copy describes an application submission"
);
assert.deepEqual(
  preparationPrimaryAction(preparationSessionForApplication(application())),
  {
    kind: "update-application",
    label: "Update application",
    busyLabel: "Updating…",
    receipt: "Application updated"
  },
  "an existing submitted application uses update language"
);
assert.deepEqual(
  preparationPrimaryAction(
    preparationSessionForApplication(application({ status: "not_applying" })),
    "not_applying"
  ),
  {
    kind: "update-job",
    label: "Save job updates",
    busyLabel: "Saving…",
    receipt: "Job updates saved"
  },
  "a saved Not applying record uses job-update language"
);

const created = appliedApplicationForSession({
  session: newPreparationSession(),
  prepared: preparedRecord,
  existing: null,
  now
});
assert.equal(created?.operation, "create");
assert.equal(created?.application.id, "fresh-1");
assert.equal(created?.application.status, "applied");
assert.equal(created?.application.appliedAt, now);

const historical = application({ status: "rejected" });
const updated = appliedApplicationForSession({
  session: preparationSessionForApplication(historical),
  prepared: preparedRecord,
  existing: historical,
  now
});
assert.equal(updated?.operation, "update");
assert.equal(updated?.application.id, historical.id);
assert.equal(updated?.application.createdAt, createdAt);
assert.equal(updated?.application.status, "rejected");
assert.equal(updated?.application.appliedAt, appliedAt);
assert.equal(updated?.application.notes, "Keep me");

assert.equal(
  appliedApplicationForSession({
    session: preparationSessionForApplication(historical),
    prepared: preparedRecord,
    existing: null,
    now
  }),
  null,
  "an explicit update session never falls back to creating a record"
);

const appSource = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const applyActionSource = readFileSync(new URL("../../sections/ApplyAction.tsx", import.meta.url), "utf8");
const railSource = readFileSync(
  new URL("../../sections/tabs/prepare/PrepareApplicationRail.tsx", import.meta.url),
  "utf8"
);
const downloadSource = readFileSync(
  new URL("../../sections/ApplyDownloadDialog.tsx", import.meta.url),
  "utf8"
);

assert.match(
  appSource,
  /const primaryPreparationAction = preparationPrimaryAction\([\s\S]{0,180}?preparationApplication\?\.status/,
  "App derives one shared action descriptor from the explicit session and record status"
);
assert.equal(
  appSource.match(/primaryAction=\{primaryPreparationAction\}/g)?.length,
  2,
  "App passes one shared action descriptor to both primary action surfaces"
);
assert.match(
  applyActionSource,
  /busy \? primaryAction\.busyLabel : primaryAction\.label/,
  "the floating Apply action uses shared idle and busy action copy"
);
assert.match(
  railSource,
  /isApplying \? primaryAction\.busyLabel : primaryAction\.label/,
  "the Prepare rail uses shared idle and busy action copy"
);
assert.match(
  downloadSource,
  /aria-label=\{`\$\{action\.label\} and download documents`\}/,
  "the confirmation dialog labels itself with the captured action"
);
assert.match(
  downloadSource,
  /submittedAction === "download"[\s\S]{0,240}?action\.busyLabel/,
  "the confirmation dialog uses the captured busy action copy"
);

// A retried create whose earlier attempt was saved but unanswered: the retry
// is authoritative, including what it clears, while the saved row keeps its
// stage, dates, history, and what no create writes.
{
  const later = "2026-08-10T12:05:00.000Z";
  const fresh = (overrides = {}) => application({ id: "attempt-1", createdAt: now, appliedAt: undefined, updatedAt: now, notes: undefined, ...overrides });
  const firstApply = appliedApplicationForSession({
    session: newPreparationSession(),
    prepared: fresh({ title: "Engineer at Acme", resumeUsed: "tailored", salaryPeriod: "year" }),
    existing: null,
    now
  }).application;
  const earlierApply = { ...firstApply, notes: "Added in the tracker", stageHistory: [{ status: "applied", at: now }] };
  const retryApply = appliedApplicationForSession({
    session: newPreparationSession(),
    prepared: fresh({ title: "Senior Engineer at Acme", createdAt: later, updatedAt: later }),
    existing: null,
    now: later
  }).application;
  const mergedApply = retriedCreateOverEarlier(earlierApply, retryApply);
  assert.equal(mergedApply.title, "Senior Engineer at Acme", "the retry's edits are written");
  assert.equal("resumeUsed" in mergedApply, false, "a resume the retry excludes is not claimed as sent");
  assert.equal("salaryPeriod" in mergedApply, false, "a field the retry clears stays cleared");
  assert.equal(mergedApply.notes, "Added in the tracker", "a later tracker edit is kept");
  assert.equal(mergedApply.createdAt, now, "the saved creation date is kept");
  assert.equal(mergedApply.appliedAt, now, "the saved submission date is kept");
  assert.deepEqual(mergedApply.stageHistory, earlierApply.stageHistory, "the saved stage history is kept");

  const skip = (at, reasons, note) => skipApplicationForSession({
    session: newPreparationSession(),
    prepared: fresh({ id: "skip-1", createdAt: at, updatedAt: at }),
    matchedNotApplying: null,
    now: at,
    reasons,
    note
  }).application;
  const earlierSkip = skip(now, ["location"], "too far");
  const mergedSkip = retriedCreateOverEarlier(earlierSkip, skip(later, [], ""));
  assert.equal("notApplyingReasons" in mergedSkip, false, "reasons the retry clears stay cleared");
  assert.equal("notApplyingNote" in mergedSkip, false, "a note the retry clears stays cleared");
  assert.equal("appliedAt" in mergedSkip, false, "a job-only decision never gains a submission date");
  assert.equal(mergedSkip.notApplyingAt, earlierSkip.notApplyingAt, "the saved decision date is kept");
}

console.log("Preparation application commit paths passed");

