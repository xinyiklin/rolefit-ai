import { useCallback, useMemo, useReducer } from "react";

import {
  newBullet,
  newEntry,
  newSkillEntry,
  newSummaryEntry,
  newSection,
  type ResumeData,
  type ResumeEntry,
  type ResumeSectionData,
  type ResumeSectionType
} from "@typeset/engine/lib/resumeData";
import {
  clearAlignmentOverride,
  type FieldFontFamily,
  type FieldMark
} from "@typeset/engine/lib/inlineMarksText";
import type { AlignmentScope } from "@typeset/engine/lib/documentStyle";
import {
  resetStyleFieldFormatting,
  setStyleFieldFont,
  setStyleFieldMark,
  setStyleFieldSize,
  type EntryTextField,
  type StyleTextField
} from "@typeset/engine/lib/styleFieldFormatting";

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
// to the SAME field into ONE undo step: typing a sentence, then ⌘Z, reverts the
// whole run rather than one character at a time. A different field, a structural
// edit, a pause, or an undo/redo starts a fresh group.
type State = {
  data: ResumeData | null;
  dirty: boolean;
  past: ResumeData[];
  future: ResumeData[];
  coalesceKey: string | null;
  coalesceAt: number;
};

const HISTORY_CAP = 100;
// Consecutive same-field edits within this window merge into one undo step; a
// longer pause closes the group so the next keystroke is separately undoable.
const COALESCE_MS = 700;

// The undo-group signature for a text edit, or null for structural operations
// that must always be their own undo step.
function coalesceKeyFor(action: Action): string | null {
  switch (action.type) {
    case "setName":
      return "name";
    case "updateContact":
      return `contact:${action.index}`;
    case "setHeading":
      return `heading:${action.sectionId}`;
    case "updateEntry":
      return `entry:${action.sectionId}:${action.entryId}:${action.field}`;
    case "updateSkillsRow":
      return `skills:${action.sectionId}:${action.entryId}`;
    case "updateBullet":
      return `bullet:${action.sectionId}:${action.entryId}:${action.bulletId}`;
    default:
      return null;
  }
}

type Action =
  | { type: "seed"; data: ResumeData | null }
  | { type: "markClean" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "setName"; name: string }
  | { type: "updateContact"; index: number; value: string }
  | { type: "addContact" }
  | { type: "removeContact"; index: number }
  | { type: "addSection"; sectionType: ResumeSectionType; position?: "top" | "bottom" }
  | { type: "insertSection"; sectionType: ResumeSectionType; sectionId: string; position: "above" | "below" }
  | { type: "removeSection"; sectionId: string }
  | { type: "reorderSections"; from: number; to: number }
  | { type: "setHeading"; sectionId: string; heading: string }
  | { type: "insertEntry"; sectionId: string; afterEntryId: string; position?: "above" | "below" }
  | { type: "removeEntry"; sectionId: string; entryId: string }
  | { type: "reorderEntries"; sectionId: string; from: number; to: number }
  | { type: "updateEntry"; sectionId: string; entryId: string; field: EntryTextField; value: string }
  | { type: "updateSkillsRow"; sectionId: string; entryId: string; label: string; skills: string }
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
  | { type: "updateBullet"; sectionId: string; entryId: string; bulletId: string; value: string }
  // Typeset-editor structural edits (Enter/Backspace inside a bullet or summary
  // paragraph). The caller pre-computes mark-balanced halves / joined text; the
  // reducer owns the new ids so each edit stays one undo step.
  | { type: "splitBullet"; sectionId: string; entryId: string; bulletId: string; before: string; after: string }
  | { type: "mergeBulletUp"; sectionId: string; entryId: string; bulletId: string; joined: string }
  | { type: "splitSummaryParagraph"; sectionId: string; entryId: string; bulletId: string; before: string; after: string }
  | { type: "mergeSummaryParagraphUp"; sectionId: string; entryId: string; joined: string };

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

