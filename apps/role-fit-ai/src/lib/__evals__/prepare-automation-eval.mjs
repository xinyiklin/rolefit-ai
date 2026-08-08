import assert from "node:assert/strict";

import {
  AUTO_POLISH_THRESHOLDS,
  isAutoPolishThreshold,
  meetsAutoPolishThreshold
} from "../prepareAutomation.ts";
import { verdictFromScore } from "../fitVerdict.ts";

assert.deepEqual(
  AUTO_POLISH_THRESHOLDS,
  ["off", "STRETCH", "REASONABLE FIT", "STRONG FIT"],
  "automation exposes exactly Off plus the three qualifying verdict thresholds"
);

for (const value of AUTO_POLISH_THRESHOLDS) {
  assert.equal(isAutoPolishThreshold(value), true, `${value} is a valid persisted threshold`);
}
for (const value of [undefined, null, "DON'T APPLY", "reasonable", 70]) {
  assert.equal(isAutoPolishThreshold(value), false, `${String(value)} is rejected as a threshold`);
}

const verdicts = ["DON'T APPLY", "STRETCH", "REASONABLE FIT", "STRONG FIT"];
const expected = {
  off: [false, false, false, false],
  STRETCH: [false, true, true, true],
  "REASONABLE FIT": [false, false, true, true],
  "STRONG FIT": [false, false, false, true]
};

for (const threshold of AUTO_POLISH_THRESHOLDS) {
  assert.deepEqual(
    verdicts.map((verdict) => meetsAutoPolishThreshold(verdict, threshold)),
    expected[threshold],
    `${threshold} is evaluated inclusively and independently`
  );
}

assert.equal(verdictFromScore(69), "STRETCH", "69 remains Stretch");
assert.equal(verdictFromScore(70), "REASONABLE FIT", "70 qualifies as Reasonable fit");
assert.equal(verdictFromScore(84), "REASONABLE FIT", "84 remains Reasonable fit");
assert.equal(verdictFromScore(85), "STRONG FIT", "85 qualifies as Strong fit");

const reasonable = verdictFromScore(70);
assert.ok(reasonable);
assert.equal(
  meetsAutoPolishThreshold(reasonable, "STRONG FIT"),
  false,
  "a Strong resume threshold may skip while cover uses a lower threshold"
);
assert.equal(
  meetsAutoPolishThreshold(reasonable, "REASONABLE FIT"),
  true,
  "cover eligibility does not depend on resume eligibility"
);

console.log("prepare automation threshold probes passed");
