import { useCallback, useMemo, useReducer } from "react";

import {
  newBullet,
  newEntry,
  newSkillEntry,
  newSummaryEntry,
  newSection,
  parseResumeData,
  serializeResumeData,
  type ResumeData,
  type ResumeEntry,
  type ResumeSectionData,
  type ResumeSectionType
} from "../lib/resumeData";

// New rows match the section's shape: skill row, summary paragraph, or entry.
function newEntryForSection(section: ResumeSectionData): ResumeEntry {
  if (section.type === "skills") return newSkillEntry();
  if (section.type === "summary") return newSummaryEntry();
  return newEntry();
}

export type EntryField = "titleLeft" | "titleRight" | "subtitleLeft" | "subtitleRight";

// `dirty` = the model differs from the last seed (drives autosave, the
// before-unload guard, and reseed confirms). `manualEdited` = the user made a
// FREE-FORM edit, as opposed to accepting/undoing an AI suggestion from the
// review rail. Only manual edits invalidate the AI verdict's provenance, so the
// fit band stays "AI-judged" after applying the very suggestions it reviewed.
type State = { data: ResumeData | null; dirty: boolean; manualEdited: boolean };

type Action =
  | { type: "seed"; data: ResumeData | null }
  | { type: "setName"; name: string }
  | { type: "updateContact"; index: number; value: string }
  | { type: "addContact" }
  | { type: "removeContact"; index: number }
  | { type: "addSection"; sectionType: ResumeSectionType }
  | { type: "removeSection"; sectionId: string }
  | { type: "reorderSections"; from: number; to: number }
  | { type: "setHeading"; sectionId: string; heading: string }
  | { type: "addEntry"; sectionId: string }
  | { type: "insertEntry"; sectionId: string; afterEntryId: string }
  | { type: "removeEntry"; sectionId: string; entryId: string }
  | { type: "reorderEntries"; sectionId: string; from: number; to: number }
  | { type: "updateEntry"; sectionId: string; entryId: string; field: EntryField; value: string; viaSuggestion?: boolean }
  | { type: "addBullet"; sectionId: string; entryId: string }
  | { type: "insertBullet"; sectionId: string; entryId: string; afterBulletId: string }
  | { type: "removeBullet"; sectionId: string; entryId: string; bulletId: string }
  | { type: "reorderBullets"; sectionId: string; entryId: string; from: number; to: number }
  | { type: "updateBullet"; sectionId: string; entryId: string; bulletId: string; value: string; viaSuggestion?: boolean };

// ----- immutable array helpers -----

// Move an item between arbitrary positions. Reordering is drag-only now (the
// dnd-kit grip covers pointer AND keyboard: focus, Space/Enter, arrow keys).
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

