import { useCallback, useMemo, useReducer, useRef } from "react";

import {
  newBullet,
  newDocumentHeader,
  newEntry,
  normalizeDocumentHeader,
  newSkillEntry,
  newSummaryEntry,
  newSection,
  type ResumeData,
  type DocumentHeader,
  type ResumeEntry,
  type ResumeSectionData,
  type ResumeSectionType
} from "@typeset/engine/lib/resumeData.ts";
import {
  clearAlignmentOverride,
  type FieldFontFamily,
  type FieldMark
} from "@typeset/engine/lib/inlineMarksText.ts";
import type { AlignmentScope } from "@typeset/engine/lib/documentStyle.ts";
import {
  resetStyleFieldFormatting,
  setStyleFieldFont,
  setStyleFieldMark,
  setStyleFieldSize,
  type EntryTextField,
  type StyleTextField
} from "@typeset/engine/lib/styleFieldFormatting.ts";
import { createHistoryClock, type HistoryClock } from "./historyClock.ts";

// New rows match the section's shape: skill row, summary paragraph, or entry.
function newEntryForSection(section: ResumeSectionData): ResumeEntry {
  if (section.type === "skills") return newSkillEntry();
  if (section.type === "summary") return newSummaryEntry();
  return newEntry();
}

// `dirty` = the model differs from the last seed (drives autosave and the
// before-unload guard).
// `past`/`future` = the undo/redo history: snapshots of `data` (structural
// sharing keeps them cheap), reset on seed, capped so a long session can't
// grow unbounded. `coalesceKey`/`coalesceAt` group a run of consecutive edits
// with the same field AND text intent into one undo step: typing, backward
// deletion, and forward deletion never merge with each other. A caret/field
// move, structural edit, pause, or undo/redo starts a fresh group.
// `coalesceEdge`/`coalesceCount` bound that group the way a word processor
// does, so undo walks a burst back in readable chunks instead of erasing it
// whole: the run also ends at a word boundary and at TEXT_GROUP_CHAR_CAP.
type State = {
  data: ResumeData | null;
  dirty: boolean;
  past: { data: ResumeData; sequence: number; branch: number; generation: number }[];
  future: { data: ResumeData; sequence: number; branch: number; generation: number }[];
  coalesceKey: string | null;
  coalesceAt: number;
  // Last character the open group absorbed, in the gesture's own direction.
  coalesceEdge: string | null;
  coalesceCount: number;
};

const HISTORY_CAP = 100;
// Consecutive same-field edits within this window merge into one undo step; a
// longer pause closes the group so the next keystroke is separately undoable.
const COALESCE_MS = 700;
// A run with no word boundary in it (a held key, a long token) still has to end
// somewhere, or one undo would swallow an arbitrarily long burst.
const TEXT_GROUP_CHAR_CAP = 20;

export type TextHistoryIntent =
  | "insert"
  | "deleteBackward"
  | "deleteForward";

export type TextEditOptions = {
  coalesce?: boolean;
  historyIntent?: TextHistoryIntent;
  // The characters this edit inserted or removed. Only history grouping reads
  // it; the document value in the action stays the single source of truth.
  historyText?: string;
};

// The undo-group signature for a text edit, or null for structural operations
// that must always be their own undo step.
function coalesceKeyFor(action: Action): string | null {
  const withIntent = (field: string, options: TextEditOptions) => {
    if (options.coalesce === false) return null;
    return `${field}:${options.historyIntent ?? "edit"}`;
  };
  switch (action.type) {
    case "setHeaderName":
      return withIntent("name", action);
    case "updateContact":
      return withIntent(`contact:${action.index}`, action);
    case "setHeading":
      return withIntent(`heading:${action.sectionId}`, action);
    case "updateEntry":
      return withIntent(
        `entry:${action.sectionId}:${action.entryId}:${action.field}`,
        action
      );
    case "updateSkillsRow":
      return withIntent(`skills:${action.sectionId}:${action.entryId}`, action);
    case "updateBullet":
      return withIntent(
        `bullet:${action.sectionId}:${action.entryId}:${action.bulletId}`,
        action
      );
    default:
      return null;
  }
}

// The characters a text edit added or removed, when the caller reported them.
function historyTextFor(action: Action): string {
  return "historyText" in action && typeof action.historyText === "string"
    ? action.historyText
    : "";
}

// Word-processor undo granularity: a burst is undone a word at a time rather
// than all at once. Insertion and forward deletion travel left to right, so a
// run ends where the next word begins. Backward deletion travels right to left,
// so it ends where the caret reaches the whitespace ahead of the word it just
// removed — that keeps the chunk "space + word" in both directions.
function startsNewTextGroup(
  intent: TextHistoryIntent | undefined,
  edge: string | null,
  text: string
): boolean {
  if (!edge || !text) return false;
  const edgeIsSpace = /\s/.test(edge);
  const nextIsSpace = /\s/.test(text[0]!);
  if (intent === "deleteBackward") return nextIsSpace && !edgeIsSpace;
  return edgeIsSpace && !nextIsSpace;
}

