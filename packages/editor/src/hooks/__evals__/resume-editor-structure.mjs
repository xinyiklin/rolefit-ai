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

// ----- index-arithmetic structural transitions -----
// One fixture with known ids at every depth; `structuralPristine` guards the
// reducer's non-mutation contract after each cluster (same pattern as above).
const structuralBase = {
  name: "Candidate",
  contact: ["a@b.com"],
  sections: [
    {
      id: "s1",
      heading: "Experience",
      type: "standard",
      items: [
        {
          id: "s1e1",
          titleLeft: "Engineer",
          titleRight: "2024",
          subtitleLeft: "Acme",
          subtitleRight: "Remote",
          bullets: [
            { id: "s1e1b1", text: "one" },
            { id: "s1e1b2", text: "two" },
            { id: "s1e1b3", text: "three" }
          ]
        },
        {
          id: "s1e2",
          titleLeft: "Dev",
          titleRight: "",
          subtitleLeft: "Beta",
          subtitleRight: "",
          bullets: [{ id: "s1e2b1", text: "four" }]
        }
      ]
    },
    {
      id: "s2",
      heading: "Projects",
      type: "standard",
      items: [
        { id: "s2e1", titleLeft: "Tool", titleRight: "", subtitleLeft: "", subtitleRight: "", bullets: [{ id: "s2e1b1", text: "five" }] }
      ]
    },
    {
      id: "s3",
      heading: "Skills",
      type: "skills",
      items: [
        { id: "s3e1", titleLeft: "Languages", titleRight: "", subtitleLeft: "TS", subtitleRight: "", bullets: [] }
      ]
    }
  ]
};
const structuralPristine = structuredClone(structuralBase);
const sectionIds = (data) => data.sections.map((section) => section.id);
const entryIds = (data, sectionIndex) => data.sections[sectionIndex].items.map((entry) => entry.id);
const bulletIds = (data, sectionIndex, entryIndex) =>
  data.sections[sectionIndex].items[entryIndex].bullets.map((bullet) => bullet.id);

// reorderSections / reorderEntries / reorderBullets
const sectionsMoved = reduceResumeData(structuralBase, { type: "reorderSections", from: 0, to: 2 });
assert.deepEqual(sectionIds(sectionsMoved), ["s2", "s3", "s1"], "reorderSections moves the first section to the end");
// No-op structural dispatches must preserve STATE IDENTITY (===), not merely
// deep equality: rootReducer's `data === state.data` short-circuit is what keeps
// a same-index drop / stale-id action from marking the document dirty and
// pushing an identical undo snapshot.
const sectionsOutOfRange = reduceResumeData(structuralBase, { type: "reorderSections", from: 0, to: 3 });
assert.equal(sectionsOutOfRange, structuralBase, "an out-of-range section reorder returns the same state");
const sectionsSameIndex = reduceResumeData(structuralBase, { type: "reorderSections", from: 1, to: 1 });
assert.equal(sectionsSameIndex, structuralBase, "a same-index section reorder returns the same state");

const entriesMoved = reduceResumeData(structuralBase, { type: "reorderEntries", sectionId: "s1", from: 1, to: 0 });
assert.deepEqual(entryIds(entriesMoved, 0), ["s1e2", "s1e1"], "reorderEntries swaps rows inside the section");
assert.equal(entriesMoved.sections[1], structuralBase.sections[1], "untargeted sections keep their object identity");
const entriesOutOfRange = reduceResumeData(structuralBase, { type: "reorderEntries", sectionId: "s1", from: 5, to: 0 });
assert.equal(entriesOutOfRange, structuralBase, "an out-of-range entry reorder returns the same state");
assert.equal(
  reduceResumeData(structuralBase, { type: "reorderEntries", sectionId: "missing", from: 0, to: 1 }),
  structuralBase,
  "an entry reorder in an unknown section returns the same state"
);

const bulletsMoved = reduceResumeData(structuralBase, { type: "reorderBullets", sectionId: "s1", entryId: "s1e1", from: 0, to: 2 });
assert.deepEqual(bulletIds(bulletsMoved, 0, 0), ["s1e1b2", "s1e1b3", "s1e1b1"], "reorderBullets moves the first bullet to the end");
const bulletsOutOfRange = reduceResumeData(structuralBase, { type: "reorderBullets", sectionId: "s1", entryId: "s1e1", from: -1, to: 1 });
assert.equal(bulletsOutOfRange, structuralBase, "a negative bullet reorder index returns the same state");