function reduce(data: ResumeData, action: Action): ResumeData {
  switch (action.type) {
    case "setName":
      return { ...data, name: action.name };

    case "updateContact":
      return { ...data, contact: data.contact.map((c, i) => (i === action.index ? action.value : c)) };
    case "addContact":
      return { ...data, contact: [...data.contact, ""] };
    case "removeContact":
      return { ...data, contact: data.contact.filter((_, i) => i !== action.index) };

    case "addSection":
      return { ...data, sections: [...data.sections, newSection(action.sectionType)] };
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

    case "addEntry":
      return mapSection(data, action.sectionId, (section) => ({
        ...section,
        items: [...section.items, newEntryForSection(section)]
      }));
    case "insertEntry":
      // Insert a sibling right after the given entry (the per-row "+").
      return mapSection(data, action.sectionId, (section) => {
        const index = section.items.findIndex((entry) => entry.id === action.afterEntryId);
        if (index < 0) return section;
        const items = section.items.slice();
        items.splice(index + 1, 0, newEntryForSection(section));
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

    case "addBullet":
      return mapSection(data, action.sectionId, (section) =>
        mapEntry(section, action.entryId, (entry) => ({ ...entry, bullets: [...entry.bullets, newBullet()] }))
      );
    case "insertBullet":
      // Insert right after the given bullet (the per-row "+", and Enter).
      return mapSection(data, action.sectionId, (section) =>
        mapEntry(section, action.entryId, (entry) => {
          const index = entry.bullets.findIndex((bullet) => bullet.id === action.afterBulletId);
          if (index < 0) return entry;
          const bullets = entry.bullets.slice();
          bullets.splice(index + 1, 0, newBullet());
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

    default:
      return data;
  }
}

function rootReducer(state: State, action: Action): State {
  if (action.type === "seed") return { data: action.data, dirty: false, manualEdited: false };
  if (!state.data) return state;
  const data = reduce(state.data, action);
  if (data === state.data) return state;
  // A change is "manual" unless it is the application of an AI suggestion from
  // the review rail (updateBullet/updateEntry with viaSuggestion). Accepting or
  // undoing a reviewed suggestion must not flip the AI verdict to "Estimated".
  const viaSuggestion =
    (action.type === "updateBullet" || action.type === "updateEntry") && action.viaSuggestion === true;
  return { data, dirty: true, manualEdited: state.manualEdited || !viaSuggestion };
}

// Owns the structured, editable resume model. App seeds it at discrete events
// (a fresh polish, a loaded base resume, a restored pipeline snapshot); every
// inline edit dispatches a mutation and flips `dirty` (and `manualEdited`, unless
// it is a review-rail suggestion application). `serializedResume` is the
// plain-text bridge the scoring/diff/export/print consumers read.
export function useResumeEditor() {
  const [state, dispatch] = useReducer(rootReducer, { data: null, dirty: false, manualEdited: false });

  // Seed from existing plain-text / LaTeX. Pass empty text to clear the editor.
  const seed = useCallback((text: string, sourceText?: string) => {
    const trimmed = text?.trim();
    dispatch({ type: "seed", data: trimmed ? parseResumeData(text, sourceText) : null });
  }, []);

  const seedData = useCallback((data: ResumeData | null) => {
    dispatch({ type: "seed", data });
  }, []);

  const serializedResume = useMemo(() => (state.data ? serializeResumeData(state.data) : ""), [state.data]);

  const actions = useMemo(
    () => ({
      setName: (name: string) => dispatch({ type: "setName", name }),
      updateContact: (index: number, value: string) => dispatch({ type: "updateContact", index, value }),
      addContact: () => dispatch({ type: "addContact" }),
      removeContact: (index: number) => dispatch({ type: "removeContact", index }),
      addSection: (sectionType: ResumeSectionType) => dispatch({ type: "addSection", sectionType }),
      removeSection: (sectionId: string) => dispatch({ type: "removeSection", sectionId }),
      reorderSections: (from: number, to: number) => dispatch({ type: "reorderSections", from, to }),
      setHeading: (sectionId: string, heading: string) => dispatch({ type: "setHeading", sectionId, heading }),
      addEntry: (sectionId: string) => dispatch({ type: "addEntry", sectionId }),
      insertEntry: (sectionId: string, afterEntryId: string) =>
        dispatch({ type: "insertEntry", sectionId, afterEntryId }),
      removeEntry: (sectionId: string, entryId: string) => dispatch({ type: "removeEntry", sectionId, entryId }),
      reorderEntries: (sectionId: string, from: number, to: number) =>
        dispatch({ type: "reorderEntries", sectionId, from, to }),
      updateEntry: (sectionId: string, entryId: string, field: EntryField, value: string, viaSuggestion?: boolean) =>
        dispatch({ type: "updateEntry", sectionId, entryId, field, value, viaSuggestion }),
      addBullet: (sectionId: string, entryId: string) => dispatch({ type: "addBullet", sectionId, entryId }),
      insertBullet: (sectionId: string, entryId: string, afterBulletId: string) =>
        dispatch({ type: "insertBullet", sectionId, entryId, afterBulletId }),
      removeBullet: (sectionId: string, entryId: string, bulletId: string) =>
        dispatch({ type: "removeBullet", sectionId, entryId, bulletId }),
      reorderBullets: (sectionId: string, entryId: string, from: number, to: number) =>
        dispatch({ type: "reorderBullets", sectionId, entryId, from, to }),
      updateBullet: (sectionId: string, entryId: string, bulletId: string, value: string, viaSuggestion?: boolean) =>
        dispatch({ type: "updateBullet", sectionId, entryId, bulletId, value, viaSuggestion })
    }),
    []
  );

  return { editedResume: state.data, dirty: state.dirty, manualEdited: state.manualEdited, serializedResume, seed, seedData, actions };
}

export type ResumeEditorActions = ReturnType<typeof useResumeEditor>["actions"];
