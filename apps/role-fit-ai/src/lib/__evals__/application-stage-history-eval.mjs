import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  deriveTimeline,
  interviewLabel,
  interviewMilestones,
  mergeStageHistories,
  newStageEntryId,
  withEntryRemoved,
  withEntrySaved,
  stageHistoryFits,
  timelineDateProblem,
  withStageChange,
  withStatusChange
} from "../applicationStageHistory.ts";
import { toDateInput, toIso, todayIso } from "../dateInput.ts";
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

// --- withEntrySaved / withEntryRemoved -------------------------------------
// Entries save on their own against the saved record; only saving a new
// interview on an Applied or Ghosted record moves the stage, and that move is
// recorded.
const interview = { id: "i1", type: "interview", kind: "technical", at: rev2 };
const savedInterview = withEntrySaved(saved[0], interview);
assert.equal(savedInterview.status, "interviewing", "saving a new interview on an Applied record moves it to Interviewing");
assert.deepEqual(
  savedInterview.stageHistory.map((entry) => entry.type === "stage" ? "stage:" + entry.status : entry.id),
  ["r1", "i1", "stage:interviewing"],
  "the interview and its stage move are saved together"
);
const reopened = withEntrySaved({ ...saved[0], status: "ghosted" }, interview);
assert.equal(reopened.status, "interviewing", "a late interview on a Ghosted record reopens it as Interviewing");
assert.equal(reopened.stageHistory.at(-1).status, "interviewing", "and records that move");
for (const status of ["interviewing", "offer", "rejected"]) {
  const result = withEntrySaved({ ...saved[0], status }, interview);
  assert.equal(result.status, status, status + " is not moved by an interview");
  assert.equal(result.stageHistory.length, 2, status + " gains only the interview");
}
const followup = { id: "f1", type: "followup", at: rev2 };
assert.deepEqual(withEntrySaved(saved[0], followup), { status: "applied", stageHistory: [existing[0], followup] }, "other entries never move the stage");
const withInterview = { ...saved[0], status: "interviewing", stageHistory: [existing[0], interview] };
const edited = withEntrySaved(withInterview, { ...interview, kind: "final" });
assert.deepEqual(edited.stageHistory, [existing[0], { ...interview, kind: "final" }], "an edit replaces the entry in place");
assert.equal(edited.status, "interviewing", "editing an interview does not move the stage");
assert.deepEqual(withEntryRemoved(withInterview, "i1"), { status: "interviewing", stageHistory: [existing[0]] }, "removal drops only that entry");
assert.equal(withEntryRemoved({ ...saved[0], stageHistory: [followup] }, "f1").stageHistory, undefined, "removing the last entry leaves no history");

const savedRecord = sanitizeApplications([{ ...saved[0], ...savedInterview, updatedAt: rev2 }]);
assert.equal(
  reconcileApplicationMutations(saved, savedRecord, [{ id: saved[0].id, operation: "upsert", baseUpdatedAt: rev1 }])[0].stageHistory.length,
  3,
  "the server accepts an interview saved with its stage move"
);

// --- Legacy Skip date and the stored limit ----------------------------------
// A record skipped before history existed keeps its Skip date when it leaves
// Skipped (which clears notApplyingAt), and the server accepts the result.
const legacySkip = sanitizeApplications([record({ status: "not_applying", notApplyingAt: rev1 })]);
const unskipped = withStageChange(legacySkip[0], "interviewing", undefined, rev2);
assert.deepEqual(
  unskipped.map((entry) => [entry.status, entry.at]),
  [["not_applying", rev1], ["interviewing", rev2]],
  "leaving a legacy Skipped record records its Skip date first"
);
assert.equal(
  reconcileApplicationMutations(legacySkip, sanitizeApplications([{ ...legacySkip[0], status: "interviewing", notApplyingAt: undefined, stageHistory: unskipped, updatedAt: rev2 }]), [
    { id: legacySkip[0].id, operation: "upsert", baseUpdatedAt: rev1 }
  ])[0].stageHistory.length,
  2,
  "the server accepts the recovered Skip entry with the move"
);
const recordedSkip = withStageChange(
  { ...legacySkip[0], stageHistory: [{ id: "s0", type: "stage", status: "not_applying", at: rev1 }] },
  "applied", [{ id: "s0", type: "stage", status: "not_applying", at: rev1 }], rev2
);
assert.equal(recordedSkip.length, 2, "a Skip already in history is not recorded twice");

