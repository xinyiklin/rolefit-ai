// Ghosted marks: the bulk record transform the tracker sends in one write, and
// the automatic pass (re-read first, re-derive from fresh records, never retry
// an id). The planned write is checked against the real server reconcile.
import assert from "node:assert/strict";

import {
  ghostedTimelineFullMessage,
  autoGhostingCandidateIds,
  planGhostedMarks,
  runAutoGhostingPass
} from "../ghostedMarks.ts";
import { applicationMutationRecords } from "../applicationMutation.ts";
import { withStageChange } from "../applicationStageHistory.ts";
import { toDateInput, toIso, todayIso } from "../dateInput.ts";
import { sanitizeApplications } from "../../../server/applications/schema.ts";
import { reconcileApplicationMutations } from "../../../server/applications/reconcile.ts";
import { STAGE_HISTORY_MAX_ENTRIES } from "../../../shared/applicationStageHistoryContract.ts";

process.env.TZ = "America/New_York";
const rev = toIso("2026-10-01");
const record = (id, overrides = {}) => ({
  id,
  title: `Engineer at ${id}`,
  jobUrl: "",
  status: "applied",
  createdAt: toIso("2026-08-01"),
  updatedAt: rev,
  appliedAt: toIso("2026-08-01"),
  ...overrides
});
const nextRevision = (previous) => new Date(Date.parse(previous) + 1).toISOString();
const fullHistory = Array.from({ length: STAGE_HISTORY_MAX_ENTRIES }, (_, index) => ({
  id: `f${index}`,
  type: "followup",
  at: toIso("2026-08-02")
}));

// --- planGhostedMarks --------------------------------------------------------
const applied = record("applied");
const interviewing = record("interviewing", {
  status: "interviewing",
  stageHistory: [{ id: "s1", type: "stage", status: "interviewing", at: toIso("2026-08-05") }]
});
const rejected = record("rejected", {
  status: "rejected",
  stageHistory: [{ id: "s2", type: "stage", status: "rejected", at: toIso("2026-08-06") }]
});
const draft = record("draft", { status: "draft", appliedAt: undefined });
const untouched = record("untouched");
const current = [applied, interviewing, rejected, draft, untouched];
const at = toIso("2026-10-20");
const plan = planGhostedMarks(current, [
  { id: "applied", at },
  { id: "interviewing", at: toIso("2026-09-02") },
  { id: "applied", at: toIso("2026-01-01") },
  { id: "rejected", at },
  { id: "draft", at },
  { id: "missing", at }
], nextRevision);
assert.equal(plan.kind, "ready");
assert.deepEqual(
  plan.mutations,
  [
    { id: "applied", operation: "upsert", baseUpdatedAt: rev },
    { id: "interviewing", operation: "upsert", baseUpdatedAt: rev }
  ],
  "one upsert per still-Applied/Interviewing record, against its saved revision"
);
const byId = new Map(plan.next.map((application) => [application.id, application]));
for (const [id, expectedAt] of [["applied", at], ["interviewing", toIso("2026-09-02")]]) {
  const marked = byId.get(id);
  const original = current.find((application) => application.id === id);
  assert.equal(marked.status, "ghosted", `${id} moves to Ghosted`);
  assert.equal(marked.updatedAt, nextRevision(rev), `${id} gets a new revision`);
  assert.equal(marked.stageHistory.length, (original.stageHistory?.length ?? 0) + 1, `${id} gains exactly one entry`);
  const entry = marked.stageHistory.at(-1);
  assert.equal(entry.type, "stage");
  assert.equal(entry.status, "ghosted");
  assert.equal(entry.at, expectedAt, `${id}'s entry keeps the date it was marked with (first mark wins)`);
  assert.deepEqual(marked.stageHistory.slice(0, -1), original.stageHistory ?? [], `${id} keeps its earlier history`);
}
for (const id of ["rejected", "draft", "untouched"]) {
  assert.equal(byId.get(id), current.find((application) => application.id === id), `${id} is left as the same object`);
}
assert.deepEqual(plan.next.map(({ id }) => id), current.map(({ id }) => id), "tracker order is kept");
assert.equal(applied.status, "applied", "the input tracker is not mutated");

