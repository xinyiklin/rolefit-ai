import assert from "node:assert/strict";
import {
  FIT_VERDICT_RANK,
  VERDICT_LABEL,
  VERDICT_TONE,
  verdictPillClass
} from "../fitVerdict.ts";
import {
  activityCount,
  appFitVerdict,
  matchesActivityFilter
} from "../applicationDisplay.ts";

assert.deepEqual(
  Object.keys(VERDICT_LABEL).sort(),
  ["LIMITED_FIT", "REASONABLE_FIT", "STRETCH", "STRONG_FIT"].sort(),
  "the canonical verdict vocabulary is complete"
);
assert.equal(VERDICT_LABEL.LIMITED_FIT, "Limited fit");
assert.equal(VERDICT_TONE.REASONABLE_FIT, "good");
assert.equal(verdictPillClass("LIMITED_FIT"), "verdict-pill--limited-fit");
assert.ok(FIT_VERDICT_RANK.STRONG_FIT > FIT_VERDICT_RANK.REASONABLE_FIT);
assert.ok(FIT_VERDICT_RANK.REASONABLE_FIT > FIT_VERDICT_RANK.STRETCH);
assert.ok(FIT_VERDICT_RANK.STRETCH > FIT_VERDICT_RANK.LIMITED_FIT);

const assessed = {
  initialFitAudit: { assessment: { verdict: "REASONABLE_FIT" } }
};
assert.deepEqual(appFitVerdict(assessed), {
  verdict: "REASONABLE_FIT",
  label: "Reasonable fit",
  tone: "good"
});
assert.equal(appFitVerdict({}), null, "no numerical or inferred fallback exists");

const lifecycleApplications = [
  { status: "interested" }, { status: "applied" }, { status: "interviewing" },
  { status: "offer" }, { status: "rejected" }, { status: "withdrawn" }
];
assert.ok(lifecycleApplications.every((app) => matchesActivityFilter(app, "all")));
assert.equal(activityCount(lifecycleApplications, "active"), 4);
assert.equal(activityCount(lifecycleApplications, "inactive"), 2);
assert.equal(activityCount(lifecycleApplications, "interviewing"), 1);

console.log("PASS categorical fit verdict presentation");
