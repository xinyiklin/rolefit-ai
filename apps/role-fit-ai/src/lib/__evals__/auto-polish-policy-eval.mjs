import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AUTO_POLISH_THRESHOLD_OPTIONS,
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
