import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AUTO_POLISH_THRESHOLD_OPTIONS,
  quickFitMeetsThreshold
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
    thresholds.map((threshold) => quickFitMeetsThreshold(verdict, threshold)),
    outcomes,
    `${verdict} preserves every threshold boundary`
  );
}

assert.equal(quickFitMeetsThreshold("REASONABLE", "REASONABLE"), true);
assert.equal(quickFitMeetsThreshold("REASONABLE", "STRONG"), false);

const sharedContract = readFileSync(
  new URL("../../../shared/quickFitContract.ts", import.meta.url),
  "utf8"
);
assert.doesNotMatch(
  sharedContract,
  /AutoPolishThreshold|AUTO_POLISH_THRESHOLD_OPTIONS|quickFitMeetsThreshold|FIT_RANK/,
  "the shared Initial Fit contract contains no downstream automation policy"
);

console.log("auto-polish policy evals passed");
