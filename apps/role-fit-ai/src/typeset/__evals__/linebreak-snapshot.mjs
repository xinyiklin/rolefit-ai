// Offline, deterministic probe: the engine's line breaking must not drift.
//
// This replaces the retired linebreak-parity check, which compared us against a
// Tectonic compile. The paragraphs are the same ones that check used, chosen to
// exercise what separates real line breaking from greedy wrapping — interword
// glue shrink at integer badness ties, hyphenation penalties on compounds,
// f-ligature widths, kerning, and bold-segment measurement. What changed is the
// reference: the recorded line ends are ours, not TeX's.
//
//   node src/typeset/__evals__/linebreak-snapshot.mjs --update
//
// re-records them, and that diff should be read as a change to how the product
// wraps text.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { paragraphItems } from "@typeset/engine/typeset/measure.ts";
import { breakParagraph } from "@typeset/engine/typeset/linebreak.ts";

const here = dirname(fileURLToPath(import.meta.url));
const snapshotPath = join(here, "linebreak-snapshot.json");
const update = process.argv.includes("--update");
const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));

// Spaces are glue, not text, so a line's words come back from run positions.
function lineText(line) {
  let out = "";
  let prevEnd = null;
  for (const run of line.runs) {
    if (prevEnd !== null && run.x - prevEnd > 0.5) out += " ";
    out += run.text;
    prevEnd = run.x + run.width;
  }
  return out;
}

const endsFor = (input) =>
  breakParagraph(
    paragraphItems(input, snapshot.sizeBp, "latin-modern", 0),
    snapshot.columnBp,
    "left"
  )
    .slice(0, -1)
    .map((line) => lineText(line).trim().split(/\s+/).pop());

if (update) {
  writeFileSync(
    snapshotPath,
    `${JSON.stringify(
      {
        ...snapshot,
        cases: snapshot.cases.map((probe) => ({ input: probe.input, ends: endsFor(probe.input) }))
      },
      null,
      2
    )}\n`
  );
  console.log(`linebreak-snapshot: recorded ${snapshot.cases.length} paragraphs`);
  process.exit(0);
}

// A truncated or empty fixture would otherwise "pass" a loop over zero cases.
assert.ok(
  Array.isArray(snapshot.cases) && snapshot.cases.length > 0,
  "linebreak-snapshot.json has no cases — the fixture is missing or corrupt"
);

snapshot.cases.forEach((probe, index) => {
  assert.deepEqual(
    endsFor(probe.input),
    probe.ends,
    `paragraph ${index + 1} wraps differently than recorded`
  );
});

console.log(
  `linebreak-snapshot: ${snapshot.cases.length}/${snapshot.cases.length} paragraphs wrap as recorded`
);