// insertSection / insertEntry / insertBullet position correctness
const insertedAbove = reduceResumeData(structuralBase, { type: "insertSection", sectionType: "summary", sectionId: "s2", position: "above" });
assert.equal(insertedAbove.sections.length, 4, "insertSection adds exactly one section");
assert.equal(insertedAbove.sections[1].type, "summary", "insertSection above lands before the anchor");
assert.equal(insertedAbove.sections[2].id, "s2", "the anchor shifts down by one");
const insertedBelow = reduceResumeData(structuralBase, { type: "insertSection", sectionType: "standard", sectionId: "s3", position: "below" });
assert.equal(insertedBelow.sections[3].type, "standard", "insertSection below the last section appends");
const insertUnknownSection = reduceResumeData(structuralBase, { type: "insertSection", sectionType: "standard", sectionId: "missing", position: "below" });
assert.equal(insertUnknownSection, structuralBase, "an unknown insert anchor returns the same state");

const entryBelow = reduceResumeData(structuralBase, { type: "insertEntry", sectionId: "s1", afterEntryId: "s1e1" });
assert.equal(entryBelow.sections[0].items.length, 3, "insertEntry adds exactly one row");
assert.equal(entryBelow.sections[0].items[2].id, "s1e2", "insertEntry defaults to below the anchor");
const entryAbove = reduceResumeData(structuralBase, { type: "insertEntry", sectionId: "s1", afterEntryId: "s1e1", position: "above" });
assert.equal(entryAbove.sections[0].items[1].id, "s1e1", "insertEntry above shifts the anchor down");
const skillRowInserted = reduceResumeData(structuralBase, { type: "insertEntry", sectionId: "s3", afterEntryId: "s3e1" });
assert.equal(skillRowInserted.sections[2].items[1].bullets.length, 0, "a skills section inserts a bullet-less skill row");
assert.equal(
  reduceResumeData(structuralBase, { type: "insertEntry", sectionId: "s1", afterEntryId: "missing" }),
  structuralBase,
  "an unknown entry anchor returns the same state"
);

const bulletBelow = reduceResumeData(structuralBase, { type: "insertBullet", sectionId: "s1", entryId: "s1e1", afterBulletId: "s1e1b1" });
assert.equal(bulletBelow.sections[0].items[0].bullets.length, 4, "insertBullet adds exactly one bullet");
assert.equal(bulletBelow.sections[0].items[0].bullets[1].text, "", "insertBullet places an empty bullet below the anchor");
assert.equal(bulletBelow.sections[0].items[0].bullets[2].id, "s1e1b2", "later bullets shift down by one");
const bulletAbove = reduceResumeData(structuralBase, { type: "insertBullet", sectionId: "s1", entryId: "s1e1", afterBulletId: "s1e1b1", position: "above" });
assert.equal(bulletAbove.sections[0].items[0].bullets[1].id, "s1e1b1", "insertBullet above shifts the anchor down");
assert.equal(
  reduceResumeData(structuralBase, { type: "insertBullet", sectionId: "s1", entryId: "s1e1", afterBulletId: "missing" }),
  structuralBase,
  "an unknown bullet anchor returns the same state"
);

// removeSection / removeEntry / removeBullet
assert.deepEqual(
  sectionIds(reduceResumeData(structuralBase, { type: "removeSection", sectionId: "s2" })),
  ["s1", "s3"],
  "removeSection drops only the target"
);
assert.equal(
  reduceResumeData(structuralBase, { type: "removeSection", sectionId: "missing" }),
  structuralBase,
  "removing an unknown section returns the same state"
);
assert.deepEqual(
  entryIds(reduceResumeData(structuralBase, { type: "removeEntry", sectionId: "s1", entryId: "s1e1" }), 0),
  ["s1e2"],
  "removeEntry drops only the target row"
);
assert.equal(
  reduceResumeData(structuralBase, { type: "removeEntry", sectionId: "s1", entryId: "missing" }),
  structuralBase,
  "removing an unknown entry returns the same state"
);
assert.deepEqual(
  bulletIds(reduceResumeData(structuralBase, { type: "removeBullet", sectionId: "s1", entryId: "s1e1", bulletId: "s1e1b2" }), 0, 0),
  ["s1e1b1", "s1e1b3"],
  "removeBullet drops only the target bullet"
);
assert.equal(
  reduceResumeData(structuralBase, { type: "removeBullet", sectionId: "s1", entryId: "s1e1", bulletId: "missing" }),
  structuralBase,
  "removing an unknown bullet returns the same state"
);
assert.equal(
  reduceResumeData(structuralBase, { type: "removeContact", index: 5 }),
  structuralBase,
  "removing an out-of-range contact returns the same state"
);

// mergeBulletUp
const mergedUp = reduceResumeData(structuralBase, { type: "mergeBulletUp", sectionId: "s1", entryId: "s1e1", bulletId: "s1e1b2", joined: "onetwo" });
assert.deepEqual(bulletIds(mergedUp, 0, 0), ["s1e1b1", "s1e1b3"], "mergeBulletUp removes the merged bullet");
assert.equal(mergedUp.sections[0].items[0].bullets[0].text, "onetwo", "the previous bullet keeps the joined text");
assert.equal(
  reduceResumeData(structuralBase, { type: "mergeBulletUp", sectionId: "s1", entryId: "s1e1", bulletId: "s1e1b1", joined: "x" }),
  structuralBase,
  "merging the first bullet returns the same state"
);

