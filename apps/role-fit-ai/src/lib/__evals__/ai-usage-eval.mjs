// Tracker records saved before the 2026-09-29 stage rename keep cover-letter
// usage under "cover". Every client read goes through copyAiUsage, so those
// records still show their Cover letter Polish usage without a data rewrite.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { RESUME_POLISH_REVIEW_USAGE_KEY, copyAiUsage, withReviewUsage } from "../aiUsage.ts";

const cover = { source: "ai", provider: "claude-cli", model: "claude-opus-5" };
const stored = { "job-analysis": { source: "none" }, cover };

assert.deepEqual(
  copyAiUsage(stored),
  { "job-analysis": { source: "none" }, "cover-polish": cover },
  "legacy cover usage reads as cover-polish"
);
assert.deepEqual(stored, { "job-analysis": { source: "none" }, cover }, "the stored record is not mutated");

const newer = { source: "local" };
assert.deepEqual(
  copyAiUsage({ cover, "cover-polish": newer }),
  { "cover-polish": newer },
  "a current cover-polish entry wins over the legacy key"
);
assert.deepEqual(copyAiUsage(undefined), {}, "absent usage copies to an empty map");

const inspector = readFileSync(new URL("../../sections/tracker/TrackerInspector.tsx", import.meta.url), "utf8");
assert.match(inspector, /\{ key: "cover-polish", label: "Cover letter Polish" \}/, "the tracker shows the renamed stage");

// The opt-in Polish review is recorded like any other AI request, and only for
// the run that actually reviewed.
const polish = { source: "ai", provider: "claude-cli", model: "opus", reasoningEffort: "high", attempts: 1, completedAt: "2026-10-07T12:00:00.000Z" };
assert.equal(RESUME_POLISH_REVIEW_USAGE_KEY, "resume-polish-review");
assert.match(RESUME_POLISH_REVIEW_USAGE_KEY, /^[a-z][a-z0-9-]{0,23}$/, "the stage key fits the tracker's usage schema");
assert.deepEqual(
  withReviewUsage({ "resume-polish": polish }, { outcome: "REVIEWED", attempts: 1 })[RESUME_POLISH_REVIEW_USAGE_KEY],
  { source: "ai", provider: "claude-cli", model: "opus", reasoningEffort: "high", attempts: 1, completedAt: polish.completedAt },
  "a review is attributed to the Resume Polish provider, model, and effort"
);
assert.deepEqual(
  withReviewUsage({ "resume-polish": polish }, { outcome: "UNAVAILABLE", attempts: 1 })[RESUME_POLISH_REVIEW_USAGE_KEY],
  { source: "none", requestedProvider: "claude-cli", requestedModel: "opus", attempts: 1, completedAt: polish.completedAt },
  "a failed review is recorded as attempted, not as producing the output"
);
const earlier = withReviewUsage({ "resume-polish": polish }, { outcome: "REVIEWED", attempts: 1 });
assert.deepEqual(withReviewUsage(earlier), { "resume-polish": polish }, "a run without a review clears an earlier review's receipt");
assert.deepEqual(earlier[RESUME_POLISH_REVIEW_USAGE_KEY].source, "ai", "and leaves the earlier map untouched");
assert.deepEqual(withReviewUsage({ "resume-polish": { source: "none", requestedProvider: "claude-cli", requestedModel: "opus" } }), { "resume-polish": { source: "none", requestedProvider: "claude-cli", requestedModel: "opus" } });
assert.match(inspector, /\{ key: "resume-polish-review", label: "Resume Polish review" \}/, "the tracker shows the review's usage");

console.log("ai-usage probes passed");
