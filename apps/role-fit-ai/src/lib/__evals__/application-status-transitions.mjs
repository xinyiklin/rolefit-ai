import assert from "node:assert/strict";
const {
  applicationStatusOptions,
  applicationStatusTransitionAllowed
} = await import("../applicationStatusTransitions.ts");

assert.deepEqual(
  applicationStatusOptions("interested"),
  ["interested", "not_applying", "applied"],
  "an unfinished preparation may be kept, passed, or submitted"
);
assert.deepEqual(
  applicationStatusOptions("applied"),
  ["applied", "interviewing", "offer", "rejected", "withdrawn"],
  "a submitted application advances without becoming Not applying"
);
assert.deepEqual(
  applicationStatusOptions("interviewing"),
  ["interviewing", "offer", "rejected", "withdrawn"],
  "interview history cannot move backward to Applied"
);
assert.deepEqual(
  applicationStatusOptions("offer"),
  ["offer", "rejected", "withdrawn"],
  "the current model keeps only its supported post-offer outcomes"
);
assert.deepEqual(applicationStatusOptions("not_applying"), ["not_applying"]);
assert.deepEqual(applicationStatusOptions("rejected"), ["rejected"]);
assert.deepEqual(applicationStatusOptions("withdrawn"), ["withdrawn"]);
assert.equal(applicationStatusTransitionAllowed("interested", "not_applying"), true);
assert.equal(applicationStatusTransitionAllowed("applied", "not_applying"), false);
assert.equal(applicationStatusTransitionAllowed("rejected", "applied"), false);
