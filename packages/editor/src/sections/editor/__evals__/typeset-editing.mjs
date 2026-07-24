// Focused regression checks for direct-editing whitespace, deleted typography,
// and engine-derived structural hit areas.
// Run: node --experimental-strip-types src/sections/editor/__evals__/typeset-editing.mjs

import assert from "node:assert/strict";

import {
  applyInlineFragment,
  applyEdit,
  buildDisplayMap,
  inlineFragmentForRange,
  setFontSize,
  typingFormatForDeletedRange
} from "../inlineTextEditing.ts";
import {
  decodeInlineClipboard,
  encodeInlineClipboard
} from "../clipboardFormatting.ts";
import { commitField, valueForField } from "../resumeFieldAdapter.ts";
import { anchorsFromDoc } from "../typesetStructure.ts";

const skillsSrc = { kind: "skillsRow", sectionId: "skills", entryId: "row" };
let storedRow = { label: "", skills: "" };
const actions = {
  updateSkillsRow(_sectionId, _entryId, label, skills) {
    storedRow = { label, skills };
  }
};

const storedData = () => ({
  name: "",
  contact: [],
  sections: [
    {
      id: "skills",
      heading: "Skills",
      type: "skills",
      items: [
        {
          id: "row",
          titleLeft: storedRow.label,
          titleRight: "",
          subtitleLeft: storedRow.skills,
          subtitleRight: "",
          bullets: []
        }
      ]
    }
  ]
});

commitField(actions, skillsSrc, "Tools: ");
assert.deepEqual(storedRow, { label: "Tools", skills: "" });
assert.equal(valueForField(storedData(), skillsSrc), "Tools: ");

commitField(actions, skillsSrc, "Tools:  ");
assert.deepEqual(storedRow, { label: "Tools", skills: " " });
assert.equal(valueForField(storedData(), skillsSrc), "Tools:  ");

commitField(actions, skillsSrc, "Tools: React, ");
assert.deepEqual(storedRow, { label: "Tools", skills: "React, " });
assert.equal(valueForField(storedData(), skillsSrc), "Tools: React, ");

commitField(actions, skillsSrc, "Programming : React");
assert.deepEqual(storedRow, { label: "Programming ", skills: "React" });
assert.equal(valueForField(storedData(), skillsSrc), "Programming : React");

const styled = buildDisplayMap(
  "<b>A</b><font=source-sans><size=14>B</size></font>",
  { preserveWhitespace: true }
);
const deletedFormat = typingFormatForDeletedRange(styled, 0, 2);
assert.deepEqual(deletedFormat, {
  bold: false,
  italic: false,
  underline: false,
  fontFamily: "source-sans",
  fontSizePt: 14,
  alignment: null
});
const emptied = applyEdit(styled, 0, 2, "");
const retyped = applyEdit(buildDisplayMap(emptied.value, { preserveWhitespace: true }), 0, 0, "Z", deletedFormat ?? undefined);
const retypedMap = buildDisplayMap(retyped.value, { preserveWhitespace: true });
assert.equal(retypedMap.display, "Z");
assert.equal(retypedMap.chars[0].fontFamily, "source-sans");
assert.equal(retypedMap.chars[0].fontSizePt, 14);

const authoredIndent = buildDisplayMap("    Indented", { preserveWhitespace: true });
assert.equal(authoredIndent.display, "    Indented", "Tab-equivalent leading spaces remain editable");

const mixedSource = buildDisplayMap(
  "<font=source-serif>A</font><font=source-sans><size=24><b>B</b></size></font><i>C</i>",
  { preserveWhitespace: true }
);
const mixedFragment = inlineFragmentForRange(mixedSource, 0, 3);
const transportedFragment = decodeInlineClipboard(encodeInlineClipboard(mixedFragment));
assert.equal(transportedFragment, mixedFragment);
const mixedPaste = applyInlineFragment(
  buildDisplayMap("xy", { preserveWhitespace: true }),
  1,
  1,
  transportedFragment
);
const mixedPasteMap = buildDisplayMap(mixedPaste.value, { preserveWhitespace: true });
assert.equal(mixedPasteMap.display, "xABCy");
assert.equal(mixedPasteMap.chars[1].fontFamily, "source-serif");
assert.equal(mixedPasteMap.chars[2].fontFamily, "source-sans");
assert.equal(mixedPasteMap.chars[2].fontSizePt, 24);
assert.equal(mixedPasteMap.chars[2].bold, true);
assert.equal(mixedPasteMap.chars[3].italic, true);

const boundedSizeSource = buildDisplayMap("ABC", { preserveWhitespace: true });
const belowMinimum = setFontSize(boundedSizeSource, 0, 1, -20);
const aboveMaximum = setFontSize(
  buildDisplayMap(belowMinimum.value, { preserveWhitespace: true }),
  1,
  2,
  900
);
const boundedSizeMap = buildDisplayMap(aboveMaximum.value, { preserveWhitespace: true });
assert.equal(boundedSizeMap.chars[0].fontSizePt, 1);
assert.equal(boundedSizeMap.chars[1].fontSizePt, 200);
assert.equal(boundedSizeMap.chars[2].fontSizePt, null);

const style = { family: "latin-modern", face: "regular", size: 10, tracking: 0 };
const bulletSrc = { kind: "bullet", sectionId: "work", entryId: "job", bulletId: "bullet" };
const anchors = anchorsFromDoc({
  geometry: {},
  pages: [
    {
      lines: [
        {
          baseline: 100,
          runs: [
            { text: "•", x: 64, width: 4, style, src: bulletSrc, marker: true },
            { text: "Built it", x: 82, width: 34, style, src: bulletSrc }
          ]
        }
      ]
    }
  ]
});
const bulletAnchor = anchors.blocks.find((block) => block.kind === "bullet");
assert.equal(bulletAnchor?.x0, 64);
assert.equal(bulletAnchor?.x1, 116);

console.log("typeset editing: whitespace, rich clipboard, bounded typography, and drag hit-area checks passed");