type Action =
  | { type: "seed"; data: ResumeData | null }
  | { type: "markClean" }
  | { type: "breakTextHistoryGroup" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "createHeader" }
  | { type: "setHeaderVisible"; visible: boolean }
  | ({ type: "setHeaderName"; value: string } & TextEditOptions)
  | { type: "removeHeaderName" }
  | { type: "replaceHeader"; header: DocumentHeader | null }
  | { type: "replaceDocument"; data: ResumeData }
  | ({ type: "updateContact"; index: number; value: string } & TextEditOptions)
  | { type: "insertContact"; index: number }
  | { type: "removeContact"; index: number }
  | { type: "addSection"; sectionType: ResumeSectionType; position?: "top" | "bottom" }
  | { type: "insertSection"; sectionType: ResumeSectionType; sectionId: string; position: "above" | "below" }
  | { type: "removeSection"; sectionId: string }
  | { type: "reorderSections"; from: number; to: number }
  | ({ type: "setHeading"; sectionId: string; heading: string } & TextEditOptions)
  | { type: "insertEntry"; sectionId: string; afterEntryId: string; position?: "above" | "below" }
  | { type: "removeEntry"; sectionId: string; entryId: string }
  | { type: "reorderEntries"; sectionId: string; from: number; to: number }
  | ({
      type: "updateEntry";
      sectionId: string;
      entryId: string;
      field: EntryTextField;
      value: string;
    } & TextEditOptions)
  | ({
      type: "updateSkillsRow";
      sectionId: string;
      entryId: string;
      label: string;
      skills: string;
    } & TextEditOptions)
  // Bulk emphasis from Styles applies/removes a mark on one entry field across
  // every standard entry. It remains ordinary formatting that can be changed
  // later on an individual selection (not a global render flag).
  | { type: "setStyleFieldMark"; field: StyleTextField; mark: FieldMark; on: boolean }
  // Bulk font family for one style field across every instance, same truth model
  // as the emphasis matrix; "default" clears the override to follow doc font.
  | { type: "setStyleFieldFont"; field: StyleTextField; family: FieldFontFamily | "default" }
  // Bulk font size (pt) for one style field; "default" clears to the role size.
  | { type: "setStyleFieldSize"; field: StyleTextField; sizePt: number | "default" }
  | { type: "resetStyleFieldFormatting" }
  | { type: "clearAlignmentOverrides"; scope: AlignmentScope }
  | { type: "addBullet"; sectionId: string; entryId: string }
  | { type: "insertBullet"; sectionId: string; entryId: string; afterBulletId: string; position?: "above" | "below" }
  | { type: "removeBullet"; sectionId: string; entryId: string; bulletId: string }
  | { type: "reorderBullets"; sectionId: string; entryId: string; from: number; to: number }
  | ({
      type: "updateBullet";
      sectionId: string;
      entryId: string;
      bulletId: string;
      value: string;
    } & TextEditOptions)
  // Typeset-editor structural edits (Enter/Backspace inside a bullet or summary
  // paragraph). The caller pre-computes mark-balanced halves / joined text; the
  // reducer owns the new ids so each edit stays one undo step.
  | { type: "splitBullet"; sectionId: string; entryId: string; bulletId: string; before: string; after: string }
  | { type: "mergeBulletUp"; sectionId: string; entryId: string; bulletId: string; joined: string }
  | { type: "splitSummaryParagraph"; sectionId: string; entryId: string; bulletId: string; before: string; after: string }
  | { type: "mergeSummaryParagraphUp"; sectionId: string; entryId: string; joined: string }
  | {
      type: "replaceBulletParagraphs";
      sectionId: string;
      entryId: string;
      bulletId: string;
      values: readonly string[];
    }
  // One edit that spans several fields — a selection crossing paragraphs, or a
  // Select All. The steps run in order against the same document and land as a
  // SINGLE undo step, so one Ctrl+Z restores the whole document rather than
  // walking back field by field.
  | { type: "batch"; steps: Action[] };

// ----- immutable array helpers -----

