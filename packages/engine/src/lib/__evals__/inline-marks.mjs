// The inline-mark grammar's tag-stack rules, checked across every walker that
// instantiates it: the engine's segmenter, the whole-field truth helpers, and
// the tag-safe uppercase transform.
// Run: node --experimental-strip-types src/lib/__evals__/inline-marks.mjs
import assert from "node:assert/strict";
import {
  effectiveFieldFont,
  effectiveFieldSize,
  hasInlineMarkTags,
  stripInlineMarks,
  uppercaseInlineMarkedText
} from "../inlineMarksText.ts";
import { segmentsFromInlineMarks } from "../../typeset/measure.ts";

// An unusable <size> still owns its </size>: the close must not pop an outer size.
for (const inner of ["0", "0.5", "201", "999999"]) {
  const value = `<size=12>a<size=${inner}>b</size>c</size>`;
  assert.deepEqual(
    segmentsFromInlineMarks(value).map((segment) => [segment.text, segment.fontSizePt]),
    [["a", 12], ["b", 12], ["c", 12]],
    `<size=${inner}> is inert for the segmenter`
  );
  assert.equal(effectiveFieldSize(value, 10), 12, `<size=${inner}> is inert for the field-size truth`);
}
assert.deepEqual(
  segmentsFromInlineMarks("<size=0>a</size>b").map((segment) => [segment.text, segment.fontSizePt]),
  [["a", null], ["b", null]],
  "an inert size at the top level leaves the role size"
);
assert.equal(effectiveFieldSize("<size=14>a</size><size=0>b</size>", 10), null, "an inert size resolves to the fallback, so this field is mixed");
assert.deepEqual(
  segmentsFromInlineMarks("<font=tinos>a<size=14>b</size>c</font>d").map((segment) => [segment.text, segment.fontFamily, segment.fontSizePt]),
  [["a", "tinos", null], ["b", "tinos", 14], ["c", "tinos", null], ["d", null, null]],
  "valid nested marks keep their scopes"
);
assert.equal(effectiveFieldFont("<font=tinos>a</font>", "arimo"), "tinos");

// Uppercase transforms text and leaves every tag payload alone.
assert.equal(
  uppercaseInlineMarkedText("mixed <link=https%3A%2F%2Fexample.test%2FPath%3Fq%3DMixed>text</link> <font=tinos><size=10.5>styled</size></font> <align=center>c</align>"),
  "MIXED <link=https%3A%2F%2Fexample.test%2FPath%3Fq%3DMixed>TEXT</link> <font=tinos><size=10.5>STYLED</size></font> <align=center>C</align>"
);
assert.equal(uppercaseInlineMarkedText(""), "");
assert.equal(uppercaseInlineMarkedText("<b></b>"), "<b></b>");
assert.equal(uppercaseInlineMarkedText("plain ß text"), "PLAIN SS TEXT", "text uppercasing is the full Unicode mapping");
assert.equal(stripInlineMarks(uppercaseInlineMarkedText("<i>ab</i>")), "AB");
assert.equal(hasInlineMarkTags("<size=0>"), true, "an unusable size is still a tag the grammar recognizes");

console.log("inline marks: inert size slots, nested scopes, and tag-safe uppercase passed");
