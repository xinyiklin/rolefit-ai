// Adapter between the editor's one-field-at-a-time text model and ResumeData.
// Pure inline editing stays in inlineTextEditing.ts; reducer dispatch stays at
// this explicit domain boundary.

import type { ResumeData } from "@typeset/engine/lib/resumeData.ts";
import { fieldKey, type FieldSrc } from "@typeset/engine/typeset/types.ts";
import type {
  FieldValueEdit,
  TextEditOptions
} from "../../hooks/useResumeEditor";
import { buildDisplayMap, splitValueAt } from "./inlineTextEditing.ts";

type ResumeFieldActions = {
  setHeaderName: (value: string, options?: TextEditOptions) => void;
  updateContact: (index: number, value: string, options?: TextEditOptions) => void;
  setHeading: (sectionId: string, value: string, options?: TextEditOptions) => void;
  updateEntry: (
    sectionId: string,
    entryId: string,
    field: "titleLeft" | "titleRight" | "subtitleLeft" | "subtitleRight",
    value: string,
    options?: TextEditOptions
  ) => void;
  updateBullet: (
    sectionId: string,
    entryId: string,
    bulletId: string,
    value: string,
    options?: TextEditOptions
  ) => void;
  updateSkillsRow: (
    sectionId: string,
    entryId: string,
    label: string,
    skills: string,
    options?: TextEditOptions
  ) => void;
};

function findEntry(data: ResumeData, sectionId: string, entryId: string) {
  const section = data.sections.find((item) => item.id === sectionId);
  return section?.items.find((item) => item.id === entryId) ?? null;
}

export function valueForField(data: ResumeData, src: FieldSrc): string {
  switch (src.kind) {
    case "name":
      return data.header?.name ?? "";
    case "contact":
      return data.header?.contact[src.index] ?? "";
    case "heading":
      return data.sections.find((section) => section.id === src.sectionId)?.heading ?? "";
    case "entry":
      return findEntry(data, src.sectionId, src.entryId)?.[src.field] ?? "";
    case "bullet":
      return findEntry(data, src.sectionId, src.entryId)?.bullets.find((bullet) => bullet.id === src.bulletId)?.text ?? "";
    case "skillsRow": {
      const entry = findEntry(data, src.sectionId, src.entryId);
      if (!entry) return "";
      // Leading whitespace is outside the printable field, but label-end and
      // skills-end whitespace are live typing state and must survive repaint.
      const label = entry.titleLeft.trimStart();
      return label ? `${label}: ${entry.subtitleLeft}` : entry.subtitleLeft;
    }
  }
}

// Write counterpart of valueForField: a pure copy of the data with one field's
// value replaced. Used for RENDER-time overlays (e.g. wrapping a URL word being
// typed in <nolink>) — the stored data is never touched, and commits still go
// through commitField/the reducer. skillsRow's editable value is a join of two
// backing columns, so it is intentionally left as-is here.
export function withFieldValue(data: ResumeData, src: FieldSrc, value: string): ResumeData {
  const mapEntry = (
    entryId: string,
    patch: (entry: ResumeData["sections"][number]["items"][number]) => ResumeData["sections"][number]["items"][number]
  ) =>
    (section: ResumeData["sections"][number]) => ({
      ...section,
      items: section.items.map((entry) => (entry.id === entryId ? patch(entry) : entry))
    });
  switch (src.kind) {
    case "name":
      return data.header
        ? { ...data, header: { ...data.header, name: value } }
        : { ...data, header: { visible: true, name: value, contact: [] } };
    case "contact":
      return data.header
        ? {
            ...data,
            header: {
              ...data.header,
              contact: data.header.contact.map((contact, index) =>
                index === src.index ? value : contact
              )
            }
          }
        : data;
    case "heading":
      return { ...data, sections: data.sections.map((s) => (s.id === src.sectionId ? { ...s, heading: value } : s)) };
    case "entry":
      return {
        ...data,
        sections: data.sections.map((s) =>
          s.id === src.sectionId ? mapEntry(src.entryId, (e) => ({ ...e, [src.field]: value }))(s) : s
        )
      };
    case "bullet":
      return {
        ...data,
        sections: data.sections.map((s) =>
          s.id === src.sectionId
            ? mapEntry(src.entryId, (e) => ({
                ...e,
                bullets: e.bullets.map((b) => (b.id === src.bulletId ? { ...b, text: value } : b))
              }))(s)
            : s
        )
      };
    default:
      return data;
  }
}

