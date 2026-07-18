// Offline, deterministic probe: the typeset engine's line breaks must match
// real TeX output. linebreak-truth.json holds the end word of the first
// wrapped line of each synthetic paragraph, extracted once from a Tectonic
// compile (see the fixture's note for regeneration). The cases cover the
// mechanics that distinguish TeX from greedy wrapping: interword-glue shrink
// (integer badness ties), \exhyphenpenalty compounds, f-ligature widths,
// kerning, and bold-segment measurement.
//
//   node src/typeset/__evals__/linebreak-parity.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { paragraphItems } from "@typeset/engine/typeset/measure.ts";
import { breakParagraph } from "@typeset/engine/typeset/linebreak.ts";

const here = dirname(fileURLToPath(import.meta.url));

const truth = JSON.parse(readFileSync(join(here, "linebreak-truth.json"), "utf8"));

// Reconstruct a line's text from positioned runs (spaces are glue, not text).
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

// Truth was extracted from the PDF, where TeX ligatures are already applied
// (– — ’); engine run text carries them too, so compare as-is.
let failures = 0;
truth.cases.forEach((c, i) => {
  const lines = breakParagraph(paragraphItems(c.input, truth.sizeBp, "latin-modern", 0), truth.columnBp, "left");
  const ends = lines.slice(0, -1).map((l) => lineText(l).trim().split(/\s+/).pop());
  const ok = JSON.stringify(ends) === JSON.stringify(c.ends);
  if (!ok) {
    failures += 1;
    console.error(`FAIL case ${i}: engine=[${ends.join(" | ")}] tex=[${c.ends.join(" | ")}]`);
  }
});

if (failures) {
  console.error(`${failures}/${truth.cases.length} paragraphs diverge from TeX`);
  process.exit(1);
}
console.log(`linebreak-parity: ${truth.cases.length}/${truth.cases.length} paragraphs break exactly like TeX`);
