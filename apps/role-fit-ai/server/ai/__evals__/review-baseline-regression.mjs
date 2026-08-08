import assert from "node:assert/strict";

import { resolveReviewOutcome } from "../polish.ts";

// Resume Review owns its response contract. Unrelated assessment-shaped data in
// the same provider envelope must never invalidate an otherwise usable review.
const response = {
  initialFit: {
    verdict: "UNKNOWN",
    confidence: "not-a-number",
    requirements: "malformed"
  },
  strictReview: {
    verdict: "REASONABLE FIT",
    verdictReason: "The resume directly supports the core Python requirement.",
    coverage: [
      {
        category: "Required tech",
        keyword: "Python",
        status: "covered",
        where: "Technical Skills: Python"
      }
    ],
    gaps: [],
    rewrites: [],
    riskFlags: [],
    recommendation: {}
  },
  aiScore: {
    base: 72,
    tailored: 78,
    liftReason: "The current resume makes its Python evidence easy to verify."
  }
};

const result = resolveReviewOutcome(
  response,
  "Required qualifications: Python.",
  "Technical Skills: Python"
);

assert.equal(result.strictReview?.verdict, "REASONABLE FIT");
assert.equal(result.strictReview?.coverage.length, 1);
assert.equal(result.aiScore?.tailored, 78);

console.log("resume Review baseline regression: passed");
