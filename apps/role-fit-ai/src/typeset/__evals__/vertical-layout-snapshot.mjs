// Offline, deterministic probe: the engine's vertical model must not drift.
//
// This replaces the retired vertical-parity check, which measured us against a
// frozen Tectonic compile. The engine owns its layout now, so the reference is
// the engine itself: vertical-layout-snapshot.json holds every line's page,
// baseline, and left edge for the starter document at three spacing presets,
// and any change to a junction shows up here as an exact numeric diff.
//
// A snapshot is only a regression net if updating it is deliberate. Run
//
//   node src/typeset/__evals__/vertical-layout-snapshot.mjs --update
//
// to re-record it, and expect the diff to be reviewed like any other change to
// what the product prints.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  DOC_SPACING_PRESETS,
  DOC_STYLE_DEFAULTS
} from "@typeset/engine/lib/documentStyle.ts";
import { buildStarterResume } from "@typeset/engine/sampleResume.ts";
import { layoutResume } from "@typeset/engine/typeset/layout.ts";
import { toTypesetSchema } from "@typeset/engine/typeset/schema.ts";

const here = dirname(fileURLToPath(import.meta.url));
const snapshotPath = join(here, "vertical-layout-snapshot.json");
const update = process.argv.includes("--update");
const schema = toTypesetSchema(buildStarterResume());

// Baselines are recorded to 0.001bp. The layout is pure arithmetic over fixed
// metrics, so an unchanged engine reproduces them exactly; there is no
// measurement noise to absorb and therefore no tolerance to spend.
const round = (value) => Math.round(value * 1000) / 1000;

const linesFor = (style) => {
  const layout = layoutResume(schema, style);
  const lines = [];
  layout.pages.forEach((page, pageIndex) => {
    for (const line of page.lines) {
      const runs = line.runs.filter((run) => run.text.trim());
      if (!runs.length) continue;
      lines.push({
        page: pageIndex + 1,
        y: round(line.baseline),
        x: round(Math.min(...runs.map((run) => run.x))),
        text: runs.map((run) => run.text).join("").slice(0, 32)
      });
    }
  });
  return lines;
};

const current = {
  balanced: linesFor(DOC_STYLE_DEFAULTS),
  compact: linesFor({ ...DOC_STYLE_DEFAULTS, ...DOC_SPACING_PRESETS.compact.values }),
  spacious: linesFor({ ...DOC_STYLE_DEFAULTS, ...DOC_SPACING_PRESETS.spacious.values })
};

if (update) {
  writeFileSync(snapshotPath, `${JSON.stringify(current, null, 2)}\n`);
  const total = Object.values(current).reduce((sum, lines) => sum + lines.length, 0);
  console.log(`vertical-layout-snapshot: recorded ${total} lines across 3 presets`);
  process.exit(0);
}

const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
// A snapshot that recorded nothing would pass every comparison below.
assert.ok(
  Object.values(snapshot).every((lines) => lines.length > 0),
  "vertical-layout-snapshot.json is empty or corrupt"
);

let checked = 0;
for (const [preset, expected] of Object.entries(snapshot)) {
  const actual = current[preset];
  assert.ok(actual, `snapshot holds preset ${preset} that the engine no longer produces`);
  assert.equal(
    actual.length,
    expected.length,
    `${preset}: line count changed (${expected.length} -> ${actual.length})`
  );
  expected.forEach((line, index) => {
    const found = actual[index];
    assert.equal(found.text, line.text, `${preset} line ${index + 1}: text changed`);
    assert.equal(
      found.page,
      line.page,
      `${preset} line ${index + 1} (${line.text}): moved to page ${found.page}`
    );
    assert.equal(
      found.y,
      line.y,
      `${preset} line ${index + 1} (${line.text}): baseline ${line.y} -> ${found.y}`
    );
    assert.equal(
      found.x,
      line.x,
      `${preset} line ${index + 1} (${line.text}): left edge ${line.x} -> ${found.x}`
    );
    checked += 1;
  });
}

console.log(`vertical-layout-snapshot: ${checked} lines across 3 presets match the recorded layout`);