// Move an item between arbitrary positions. The typeset editor exposes the
// same action through pointer drag and focused-grip Arrow keys.
function reorder<T>(arr: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return arr;
  const next = arr.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

// Both mappers preserve identity when nothing changed (unknown id, or `fn`
// returned its input): `rootReducer` treats `data === state.data` as "no edit",
// so a no-op structural dispatch (same-index drop, boundary arrow-reorder,
// stale id) must not mark the document dirty or push an identical undo step.
function mapSection(data: ResumeData, sectionId: string, fn: (section: ResumeSectionData) => ResumeSectionData): ResumeData {
  let changed = false;
  const sections = data.sections.map((section) => {
    if (section.id !== sectionId) return section;
    const next = fn(section);
    if (next !== section) changed = true;
    return next;
  });
  return changed ? { ...data, sections } : data;
}

function mapEntry(section: ResumeSectionData, entryId: string, fn: (entry: ResumeEntry) => ResumeEntry): ResumeSectionData {
  let changed = false;
  const items = section.items.map((entry) => {
    if (entry.id !== entryId) return entry;
    const next = fn(entry);
    if (next !== entry) changed = true;
    return next;
  });
  return changed ? { ...section, items } : section;
}

// ----- reducer -----

// Exported for the package's co-located structural eval
// (`__evals__/resume-editor-structure.mjs`), not for host consumption.
export function reduceResumeData(data: ResumeData, action: Action): ResumeData {
  switch (action.type) {
    // Each step sees the document the previous step produced, so a caller can
    // rewrite text and then collapse the structure it emptied.
    case "batch":
      return action.steps.reduce(reduceResumeData, data);

    case "createHeader":
      return data.header
        ? data.header.visible
          ? data
          : { ...data, header: { ...data.header, visible: true } }
        : { ...data, header: newDocumentHeader() };

    case "setHeaderVisible":
      if (!data.header) {
        return action.visible ? { ...data, header: newDocumentHeader() } : data;
      }
      return data.header.visible === action.visible
        ? data
        : { ...data, header: { ...data.header, visible: action.visible } };

    case "setHeaderName":
      return data.header
        ? data.header.name === action.value
          ? data
          : { ...data, header: { ...data.header, name: action.value } }
        : { ...data, header: { visible: true, name: action.value, contact: [] } };

    case "removeHeaderName": {
      if (!data.header || data.header.name === null) return data;
      return {
        ...data,
        header: normalizeDocumentHeader({ ...data.header, name: null })
      };
    }
    case "replaceHeader":
      return {
        ...data,
        header: normalizeDocumentHeader(
          action.header
            ? {
              visible: action.header.visible,
              name: action.header.name,
              contact: [...action.header.contact]
            }
            : null
        )
      };
    case "replaceDocument":
      return action.data;

    case "updateContact": {
      if (!data.header || action.index < 0 || action.index >= data.header.contact.length) return data;
      if (data.header.contact[action.index] === action.value) return data;
      return {
        ...data,
        header: {
          ...data.header,
          contact: data.header.contact.map((contact, index) =>
            index === action.index ? action.value : contact
          )
        }
      };
    }
    case "insertContact": {
      const header = data.header ?? { visible: true, name: null, contact: [] };
      const index = Math.max(0, Math.min(action.index, header.contact.length));
      const contact = header.contact.slice();
      contact.splice(index, 0, "");
      return { ...data, header: { ...header, visible: true, contact } };
    }
    case "removeContact": {
      if (!data.header || action.index < 0 || action.index >= data.header.contact.length) return data;
      const contact = data.header.contact.filter((_, index) => index !== action.index);
      return {
        ...data,
        header: normalizeDocumentHeader({ ...data.header, contact })
      };
    }

    case "addSection": {
      const section = newSection(action.sectionType);
      return {
        ...data,
        sections: action.position === "top" ? [section, ...data.sections] : [...data.sections, section]
      };
    }
    case "insertSection": {
      const index = data.sections.findIndex((section) => section.id === action.sectionId);
      if (index < 0) return data;
      const sections = data.sections.slice();
      sections.splice(index + (action.position === "above" ? 0 : 1), 0, newSection(action.sectionType));
      return { ...data, sections };
    }
    case "removeSection": {
      const sections = data.sections.filter((section) => section.id !== action.sectionId);
      return sections.length === data.sections.length ? data : { ...data, sections };
    }
    case "reorderSections": {
      const sections = reorder(data.sections, action.from, action.to);
      return sections === data.sections ? data : { ...data, sections };
    }
    case "setHeading":
      // Heading edits never change the section type — type is set explicitly when
      // the section is added (prevents a rename from hiding an entry's bullets).
      return mapSection(data, action.sectionId, (section) => ({
        ...section,
        heading: action.heading
      }));

    case "insertEntry":
      // Insert a sibling above or below the given entry (the per-row "+" and the
      // right-click "Add entry/skill row above/below"). Defaults to below.
      return mapSection(data, action.sectionId, (section) => {
        const index = section.items.findIndex((entry) => entry.id === action.afterEntryId);
        if (index < 0) return section;
        const items = section.items.slice();
        items.splice(index + (action.position === "above" ? 0 : 1), 0, newEntryForSection(section));
        return { ...section, items };
      });
    case "removeEntry":
      return mapSection(data, action.sectionId, (section) => {
        const items = section.items.filter((entry) => entry.id !== action.entryId);
        return items.length === section.items.length ? section : { ...section, items };
      });
    case "reorderEntries":
      return mapSection(data, action.sectionId, (section) => {
        const items = reorder(section.items, action.from, action.to);
        return items === section.items ? section : { ...section, items };
      });
    case "updateEntry":
      return mapSection(data, action.sectionId, (section) =>
        mapEntry(section, action.entryId, (entry) => ({ ...entry, [action.field]: action.value }))
      );
    case "updateSkillsRow":
      // The painted skills row is one editable field ("Label: skills"), so
      // update both backing columns in one reducer action / undo snapshot.
      return mapSection(data, action.sectionId, (section) =>
        mapEntry(section, action.entryId, (entry) => ({
          ...entry,
          titleLeft: action.label,
          subtitleLeft: action.skills
        }))
      );
    case "setStyleFieldMark":
      return setStyleFieldMark(data, action.field, action.mark, action.on);
    case "setStyleFieldFont":
      return setStyleFieldFont(data, action.field, action.family);
    case "setStyleFieldSize":
      return setStyleFieldSize(data, action.field, action.sizePt);
    case "resetStyleFieldFormatting":
      return resetStyleFieldFormatting(data);
    case "clearAlignmentOverrides":
      if (action.scope === "header") {
        if (!data.header) return data;
        const name = data.header.name === null
          ? null
          : clearAlignmentOverride(data.header.name);
        const contact = data.header.contact.map(clearAlignmentOverride);
        if (
          name === data.header.name
          && contact.every((value, index) => value === data.header?.contact[index])
        ) return data;
        return {
          ...data,
          header: { ...data.header, name, contact }
        };
      }
      if (action.scope === "heading") {
        if (data.sections.every((section) => clearAlignmentOverride(section.heading) === section.heading)) return data;
        return {
          ...data,
          sections: data.sections.map((section) => ({
            ...section,
            heading: clearAlignmentOverride(section.heading)
          }))
        };
      }
      if (data.sections.every((section) => section.items.every((entry) => {
        const skillsUnchanged = section.type !== "skills" || (
          clearAlignmentOverride(entry.titleLeft) === entry.titleLeft
          && clearAlignmentOverride(entry.subtitleLeft) === entry.subtitleLeft
        );
        return skillsUnchanged
          && entry.bullets.every((bullet) => clearAlignmentOverride(bullet.text) === bullet.text);
      }))) return data;
      return {
        ...data,
        sections: data.sections.map((section) => ({
          ...section,
          items: section.items.map((entry) => ({
            ...entry,
            titleLeft: section.type === "skills" ? clearAlignmentOverride(entry.titleLeft) : entry.titleLeft,
            subtitleLeft: section.type === "skills" ? clearAlignmentOverride(entry.subtitleLeft) : entry.subtitleLeft,
            bullets: entry.bullets.map((bullet) => ({
              ...bullet,
              text: clearAlignmentOverride(bullet.text)
            }))
          }))
        }))
      };

    case "addBullet":
      return mapSection(data, action.sectionId, (section) =>
        mapEntry(section, action.entryId, (entry) => ({ ...entry, bullets: [...entry.bullets, newBullet()] }))
      );
    case "insertBullet":
      // Insert above or below the given bullet (the per-row "+", Enter, and the
      // right-click "Add bullet above/below"). Defaults to below.
      return mapSection(data, action.sectionId, (section) =>
        mapEntry(section, action.entryId, (entry) => {
          const index = entry.bullets.findIndex((bullet) => bullet.id === action.afterBulletId);
          if (index < 0) return entry;
          const bullets = entry.bullets.slice();
          bullets.splice(index + (action.position === "above" ? 0 : 1), 0, newBullet());
          return { ...entry, bullets };
        })
      );
    case "removeBullet":
      return mapSection(data, action.sectionId, (section) =>
        mapEntry(section, action.entryId, (entry) => {
          const bullets = entry.bullets.filter((bullet) => bullet.id !== action.bulletId);
          return bullets.length === entry.bullets.length ? entry : { ...entry, bullets };
        })
      );
    case "reorderBullets":
      return mapSection(data, action.sectionId, (section) =>
        mapEntry(section, action.entryId, (entry) => {
          const bullets = reorder(entry.bullets, action.from, action.to);
          return bullets === entry.bullets ? entry : { ...entry, bullets };
        })
      );
    case "updateBullet":
      return mapSection(data, action.sectionId, (section) =>
        mapEntry(section, action.entryId, (entry) => ({
          ...entry,
          bullets: entry.bullets.map((bullet) => (bullet.id === action.bulletId ? { ...bullet, text: action.value } : bullet))
        }))
      );

    case "splitBullet":
      return mapSection(data, action.sectionId, (section) =>
        mapEntry(section, action.entryId, (entry) => {
          const index = entry.bullets.findIndex((bullet) => bullet.id === action.bulletId);
          if (index < 0) return entry;
          const bullets = entry.bullets.slice();
          bullets[index] = { ...bullets[index], text: action.before };
          bullets.splice(index + 1, 0, { ...newBullet(), text: action.after });
          return { ...entry, bullets };
        })
      );
    case "mergeBulletUp":
      return mapSection(data, action.sectionId, (section) =>
        mapEntry(section, action.entryId, (entry) => {
          const index = entry.bullets.findIndex((bullet) => bullet.id === action.bulletId);
          if (index <= 0) return entry;
          const bullets = entry.bullets.slice();
          bullets[index - 1] = { ...bullets[index - 1], text: action.joined };
          bullets.splice(index, 1);
          return { ...entry, bullets };
        })
      );

    case "splitSummaryParagraph":
      return mapSection(data, action.sectionId, (section) => {
        if (section.type !== "summary") return section;
        const index = section.items.findIndex((entry) => entry.id === action.entryId);
        if (index < 0) return section;
        const items = section.items.slice();
        const current = items[index];
        const bulletIndex = current.bullets.findIndex((bullet) => bullet.id === action.bulletId);
        if (bulletIndex < 0) return section;
        const bullets = current.bullets.slice();
        bullets[bulletIndex] = { ...bullets[bulletIndex], text: action.before };
        items[index] = { ...current, bullets };
        items.splice(index + 1, 0, newSummaryEntry(action.after));
        return { ...section, items };
      });

    case "mergeSummaryParagraphUp":
      return mapSection(data, action.sectionId, (section) => {
        if (section.type !== "summary") return section;
        const index = section.items.findIndex((entry) => entry.id === action.entryId);
        if (index <= 0) return section;
        const items = section.items.slice();
        const previous = items[index - 1];
        const previousBullet = previous.bullets[0];
        if (!previousBullet) return section;
        items[index - 1] = {
          ...previous,
          bullets: [{ ...previousBullet, text: action.joined }, ...previous.bullets.slice(1)]
        };
        items.splice(index, 1);
        return { ...section, items };
      });

    case "replaceBulletParagraphs":
      if (action.values.length < 2) return data;
      return mapSection(data, action.sectionId, (section) => {
        const entryIndex = section.items.findIndex((entry) => entry.id === action.entryId);
        if (entryIndex < 0) return section;
        const entry = section.items[entryIndex];
        const bulletIndex = entry.bullets.findIndex((bullet) => bullet.id === action.bulletId);
        if (bulletIndex < 0) return section;
        if (section.type === "summary") {
          const items = section.items.slice();
          const bullets = entry.bullets.slice();
          bullets[bulletIndex] = { ...bullets[bulletIndex], text: action.values[0] };
          items[entryIndex] = { ...entry, bullets };
          items.splice(
            entryIndex + 1,
            0,
            ...action.values.slice(1).map((value) => newSummaryEntry(value))
          );
          return { ...section, items };
        }
        const bullets = entry.bullets.slice();
        bullets[bulletIndex] = { ...bullets[bulletIndex], text: action.values[0] };
        bullets.splice(
          bulletIndex + 1,
          0,
          ...action.values.slice(1).map((value) => ({ ...newBullet(), text: value }))
        );
        const items = section.items.slice();
        items[entryIndex] = { ...entry, bullets };
        return { ...section, items };
      });

    default:
      return data;
  }
}

// The write vocabulary a multi-field edit needs: rewritten values, structural
// paragraph insertion, and removal of rows it emptied. It mirrors FieldSrc so
// the editor's field adapter owns the only translation.
// Writing one field's value. Every field kind has exactly one of these, so a
// caller that maps a field to its write is total.
export type FieldValueEdit =
  | { kind: "name"; value: string }
  | { kind: "contact"; index: number; value: string }
  | { kind: "heading"; sectionId: string; value: string }
  | { kind: "entry"; sectionId: string; entryId: string; field: EntryTextField; value: string }
  | { kind: "bullet"; sectionId: string; entryId: string; bulletId: string; value: string }
  | { kind: "skillsRow"; sectionId: string; entryId: string; label: string; skills: string };

export type FieldEdit =
  | FieldValueEdit
  | { kind: "removeBullet"; sectionId: string; entryId: string; bulletId: string }
  | { kind: "removeEntry"; sectionId: string; entryId: string }
  | {
      kind: "replaceBulletParagraphs";
      sectionId: string;
      entryId: string;
      bulletId: string;
      values: readonly string[];
    };

function actionForFieldEdit(edit: FieldEdit): Action {
  switch (edit.kind) {
    case "name":
      return { type: "setHeaderName", value: edit.value };
    case "contact":
      return { type: "updateContact", index: edit.index, value: edit.value };
    case "heading":
      return { type: "setHeading", sectionId: edit.sectionId, heading: edit.value };
    case "entry":
      return {
        type: "updateEntry",
        sectionId: edit.sectionId,
        entryId: edit.entryId,
        field: edit.field,
        value: edit.value,
        coalesce: false
      };
    case "bullet":
      return {
        type: "updateBullet",
        sectionId: edit.sectionId,
        entryId: edit.entryId,
        bulletId: edit.bulletId,
        value: edit.value,
        coalesce: false
      };
    case "skillsRow":
      return {
        type: "updateSkillsRow",
        sectionId: edit.sectionId,
        entryId: edit.entryId,
        label: edit.label,
        skills: edit.skills
      };
    case "removeBullet":
      return {
        type: "removeBullet",
        sectionId: edit.sectionId,
        entryId: edit.entryId,
        bulletId: edit.bulletId
      };
    case "removeEntry":
      return { type: "removeEntry", sectionId: edit.sectionId, entryId: edit.entryId };
    case "replaceBulletParagraphs":
      return {
        type: "replaceBulletParagraphs",
        sectionId: edit.sectionId,
        entryId: edit.entryId,
        bulletId: edit.bulletId,
        values: edit.values
      };
  }
}

// Exported for the package's co-located structural eval
// (`__evals__/resume-editor-structure.mjs`), not for host consumption.
export function rootReducer(
  state: State,
  action: Action,
  historyClock: HistoryClock
): State {
  if (action.type === "seed") {
    historyClock.reset();
    return {
      data: action.data,
      dirty: false,
      past: [],
      future: [],
      coalesceKey: null,
      coalesceAt: 0,
      coalesceEdge: null,
      coalesceCount: 0
    };
  }
  // Persistence is not an editing gesture. Marking a recovery/autosave clean
  // must not split a held-key typing or deletion transaction.
  if (action.type === "markClean")
    return state.dirty ? { ...state, dirty: false } : state;
  if (action.type === "breakTextHistoryGroup") {
    return state.coalesceKey === null
      ? state
      : { ...state, coalesceKey: null, coalesceEdge: null, coalesceCount: 0 };
  }
  if (!state.data) return state;
  if (action.type === "undo") {
    let index = state.past.length - 1;
    while (
      index >= 0 &&
      !historyClock.isCurrentGeneration(state.past[index]?.generation ?? -1)
    ) {
      index -= 1;
    }
    const entry = state.past[index];
    if (!entry) return state;
    const branch = historyClock.noteUndo(entry.sequence);
    return {
      ...state,
      data: entry.data,
      dirty: true,
      past: state.past.filter((_, pastIndex) => pastIndex !== index),
      future: [
        {
          data: state.data,
          sequence: entry.sequence,
          branch,
          generation: historyClock.currentGeneration()
        },
        ...state.future
      ].slice(0, HISTORY_CAP),
      // Restored snapshots are their own boundary: don't let post-undo typing
      // merge into the group that was just traversed.
      coalesceKey: null,
      coalesceEdge: null,
      coalesceCount: 0
    };
  }
  if (action.type === "redo") {
    const index = state.future.findIndex((entry) =>
      historyClock.isCurrentRedoBranch(entry.branch) &&
      historyClock.isCurrentGeneration(entry.generation)
    );
    if (index < 0) return state;
    const entry = state.future[index];
    if (!entry) return state;
    historyClock.noteRedo(entry.sequence);
    return {
      ...state,
      data: entry.data,
      dirty: true,
      past: [
        ...state.past,
        {
          data: state.data,
          sequence: entry.sequence,
          branch: historyClock.currentBranch(),
          generation: historyClock.currentGeneration()
        }
      ].slice(-HISTORY_CAP),
      future: state.future.filter((_, futureIndex) => futureIndex !== index),
      coalesceKey: null,
      coalesceEdge: null,
      coalesceCount: 0
    };
  }
  const data = reduceResumeData(state.data, action);
  if (data === state.data) return state;
  // Coalesce a run of consecutive same-field edits into one undo step: keep the
  // existing `past` (whose top is the pre-run snapshot) instead of pushing a new
  // one. A new field, a structural edit, or a pause past COALESCE_MS starts a
  // fresh group and pushes a snapshot. Within one burst the run still ends at a
  // word boundary and at the character cap, so undo gives the text back in
  // chunks the writer recognizes.
  const key = coalesceKeyFor(action);
  const now = Date.now();
  // A shared clock prevents content edits from coalescing across a style edit.
  const sequence = historyClock.sequenceFor(state, action);
  const branch = historyClock.currentBranch();
  const generation = historyClock.currentGeneration();
  const previous = state.past[state.past.length - 1];
  const intent = "historyIntent" in action ? action.historyIntent : undefined;
  const text = historyTextFor(action);
  // An edit that did not report its characters still advances the cap by one,
  // so an unreported burst cannot grow without bound either.
  const length = text.length || 1;
  const coalesce =
    key !== null &&
    key === state.coalesceKey &&
    now - state.coalesceAt < COALESCE_MS &&
    previous?.generation === generation &&
    previous?.sequence === sequence - 1 &&
    !startsNewTextGroup(intent, state.coalesceEdge, text) &&
    state.coalesceCount + length <= TEXT_GROUP_CHAR_CAP;
  return {
    data,
    dirty: true,
    past: coalesce
      ? [...state.past.slice(0, -1), { ...previous, sequence, branch, generation }]
      : [
          ...state.past,
          { data: state.data, sequence, branch, generation }
        ].slice(-HISTORY_CAP),
    future: [],
    coalesceKey: key,
    coalesceAt: now,
    coalesceEdge: text ? text[text.length - 1]! : null,
    coalesceCount: coalesce ? state.coalesceCount + length : length
  };
}

// `seedData` is the only load path; callers validate documents before this reducer.
export function useResumeEditor(
  initialData: ResumeData | null = null,
  historyClock?: HistoryClock
) {
  const localHistoryClockRef = useRef<HistoryClock | null>(null);
  if (!localHistoryClockRef.current) localHistoryClockRef.current = createHistoryClock();
  const documentHistoryClock = historyClock ?? localHistoryClockRef.current;
  const reducer = useMemo(
    () => (state: State, action: Action) =>
      rootReducer(state, action, documentHistoryClock),
    [documentHistoryClock]
  );
  const [state, dispatch] = useReducer(reducer, {
    data: initialData,
    dirty: false,
    past: [],
    future: [],
    coalesceKey: null,
    coalesceAt: 0,
    coalesceEdge: null,
    coalesceCount: 0
  });

  const seedData = useCallback((data: ResumeData | null) => {
    dispatch({ type: "seed", data });
  }, []);

  // Persistence clears only the dirty flag; the next edit re-arms it.
  const markClean = useCallback(() => {
    dispatch({ type: "markClean" });
  }, []);

  const actions = useMemo(
    () => ({
      createHeader: () => dispatch({ type: "createHeader" }),
      setHeaderVisible: (visible: boolean) => dispatch({ type: "setHeaderVisible", visible }),
      setHeaderName: (value: string, options?: TextEditOptions) =>
        dispatch({ type: "setHeaderName", value, ...options }),
      removeHeaderName: () => dispatch({ type: "removeHeaderName" }),
      replaceHeader: (header: DocumentHeader | null) =>
        dispatch({ type: "replaceHeader", header }),
      replaceDocument: (data: ResumeData) =>
        dispatch({ type: "replaceDocument", data }),
      updateContact: (index: number, value: string, options?: TextEditOptions) =>
        dispatch({ type: "updateContact", index, value, ...options }),
      insertContact: (index: number) => dispatch({ type: "insertContact", index }),
      removeContact: (index: number) => dispatch({ type: "removeContact", index }),
      addSection: (sectionType: ResumeSectionType, position?: "top" | "bottom") =>
        dispatch({ type: "addSection", sectionType, position }),
      insertSection: (sectionType: ResumeSectionType, sectionId: string, position: "above" | "below") =>
        dispatch({ type: "insertSection", sectionType, sectionId, position }),
      removeSection: (sectionId: string) => dispatch({ type: "removeSection", sectionId }),
      reorderSections: (from: number, to: number) => dispatch({ type: "reorderSections", from, to }),
      setHeading: (
        sectionId: string,
        heading: string,
        options?: TextEditOptions
      ) => dispatch({ type: "setHeading", sectionId, heading, ...options }),
      insertEntry: (sectionId: string, afterEntryId: string, position?: "above" | "below") =>
        dispatch({ type: "insertEntry", sectionId, afterEntryId, position }),
      removeEntry: (sectionId: string, entryId: string) => dispatch({ type: "removeEntry", sectionId, entryId }),
      reorderEntries: (sectionId: string, from: number, to: number) =>
        dispatch({ type: "reorderEntries", sectionId, from, to }),
      updateEntry: (
        sectionId: string,
        entryId: string,
        field: EntryTextField,
        value: string,
        options?: TextEditOptions
      ) => dispatch({ type: "updateEntry", sectionId, entryId, field, value, ...options }),
      updateSkillsRow: (
        sectionId: string,
        entryId: string,
        label: string,
        skills: string,
        options?: TextEditOptions
      ) => dispatch({ type: "updateSkillsRow", sectionId, entryId, label, skills, ...options }),
      setStyleFieldMark: (field: StyleTextField, mark: FieldMark, on: boolean) =>
        dispatch({ type: "setStyleFieldMark", field, mark, on }),
      setStyleFieldFont: (field: StyleTextField, family: FieldFontFamily | "default") =>
        dispatch({ type: "setStyleFieldFont", field, family }),
      setStyleFieldSize: (field: StyleTextField, sizePt: number | "default") =>
        dispatch({ type: "setStyleFieldSize", field, sizePt }),
      resetStyleFieldFormatting: () => dispatch({ type: "resetStyleFieldFormatting" }),
      clearAlignmentOverrides: (scope: AlignmentScope) => dispatch({ type: "clearAlignmentOverrides", scope }),
      addBullet: (sectionId: string, entryId: string) => dispatch({ type: "addBullet", sectionId, entryId }),
      insertBullet: (sectionId: string, entryId: string, afterBulletId: string, position?: "above" | "below") =>
        dispatch({ type: "insertBullet", sectionId, entryId, afterBulletId, position }),
      removeBullet: (sectionId: string, entryId: string, bulletId: string) =>
        dispatch({ type: "removeBullet", sectionId, entryId, bulletId }),
      reorderBullets: (sectionId: string, entryId: string, from: number, to: number) =>
        dispatch({ type: "reorderBullets", sectionId, entryId, from, to }),
      updateBullet: (
        sectionId: string,
        entryId: string,
        bulletId: string,
        value: string,
        options?: TextEditOptions
      ) => dispatch({ type: "updateBullet", sectionId, entryId, bulletId, value, ...options }),
      splitBullet: (sectionId: string, entryId: string, bulletId: string, before: string, after: string) =>
        dispatch({ type: "splitBullet", sectionId, entryId, bulletId, before, after }),
      mergeBulletUp: (sectionId: string, entryId: string, bulletId: string, joined: string) =>
        dispatch({ type: "mergeBulletUp", sectionId, entryId, bulletId, joined }),
      splitSummaryParagraph: (sectionId: string, entryId: string, bulletId: string, before: string, after: string) =>
        dispatch({ type: "splitSummaryParagraph", sectionId, entryId, bulletId, before, after }),
      mergeSummaryParagraphUp: (sectionId: string, entryId: string, joined: string) =>
        dispatch({ type: "mergeSummaryParagraphUp", sectionId, entryId, joined }),
      replaceBulletParagraphs: (
        sectionId: string,
        entryId: string,
        bulletId: string,
        values: readonly string[]
      ) => dispatch({ type: "replaceBulletParagraphs", sectionId, entryId, bulletId, values }),
      // One undoable edit spanning several fields. The caller supplies the
      // rewritten text for every field its selection covered, plus the rows and
      // paragraphs the edit emptied, in the order they must apply.
      applyFieldEdits: (edits: readonly FieldEdit[]) => {
        const steps = edits.map(actionForFieldEdit);
        if (steps.length) dispatch({ type: "batch", steps });
      },
      breakTextHistoryGroup: () => dispatch({ type: "breakTextHistoryGroup" }),
      undo: () => dispatch({ type: "undo" }),
      redo: () => dispatch({ type: "redo" })
    }),
    []
  );

  let undoIndex = state.past.length - 1;
  while (
    undoIndex >= 0 &&
    !documentHistoryClock.isCurrentGeneration(state.past[undoIndex]?.generation ?? -1)
  ) {
    undoIndex -= 1;
  }
  const undoEntry = state.past[undoIndex];
  const redoEntry = state.future.find((entry) =>
    documentHistoryClock.isCurrentRedoBranch(entry.branch) &&
    documentHistoryClock.isCurrentGeneration(entry.generation)
  );

  return {
    editedResume: state.data,
    dirty: state.dirty,
    // Drives the editor's undo/redo gate: a no-op undo/redo must not run the
    // commit pipeline, whose safety-timer nonce bump repaints (a visible flicker
    // when there is nothing to restore).
    canUndo: undoEntry !== undefined,
    canRedo: redoEntry !== undefined,
    undoSequence: (undoEntry?.sequence ?? null) as number | null,
    redoSequence: (redoEntry?.sequence ?? null) as number | null,
    seedData,
    markClean,
    actions
  };
}

export type ResumeEditorActions = ReturnType<typeof useResumeEditor>["actions"];
