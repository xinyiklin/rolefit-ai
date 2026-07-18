// Focused regression checks for the resume-data reducer and root-reducer
// undo/redo history coalescing.
// Run: node --experimental-strip-types src/hooks/__evals__/resume-editor-structure.mjs

import assert from "node:assert/strict";

import { reduceResumeData, rootReducer } from "../useResumeEditor.ts";
import { fieldMarkState, setFieldMark } from "@typeset/engine/lib/inlineMarksText.ts";

const base = {
  name: "Candidate",
  contact: [],
  sections: [
    {
      id: "summary",
      heading: "Summary",
      type: "summary",
      items: [
        {
          id: "paragraph-1",
          titleLeft: "",
          titleRight: "",
          subtitleLeft: "",
          subtitleRight: "",
          bullets: [{ id: "summary-text-1", text: "Front endBack end" }]
        }
      ]
    }
  ]
};

const split = reduceResumeData(base, {
  type: "splitSummaryParagraph",
  sectionId: "summary",
  entryId: "paragraph-1",
  bulletId: "summary-text-1",
  before: "Front end",
  after: "Back end"
});

assert.equal(split.sections[0].items.length, 2, "Enter creates a second summary row");
assert.equal(split.sections[0].items[0].bullets[0].text, "Front end", "the first row keeps the text before the caret");
assert.equal(split.sections[0].items[1].bullets[0].text, "Back end", "the new row receives the text after the caret");

const merged = reduceResumeData(split, {
  type: "mergeSummaryParagraphUp",
  sectionId: "summary",
  entryId: split.sections[0].items[1].id,
  joined: "Front endBack end"
});

assert.equal(merged.sections[0].items.length, 1, "Backspace at the next row start removes that row");
assert.equal(merged.sections[0].items[0].bullets[0].text, "Front endBack end", "merge restores the original paragraph text");
assert.deepEqual(base.sections[0].items[0].bullets[0].text, "Front endBack end", "the reducer does not mutate its input");

const skillsBase = {
  ...base,
  sections: [
    {
      id: "skills",
      heading: "Skills",
      type: "skills",
      items: [
        {
          id: "skills-1",
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
const skillsUpdated = reduceResumeData(skillsBase, {
  type: "updateSkillsRow",
  sectionId: "skills",
  entryId: "skills-1",
  label: "Languages & tools",
  skills: "TypeScript, Vite"
});
assert.equal(skillsUpdated.sections[0].items[0].titleLeft, "Languages & tools", "skills label updates atomically");
assert.equal(skillsUpdated.sections[0].items[0].subtitleLeft, "TypeScript, Vite", "skills values update atomically");

// ----- undo/redo history coalescing (rootReducer) -----
// Consecutive same-field edits in this eval run back-to-back, so their Date.now()
// deltas fall inside COALESCE_MS and merge deterministically into one undo step.
const historyBase = {
  name: "Candidate",
  contact: ["a@b.com"],
  sections: [
    {
      id: "sec-1",
      heading: "Experience",
      type: "standard",
      items: [
        {
          id: "entry-1",
          titleLeft: "Role",
          titleRight: "",
          subtitleLeft: "",
          subtitleRight: "",
          bullets: [
            { id: "b-1", text: "" },
            { id: "b-2", text: "x" }
          ]
        }
      ]
    }
  ]
};

const seeded = rootReducer(
  { data: null, dirty: false, past: [], future: [], coalesceKey: null, coalesceAt: 0 },
  { type: "seed", data: historyBase }
);
assert.equal(seeded.past.length, 0, "a fresh seed starts with empty history");

const typeRun = ["H", "He", "Hel"].reduce(
  (state, value) => rootReducer(state, { type: "updateBullet", sectionId: "sec-1", entryId: "entry-1", bulletId: "b-1", value }),
  seeded
);
assert.equal(typeRun.past.length, 1, "a run of same-field keystrokes is a single undo step");
assert.equal(typeRun.data.sections[0].items[0].bullets[0].text, "Hel", "the run applies every keystroke");

const undone = rootReducer(typeRun, { type: "undo" });
assert.equal(undone.data.sections[0].items[0].bullets[0].text, "", "one undo reverts the whole typing run");
const redone = rootReducer(undone, { type: "redo" });
assert.equal(redone.data.sections[0].items[0].bullets[0].text, "Hel", "redo reapplies the coalesced run");

const otherField = rootReducer(typeRun, { type: "updateBullet", sectionId: "sec-1", entryId: "entry-1", bulletId: "b-2", value: "xy" });
assert.equal(otherField.past.length, 2, "switching to a different field starts a new undo step");

const structural = rootReducer(typeRun, {
  type: "splitBullet",
  sectionId: "sec-1",
  entryId: "entry-1",
  bulletId: "b-1",
  before: "He",
  after: "l"
});
assert.equal(structural.past.length, 2, "a structural edit is its own undo step");
assert.equal(structural.coalesceKey, null, "a structural edit closes the typing group");

const suggestionApply = rootReducer(typeRun, {
  type: "updateBullet",
  sectionId: "sec-1",
  entryId: "entry-1",
  bulletId: "b-1",
  value: "Help",
  coalesce: false
});
assert.equal(suggestionApply.past.length, 2, "a suggestion apply is its own undo step, never merged into typing");

// ----- whole-field emphasis helpers + bulk setEntriesMark -----
assert.equal(setFieldMark("Foo", "bold", true), "<b>Foo</b>", "bold-on wraps the whole field");
assert.equal(setFieldMark("<b>Foo</b>", "bold", false), "Foo", "bold-off strips the mark");
assert.equal(setFieldMark("<b>A</b> B", "bold", true), "<b>A B</b>", "bold-on de-nests then wraps the whole field");
assert.equal(setFieldMark("", "bold", true), "", "empty field is left untouched");
assert.equal(setFieldMark("<i>Foo</i>", "bold", true), "<b><i>Foo</i></b>", "bold-on preserves an inner italic mark");

assert.equal(fieldMarkState("<b>Foo</b>", "bold"), true, "a fully bold-wrapped field reads as marked");
assert.equal(fieldMarkState("<b>A</b> B", "bold"), null, "a partially bold field reads as mixed");
assert.equal(fieldMarkState("Foo", "bold"), false, "a plain field is not marked");

const emphasisBase = {
  name: "Candidate",
  contact: [],
  sections: [
    {
      id: "exp",
      heading: "Experience",
      type: "standard",
      items: [
        { id: "e1", titleLeft: "Engineer", titleRight: "", subtitleLeft: "Acme", subtitleRight: "", bullets: [] }
      ]
    },
    {
      id: "sk",
      heading: "Skills",
      type: "skills",
      items: [
        { id: "s1", titleLeft: "Languages", titleRight: "", subtitleLeft: "TS", subtitleRight: "", bullets: [] }
      ]
    }
  ]
};
const boldedTitles = reduceResumeData(emphasisBase, { type: "setStyleFieldMark", field: "titleLeft", mark: "bold", on: true });
assert.equal(boldedTitles.sections[0].items[0].titleLeft, "<b>Engineer</b>", "bulk bold marks the standard entry title");
assert.equal(boldedTitles.sections[1].items[0].titleLeft, "Languages", "bulk title bold leaves the skills row untouched");
const unbolded = reduceResumeData(boldedTitles, { type: "setStyleFieldMark", field: "titleLeft", mark: "bold", on: false });
assert.equal(unbolded.sections[0].items[0].titleLeft, "Engineer", "bulk bold-off removes the title mark");

console.log("resume editor structure eval: 28/28 checks passed");
