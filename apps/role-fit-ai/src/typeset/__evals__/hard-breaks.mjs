// Focused deterministic probe for authored hard line breaks.
//
//   node src/typeset/__evals__/hard-breaks.mjs
import assert from "node:assert/strict";
import { DOC_STYLE_DEFAULTS } from "@typeset/engine/lib/documentStyle.ts";
import { paragraphItems } from "@typeset/engine/typeset/measure.ts";
import { breakParagraph } from "@typeset/engine/typeset/linebreak.ts";
import { layoutResume } from "@typeset/engine/typeset/layout.ts";

const SIZE = 10;
const WIDE_COLUMN = 1000;
const lineText = (line) => {
  let text = "";
  let previousEnd = null;
  for (const run of line.runs) {
    if (previousEnd !== null && run.x - previousEnd > 0.3) text += " ";
    text += run.text;
    previousEnd = run.x + run.width;
  }
  return text;
};

const items = paragraphItems("Alpha\nBeta", SIZE, "latin-modern", 0);
assert.equal(items.filter((item) => item.kind === "forcedBreak").length, 1, "newline tokenizes as one forced break");
assert.deepEqual(
  breakParagraph(items, WIDE_COLUMN, "left").map(lineText),
  ["Alpha", "Beta"],
  "a hard break wins even when both phrases fit on one line"
);

const markedLines = breakParagraph(paragraphItems("<b>Bold\nstill bold</b>", SIZE, "latin-modern", 0), WIDE_COLUMN, "left");
assert.deepEqual(markedLines.map(lineText), ["Bold", "still bold"], "inline marks do not swallow the break");
assert.equal(
  markedLines.every((line) => line.runs.every((run) => run.style.face === "bold")),
  true,
  "inline style continues across the authored break"
);

assert.deepEqual(
  breakParagraph(paragraphItems("A\n\nB\n", SIZE, "latin-modern", 0), WIDE_COLUMN, "left").map(lineText),
  ["A", "", "B", ""],
  "repeated and trailing hard breaks preserve blank visual lines"
);

// DOM and PDF are both backends over this LayoutDocument. Verify the shared
// document contains two separately positioned bullet lines and no newline glyph
// for either backend to reinterpret.
const layout = layoutResume(
  {
    name: "Candidate",
    contact: ["candidate@example.com"],
    sections: [
      {
        id: "experience",
        heading: "Experience",
        type: "standard",
        items: [
          {
            id: "role",
            titleLeft: "Engineer",
            titleRight: "2026",
            subtitleLeft: "Example Co.",
            subtitleRight: "Remote",
            bullets: ["First line\nSecond line"],
            bulletIds: ["bullet-1"]
          }
        ]
      }
    ]
  },
  DOC_STYLE_DEFAULTS
);
const placed = layout.pages.flatMap((page) => page.lines);
const bulletLines = placed.filter((line) =>
  line.runs.some((run) => run.src?.kind === "bullet" && run.src.bulletId === "bullet-1" && !run.marker)
);
assert.equal(bulletLines.length, 2, "layout emits one placed line on each side of the hard break");
assert.deepEqual(
  bulletLines.map((line) => lineText({ runs: line.runs.filter((run) => !run.marker) })),
  ["First line", "Second line"],
  "placed lines retain their text in order"
);
assert.equal(
  bulletLines.flatMap((line) => line.runs).some((run) => run.text.includes("\n")),
  false,
  "newline is structural, never emitted as a glyph"
);
assert.equal(
  bulletLines.flatMap((line) => line.runs).filter((run) => run.marker).length,
  1,
  "a continued hard-break line does not gain a second bullet marker"
);

console.log("hard-breaks: forced, styled, blank, and shared-layout cases passed");
