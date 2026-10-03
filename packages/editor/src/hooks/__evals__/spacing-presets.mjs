// Saved spacing presets: parsing stored lists, naming, cap, and list edits.
// Run: node --experimental-strip-types src/hooks/__evals__/spacing-presets.mjs

import assert from "node:assert/strict";

import { DOC_SPACING_PRESETS, DOC_STYLE_DEFAULTS, pickDocSpacing } from "@typeset/engine/lib/documentStyle.ts";
import {
  MAX_SAVED_SPACING_PRESETS,
  MAX_SPACING_PRESET_NAME_LENGTH,
  addSpacingPreset,
  loadSavedSpacingPresets,
  nextSpacingPresetName,
  parseSavedSpacingPresets,
  removeSpacingPreset,
  renameSpacingPreset,
  updateSpacingPresetValues
} from "../spacingPresets.ts";

const compact = DOC_SPACING_PRESETS.compact.values;
const preset = (id, name, values = compact) => ({ id, name, values: { ...values } });

// ----- parsing tolerates corrupt storage entry by entry -----
assert.deepEqual(parseSavedSpacingPresets(null), [], "non-array storage parses to no presets");
assert.deepEqual(parseSavedSpacingPresets({ id: "a" }), [], "an object is not a list");
const parsed = parseSavedSpacingPresets([
  preset("a", "  Tight   one "),
  { id: "b", name: "No values" },
  { id: "", name: "Empty id", values: compact },
  preset("a", "Duplicate id"),
  { id: "c", name: "   ", values: compact },
  { id: "d", name: "Partial", values: { lineHeight: 1.2, sectionGapPt: "wide" } }
]);
assert.deepEqual(parsed.map((entry) => [entry.id, entry.name]), [["a", "Tight one"], ["d", "Partial"]]);
assert.deepEqual(parsed[0].values, pickDocSpacing({ ...DOC_STYLE_DEFAULTS, ...compact }), "values keep only spacing keys");
assert.equal(parsed[1].values.lineHeight, 1.2, "valid fields survive");
assert.equal(parsed[1].values.sectionGapPt, DOC_STYLE_DEFAULTS.sectionGapPt, "invalid fields fall back to defaults");
assert.equal(
  parseSavedSpacingPresets(Array.from({ length: 12 }, (_, index) => preset(`p${index}`, `P${index}`))).length,
  MAX_SAVED_SPACING_PRESETS,
  "an over-long stored list is truncated at the cap"
);
assert.equal(
  parseSavedSpacingPresets([preset("long", "x".repeat(80))])[0].name.length,
  MAX_SPACING_PRESET_NAME_LENGTH,
  "stored names are clipped to the name limit"
);

// ----- the stored list wins over the legacy single preset -----
const legacy = JSON.stringify({ ...DOC_STYLE_DEFAULTS, ...compact });
assert.deepEqual(loadSavedSpacingPresets(null, null), [], "nothing stored loads no presets");
assert.deepEqual(loadSavedSpacingPresets("[]", legacy), [], "an emptied list stays empty instead of resurrecting the legacy preset");
assert.deepEqual(
  loadSavedSpacingPresets(JSON.stringify([preset("a", "A")]), legacy).map((entry) => entry.id),
  ["a"],
  "a stored list ignores the legacy preset"
);
const migrated = loadSavedSpacingPresets(null, legacy);
assert.deepEqual(migrated.map((entry) => [entry.id, entry.name]), [["custom", "Custom"]], "the legacy preset migrates as Custom");
assert.deepEqual(migrated[0].values, pickDocSpacing({ ...DOC_STYLE_DEFAULTS, ...compact }));
assert.throws(() => loadSavedSpacingPresets("{not json", null), SyntaxError, "corrupt storage is reported to the caller");

// ----- generated names fill the first free "Custom N" -----
assert.equal(nextSpacingPresetName([]), "Custom 1");
assert.equal(nextSpacingPresetName([preset("a", "custom 1"), preset("b", "Custom 3")]), "Custom 2");

// ----- list edits are pure and bounded -----
const one = [preset("a", "A")];
const added = addSpacingPreset(one, preset("b", "B"));
assert.deepEqual(added.map((entry) => entry.id), ["a", "b"]);
assert.deepEqual(one.map((entry) => entry.id), ["a"], "adding does not mutate the input");
const full = Array.from({ length: MAX_SAVED_SPACING_PRESETS }, (_, index) => preset(`p${index}`, `P${index}`));
assert.equal(addSpacingPreset(full, preset("x", "X")).length, MAX_SAVED_SPACING_PRESETS, "the cap refuses another preset");

const spacious = DOC_SPACING_PRESETS.spacious.values;
const updated = updateSpacingPresetValues(added, "b", spacious);
assert.deepEqual(updated[1].values, spacious, "update overwrites the target's values");
assert.equal(updated[0], added[0], "update leaves other presets untouched");

assert.equal(renameSpacingPreset(added, "a", "  Résumé tight ")[0].name, "Résumé tight");
assert.equal(renameSpacingPreset(added, "a", "   ")[0].name, "A", "an empty rename keeps the old name");
assert.deepEqual(removeSpacingPreset(added, "a").map((entry) => entry.id), ["b"]);
assert.deepEqual(removeSpacingPreset(added, "missing").map((entry) => entry.id), ["a", "b"]);

console.log("spacing presets: ok");
