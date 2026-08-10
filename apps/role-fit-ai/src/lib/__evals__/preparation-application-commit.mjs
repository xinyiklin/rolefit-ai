import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  preparationPrimaryAction,
  preparationSessionForApplication,
  newPreparationSession
} from "../preparationSession.ts";
import { appliedApplicationForSession } from "../preparationApplication.ts";

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
const preparedDraft = application({
  id: "fresh-1",
  status: "interested",
  createdAt: now,
  appliedAt: undefined,
  updatedAt: now,
  jobDescription: "Updated prepared posting",
  notes: undefined
});

assert.deepEqual(
  preparationPrimaryAction(newPreparationSession()),
  { kind: "apply", label: "Apply", busyLabel: "Applying…", successVerb: "Applied" },
  "new preparation copy describes an application submission"
);
assert.deepEqual(
  preparationPrimaryAction(preparationSessionForApplication(application({ status: "interested" }))),
  { kind: "apply", label: "Apply", busyLabel: "Applying…", successVerb: "Applied" },
  "an interested draft still applies"
);
assert.deepEqual(
  preparationPrimaryAction(preparationSessionForApplication(application())),
  {
    kind: "update-application",
    label: "Update application",
    busyLabel: "Updating…",
    successVerb: "Updated"
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
    successVerb: "Saved"
  },
  "a saved Not applying record uses job-update language"
);

const created = appliedApplicationForSession({
  session: newPreparationSession(),
  prepared: preparedDraft,
  existing: null,
  now
});
assert.equal(created?.operation, "create");
assert.equal(created?.application.id, "fresh-1");
assert.equal(created?.application.status, "applied");
assert.equal(created?.application.appliedAt, now);

const draft = application({ status: "interested", appliedAt: undefined });
const appliedDraft = appliedApplicationForSession({
  session: preparationSessionForApplication(draft),
  prepared: preparedDraft,
  existing: draft,
  now
});
assert.equal(appliedDraft?.operation, "update");
assert.equal(appliedDraft?.application.id, draft.id);
assert.equal(appliedDraft?.application.createdAt, createdAt);
assert.equal(appliedDraft?.application.status, "applied");
assert.equal(appliedDraft?.application.appliedAt, now);
assert.equal(appliedDraft?.application.notes, "Keep me");

const historical = application({ status: "rejected" });
const updated = appliedApplicationForSession({
  session: preparationSessionForApplication(historical),
  prepared: preparedDraft,
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
    prepared: preparedDraft,
    existing: null,
    now
  }),
  null,
  "an explicit draft/update session never falls back to creating a record"
);

const appSource = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const mastheadSource = readFileSync(new URL("../../sections/Masthead.tsx", import.meta.url), "utf8");
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
  mastheadSource,
  /busy \? primaryAction\.busyLabel : primaryAction\.label/,
  "the masthead uses shared idle and busy action copy"
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

console.log("Preparation application commit paths passed");
