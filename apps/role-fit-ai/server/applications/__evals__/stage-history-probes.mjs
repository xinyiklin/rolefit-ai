import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApplicationsStorageError, sanitizeApplications } from "../schema.ts";
import { reconcileApplicationMutations } from "../reconcile.ts";
import {
  applicationsFilePath,
  invalidateApplicationsSnapshot,
  readApplications as readCachedApplications,
  writeApplications
} from "../storage.ts";
import {
  STAGE_HISTORY_MAX_ENTRIES,
  STAGE_HISTORY_NOTE_MAX_LENGTH
} from "../../../shared/applicationStageHistoryContract.ts";

const readApplications = (dir) => {
  invalidateApplicationsSnapshot();
  return readCachedApplications(dir);
};

const created = "2026-09-01T00:00:00.000Z";
const applied = "2026-09-02T00:00:00.000Z";
const rev1 = "2026-09-10T00:00:00.000Z";
const rev2 = "2026-09-11T00:00:00.000Z";

const record = (overrides = {}) => ({
  id: "stage-app",
  title: "Engineer at Example",
  status: "interviewing",
  createdAt: created,
  updatedAt: rev1,
  appliedAt: applied,
  ...overrides
});

const fullHistory = [
  { id: "s1", type: "stage", status: "interviewing", at: "2026-09-05T00:00:00.000Z" },
  { id: "i1", type: "interview", kind: "recruiter_screen", at: "2026-09-06T00:00:00.000Z", note: "Call with the recruiter" },
  { id: "i2", type: "interview", kind: "technical", at: "2026-09-20T00:00:00.000Z" },
  { id: "r1", type: "response", at: "2026-09-04T00:00:00.000Z" },
  { id: "f1", type: "followup", at: "2026-09-15T00:00:00.000Z", note: "Thank-you email" }
];

const accepted = (overrides) => sanitizeApplications([record(overrides)]).length === 1;

// --- Sanitizer -------------------------------------------------------------

const workspace = await mkdtemp(join(tmpdir(), "rolefit-stage-history-"));
try {
  const [valid] = sanitizeApplications([record({ stageHistory: fullHistory })]);
  assert.deepEqual(valid.stageHistory, fullHistory, "every entry type is accepted as written");

  await writeApplications(workspace, [valid]);
  const [loaded] = await readApplications(workspace);
  assert.deepEqual(loaded.stageHistory, fullHistory, "history survives the strict on-disk round trip");

  assert.equal(sanitizeApplications([record({ stageHistory: [] })])[0].stageHistory, undefined, "an empty list is stored as absent");
  assert.equal(sanitizeApplications([record()])[0].stageHistory, undefined, "a record without history stays without history");

  const atLimit = Array.from({ length: STAGE_HISTORY_MAX_ENTRIES }, (_, index) => ({
    id: `f${index}`,
    type: "followup",
    at: rev1,
    note: "x".repeat(STAGE_HISTORY_NOTE_MAX_LENGTH)
  }));
  assert.ok(accepted({ stageHistory: atLimit }), "a list at the entry and note limits is accepted");

  const invalidHistories = {
    "not a list": { s1: fullHistory[0] },
    "null": null,
    "uppercase id": [{ ...fullHistory[0], id: "S1" }],
    "long id": [{ ...fullHistory[0], id: "a".repeat(41) }],
    "duplicate id": [fullHistory[0], { ...fullHistory[1], id: "s1" }],
    "unknown type": [{ id: "x1", type: "offer_call", at: rev1 }],
    "unknown interview kind": [{ ...fullHistory[1], kind: "coffee_chat" }],
    "draft stage": [{ ...fullHistory[0], status: "draft" }],
    "unknown stage": [{ ...fullHistory[0], status: "ghosted" }],
    "non-canonical date": [{ ...fullHistory[0], at: "2026-09-05" }],
    "unparseable date": [{ ...fullHistory[0], at: "soon" }],
    "extra key": [{ ...fullHistory[3], recruiter: "Pat" }],
    "note on a stage entry": [{ ...fullHistory[0], note: "Moved" }],
    "blank note": [{ ...fullHistory[3], note: "   " }],
    "over-long note": [{ ...fullHistory[3], note: "x".repeat(STAGE_HISTORY_NOTE_MAX_LENGTH + 1) }],
    "too many entries": [...atLimit, { id: "extra", type: "response", at: rev1 }],
    "non-object entry": ["applied"]
  };
  for (const [label, stageHistory] of Object.entries(invalidHistories)) {
    assert.ok(!accepted({ stageHistory }), `invalid history refuses the whole record: ${label}`);
  }

  assert.ok(!accepted({ status: "draft", appliedAt: undefined, stageHistory: [fullHistory[3]] }), "a Draft cannot carry history");
  assert.ok(
    !accepted({ status: "not_applying", appliedAt: undefined, notApplyingAt: rev1, stageHistory: [fullHistory[3]] }),
    "a job-only Skipped decision cannot carry history"
  );
  assert.ok(
    accepted({
      status: "not_applying",
      notApplyingAt: rev1,
      stageHistory: [{ id: "s2", type: "stage", status: "not_applying", at: rev1 }]
    }),
    "an application later marked Skipped keeps its history"
  );

  // Strict reads: invalid or non-canonical history on disk fails closed and is
  // never rewritten.
  const filePath = applicationsFilePath(workspace);
  for (const stageHistory of [[], [{ ...fullHistory[1], kind: "coffee_chat" }], [{ ...fullHistory[0], at: "2026-09-05" }]]) {
    const before = JSON.stringify({ applications: [{ ...valid, stageHistory }] });
    await writeFile(filePath, before, "utf8");
    await assert.rejects(readApplications(workspace), ApplicationsStorageError, `stored history ${JSON.stringify(stageHistory)} fails closed`);
    assert.equal(await readFile(filePath, "utf8"), before, "a refused tracker keeps its bytes");
  }
} finally {
  await rm(workspace, { recursive: true, force: true });
}