function mapSection(data: ResumeData, sectionId: string, fn: (section: ResumeSectionData) => ResumeSectionData): ResumeData {
  return { ...data, sections: data.sections.map((section) => (section.id === sectionId ? fn(section) : section)) };
}

function mapEntry(section: ResumeSectionData, entryId: string, fn: (entry: ResumeEntry) => ResumeEntry): ResumeSectionData {
  return { ...section, items: section.items.map((entry) => (entry.id === entryId ? fn(entry) : entry)) };
}

// ----- reducer -----

function reduceResumeData(data: ResumeData, action: Action): ResumeData {
  switch (action.type) {
    case "setName":
      return { ...data, name: action.name };

    case "updateContact":
      return { ...data, contact: data.contact.map((c, i) => (i === action.index ? action.value : c)) };
    case "addContact":
      return { ...data, contact: [...data.contact, ""] };
    case "removeContact":
      return { ...data, contact: data.contact.filter((_, i) => i !== action.index) };

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
    case "removeSection":
      return { ...data, sections: data.sections.filter((section) => section.id !== action.sectionId) };
    case "reorderSections":
      return { ...data, sections: reorder(data.sections, action.from, action.to) };
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
      return mapSection(data, action.sectionId, (section) => ({
        ...section,
        items: section.items.filter((entry) => entry.id !== action.entryId)
      }));
    case "reorderEntries":
      return mapSection(data, action.sectionId, (section) => ({
        ...section,
        items: reorder(section.items, action.from, action.to)
      }));
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
        if (
          clearAlignmentOverride(data.name) === data.name
          && data.contact.every((value) => clearAlignmentOverride(value) === value)
        ) return data;
        return {
          ...data,
          name: clearAlignmentOverride(data.name),
          contact: data.contact.map(clearAlignmentOverride)
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
        mapEntry(section, action.entryId, (entry) => ({
          ...entry,
          bullets: entry.bullets.filter((bullet) => bullet.id !== action.bulletId)
        }))
      );
    case "reorderBullets":
      return mapSection(data, action.sectionId, (section) =>
        mapEntry(section, action.entryId, (entry) => ({
          ...entry,
          bullets: reorder(entry.bullets, action.from, action.to)
        }))
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

    default:
      return data;
  }
}

function rootReducer(state: State, action: Action): State {
  if (action.type === "seed")
    return { data: action.data, dirty: false, past: [], future: [], coalesceKey: null, coalesceAt: 0 };
  // Mark the model as saved without reseeding. Undo history remains useful, but
  // the next edit starts a new coalescing group.
  if (action.type === "markClean")
    return state.dirty ? { ...state, dirty: false, coalesceKey: null } : state;
  if (!state.data) return state;
  if (action.type === "undo") {
    if (!state.past.length) return state;
    const data = state.past[state.past.length - 1];
    return {
      ...state,
      data,
      dirty: true,
      past: state.past.slice(0, -1),
      future: [state.data, ...state.future].slice(0, HISTORY_CAP),
      // Restored snapshots are their own boundary: don't let post-undo typing
      // merge into the group that was just traversed.
      coalesceKey: null
    };
  }
  if (action.type === "redo") {
    if (!state.future.length) return state;
    const [data, ...future] = state.future;
    return {
      ...state,
      data,
      dirty: true,
      past: [...state.past, state.data].slice(-HISTORY_CAP),
      future,
      coalesceKey: null
    };
  }
  const data = reduceResumeData(state.data, action);
  if (data === state.data) return state;
  // Coalesce a run of consecutive same-field edits into one undo step: keep the
  // existing `past` (whose top is the pre-run snapshot) instead of pushing a new
  // one. A new field, a structural edit, or a pause past COALESCE_MS starts a
  // fresh group and pushes a snapshot.
  const key = coalesceKeyFor(action);
  const now = Date.now();
  const coalesce = key !== null && key === state.coalesceKey && now - state.coalesceAt < COALESCE_MS;
  return {
    data,
    dirty: true,
    past: coalesce ? state.past : [...state.past, state.data].slice(-HISTORY_CAP),
    future: [],
    coalesceKey: key,
    coalesceAt: now
  };
}

// Owns the structured, editable resume model. `seedData` is the only load path:
// startup snapshots and opened `.resume` files are validated before reaching
// the reducer. Every inline edit is structured and undoable.
export function useResumeEditor() {
  const [state, dispatch] = useReducer(rootReducer, {
    data: null,
    dirty: false,
    past: [],
    future: [],
    coalesceKey: null,
    coalesceAt: 0
  });

  const seedData = useCallback((data: ResumeData | null) => {
    dispatch({ type: "seed", data });
  }, []);

  // Clear the dirty flag after the work is safely persisted (Apply/export) so the
  // before-unload guard stops warning — see the reducer note. Editor content is
  // untouched, so editing again re-arms the guard.
  const markClean = useCallback(() => {
    dispatch({ type: "markClean" });
  }, []);

  const actions = useMemo(
    () => ({
      setName: (name: string) => dispatch({ type: "setName", name }),
      updateContact: (index: number, value: string) => dispatch({ type: "updateContact", index, value }),
      addContact: () => dispatch({ type: "addContact" }),
      removeContact: (index: number) => dispatch({ type: "removeContact", index }),
      addSection: (sectionType: ResumeSectionType, position?: "top" | "bottom") =>
        dispatch({ type: "addSection", sectionType, position }),
      insertSection: (sectionType: ResumeSectionType, sectionId: string, position: "above" | "below") =>
        dispatch({ type: "insertSection", sectionType, sectionId, position }),
      removeSection: (sectionId: string) => dispatch({ type: "removeSection", sectionId }),
      reorderSections: (from: number, to: number) => dispatch({ type: "reorderSections", from, to }),
      setHeading: (sectionId: string, heading: string) => dispatch({ type: "setHeading", sectionId, heading }),
      insertEntry: (sectionId: string, afterEntryId: string, position?: "above" | "below") =>
        dispatch({ type: "insertEntry", sectionId, afterEntryId, position }),
      removeEntry: (sectionId: string, entryId: string) => dispatch({ type: "removeEntry", sectionId, entryId }),
      reorderEntries: (sectionId: string, from: number, to: number) =>
        dispatch({ type: "reorderEntries", sectionId, from, to }),
      updateEntry: (sectionId: string, entryId: string, field: EntryTextField, value: string) =>
        dispatch({ type: "updateEntry", sectionId, entryId, field, value }),
      updateSkillsRow: (sectionId: string, entryId: string, label: string, skills: string) =>
        dispatch({ type: "updateSkillsRow", sectionId, entryId, label, skills }),
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
      updateBullet: (sectionId: string, entryId: string, bulletId: string, value: string) =>
        dispatch({ type: "updateBullet", sectionId, entryId, bulletId, value }),
      splitBullet: (sectionId: string, entryId: string, bulletId: string, before: string, after: string) =>
        dispatch({ type: "splitBullet", sectionId, entryId, bulletId, before, after }),
      mergeBulletUp: (sectionId: string, entryId: string, bulletId: string, joined: string) =>
        dispatch({ type: "mergeBulletUp", sectionId, entryId, bulletId, joined }),
      splitSummaryParagraph: (sectionId: string, entryId: string, bulletId: string, before: string, after: string) =>
        dispatch({ type: "splitSummaryParagraph", sectionId, entryId, bulletId, before, after }),
      mergeSummaryParagraphUp: (sectionId: string, entryId: string, joined: string) =>
        dispatch({ type: "mergeSummaryParagraphUp", sectionId, entryId, joined }),
      undo: () => dispatch({ type: "undo" }),
      redo: () => dispatch({ type: "redo" })
    }),
    []
  );

  return {
    editedResume: state.data,
    dirty: state.dirty,
    // Drives the editor's undo/redo gate: a no-op undo/redo must not run the
    // commit pipeline, whose safety-timer nonce bump repaints (a visible flicker
    // when there is nothing to restore).
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    seedData,
    markClean,
    actions
  };
}

export type ResumeEditorActions = ReturnType<typeof useResumeEditor>["actions"];
