// Adapter between the editor's one-field-at-a-time text model and ResumeData.
// Pure inline editing stays in inlineTextEditing.ts; reducer dispatch stays at
// this explicit domain boundary.

import type { ResumeData } from "@typeset/engine/lib/resumeData";
import { fieldKey, type FieldSrc } from "@typeset/engine/typeset/types";
import { buildDisplayMap, splitValueAt } from "./inlineTextEditing.ts";

type ResumeFieldActions = {
  setName: (value: string) => void;
  updateContact: (index: number, value: string) => void;
  setHeading: (sectionId: string, value: string) => void;
  updateEntry: (
    sectionId: string,
    entryId: string,
    field: "titleLeft" | "titleRight" | "subtitleLeft" | "subtitleRight",
    value: string
  ) => void;
  updateBullet: (sectionId: string, entryId: string, bulletId: string, value: string) => void;
  updateSkillsRow: (sectionId: string, entryId: string, label: string, skills: string) => void;
};

function findEntry(data: ResumeData, sectionId: string, entryId: string) {
  const section = data.sections.find((item) => item.id === sectionId);
  return section?.items.find((item) => item.id === entryId) ?? null;
}

export function valueForField(data: ResumeData, src: FieldSrc): string {
  switch (src.kind) {
    case "name":
      return data.name;
    case "contact":
      return data.contact[src.index] ?? "";
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
      return { ...data, name: value };
    case "contact":
      return { ...data, contact: data.contact.map((v, i) => (i === src.index ? value : v)) };
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
  const sources: FieldSrc[] = [{ kind: "name" }];
  data.contact.forEach((_, index) => sources.push({ kind: "contact", index }));
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

export function commitField(actions: ResumeFieldActions, src: FieldSrc, value: string): void {
  switch (src.kind) {
    case "name":
      actions.setName(value);
      return;
    case "contact":
      actions.updateContact(src.index, value);
      return;
    case "heading":
      actions.setHeading(src.sectionId, value);
      return;
    case "entry":
      actions.updateEntry(src.sectionId, src.entryId, src.field, value);
      return;
    case "bullet":
      actions.updateBullet(src.sectionId, src.entryId, src.bulletId, value);
      return;
    case "skillsRow": {
      const map = buildDisplayMap(value, { preserveWhitespace: true });
      const colon = map.display.indexOf(":");
      if (colon > 0 && colon <= 40) {
        // Split display characters so each stored field receives balanced inline
        // tags. Raw string slicing can strand a closing format tag on one side.
        const label = splitValueAt(map, colon).before.trimStart();
        const serializedSkills = splitValueAt(map, colon + 1).after;
        const skills = serializedSkills.startsWith(" ") ? serializedSkills.slice(1) : serializedSkills;
        actions.updateSkillsRow(src.sectionId, src.entryId, label, skills);
      } else {
        actions.updateSkillsRow(src.sectionId, src.entryId, "", value.trimStart());
      }
    }
  }
}
