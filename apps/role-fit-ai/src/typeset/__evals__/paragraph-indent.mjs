import assert from "node:assert/strict";
import { DOC_STYLE_DEFAULTS } from "@typeset/engine/lib/documentStyle.ts";
import { layoutCoverLetter } from "@typeset/engine/typeset/layout.ts";
import { paragraphIndentFromInlineMarks } from "@typeset/engine/lib/inlineMarksText.ts";

const INDENT_PT = 36;
const style = { ...DOC_STYLE_DEFAULTS };

// Long enough to wrap several times at any sane page width, so the probe sees
// continuation lines rather than a single line that leading spaces could fake.
const SENTENCE =
  "This paragraph is deliberately long enough that the engine has to break it "
  + "across several lines, because the whole point of a block indent is what it "
  + "does to the lines the author never started themselves.";

const letter = (text) => ({
  name: "",
  contact: [],
  sections: [
    {
      id: "cover-letter",
      heading: "",
      type: "summary",
      items: [{ id: "p1", bulletIds: ["b1"], bullets: [text] }]
    }
  ]
});

const linesOf = (text) => layoutCoverLetter(letter(text), style).pages.flatMap((page) => page.lines);
const textOf = (line) => line.runs.map((run) => run.text).join("");

assert.equal(paragraphIndentFromInlineMarks(SENTENCE), 0, "an untagged paragraph has no indent");
assert.equal(
  paragraphIndentFromInlineMarks(`<indent=${INDENT_PT}>${SENTENCE}</indent>`),
  INDENT_PT
);

const plain = linesOf(SENTENCE);
const indented = linesOf(`<indent=${INDENT_PT}>${SENTENCE}</indent>`);

assert(plain.length > 1, "the probe paragraph must wrap");
assert.equal(
  indented.every((line) => line.runs.length > 0),
  true,
  "every line still carries runs"
);

// 1. EVERY line moves, not just the first. This is the whole difference from
//    leading spaces.
const leftEdge = (lines) => lines.map((line) => Math.min(...line.runs.map((run) => run.x)));
const plainLeft = leftEdge(plain);
const indentedLeft = leftEdge(indented);
for (let index = 0; index < Math.min(plainLeft.length, indentedLeft.length); index += 1) {
  assert.equal(
    Math.round((indentedLeft[index] - plainLeft[index]) * 100) / 100,
    INDENT_PT,
    `line ${index + 1} must start one indent further in`
  );
}

// 2. The measure narrows with it: no line may reach past where the unindented
//    paragraph was allowed to end.
const rightEdge = (lines) => Math.max(...lines.map((line) => Math.max(...line.runs.map((run) => run.x + run.width))));
assert(
  rightEdge(indented) <= rightEdge(plain) + 0.01,
  "an indented paragraph must not run past the original right margin"
);

// 3. A narrower measure means the same words need at least as many lines.
assert(
  indented.length >= plain.length,
  "narrowing the column cannot produce fewer lines"
);

// 4. The tag is layout, never text.
assert.equal(
  indented.some((line) => /<\/?indent/.test(textOf(line))),
  false,
  "the indent tag must never be painted"
);
// Runs are positioned by x with the glue consumed into the break, so compare
// the glyphs themselves rather than reconstructing spacing.
const glyphsOf = (lines) => lines.map(textOf).join("").replace(/\s+/g, "");
assert.equal(
  glyphsOf(indented),
  glyphsOf(plain),
  "indenting changes where the words sit, never which words they are"
);

// First-line spaces ride on top of block indentation as the second visible stop.
const both = linesOf(`<indent=${INDENT_PT}>${" ".repeat(8)}${SENTENCE}</indent>`);
assert.equal(
  both[0].runs[0].text.startsWith("        "),
  true,
  "the first line keeps its authored leading spaces"
);
assert.equal(
  Math.round(both[0].runs[0].x * 100) / 100,
  Math.round(indented[0].runs[0].x * 100) / 100,
  "both indents apply to the same line, one after the other"
);
assert(
  both[0].runs[1].x > indented[0].runs[1].x,
  "and those spaces take real width, pushing the first line's text one stop further"
);
assert.equal(
  Math.round(both[1].runs[0].x * 100) / 100,
  Math.round(indented[1].runs[0].x * 100) / 100,
  "every following line stays at the block indent"
);

console.log(
  `paragraph indent: ${plain.length} → ${indented.length} lines, every line +${INDENT_PT}bp, `
  + "measure narrowed, tag never painted, first-line indent stacks"
);