const nothing = planGhostedMarks(current, [{ id: "rejected", at }], nextRevision);
assert.equal(nothing.kind, "ready");
assert.equal(nothing.mutations.length, 0, "nothing still markable means no write");

const full = record("full", { stageHistory: fullHistory });
const refused = planGhostedMarks([applied, full], [{ id: "applied", at }, { id: "full", at }], nextRevision);
assert.equal(refused.kind, "history-full", "one full timeline refuses the whole batch");
assert.equal(refused.application.id, "full", "the refusal names the full record");
assert.match(ghostedTimelineFullMessage(refused.application), /'s timeline is full\./);
assert.equal(
  planGhostedMarks([applied, full], [{ id: "applied", at }], nextRevision).kind,
  "ready",
  "a full timeline outside the batch does not block it"
);

// The planned write is exactly what the server accepts, in one transaction.
const saved = sanitizeApplications(current);
const accepted = reconcileApplicationMutations(
  saved,
  sanitizeApplications(applicationMutationRecords(plan.next, plan.mutations)),
  plan.mutations
);
assert.deepEqual(
  accepted.filter(({ status }) => status === "ghosted").map(({ id }) => id).sort(),
  ["applied", "interviewing"],
  "the server accepts the bulk upsert with its stage entries"
);

// --- autoGhostingCandidateIds -------------------------------------------------
const today = new Date(2026, 9, 20, 9);
const stale = (id, overrides) => record(id, { appliedAt: toIso("2026-08-01"), ...overrides });
const tracker = [
  stale("old"),
  stale("tried"),
  stale("full", { stageHistory: fullHistory }),
  stale("recent", { appliedAt: toIso("2026-10-10") }),
  stale("closed", { status: "rejected", stageHistory: [{ id: "s3", type: "stage", status: "rejected", at: toIso("2026-08-03") }] })
];
assert.deepEqual(
  autoGhostingCandidateIds(tracker, 21, new Set(["tried"]), today),
  ["old"],
  "only flagged, untried records with room for the entry"
);

// --- runAutoGhostingPass ------------------------------------------------------
function fakeTracker(initial, { refreshResult = true, markResult = true, afterRefresh } = {}) {
  let records = initial;
  const calls = [];
  return {
    calls,
    set(next) {
      records = next;
    },
    pass(overrides = {}) {
      return {
        ids: [],
        afterDays: 21,
        attempted: new Set(),
        isCurrent: () => true,
        refresh: async () => {
          calls.push("refresh");
          if (afterRefresh) records = afterRefresh(records);
          return refreshResult;
        },
        getApplication: (id) => records.find((application) => application.id === id),
        markGhosted: async (marks) => {
          calls.push(["mark", marks]);
          if (!markResult) return null;
          const result = planGhostedMarks(records, marks, nextRevision);
          if (result.kind !== "ready") return null;
          records = result.next;
          return result.mutations.length;
        },
        today: () => today,
        ...overrides
      };
    }
  };
}

{
  const fake = fakeTracker([stale("old"), stale("recent", { appliedAt: toIso("2026-10-10") })]);
  const attempted = new Set();
  const marked = await runAutoGhostingPass(fake.pass({ ids: ["old"], attempted }));
  assert.equal(marked, 1);
  assert.equal(fake.calls[0], "refresh", "the pass re-reads the tracker before writing");
  assert.deepEqual(fake.calls[1], ["mark", [{ id: "old", at: toIso("2026-08-22") }]], "the mark is dated the day the threshold passed");
  assert.equal(toDateInput(fake.calls[1][1][0].at), "2026-08-22");
  assert.notEqual(fake.calls[1][1][0].at, todayIso(today), "not the day the app was opened");
  assert.deepEqual([...attempted], ["old"]);
}

{
  // Another tab already marked it, or logged a follow-up: the fresh record wins.
  const fake = fakeTracker([stale("a"), stale("b")], {
    afterRefresh: (records) => records.map((application) => application.id === "a"
      ? { ...application, status: "ghosted", stageHistory: [{ id: "g1", type: "stage", status: "ghosted", at: toIso("2026-08-22") }] }
      : { ...application, stageHistory: [{ id: "f1", type: "followup", at: toIso("2026-10-15") }] })
  });
  const attempted = new Set();
  assert.equal(await runAutoGhostingPass(fake.pass({ ids: ["a", "b"], attempted })), 0);
  assert.deepEqual(fake.calls, ["refresh"], "nothing is written when the fresh records are no longer silent");
  assert.equal(attempted.size, 0, "an id the pass did not send stays eligible");
}

{
  const fake = fakeTracker([stale("old")]);
  assert.equal(await runAutoGhostingPass(fake.pass({ ids: ["old"], isCurrent: () => false })), 0);
  assert.deepEqual(fake.calls, [], "a pass that is no longer current neither re-reads nor writes");

  let current = true;
  const stopsAfterRead = fakeTracker([stale("old")], { afterRefresh: (records) => { current = false; return records; } });
  assert.equal(await runAutoGhostingPass(stopsAfterRead.pass({ ids: ["old"], isCurrent: () => current })), 0);
  assert.deepEqual(stopsAfterRead.calls, ["refresh"], "turning automation off during the re-read stops the write");

  const unread = fakeTracker([stale("old")], { refreshResult: false });
  assert.equal(await runAutoGhostingPass(unread.pass({ ids: ["old"] })), 0);
  assert.deepEqual(unread.calls, ["refresh"], "a failed re-read never writes on stale data");
}

{
  // A failed or conflicting write is never retried this session.
  const fake = fakeTracker([stale("old")], { markResult: false });
  const attempted = new Set();
  assert.equal(await runAutoGhostingPass(fake.pass({ ids: ["old"], attempted })), 0);
  assert.deepEqual([...attempted], ["old"]);
  assert.deepEqual(autoGhostingCandidateIds([stale("old")], 21, attempted, today), [], "the tried id is no longer a candidate");
  assert.equal(await runAutoGhostingPass(fake.pass({ ids: ["old"], attempted })), 0);
  assert.equal(fake.calls.filter((call) => Array.isArray(call)).length, 1, "the second pass sends no write");
}

{
  const fake = fakeTracker([stale("full", { stageHistory: fullHistory }), stale("old")]);
  assert.equal(await runAutoGhostingPass(fake.pass({ ids: ["full", "old"] })), 1);
  assert.deepEqual(fake.calls[1][1].map(({ id }) => id), ["old"], "a timeline that filled meanwhile is left out, not the batch");
}

// --- Don't fight the user ------------------------------------------------------
{
  // Auto-marked, then the user moves it back to Applied today: the new stage
  // entry is the latest activity, so the clock restarts from today.
  const fake = fakeTracker([stale("back")]);
  const attempted = new Set();
  assert.equal(await runAutoGhostingPass(fake.pass({ ids: ["back"], attempted })), 1);
  const ghosted = fake.pass().getApplication("back");
  assert.equal(ghosted.status, "ghosted");
  const movedBack = {
    ...ghosted,
    status: "applied",
    stageHistory: withStageChange(ghosted, "applied", ghosted.stageHistory, todayIso(today))
  };
  fake.set([movedBack]);
  assert.deepEqual(autoGhostingCandidateIds([movedBack], 21, new Set(), today), [], "moving back to Applied is fresh activity");
  assert.deepEqual(autoGhostingCandidateIds([movedBack], 21, attempted, new Date(2026, 10, 10, 9)), [], "and this session never retries it");
  const nextSession = autoGhostingCandidateIds([movedBack], 21, new Set(), new Date(2026, 10, 10, 9));
  assert.deepEqual(nextSession, ["back"], "a later session flags it again only after a full new threshold");
  const again = fakeTracker([movedBack]);
  await runAutoGhostingPass(again.pass({ ids: nextSession, today: () => new Date(2026, 10, 10, 9) }));
  assert.equal(toDateInput(again.calls[1][1][0].at), "2026-11-10", "dated 21 days after the user moved it back");
}

console.log("ghosted marks eval passed");
