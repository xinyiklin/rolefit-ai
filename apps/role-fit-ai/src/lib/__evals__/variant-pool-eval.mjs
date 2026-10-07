// The variants Prepare may pick from: exclusion records per document kind,
// their normalization, eligibility filtering, and persistence through the
// settings cache and per-entry change detection.
//
//   node src/lib/__evals__/variant-pool-eval.mjs

import assert from "node:assert/strict";

import {
  MAX_VARIANT_EXCLUSIONS,
  eligibleVariantKey,
  eligibleVariantOptions,
  normalizeVariantExclusions
} from "../variantPool.ts";
import { loadSettings, normalizeSettings, saveSettings } from "../settings.ts";
import { materializeAiSettings } from "../aiSettingsPersistence.ts";
import { changedSettingKeys, rebaseSettings } from "../workspacePreferencesRebase.ts";

// ── Normalization ───────────────────────────────────────────────────────────

assert.deepEqual(
  Object.keys(normalizeVariantExclusions({ "b.resume": true, "a.resume": true }, "resume")),
  ["b.resume", "a.resume"],
  "valid entries keep their input order, so a clean record normalizes to itself"
);
assert.deepEqual(
  normalizeVariantExclusions({
    "keep.resume": true,
    "off.resume": false,
    "truthy.resume": 1,
    "letter.cover": true,
    "../escape.resume": true,
    "a/b.resume": true,
    ".hidden.resume": true,
    "__proto__": true,
    [`${"x".repeat(249)}.resume`]: true,
    [`${"y".repeat(248)}.resume`]: true
  }, "resume"),
  { "keep.resume": true, [`${"y".repeat(248)}.resume`]: true },
  "only true values on this kind's valid names of at most 255 characters survive"
);
assert.deepEqual(
  normalizeVariantExclusions({ "letter.cover": true, "base.resume": true }, "cover-letter"),
  { "letter.cover": true },
  "the cover-letter pool accepts only .cover names"
);
for (const value of [null, undefined, "a.resume", ["a.resume"], 3]) {
  assert.deepEqual(normalizeVariantExclusions(value, "resume"), {}, `a non-record (${JSON.stringify(value)}) excludes nothing`);
}
const oversized = Object.fromEntries(
  Array.from({ length: MAX_VARIANT_EXCLUSIONS + 5 }, (_, index) => [`v${index}.resume`, true])
);
assert.equal(
  Object.keys(normalizeVariantExclusions(oversized, "resume")).length,
  MAX_VARIANT_EXCLUSIONS,
  "the record is bounded"
);

// ── Eligibility ─────────────────────────────────────────────────────────────

const options = [
  { fileName: "default.resume", label: "Default" },
  { fileName: "backend.resume", label: "Backend" },
  { fileName: "frontend.resume", label: "Frontend" }
];
assert.deepEqual(eligibleVariantOptions(options, undefined), options, "an unset pool leaves every variant eligible");
assert.deepEqual(eligibleVariantOptions(options, {}), options, "an empty pool leaves every variant eligible");
assert.deepEqual(
  eligibleVariantOptions(options, { "backend.resume": true, "deleted.resume": true }).map((option) => option.fileName),
  ["default.resume", "frontend.resume"],
  "exclusions remove only their own variants, in workspace order; a missing name is inert"
);
assert.deepEqual(
  eligibleVariantOptions([{ fileName: "toString" }, { fileName: "constructor" }], {}).length,
  2,
  "inherited object keys never count as exclusions"
);
assert.equal(eligibleVariantKey(options, { "frontend.resume": true }), JSON.stringify(["default.resume", "backend.resume"]));

// ── Settings persistence ────────────────────────────────────────────────────

const cache = new Map();
globalThis.localStorage = {
  getItem: (key) => cache.get(key) ?? null,
  setItem: (key, value) => cache.set(key, String(value)),
  removeItem: (key) => cache.delete(key)
};

const pool = {
  excludedResumeVariants: { "experiment.resume": true },
  excludedCoverLetterVariants: { "old-growth.cover": true }
};
saveSettings({ fitAssessmentAuto: true, ...pool });
assert.deepEqual(
  JSON.parse(cache.get("rolefit:settings")),
  { fitAssessmentAuto: true, ...pool },
  "both pools reach the browser cache unchanged"
);
assert.deepEqual(loadSettings(), { fitAssessmentAuto: true, ...pool }, "both pools survive a reload");

assert.deepEqual(
  normalizeSettings({
    excludedResumeVariants: { "base.cover": true, "keep.resume": true },
    excludedCoverLetterVariants: { "base.resume": true }
  }),
  { excludedResumeVariants: { "keep.resume": true } },
  "each pool keeps only its own kind; a pool left empty is dropped"
);
assert.deepEqual(normalizeSettings({ excludedResumeVariants: {} }), {}, "an empty pool is never stored");
assert.deepEqual(normalizeSettings({ excludedResumeVariants: ["a.resume"] }), {}, "the browser cache drops a malformed pool");

const legacy = materializeAiSettings({ profileBackground: "Older settings without a pool." });
assert.ok(
  !("excludedResumeVariants" in legacy) && !("excludedCoverLetterVariants" in legacy),
  "settings saved before the pool materialize with every variant eligible and write no new keys"
);

// ── Per-entry change detection and rebase ───────────────────────────────────

assert.deepEqual(
  changedSettingKeys({}, { excludedResumeVariants: { "a.resume": true } }),
  ["excludedResumeVariants.a.resume"],
  "excluding a variant is an edit to that variant only"
);
assert.deepEqual(
  changedSettingKeys({ excludedCoverLetterVariants: { "a.cover": true } }, {}),
  ["excludedCoverLetterVariants.a.cover"],
  "re-including a variant is an edit to that variant only"
);
assert.deepEqual(
  rebaseSettings(
    { excludedResumeVariants: { "theirs.resume": true }, excludedCoverLetterVariants: { "theirs.cover": true } },
    { excludedResumeVariants: { "mine.resume": true } },
    ["excludedResumeVariants.mine.resume"]
  ),
  {
    excludedResumeVariants: { "theirs.resume": true, "mine.resume": true },
    excludedCoverLetterVariants: { "theirs.cover": true }
  },
  "a rebase keeps the newer record's exclusions and the other pool"
);

delete globalThis.localStorage;
console.log("variant pool probes passed");
