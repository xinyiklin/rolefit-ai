import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  deriveTimeline,
  mergeStageHistories,
  newStageEntryId,
  withInterviewLogged,
  withStageChange
} from "../applicationStageHistory.ts";
import { skipApplicationForSession } from "../notApplyingApplication.ts";
import { sanitizeApplications } from "../../../server/applications/schema.ts";
import { reconcileApplicationMutations } from "../../../server/applications/reconcile.ts";
import { STAGE_HISTORY_MAX_ENTRIES } from "../../../shared/applicationStageHistoryContract.ts";

const created = "2026-09-01T12:00:00.000Z";
const applied = "2026-09-02T12:00:00.000Z";
const rev1 = "2026-09-10T12:00:00.000Z";
const rev2 = "2026-09-11T12:00:00.000Z";
const record = (overrides = {}) => ({
  id: "stage-app",
  title: "Engineer at Example",
  jobUrl: "",
  status: "applied",
  createdAt: created,
  updatedAt: rev1,
  appliedAt: applied,
  ...overrides
});

// --- Entry ids satisfy the stored contract -----------------------------------
const ids = new Set(Array.from({ length: 200 }, newStageEntryId));
assert.equal(ids.size, 200, "entry ids do not repeat");
for (const id of ids) assert.match(id, /^[a-z0-9_-]{1,40}$/, "entry ids match the stored id rule");

// --- withStageChange --------------------------------------------------------
const moved = withStageChange(record(), "interviewing", undefined, rev2);
assert.equal(moved.length, 1);
assert.deepEqual({ ...moved[0], id: "x" }, { id: "x", type: "stage", status: "interviewing", at: rev2 }, "a stage change appends one dated stage entry");
const existing = [{ id: "r1", type: "response", at: rev1 }];
assert.deepEqual(withStageChange(record(), "applied", existing, rev2), existing, "no entry when the stage does not change");
assert.equal(withStageChange(record({ status: "draft", appliedAt: undefined }), "applied", undefined, rev2), undefined, "submitting a Draft records no entry");
assert.equal(
  withStageChange(record({ status: "not_applying", appliedAt: undefined, notApplyingAt: rev1 }), "applied", undefined, rev2),
  undefined,
  "applying after a job-only Skip records no entry"
);
assert.equal(withStageChange(record(), "rejected", existing, rev2).length, 2, "the new entry follows existing history");

// The client's entry is exactly what the server requires for a stage change.
const saved = sanitizeApplications([record({ stageHistory: existing })]);
for (const status of ["interviewing", "offer", "rejected", "withdrawn", "not_applying"]) {
  const requested = sanitizeApplications([{
    ...saved[0],
    status,
    ...(status === "not_applying" ? { notApplyingAt: rev2 } : {}),
    stageHistory: withStageChange(saved[0], status, saved[0].stageHistory, rev2),
    updatedAt: rev2
  }]);
  assert.equal(requested.length, 1, `the ${status} record is valid`);
  assert.equal(
    reconcileApplicationMutations(saved, requested, [{ id: saved[0].id, operation: "upsert", baseUpdatedAt: rev1 }])[0].status,
    status,
    `the server accepts the client's recorded move to ${status}`
  );
}

// --- withInterviewLogged ----------------------------------------------------
const interview = { id: "i1", type: "interview", kind: "technical", at: rev2 };
assert.deepEqual(
  withInterviewLogged({ status: "applied" }, interview),
  { status: "interviewing", stageHistory: [interview] },
  "logging an interview on an Applied record moves it to Interviewing"
);
for (const status of ["interviewing", "offer", "rejected"]) {
  assert.equal(withInterviewLogged({ status, stageHistory: existing }, interview).status, status, `${status} is not moved by an interview`);
}
const logged = withInterviewLogged(saved[0], interview);
const loggedRecord = sanitizeApplications([{
  ...saved[0],
  ...logged,
  stageHistory: withStageChange(saved[0], logged.status, logged.stageHistory, rev2),
  updatedAt: rev2
}]);
assert.equal(
  reconcileApplicationMutations(saved, loggedRecord, [{ id: saved[0].id, operation: "upsert", baseUpdatedAt: rev1 }])[0].stageHistory.length,
  3,
  "an interview plus its auto-move saves as one recorded change"
);

