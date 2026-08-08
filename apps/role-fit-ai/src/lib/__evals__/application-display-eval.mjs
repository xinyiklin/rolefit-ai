import assert from "node:assert/strict";

import { initialFitRank, priorityFor } from "../applicationDisplay.ts";

function application(overrides = {}) {
  return {
    id: "app-1",
    createdAt: "2026-08-08T12:00:00.000Z",
    updatedAt: "2026-08-08T12:00:00.000Z",
    status: "interested",
    initialFit: {
      resumeLabel: "Backend resume",
      result: {
        verdict: "STRONG",
        summary: "Grounded fit summary.",
        matches: [],
        gaps: []
      }
    },
    ...overrides
  };
}

assert.equal(priorityFor(application({ priority: "Low" })), "Low", "an explicit user priority always wins");
assert.equal(priorityFor(application({ status: "interviewing" })), "High", "Interviewing derives High");
assert.equal(priorityFor(application({ status: "offer" })), "High", "Offer derives High");
assert.equal(priorityFor(application()), "Medium", "Strong fit stays advisory and does not raise priority");
assert.equal(
  priorityFor(application({ initialFit: { ...application().initialFit, result: { ...application().initialFit.result, verdict: "LIMITED" } } })),
  "Medium",
  "Limited fit stays advisory and does not lower priority"
);
assert.ok(
  initialFitRank(application()) > initialFitRank(application({
    initialFit: { ...application().initialFit, result: { ...application().initialFit.result, verdict: "LIMITED" } }
  })),
  "Initial Fit remains available for explicit tracker sorting"
);

console.log("application display priority probes: passed");