const atLimit = Array.from({ length: STAGE_HISTORY_MAX_ENTRIES }, (_, index) => ({ id: `l${index}`, type: "followup", at: rev1 }));
const oneBelow = atLimit.slice(1);
assert.equal(stageHistoryFits(record({ stageHistory: atLimit }), "applied"), true, "no stage move needs no room");
assert.equal(stageHistoryFits(record({ stageHistory: atLimit }), "rejected"), false, "a full timeline cannot take a stage move");
assert.equal(stageHistoryFits(record({ stageHistory: oneBelow }), "rejected"), true, "one free entry fits a stage move");
assert.equal(
  stageHistoryFits(record({ stageHistory: oneBelow }), "interviewing", [interview]),
  false,
  "an interview on an Applied record needs room for itself and its stage move"
);
assert.equal(
  sanitizeApplications([{ ...record({ stageHistory: oneBelow }), ...withEntrySaved(record({ stageHistory: oneBelow }), interview), updatedAt: rev2 }]).length,
  0,
  "what stageHistoryFits refuses is exactly what the server would refuse"
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
{
  // The Applied anchor keeps its exact instant while entries sit at local noon:
  // a stage entry on the application day still follows the anchor.
  const sameDay = deriveTimeline(record({
    status: "interviewing",
    appliedAt: new Date("2026-09-02T15:00:00").toISOString(),
    stageHistory: [{ id: "s0", type: "stage", status: "interviewing", at: new Date("2026-09-02T12:00:00").toISOString() }]
  }), today);
  assert.deepEqual(sameDay.map((row) => row.key), ["applied", "entry-s0"], "a same-day stage entry never precedes the Applied anchor");
  const recorded = deriveTimeline(record({
    status: "interviewing",
    stageHistory: [
      { id: "late", type: "followup", at: new Date("2026-09-10T15:00:00").toISOString() },
      { id: "early", type: "response", at: new Date("2026-09-10T09:00:00").toISOString() }
    ]
  }), today);
  assert.deepEqual(recorded.map((row) => row.key), ["applied", "entry-late", "entry-early"], "same-day entries keep their recorded order, not their time of day");
}
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

// --- interviewMilestones ----------------------------------------------------
const milestones = interviewMilestones(record({
  status: "interviewing",
  stageHistory: [
    { id: "i1", type: "interview", kind: "recruiter_screen", at: "2026-09-06T12:00:00.000Z" },
    { id: "i3", type: "interview", kind: "final", at: "2026-09-30T12:00:00.000Z" },
    { id: "i2", type: "interview", kind: "technical", at: "2026-09-12T12:00:00.000Z" },
    { id: "i4", type: "interview", kind: "panel_onsite", at: "2026-09-20T12:00:00.000Z" }
  ]
}), today);
assert.equal(interviewLabel(milestones.latest), "Round 2 · Technical", "the latest held interview is the most recent past one");
assert.equal(interviewLabel(milestones.next), "Round 3 · Panel / onsite", "the next interview is the soonest scheduled one");
assert.deepEqual(interviewMilestones(record(), today), { latest: undefined, next: undefined }, "no interviews, no milestones");

// --- Date helpers keep a picked day stable ----------------------------------
assert.equal(toDateInput(toIso("2026-03-08")), "2026-03-08", "a picked date round-trips through storage");
assert.equal(toDateInput(todayIso(new Date(2026, 9, 20, 23, 30))), "2026-10-20", "late-evening entries keep the local day");

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
assert.match(hook, /a\.id === id \? withStatusChange\(a, status, now\) : a/, "row-menu stage moves record the change");
{
  const submitted = record();
  const moved = withStatusChange(submitted, "interviewing", rev2, rev2);
  assert.equal(moved.updatedAt, rev2);
  assert.deepEqual(moved.stageHistory, withStageChange(submitted, "interviewing", submitted.stageHistory, rev2).map((entry, index) => ({ ...entry, id: moved.stageHistory[index].id })), "the shared transform records the stage entry");
}
{
  // A migrated submitted record without a date keeps none; only a first
  // submission is dated now.
  const migrated = withStatusChange({ ...record(), appliedAt: undefined, stageHistory: undefined }, "interviewing", rev2, rev2);
  assert.equal(migrated.appliedAt, undefined, "a stage move never invents an application date");
  const submittedNow = withStatusChange({ ...record(), status: "draft", appliedAt: undefined, stageHistory: undefined }, "applied", rev2);
  assert.equal(submittedNow.appliedAt, rev2, "submitting a Draft dates it now");
  const skipSubmitted = withStatusChange({ ...record(), status: "not_applying", appliedAt: undefined, stageHistory: undefined, notApplyingAt: rev1 }, "applied", rev2);
  assert.equal(skipSubmitted.appliedAt, rev2, "submitting a job-only Skip dates it now");
}
assert.match(hook, /mergeStageHistories\(canonical\.stageHistory, others\.map/, "duplicate merge unions history");
assert.match(hook, /if \(stageHistory === null\) \{[\s\S]*?return false;/, "an over-limit merge is refused");
assert.match(hook, /if \(!stageHistoryFits\(existing, status\)\) \{\s*setError\(STAGE_HISTORY_FULL_MESSAGE\);/, "a row-menu move on a full timeline is refused with a clear message");
assert.match(hook, /if \(skipDropsDocuments\(existing, status\)\) \{\s*setError\(SKIP_DROPS_DOCUMENTS_MESSAGE\);\s*return;/, "a row-menu Skip that would drop documents is refused with a clear message");
{
  const detail = source("../../sections/ApplicationModal.tsx");
  assert.match(
    detail,
    /function stageChangeRefused\(status: ApplicationStatus\): boolean \{\s*if \(!activeApplication\) return false;\s*if \(!stageHistoryFits\(activeApplication, status\)\) \{\s*setSaveError\(STAGE_HISTORY_FULL_MESSAGE\);\s*return true;\s*\}\s*if \(skipDropsDocuments\([\s\S]*?, status\)\) \{\s*setSaveError\(SKIP_DROPS_DOCUMENTS_MESSAGE\);/,
    "Detail refuses a stage move that would overflow the timeline or drop documents"
  );
  assert.match(detail, /if \(stageChangeRefused\(statusOverride\)\) return;\s*setIsSaving\(true\);/, "Save refuses a full timeline up front");
  // Opening the preparation or a related record, and unlinking or merging, all
  // persist the form's pending stage first, so each refuses the same way.
  const persistPaths = detail.split(/\n  (?=async function |function )/).filter((body) => body.includes("buildApplication(form.status)"));
  assert.equal(persistPaths.length, 3, "three paths persist the form's stage before leaving it");
  for (const body of persistPaths) {
    const guard = body.indexOf("stageChangeRefused(form.status)) return;");
    assert.ok(guard >= 0 && guard < body.indexOf("buildApplication(form.status)"), `${body.slice(0, 60)} refuses a full timeline before persisting`);
  }
}
assert.match(
  source("../../sections/ApplicationModal.tsx"),
  /stageHistory: statusOverride === "draft"\s*\? undefined\s*: withStageChange\(base, statusOverride, base\.stageHistory\)/,
  "Application Detail records a stage change on save"
);

// --- Timeline dates: nothing before the application; only an interview ahead
{
  const now = new Date(2026, 9, 20, 9, 0);
  const appliedDay = toIso("2026-10-01");
  assert.equal(timelineDateProblem({ type: "followup", at: toIso("2026-09-30") }, appliedDay, now), "before_application");
  assert.equal(timelineDateProblem({ type: "interview", at: toIso("2026-09-30") }, appliedDay, now), "before_application", "an interview cannot predate the application either");
  assert.equal(timelineDateProblem({ type: "followup", at: toIso("2026-10-01") }, new Date(2026, 9, 1, 23, 30).toISOString(), now), null, "the application day itself fits, whatever its time");
  for (const type of ["response", "followup", "stage"]) {
    assert.equal(timelineDateProblem({ type, at: toIso("2026-10-21") }, appliedDay, now), "future", `a ${type} cannot be dated ahead`);
    assert.equal(timelineDateProblem({ type, at: toIso("2026-10-20") }, appliedDay, now), null, `a ${type} can be dated today`);
  }
  assert.equal(timelineDateProblem({ type: "interview", at: toIso("2027-01-15") }, appliedDay, now), null, "an interview can be scheduled ahead");
  assert.equal(timelineDateProblem({ type: "followup", at: toIso("2026-10-10") }, undefined, now), null);

  const popover = source("../../sections/application/ApplicationTimelinePopover.tsx");
  assert.match(
    popover,
    /const dateChanged = draft \? draft\.isNew \|\| toDateInput\(draft\.entry\.at\) !== toDateInput\(savedEntry\?\.at\) : false;\s*const dateProblem = draft && dateChanged \? timelineDateProblem\(draft\.entry, appliedAt\) : null;/,
    "the popover checks a typed date, never an unchanged saved one"
  );
  assert.match(popover, /function save\(\) \{\s*if \(draft && !dateProblem\) void run\(\(\) => onSaveEntry/, "an out-of-range date is never sent");
  assert.match(popover, /\{dateProblem \? <p id=\{DATE_PROBLEM_ID\} className="application-timeline__error" role="alert">\{DATE_PROBLEM_MESSAGE\[dateProblem\]\}<\/p> : null\}/, "the problem shows inline");
  assert.match(
    popover,
    /aria-invalid=\{dateProblem \? true : undefined\}\s*aria-describedby=\{dateProblem \? DATE_PROBLEM_ID : undefined\}\s*onChange=\{\(event\) => changeDate/,
    "the date input is marked invalid and names the problem"
  );
  assert.match(
    popover,
    /aria-disabled=\{busy \|\| Boolean\(dateProblem\)\}\s*aria-describedby=\{dateProblem \? DATE_PROBLEM_ID : undefined\}\s*onClick=\{save\}/,
    "Save reads as unavailable and names the problem"
  );
  assert.match(source("../../../server/applications/eventService.ts"), /const dateProblem = timelineDateProblem\(entry, current\.appliedAt\);/, "the event route applies the same rule");
}

console.log("application stage history eval passed");
