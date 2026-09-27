import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AUTO_POLISH_THRESHOLD_OPTIONS,
  automaticPolishActionDecision,
  fitAssessmentMeetsThreshold
} from "../autoPolishPolicy.ts";

assert.deepEqual(
  AUTO_POLISH_THRESHOLD_OPTIONS,
  [
    { value: "STRONG", label: "Strong only" },
    { value: "REASONABLE", label: "Reasonable or better" },
    { value: "STRETCH", label: "Stretch or better" },
    { value: "LIMITED", label: "Any fit result" }
  ],
  "threshold values, ordering, and labels remain unchanged"
);

const expected = {
  STRONG: [true, true, true, true],
  REASONABLE: [false, true, true, true],
  STRETCH: [false, false, true, true],
  LIMITED: [false, false, false, true]
};
const thresholds = AUTO_POLISH_THRESHOLD_OPTIONS.map((option) => option.value);
for (const [verdict, outcomes] of Object.entries(expected)) {
  assert.deepEqual(
    thresholds.map((threshold) => fitAssessmentMeetsThreshold(verdict, threshold)),
    outcomes,
    `${verdict} preserves every threshold boundary`
  );
}

assert.equal(fitAssessmentMeetsThreshold("REASONABLE", "REASONABLE"), true);
assert.equal(fitAssessmentMeetsThreshold("REASONABLE", "STRONG"), false);

assert.equal(
  automaticPolishActionDecision({
    enabled: true,
    thresholdMet: true,
    automationBlocked: false,
    prerequisitePending: true,
    canStart: false
  }),
  "wait",
  "a qualified automatic Cover Letter action waits for variant resolution instead of being consumed"
);
assert.equal(
  automaticPolishActionDecision({
    enabled: true,
    thresholdMet: true,
    automationBlocked: false,
    prerequisitePending: false,
    canStart: true
  }),
  "start",
  "the action starts once its transient prerequisite settles"
);
for (const input of [
  { enabled: false, thresholdMet: true, automationBlocked: false },
  { enabled: true, thresholdMet: false, automationBlocked: false },
  { enabled: true, thresholdMet: true, automationBlocked: true }
]) {
  assert.equal(
    automaticPolishActionDecision({
      ...input,
      prerequisitePending: true,
      canStart: true
    }),
    "decline",
    "disabled, below-threshold, and blocked actions settle as permanent declines"
  );
}
assert.equal(
  automaticPolishActionDecision({
    enabled: true,
    thresholdMet: true,
    automationBlocked: false,
    prerequisitePending: false,
    canStart: false
  }),
  "decline",
  "a qualified action with settled but unavailable start requirements declines"
);

const sharedContract = readFileSync(
  new URL("../../../shared/fitAssessmentContract.ts", import.meta.url),
  "utf8"
);
assert.doesNotMatch(
  sharedContract,
  /AutoPolishThreshold|AUTO_POLISH_THRESHOLD_OPTIONS|fitAssessmentMeetsThreshold|FIT_RANK/,
  "the shared Fit Assessment contract contains no downstream automation policy"
);

console.log("auto-polish policy evals passed");