// --- mergeStageHistories ----------------------------------------------------
const a = [{ id: "a1", type: "followup", at: rev1 }];
const b = [{ id: "b1", type: "response", at: rev2 }, { id: "a1", type: "followup", at: rev2 }];
assert.deepEqual(mergeStageHistories(a, [b, undefined]), [a[0], b[0]], "canonical entries come first and a repeated id keeps its first copy");
assert.equal(mergeStageHistories(undefined, [undefined]), undefined, "no history merges to absent");
const full = Array.from({ length: STAGE_HISTORY_MAX_ENTRIES }, (_, index) => ({ id: `f${index}`, type: "followup", at: rev1 }));
assert.equal(mergeStageHistories(full, [[{ id: "over", type: "response", at: rev1 }]]), null, "a merge over the limit is refused, never truncated");
assert.equal(mergeStageHistories(full, [full]).length, STAGE_HISTORY_MAX_ENTRIES, "repeated ids do not count toward the limit");

// --- deriveTimeline ---------------------------------------------------------
const today = new Date("2026-09-15T12:00:00.000Z");
const timeline = deriveTimeline(record({
  status: "interviewing",
  stageHistory: [
    { id: "i2", type: "interview", kind: "panel_onsite", at: "2026-09-20T12:00:00.000Z" },
    { id: "s1", type: "stage", status: "interviewing", at: "2026-09-05T12:00:00.000Z" },
    { id: "i1", type: "interview", kind: "recruiter_screen", at: "2026-09-06T12:00:00.000Z" },
    { id: "f1", type: "followup", at: "2026-09-06T12:00:00.000Z" }
  ]
}), today);
assert.deepEqual(timeline.map((row) => row.key), ["applied", "entry-s1", "entry-i1", "entry-f1", "entry-i2"], "rows run oldest first; same-day rows keep their stored order");
const rounds = timeline.filter((row) => row.kind === "interview").map((row) => [row.entry.id, row.round, row.scheduled]);
assert.deepEqual(rounds, [["i1", 1, false], ["i2", 2, true]], "rounds number by date and future interviews are scheduled");
assert.equal(
  deriveTimeline(record({ stageHistory: [{ id: "i3", type: "interview", kind: "final", at: "2026-09-15T12:00:00.000Z" }] }), today)[1].scheduled,
  false,
  "an interview today is not shown as scheduled"
);

assert.deepEqual(
  deriveTimeline(record({ status: "not_applying", notApplyingAt: rev1 })).map((row) => row.kind),
  ["applied", "skipped"],
  "a record skipped before history existed keeps its Skipped date"
);
assert.deepEqual(
  deriveTimeline(record({
    status: "not_applying",
    notApplyingAt: rev1,
    stageHistory: [{ id: "s2", type: "stage", status: "not_applying", at: rev1 }]
  })).map((row) => row.kind),
  ["applied", "stage"],
  "a recorded Skip is not shown twice"
);
assert.deepEqual(deriveTimeline(record({ status: "draft", appliedAt: undefined })), [], "a Draft has no timeline");

// --- Skip keeps submitted history; job-only decisions keep none ------------
const skipped = skipApplicationForSession({
  session: { mode: "new" },
  prepared: record({ stageHistory: existing }),
  matchedNotApplying: null,
  now: rev2,
  reasons: [],
  note: ""
});
assert.equal(skipped.application.stageHistory, undefined, "a fresh job-only Skip carries no history");

// --- Wiring: every client write path that changes a submitted stage --------
const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const hook = source("../../hooks/useApplications.ts");
assert.match(hook, /status,\s*updatedAt: now,\s*stageHistory: withStageChange\(a, status, a\.stageHistory\)/, "row-menu stage moves record the change");
assert.match(hook, /mergeStageHistories\(canonical\.stageHistory, others\.map/, "duplicate merge unions history");
assert.match(hook, /if \(stageHistory === null\) \{[\s\S]*?return false;/, "an over-limit merge is refused");
assert.match(
  source("../../sections/ApplicationModal.tsx"),
  /stageHistory: withStageChange\(base, statusOverride, form\.stageHistory\.length \? form\.stageHistory : undefined, now\)/,
  "Application Detail records a stage change on save"
);

console.log("application stage history eval passed");
