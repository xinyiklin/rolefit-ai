// Tracker records saved before the 2026-09-29 stage rename keep cover-letter
// usage under "cover". Every client read goes through copyAiUsage, so those
// records still show their Cover letter Polish usage without a data rewrite.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { copyAiUsage } from "../aiUsage.ts";

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

console.log("ai-usage probes passed");