function fieldSources(data: ResumeData): FieldSrc[] {
  const sources: FieldSrc[] = [];
  if (data.header?.name !== null && data.header?.name !== undefined) {
    sources.push({ kind: "name" });
  }
  data.header?.contact.forEach((_, index) => sources.push({ kind: "contact", index }));
  for (const section of data.sections) {
    sources.push({ kind: "heading", sectionId: section.id });
    for (const entry of section.items) {
      if (section.type === "skills") {
        sources.push({ kind: "skillsRow", sectionId: section.id, entryId: entry.id });
      } else {
        for (const field of ["titleLeft", "titleRight", "subtitleLeft", "subtitleRight"] as const) {
          sources.push({ kind: "entry", sectionId: section.id, entryId: entry.id, field });
        }
      }
      for (const bullet of entry.bullets) {
        sources.push({ kind: "bullet", sectionId: section.id, entryId: entry.id, bulletId: bullet.id });
      }
    }
  }
  return sources;
}

// Locate the changed field and restored span after an undo/redo snapshot swap.
export function historyCaretTarget(
  before: ResumeData,
  after: ResumeData
): { key: string; valueIndex: number; valueEndIndex?: number } | null {
  const beforeContacts = before.header?.contact ?? [];
  const afterContacts = after.header?.contact ?? [];
  // A missing slot and a restored empty contact both read as "", so field
  // value comparison alone cannot place the caret after the restored divider.
  if (afterContacts.length > beforeContacts.length) {
    let restoredIndex = 0;
    while (
      restoredIndex < beforeContacts.length &&
      beforeContacts[restoredIndex] === afterContacts[restoredIndex]
    ) {
      restoredIndex += 1;
    }
    return {
      key: fieldKey({ kind: "contact", index: restoredIndex }),
      valueIndex: 0
    };
  }

  for (const src of fieldSources(after)) {
    const afterValue = valueForField(after, src);
    const beforeValue = valueForField(before, src);
    if (afterValue === beforeValue) continue;
    const maxCommon = Math.min(afterValue.length, beforeValue.length);
    let prefix = 0;
    while (prefix < maxCommon && afterValue[prefix] === beforeValue[prefix]) prefix += 1;
    let suffix = 0;
    while (
      suffix < maxCommon - prefix &&
      afterValue[afterValue.length - 1 - suffix] === beforeValue[beforeValue.length - 1 - suffix]
    ) {
      suffix += 1;
    }
    const end = afterValue.length - suffix;
    return {
      key: fieldKey(src),
      valueIndex: prefix,
      valueEndIndex: end > prefix ? end : undefined
    };
  }
  return null;
}

// A skills row's editable value joins two backing columns, so a write splits it
// on the label separator. Splitting DISPLAY characters keeps each column's
// inline tags balanced; raw string slicing can strand a closing tag.
function skillsRowColumns(value: string): { label: string; skills: string } {
  const map = buildDisplayMap(value, { preserveWhitespace: true });
  const colon = map.display.indexOf(":");
  if (colon <= 0 || colon > 40) return { label: "", skills: value.trimStart() };
  const serializedSkills = splitValueAt(map, colon + 1).after;
  return {
    label: splitValueAt(map, colon).before.trimStart(),
    skills: serializedSkills.startsWith(" ") ? serializedSkills.slice(1) : serializedSkills
  };
}

// The write for one field, as data. `commitField` dispatches it immediately;
// a selection spanning several fields collects these into one batched edit.
export function fieldEditFor(src: FieldSrc, value: string): FieldValueEdit {
  switch (src.kind) {
    case "name":
      return { kind: "name", value };
    case "contact":
      return { kind: "contact", index: src.index, value };
    case "heading":
      return { kind: "heading", sectionId: src.sectionId, value };
    case "entry":
      return { kind: "entry", sectionId: src.sectionId, entryId: src.entryId, field: src.field, value };
    case "bullet":
      return {
        kind: "bullet",
        sectionId: src.sectionId,
        entryId: src.entryId,
        bulletId: src.bulletId,
        value
      };
    case "skillsRow":
      return { kind: "skillsRow", sectionId: src.sectionId, entryId: src.entryId, ...skillsRowColumns(value) };
  }
}

export function commitField(
  actions: ResumeFieldActions,
  src: FieldSrc,
  value: string,
  options: TextEditOptions = { coalesce: false }
): void {
  const edit = fieldEditFor(src, value);
  switch (edit.kind) {
    case "name":
      return actions.setHeaderName(edit.value, options);
    case "contact":
      return actions.updateContact(edit.index, edit.value, options);
    case "heading":
      return actions.setHeading(edit.sectionId, edit.value, options);
    case "entry":
      return actions.updateEntry(
        edit.sectionId,
        edit.entryId,
        edit.field,
        edit.value,
        options
      );
    case "bullet":
      return actions.updateBullet(
        edit.sectionId,
        edit.entryId,
        edit.bulletId,
        edit.value,
        options
      );
    case "skillsRow":
      return actions.updateSkillsRow(
        edit.sectionId,
        edit.entryId,
        edit.label,
        edit.skills,
        options
      );
  }
}