// --- Reconcile: every stage change after submission is recorded ------------

const saved = sanitizeApplications([record({ status: "applied", stageHistory: [fullHistory[3]] })]);
const save = (overrides, base = saved) => reconcileApplicationMutations(
  base,
  sanitizeApplications([{ ...base[0], updatedAt: rev2, ...overrides }]),
  [{ id: base[0].id, operation: "upsert", baseUpdatedAt: base[0].updatedAt }]
);
const rejectsUnrecorded = (overrides, base, message) => assert.throws(
  () => save(overrides, base),
  (error) => error instanceof ApplicationsStorageError && error.status === 400 && /stage change must be recorded/.test(error.message),
  message
);
const moved = { id: "s9", type: "stage", status: "interviewing", at: rev2 };

rejectsUnrecorded({ status: "interviewing" }, saved, "a stage change without a stage entry is refused");
rejectsUnrecorded(
  { status: "interviewing", stageHistory: [fullHistory[3], { ...moved, status: "offer" }] },
  saved,
  "a stage entry naming a different stage does not record the change"
);
rejectsUnrecorded(
  { status: "interviewing", stageHistory: [fullHistory[3], { ...fullHistory[2], id: "i9" }] },
  saved,
  "an interview entry alone does not record the stage change"
);
const alreadyInterviewing = sanitizeApplications([record({ status: "applied", stageHistory: [fullHistory[0]] })]);
rejectsUnrecorded(
  { status: "interviewing" },
  alreadyInterviewing,
  "an already-saved stage entry cannot record a new change"
);

assert.equal(save({ status: "interviewing", stageHistory: [fullHistory[3], moved] })[0].status, "interviewing", "a recorded stage change is accepted");
assert.equal(
  save({ status: "interviewing", stageHistory: [fullHistory[3], { ...fullHistory[1], id: "i9" }, moved] })[0].stageHistory.length,
  3,
  "logging an interview may move the stage in the same save"
);
assert.equal(
  save({ status: "not_applying", notApplyingAt: rev2, stageHistory: [fullHistory[3], { ...moved, status: "not_applying" }] })[0].status,
  "not_applying",
  "moving a submitted record to Skipped is recorded like any other stage"
);
assert.equal(save({ notes: "edited", stageHistory: undefined })[0].stageHistory, undefined, "entries may be deleted without a stage change");
assert.equal(
  save({ stageHistory: [{ ...fullHistory[3], at: rev2 }, { ...moved, id: "merged-stage" }] })[0].stageHistory.length,
  2,
  "entries may be edited or merged in without a stage change"
);

const draft = sanitizeApplications([record({ status: "draft", appliedAt: undefined })]);
assert.equal(save({ status: "applied", appliedAt: rev2 }, draft)[0].status, "applied", "submitting a Draft needs no stage entry");
const jobOnly = sanitizeApplications([record({ status: "not_applying", appliedAt: undefined, notApplyingAt: rev1 })]);
assert.equal(
  save({ status: "applied", appliedAt: rev2, notApplyingAt: undefined }, jobOnly)[0].status,
  "applied",
  "applying after a job-only Skip decision is the submission and needs no stage entry"
);

console.log("stage-history probes passed");
