// Focused regression checks for direct-editing whitespace, deleted typography,
// and engine-derived structural hit areas.
// Run: node --experimental-strip-types src/sections/editor/__evals__/typeset-editing.mjs

import assert from "node:assert/strict";

import {
  applyEdit,
  buildDisplayMap,
  typingFormatForDeletedRange
} from "../inlineTextEditing.ts";
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

console.log("typeset editing: whitespace, deleted typography, and drag hit-area checks passed");
