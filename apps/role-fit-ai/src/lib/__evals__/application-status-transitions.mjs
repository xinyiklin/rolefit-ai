import assert from "node:assert/strict";
const {
  applicationStatusOptions,
  applicationStatusTransitionAllowed
} = await import("../applicationStatusTransitions.ts");

assert.deepEqual(
  applicationStatusOptions("applied"),
  ["applied", "interviewing", "offer", "rejected", "ghosted", "withdrawn"],
  "a submitted application advances without becoming Not applying"
);
assert.deepEqual(
  applicationStatusOptions("interviewing"),
  ["interviewing", "offer", "rejected", "ghosted", "withdrawn"],
  "interview history cannot move backward to Applied"
);
assert.deepEqual(
  applicationStatusOptions("offer"),
  ["offer", "rejected", "withdrawn"],
  "an offer is a response, so it is never offered Ghosted"
);
assert.deepEqual(
  applicationStatusOptions("ghosted"),
  ["ghosted", "applied", "interviewing", "offer", "rejected", "withdrawn"],
  "a late reply reopens a Ghosted record, and Applied undoes a premature mark"
);
assert.deepEqual(applicationStatusOptions("not_applying"), ["not_applying"]);
assert.deepEqual(applicationStatusOptions("rejected"), ["rejected"]);
assert.deepEqual(applicationStatusOptions("withdrawn"), ["withdrawn"]);
assert.ok(!applicationStatusOptions("draft").includes("ghosted"), "a Draft was never sent, so it cannot be Ghosted");
assert.equal(applicationStatusTransitionAllowed("applied", "not_applying"), true);
assert.equal(applicationStatusTransitionAllowed("rejected", "applied"), true);
assert.equal(applicationStatusTransitionAllowed("not_applying", "offer"), true);
assert.equal(applicationStatusTransitionAllowed("applied", "ghosted"), true);
assert.equal(applicationStatusTransitionAllowed("interviewing", "ghosted"), true);
assert.equal(applicationStatusTransitionAllowed("ghosted", "applied"), true);
assert.equal(applicationStatusTransitionAllowed("ghosted", "draft"), false, "no submitted record returns to Draft");
assert.equal(applicationStatusTransitionAllowed("draft", "ghosted"), false, "a Draft is submitted before anything else");
