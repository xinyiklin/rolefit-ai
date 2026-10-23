// The tracker's derived "No response" state: the label, where it outranks and
// yields to other next actions, and the Ghosted stage's place in the lifecycle
// filters and the row menu. The flag is never stored, so every probe derives it
// from a record and a fixed "today".
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ACTIVITY_STATUS_GROUPS,
  STATUS_LABEL,
  activityCount,
  matchesActivityFilter,
  nextAction,
  noResponseLabel
} from "../../../lib/applicationDisplay.ts";
import { noResponseCandidate, noResponseCandidates } from "../../../lib/noResponse.ts";
import { stageMenuMoveAllowed } from "../../../lib/applicationStatusTransitions.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const today = new Date(2026, 9, 5);

function application(overrides = {}) {
  return {
    id: "app-1",
    title: "Acme · Engineer",
    createdAt: "2026-08-01",
    updatedAt: "2026-08-01",
    status: "applied",
    appliedAt: "2026-09-01",
    ...overrides
  };
}

// ----- Label -----
assert.equal(noResponseLabel({ silentDays: 34 }), "No response · 34d");

const stale = noResponseCandidate(application(), 21, today);
assert.equal(stale?.silentDays, 34, "silence counts local days from the latest activity");
assert.equal(nextAction(application()), "Awaiting response", "without a flag the waiting action is unchanged");
assert.equal(nextAction(application(), stale), "No response · 34d", "a flag replaces Awaiting response");
assert.equal(
  nextAction(application({ status: "interviewing" }), stale),
  "No response · 34d",
  "a flagged Interviewing record no longer reads Prepare interview"
);
assert.equal(
  nextAction(application({ followupAt: "2026-10-20" }), stale),
  "Follow up Oct 20",
  "the user's own follow-up date outranks the derived flag"
);
assert.equal(nextAction(application({ status: "ghosted" })), "No action", "a Ghosted record has nothing left to do");
assert.equal(nextAction(application({ status: "draft" }), stale), "Finish application", "a draft is never flagged");
assert.equal(nextAction(application({ status: "offer" })), "Review offer", "an offer is not flagged");

// ----- Derivation feeds the label -----
assert.equal(noResponseCandidate(application(), 45, today), null, "inside the threshold there is no flag");
assert.equal(noResponseCandidate(application({ status: "rejected" }), 21, today), null, "only Applied and Interviewing are flagged");
assert.equal(noResponseCandidate(application({ status: "ghosted" }), 21, today), null, "a marked record is no longer a candidate");
assert.deepEqual(
  noResponseCandidates(
    [application({ id: "a", appliedAt: "2026-09-20" }), application({ id: "b" }), application({ id: "c", appliedAt: "2026-08-01" })],
    21,
    today
  ).map((candidate) => candidate.application.id),
  ["c", "b"],
  "candidates list the longest silence first"
);

// ----- Ghosted in the lifecycle filters -----
assert.equal(STATUS_LABEL.ghosted, "Ghosted");
assert.ok(ACTIVITY_STATUS_GROUPS.inactive.includes("ghosted"), "Ghosted drills down under Inactive");
assert.ok(!ACTIVITY_STATUS_GROUPS.active.includes("ghosted"));
const ghosted = application({ id: "g", status: "ghosted" });
assert.equal(matchesActivityFilter(ghosted, "inactive"), true);
assert.equal(matchesActivityFilter(ghosted, "ghosted"), true);
assert.equal(matchesActivityFilter(ghosted, "active"), false);
assert.equal(activityCount([ghosted, application()], "ghosted"), 1);
assert.equal(activityCount([ghosted, application()], "inactive"), 1);

// ----- Surface wiring (source contract; layout is not asserted here) -----
const tracker = read("../../tabs/TrackerTab.tsx");
const table = read("../TrackerTableView.tsx");
const inspector = read("../TrackerInspector.tsx");
const modal = read("../../ApplicationModal.tsx");

assert.match(tracker, /ghostedAfterDays: number;/, "the tab takes the threshold from Settings");
assert.match(
  tracker,
  /noResponseCandidates\(applications, ghostedAfterDays\)/,
  "the flag is derived from the records and the threshold, never stored"
);
assert.match(tracker, /compareBy\(sort\.key, a, b, noResponseById\)/, "sorting by Next action sorts what the column shows");
assert.match(table, /nextAction\(app, noResponse\)/, "the Next action cell shows the flag");
assert.match(table, /next-action-no-response/);
assert.match(inspector, /nextAction\(selected, noResponse\)/, "the inspector's Next action matches the table");
assert.match(
  inspector,
  /noResponse && !actionIsNoResponse[\s\S]{0,260}?<dt>No response<\/dt>/,
  "a follow-up that hides the flag still leaves the silence visible"
);
assert.match(modal, /ghostedAfterDays: number;/, "Application Detail takes the threshold too");
assert.match(
  modal,
  /form\.status === activeApplication\.status\s*\? noResponseCandidate\(activeApplication, ghostedAfterDays\)/,
  "Application Detail derives the flag from the saved record, and only without a pending stage change"
);
assert.match(
  modal,
  /\{noResponse \? <p className="application-stage-hint">\{noResponseLabel\(noResponse\)\}<\/p> : null\}/,
  "the Application status card carries the derived hint"
);

// The row menu promotes Mark as Ghosted for flagged rows only, and offers the
// Ghosted stage only where a record can be waiting on a reply.
assert.match(
  tracker,
  /if \(noResponseById\.has\(app\.id\)\) \{[\s\S]{0,260}?Mark as \$\{STATUS_LABEL\.ghosted\}[\s\S]{0,200}?onUpdateStatus\(app\.id, "ghosted"\)/,
  "a flagged row gets a one-step Mark as Ghosted"
);
assert.match(tracker, /disabled: !stageMenuMoveAllowed\(app\.status, status\)/, "the stage list uses the shared menu rule");
for (const status of ["rejected", "withdrawn", "offer", "not_applying"]) {
  assert.equal(stageMenuMoveAllowed(status, "ghosted"), false, `the stage list does not offer Ghosted to ${status}`);
}
assert.equal(stageMenuMoveAllowed("applied", "ghosted"), true);
assert.equal(stageMenuMoveAllowed("rejected", "applied"), true, "the row menu can reopen a record");
assert.equal(stageMenuMoveAllowed("applied", "applied"), false, "the current stage is not a move");
assert.equal(stageMenuMoveAllowed("applied", "draft"), false);

console.log("No-response label probes passed");
