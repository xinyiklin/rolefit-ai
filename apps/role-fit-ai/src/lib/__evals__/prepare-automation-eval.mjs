import assert from "node:assert/strict";

import {
  AUTO_POLISH_THRESHOLDS,
  decideAutoPolish,
  isAutoPolishThreshold,
  meetsAutoPolishThreshold
} from "../prepareAutomation.ts";

assert.deepEqual(
  AUTO_POLISH_THRESHOLDS,
  ["OFF", "STRETCH", "REASONABLE_FIT", "STRONG_FIT"],
  "automation exposes exactly Off plus the three qualifying verdict thresholds"
);

for (const value of AUTO_POLISH_THRESHOLDS) {
  assert.equal(isAutoPolishThreshold(value), true, `${value} is a valid persisted threshold`);
}
for (const value of [undefined, null, "LIMITED_FIT", "REASONABLE FIT", "off", 70]) {
  assert.equal(isAutoPolishThreshold(value), false, `${String(value)} is rejected as a threshold`);
}

const verdicts = ["LIMITED_FIT", "STRETCH", "REASONABLE_FIT", "STRONG_FIT"];
const expected = {
  OFF: [false, false, false, false],
  STRETCH: [false, true, true, true],
  REASONABLE_FIT: [false, false, true, true],
  STRONG_FIT: [false, false, false, true]
};

for (const threshold of AUTO_POLISH_THRESHOLDS) {
  assert.deepEqual(
    verdicts.map((verdict) => meetsAutoPolishThreshold(verdict, threshold)),
    expected[threshold],
    `${threshold} is evaluated inclusively and independently`
  );
}

const assessment = {
  verdict: "REASONABLE_FIT",
  confidence: "HIGH",
  eligibility: { status: "SATISFIED", items: [] }
};
assert.equal(decideAutoPolish(assessment, "REASONABLE_FIT").action, "RUN");
assert.equal(decideAutoPolish(assessment, "STRONG_FIT").action, "SKIP");
assert.equal(decideAutoPolish({ ...assessment, confidence: "LOW" }, "STRETCH").action, "WAIT");
assert.equal(decideAutoPolish({
  ...assessment,
  eligibility: { status: "UNCERTAIN", items: [] }
}, "STRETCH").action, "WAIT");
assert.equal(decideAutoPolish({
  ...assessment,
  eligibility: { status: "NOT_SATISFIED", items: [] }
}, "STRETCH").action, "SKIP");

console.log("prepare automation threshold probes passed");
