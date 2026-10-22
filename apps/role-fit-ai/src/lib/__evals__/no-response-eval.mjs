// No response is derived from the latest dated activity: the submission or any
// timeline entry. Day-granular in every zone; only Applied and Interviewing
// records are ever flagged; dueAt is the local day the threshold passed.
import assert from "node:assert/strict";

import {
  DEFAULT_GHOSTED_AFTER_DAYS,
  MAX_GHOSTED_AFTER_DAYS,
  MIN_GHOSTED_AFTER_DAYS,
  normalizeGhostedAfterDays
} from "../ghostedThreshold.ts";
import { lastActivityAt, noResponseCandidate, noResponseCandidates } from "../noResponse.ts";
import { withStageChange } from "../applicationStageHistory.ts";
import { toDateInput, toIso, todayIso } from "../dateInput.ts";

// --- Threshold validation ----------------------------------------------------
assert.equal(DEFAULT_GHOSTED_AFTER_DAYS, 21);
assert.equal(normalizeGhostedAfterDays(MIN_GHOSTED_AFTER_DAYS), 7);
assert.equal(normalizeGhostedAfterDays(MAX_GHOSTED_AFTER_DAYS), 180);
for (const invalid of [6, 181, 21.5, "21", Number.NaN, Infinity, null, undefined, 0, -21]) {
  assert.equal(normalizeGhostedAfterDays(invalid), null, `${String(invalid)} is not a threshold`);
}

// Calendar arithmetic independent of any zone.
const addDays = (day, days) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};
const localDate = (day, hours = 12, minutes = 0) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, hours, minutes);
};
const record = (overrides = {}) => ({
  id: "app-1",
  title: "Engineer at Example",
  jobUrl: "",
  status: "applied",
  createdAt: toIso("2026-01-01"),
  updatedAt: toIso("2026-01-01"),
  ...overrides
});

// Start days include both US DST changes and the year end.
const ZONES = ["America/New_York", "UTC", "Pacific/Kiritimati", "Pacific/Pago_Pago", "Asia/Kolkata", "Pacific/Auckland"];
const START_DAYS = ["2026-02-20", "2026-03-01", "2026-10-15", "2026-12-20"];
const offsets = new Set();

for (const zone of ZONES) {
  process.env.TZ = zone;
  offsets.add(new Date(Date.UTC(2026, 0, 1, 12)).getTimezoneOffset());
  for (const start of START_DAYS) {
    for (const afterDays of [7, 21, 180]) {
      const applied = record({ appliedAt: toIso(start) });
      const dueDay = addDays(start, afterDays);
      const label = `${zone} ${start} +${afterDays}`;

      // Exact boundary, at both ends of the local day.
      for (const [hours, minutes] of [[0, 15], [23, 30]]) {
        assert.equal(noResponseCandidate(applied, afterDays, localDate(addDays(dueDay, -1), hours, minutes)), null, `${label}: one day early is not flagged`);
        const due = noResponseCandidate(applied, afterDays, localDate(dueDay, hours, minutes));
        assert.ok(due, `${label}: flagged on the day the threshold passes`);
        assert.equal(due.silentDays, afterDays, `${label}: silence counts local days across DST`);
        assert.equal(due.dueAt, toIso(dueDay), `${label}: dueAt is that day's stored noon`);
        assert.equal(toDateInput(due.dueAt), dueDay, `${label}: dueAt reads back as the local due day`);
        assert.equal(due.lastActivityAt, applied.appliedAt);
      }

      // Opening the app later still records the day the threshold passed.
      const late = noResponseCandidate(applied, afterDays, localDate(addDays(dueDay, 40), 9));
      assert.equal(late.silentDays, afterDays + 40);
      assert.equal(toDateInput(late.dueAt), dueDay, `${label}: dueAt is not the day the app was opened`);
    }
  }

  // todayIso() entries (what every user-made stage change records) restart the
  // clock in this zone as well.
  const today = localDate("2026-10-20", 23, 45);
  const ghosted = record({
    status: "ghosted",
    appliedAt: toIso("2026-08-01"),
    stageHistory: [{ id: "g1", type: "stage", status: "ghosted", at: toIso("2026-08-22") }]
  });
  const reopened = record({
    ...ghosted,
    status: "applied",
    stageHistory: withStageChange(ghosted, "applied", ghosted.stageHistory, todayIso(today))
  });
  assert.equal(toDateInput(lastActivityAt(reopened)), "2026-10-20", `${zone}: moving back to Applied is today's activity`);
  assert.equal(noResponseCandidate(reopened, 21, today), null, `${zone}: Applied again restarts the clock`);
  assert.equal(noResponseCandidate(reopened, 21, localDate("2026-11-09", 23)), null, `${zone}: still fresh a day early`);
  assert.equal(toDateInput(noResponseCandidate(reopened, 21, localDate("2026-11-10", 0, 5)).dueAt), "2026-11-10", `${zone}: due again 21 days after reopening`);
}
assert.ok(offsets.size >= 5, "the zones above really ran with different offsets");

