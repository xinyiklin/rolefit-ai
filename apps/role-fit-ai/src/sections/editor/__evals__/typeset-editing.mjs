import assert from "node:assert/strict";

import {
  applyEdit,
  buildDisplayMap,
  displayIndexForValueIndex,
  historyCaretTarget,
  splitValueAt,
  toggleMark
} from "../typesetEditing.ts";
import { anchorForField, fieldKeyForReviewTarget } from "../typesetStructure.ts";

let checks = 0;
const check = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  checks += 1;
};

const marked = buildDisplayMap("<b>Hello</b> world");
check(marked.display, "Hello world", "inline tags stay out of the painted text");
check(marked.chars.slice(0, 5).every((char) => char.bold), true, "bold provenance reaches every painted character");
check(
  toggleMark(marked, 6, 11, "italic").value,
  "<b>Hello</b> <i>world</i>",
  "formatting a selection preserves adjacent marks"
);

const ligature = buildDisplayMap("A -- B");
check(ligature.display, "A – B", "TeX ligatures paint as one display character");
const deletedLigature = applyEdit(ligature, 2, 3, "");
check(buildDisplayMap(deletedLigature.value).display, "A B", "one delete removes the full ligature source");

const spaced = buildDisplayMap("  Alpha   Beta  ");
check(spaced.display, "Alpha Beta", "painted whitespace matches the layout engine");
const inserted = applyEdit(spaced, 5, 5, "+");
check(buildDisplayMap(inserted.value).display, "Alpha+ Beta", "edits keep trimmed outer whitespace stable");

check(
  splitValueAt(buildDisplayMap("<b>Bold text</b>"), 4),
  { before: "<b>Bold</b>", after: "<b> text</b>" },
  "splitting a bullet balances marks on both sides"
);
check(displayIndexForValueIndex(buildDisplayMap("A -- B"), 4), 3, "value offsets restore to the painted caret boundary");
const hardBreak = buildDisplayMap("First  \n  Second\n\nThird");
check(hardBreak.display, "First\nSecond\n\nThird", "hard breaks survive while edge spaces stay unpainted");
check(
  buildDisplayMap(applyEdit(hardBreak, 5, 5, "\n").value).display,
  "First\n\nSecond\n\nThird",
  "Shift+Enter inserts an authored blank line"
);

const resume = {
  name: "Candidate",
  contact: [],
  sections: [
    {
      id: "skills",
      heading: "Skills",
      type: "skills",
      items: [
        {
          id: "skill-row",
          titleLeft: "Languages",
          titleRight: "",
          subtitleLeft: "TypeScript",
          subtitleRight: "",
          bullets: []
        }
      ]
    }
  ]
};
check(
  fieldKeyForReviewTarget(resume, { sectionId: "skills", entryId: "skill-row", field: "skill" }),
  "skillsRow|skills|skill-row",
  "review skill targets resolve to the combined painted row"
);
const skillAnchor = { page: 0, top: 10, bottom: 20, sectionId: "skills", entryId: "skill-row", kind: "skillsRow" };
check(
  anchorForField({ blocks: [skillAnchor], headings: new Map() }, "skillsRow|skills|skill-row"),
  skillAnchor,
  "keyboard-active fields resolve back to structural chrome anchors"
);

const standardResume = {
  ...resume,
  sections: [
    {
      id: "experience",
      heading: "Experience",
      type: "standard",
      items: [
        {
          id: "role",
          titleLeft: "Engineer",
          titleRight: "",
          subtitleLeft: "",
          subtitleRight: "",
          bullets: []
        }
      ]
    }
  ]
};
check(
  fieldKeyForReviewTarget(standardResume, {
    sectionId: "experience",
    entryId: "role",
    field: "subtitleRight"
  }),
  "entry|experience|role|subtitleRight",
  "an unpainted optional review target keeps its exact field"
);

// ----- undo/redo caret restoration (historyCaretTarget) -----
const withBullet = (text) => ({
  name: "Candidate",
  contact: [],
  sections: [
    {
      id: "s",
      heading: "Experience",
      type: "standard",
      items: [
        { id: "e", titleLeft: "", titleRight: "", subtitleLeft: "", subtitleRight: "", bullets: [{ id: "b", text }] }
      ]
    }
  ]
});

const appendUndo = historyCaretTarget(withBullet("helloabc"), withBullet("hello"));
check(appendUndo.key, "bullet|s|e|b", "undo locates the changed bullet");
check(appendUndo.valueIndex, 5, "append-undo caret sits at the end of the remaining text");
check(appendUndo.valueEndIndex, undefined, "append-undo collapses the caret rather than selecting");

const replaceUndo = historyCaretTarget(withBullet("hello X"), withBullet("hello world"));
check(replaceUndo.valueIndex, 6, "restoring a replaced selection starts the highlight at the divergence");
check(replaceUndo.valueEndIndex, 11, "restoring a replaced selection re-highlights the restored text");

check(historyCaretTarget(withBullet("hello"), withBullet("hello")), null, "an unchanged snapshot moves no caret");

console.log(`typeset editing eval: ${checks}/${checks} checks passed`);
