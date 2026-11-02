// A local alignment on an entry title or subtitle moves the row's text. An empty
// side stays a caret anchor at its edge; a row with text on both sides keeps
// its pinned anchors (the group already spans the row).
import assert from "node:assert/strict";
import { DOC_STYLE_DEFAULTS } from "../../lib/documentStyle.ts";
import { layoutResume } from "../layout.ts";
import { ensureAllFontMetrics } from "../fontRegistry.ts";

await ensureAllFontMetrics();

const runsOf = (fields) => layoutResume({
  header: { name: "Name", contact: [] },
  sections: [{ id: "s", type: "standard", heading: "Education", items: [{
    id: "e", titleLeft: "", titleRight: "", subtitleLeft: "", subtitleRight: "", bullets: [], bulletIds: [], ...fields
  }] }]
}, DOC_STYLE_DEFAULTS).pages[0].lines.flatMap((line) => line.runs).filter((run) => run.src?.kind === "entry");
const field = (runs, name) => runs.filter((run) => run.src.field === name);
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} vs ${expected}`);

const plain = runsOf({ titleLeft: "University of Somewhere", subtitleLeft: "B.S. Example" });
const left = field(plain, "titleLeft")[0].x;
const right = field(plain, "titleRight")[0].x;
assert.ok(right > left + 300, "the empty date anchor sits at the row's right edge");

for (const textField of ["titleLeft", "subtitleLeft"]) {
  for (const mode of ["center", "right"]) {
    const text = textField === "titleLeft" ? "University of Somewhere" : "B.S. Example";
    const runs = runsOf({
      titleLeft: "University of Somewhere",
      subtitleLeft: "B.S. Example",
      [textField]: `<align=${mode}>${text}</align>`
    });
    const [run] = field(runs, textField);
    const end = run.x + run.width;
    if (mode === "center") close(run.x - left, right - end, `${textField} centers between the row's edges`);
    else close(end, right, `${textField} right-aligns to the row's right edge`);
    const anchorField = textField === "titleLeft" ? "titleRight" : "subtitleRight";
    close(field(runs, anchorField)[0].x, right, `the empty ${anchorField} keeps its caret anchor at the edge`);
  }
}

// An aligned date with an empty left side moves too; the empty left anchor stays.
{
  const runs = runsOf({ titleLeft: "", titleRight: "<align=center>2019 - 2024</align>" });
  const [date] = field(runs, "titleRight");
  close(date.x - left, right - (date.x + date.width), "a centered date with no title centers in the row");
  close(field(runs, "titleLeft")[0].x, left, "the empty title keeps its anchor at the left edge");
}

// Both sides filled: the group spans the row, so alignment leaves it in place.
{
  const pinned = runsOf({ titleLeft: "Engineer", titleRight: "2019 - 2024" });
  const aligned = runsOf({ titleLeft: "<align=center>Engineer</align>", titleRight: "2019 - 2024" });
  assert.deepEqual(aligned.map((run) => run.x), pinned.map((run) => run.x), "a two-sided row keeps its pinned anchors");
}

console.log("head-row alignment checks passed");