assert.deepEqual(structuralBase, structuralPristine, "structural actions never mutate their input state");

// ----- bulk style-field font/size and formatting reset -----
const fonted = reduceResumeData(structuralBase, { type: "setStyleFieldFont", field: "titleLeft", family: "source-serif" });
assert.equal(fonted.sections[0].items[0].titleLeft, "<font=source-serif>Engineer</font>", "bulk font wraps every standard entry title");
assert.equal(fonted.sections[2].items[0].titleLeft, "Languages", "bulk title font leaves the skills row untouched");
const defonted = reduceResumeData(fonted, { type: "setStyleFieldFont", field: "titleLeft", family: "default" });
assert.equal(defonted.sections[0].items[0].titleLeft, "Engineer", 'font "default" strips the override');

const sized = reduceResumeData(structuralBase, { type: "setStyleFieldSize", field: "subtitleLeft", sizePt: 9 });
assert.equal(sized.sections[0].items[0].subtitleLeft, "<size=9>Acme</size>", "bulk size wraps every standard entry subtitle");
const desized = reduceResumeData(sized, { type: "setStyleFieldSize", field: "subtitleLeft", sizePt: "default" });
assert.equal(desized.sections[0].items[0].subtitleLeft, "Acme", 'size "default" strips the override');

const sizedAndFonted = reduceResumeData(fonted, { type: "setStyleFieldSize", field: "subtitleLeft", sizePt: 9 });
const resetFormatting = reduceResumeData(sizedAndFonted, { type: "resetStyleFieldFormatting" });
assert.equal(resetFormatting.sections[0].items[0].titleLeft, "<b>Engineer</b>", "reset restores the default title bold and clears the font override");
assert.equal(resetFormatting.sections[0].items[0].subtitleLeft, "<i>Acme</i>", "reset restores the default subtitle italic and clears the size override");
assert.equal(resetFormatting.sections[2].items[0].titleLeft, "<b>Languages</b>", "reset restores the default bold skill label");
assert.equal(resetFormatting.contact[0], "a@b.com", "reset leaves unmarked contact defaults untouched");

assert.deepEqual(structuralBase, structuralPristine, "style-formatting actions never mutate their input state");

// ----- clearAlignmentOverrides per scope -----
const alignmentBase = {
  name: "<align=left>Candidate</align>",
  contact: ["<align=left>a@b.com</align>"],
  sections: [
    {
      id: "s1",
      heading: "<align=center>Experience</align>",
      type: "standard",
      items: [
        {
          id: "s1e1",
          titleLeft: "<align=center>Engineer</align>",
          titleRight: "",
          subtitleLeft: "",
          subtitleRight: "",
          bullets: [{ id: "s1e1b1", text: "<align=right>one</align>" }]
        }
      ]
    },
    {
      id: "s2",
      heading: "Skills",
      type: "skills",
      items: [
        { id: "s2e1", titleLeft: "<align=center>Languages</align>", titleRight: "", subtitleLeft: "<align=center>TS</align>", subtitleRight: "", bullets: [] }
      ]
    }
  ]
};
const alignmentPristine = structuredClone(alignmentBase);

const clearedHeader = reduceResumeData(alignmentBase, { type: "clearAlignmentOverrides", scope: "header" });
assert.equal(clearedHeader.name, "Candidate", "header scope clears the name override");
assert.equal(clearedHeader.contact[0], "a@b.com", "header scope clears contact overrides");
assert.equal(clearedHeader.sections[0].heading, "<align=center>Experience</align>", "header scope leaves headings alone");

const clearedHeadings = reduceResumeData(alignmentBase, { type: "clearAlignmentOverrides", scope: "heading" });
assert.equal(clearedHeadings.sections[0].heading, "Experience", "heading scope clears section-heading overrides");
assert.equal(clearedHeadings.name, "<align=left>Candidate</align>", "heading scope leaves the header alone");

const clearedBody = reduceResumeData(alignmentBase, { type: "clearAlignmentOverrides", scope: "body" });
assert.equal(clearedBody.sections[0].items[0].bullets[0].text, "one", "body scope clears bullet overrides");
assert.equal(clearedBody.sections[1].items[0].titleLeft, "Languages", "body scope clears skill-label overrides");
assert.equal(clearedBody.sections[1].items[0].subtitleLeft, "TS", "body scope clears skill-value overrides");
assert.equal(clearedBody.sections[0].items[0].titleLeft, "<align=center>Engineer</align>", "body scope leaves entry title columns alone");

assert.equal(
  reduceResumeData(structuralBase, { type: "clearAlignmentOverrides", scope: "body" }),
  structuralBase,
  "clearing with no overrides returns the same state"
);
assert.deepEqual(alignmentBase, alignmentPristine, "alignment clearing never mutates its input state");

console.log("resume editor structure eval: 84/84 checks passed");