// --- Activity restarts the clock --------------------------------------------
process.env.TZ = "America/New_York";
const today = localDate("2026-10-20");
const appliedAt = toIso("2026-09-01");
const base = record({ appliedAt });
assert.ok(noResponseCandidate(base, 21, today), "a silent application is flagged");

for (const [label, entry] of [
  ["a follow-up the user sent", { id: "f1", type: "followup", at: toIso("2026-10-05") }],
  ["an employer response", { id: "r1", type: "response", at: toIso("2026-10-05") }],
  ["a past interview", { id: "i1", type: "interview", kind: "technical", at: toIso("2026-10-05") }],
  ["a stage entry", { id: "s1", type: "stage", status: "interviewing", at: toIso("2026-10-05") }]
]) {
  const active = record({ appliedAt, status: entry.type === "stage" ? "interviewing" : "applied", stageHistory: [entry] });
  assert.equal(noResponseCandidate(active, 21, today), null, `${label} 15 days ago keeps the record fresh`);
  assert.equal(toDateInput(noResponseCandidate(active, 21, localDate("2026-10-26")).dueAt), "2026-10-26", `${label} restarts the clock from its own day`);
  assert.equal(noResponseCandidate(active, 14, today).silentDays, 15, `${label} is the latest activity`);
}

const scheduled = record({
  appliedAt,
  status: "interviewing",
  stageHistory: [
    { id: "s1", type: "stage", status: "interviewing", at: toIso("2026-09-05") },
    { id: "i1", type: "interview", kind: "final", at: toIso("2026-12-01") }
  ]
});
assert.equal(lastActivityAt(scheduled), toIso("2026-12-01"), "the latest dated entry wins, future ones included");
assert.equal(noResponseCandidate(scheduled, 7, today), null, "a scheduled interview keeps the record fresh");
assert.equal(noResponseCandidate(scheduled, 7, localDate("2026-12-07")), null, "until its own day passes the threshold");
assert.equal(toDateInput(noResponseCandidate(scheduled, 7, localDate("2026-12-08")).dueAt), "2026-12-08");

const unordered = record({
  appliedAt,
  stageHistory: [
    { id: "f2", type: "followup", at: toIso("2026-10-01") },
    { id: "f1", type: "followup", at: toIso("2026-09-20") }
  ]
});
assert.equal(lastActivityAt(unordered), toIso("2026-10-01"), "entry order does not matter");

// --- Only submitted Applied/Interviewing records are flagged ------------------
const old = toIso("2026-01-05");
const never = {
  "a Draft": record({ status: "draft" }),
  "a job-only Skipped decision": record({ status: "not_applying", notApplyingAt: old }),
  "an application later Skipped": record({ status: "not_applying", appliedAt: old, notApplyingAt: old }),
  "an Offer": record({ status: "offer", appliedAt: old }),
  "a Rejected record": record({ status: "rejected", appliedAt: old }),
  "a Withdrawn record": record({ status: "withdrawn", appliedAt: old }),
  "an already Ghosted record": record({ status: "ghosted", appliedAt: old }),
  "an Applied record without a submission date": record({ status: "applied" }),
  "an Applied record with an unreadable submission date": record({ status: "applied", appliedAt: "soon" })
};
for (const [label, application] of Object.entries(never)) {
  assert.equal(noResponseCandidate(application, MIN_GHOSTED_AFTER_DAYS, today), null, `${label} is never flagged`);
}

// --- The list is longest silence first ----------------------------------------
const list = noResponseCandidates([
  record({ id: "recent", appliedAt: toIso("2026-09-25") }),
  ...Object.values(never),
  record({ id: "oldest", appliedAt: toIso("2026-06-01") }),
  record({ id: "fresh", appliedAt: toIso("2026-10-15") }),
  record({ id: "middle", status: "interviewing", appliedAt: toIso("2026-08-01") })
], 21, today);
assert.deepEqual(list.map((candidate) => candidate.application.id), ["oldest", "middle", "recent"]);

// --- A planned follow-up outranks the silence --------------------------------
const quiet = record({ appliedAt: toIso("2026-08-01") });
assert.ok(noResponseCandidate(quiet, 21, today), "a long-quiet application is flagged");
assert.equal(
  noResponseCandidate({ ...quiet, followupAt: toIso("2026-10-20") }, 21, today),
  null,
  "a follow-up planned for today keeps it fresh"
);
assert.equal(
  noResponseCandidate({ ...quiet, followupAt: toIso("2026-10-25") }, 21, today),
  null,
  "a follow-up planned later keeps it fresh"
);
assert.ok(
  noResponseCandidate({ ...quiet, followupAt: toIso("2026-10-19") }, 21, today),
  "an overdue follow-up no longer holds it back"
);

console.log("no-response eval passed");
