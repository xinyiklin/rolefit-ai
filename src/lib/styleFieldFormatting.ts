import type { ResumeData } from "./resumeData.ts";
import type { DocumentStyle } from "./documentStyle.ts";
import { fontSizesFor } from "./documentTypography.ts";
import {
  effectiveFieldAlignment,
  effectiveFieldFont,
  effectiveFieldSize,
  fieldMarkState,
  setFieldFont,
  setFieldMark,
  setFieldSize,
  stripInlineMarks,
  type FieldAlignment,
  type FieldFontFamily,
  type FieldFontState,
  type FieldMark
} from "./inlineMarksText.ts";

export type EntryTextField = "titleLeft" | "titleRight" | "subtitleLeft" | "subtitleRight";
export type StyleTextField = EntryTextField | "sectionHeading" | "skillLabel" | "contact";
export type StyleFieldMarkStates = Record<StyleTextField, Record<FieldMark, boolean | null>>;
export type StyleFieldFontStates = Record<StyleTextField, FieldFontState>;
export type StyleFieldSizeStates = Record<StyleTextField, number | null>;
export type { FieldFontFamily } from "./inlineMarksText.ts";

// Each style field renders at a size derived from the document base size (the
// same hierarchy the engine uses in defaultFontSizeForField): headings large,
// entry titles normalsize, everything else small. This is the fallback the
// per-field size control resolves to when nothing overrides it.
export function styleFieldDefaultSizePt(field: StyleTextField, baseFontSizePt: number): number {
  const sizes = fontSizesFor(baseFontSizePt);
  if (field === "sectionHeading") return sizes.large;
  if (field === "titleLeft" || field === "titleRight") return sizes.normalsize;
  return sizes.small;
}

const ENTRY_TEXT_FIELDS: readonly EntryTextField[] = [
  "titleLeft",
  "titleRight",
  "subtitleLeft",
  "subtitleRight"
];

const STYLE_TEXT_FIELDS: readonly StyleTextField[] = [
  "sectionHeading",
  ...ENTRY_TEXT_FIELDS,
  "skillLabel",
  "contact"
];

export const STYLE_FIELD_MARK_DEFAULTS: Record<StyleTextField, Record<FieldMark, boolean>> = {
  sectionHeading: { bold: false, italic: false, underline: false },
  titleLeft: { bold: true, italic: false, underline: false },
  titleRight: { bold: false, italic: false, underline: false },
  subtitleLeft: { bold: false, italic: true, underline: false },
  subtitleRight: { bold: false, italic: true, underline: false },
  skillLabel: { bold: true, italic: false, underline: false },
  contact: { bold: false, italic: false, underline: false }
};

function valuesForStyleField(data: ResumeData, field: StyleTextField): string[] {
  if (field === "contact") {
    return data.contact.filter((value) => stripInlineMarks(value).trim());
  }
  if (field === "sectionHeading") {
    return data.sections.map((section) => section.heading).filter((value) => stripInlineMarks(value).trim());
  }
  if (field === "skillLabel") {
    return data.sections
      .filter((section) => section.type === "skills")
      .flatMap((section) => section.items.map((entry) => entry.titleLeft))
      .filter((value) => stripInlineMarks(value).trim());
  }
  return data.sections
    .filter((section) => section.type !== "skills" && section.type !== "summary")
    .flatMap((section) => section.items.map((entry) => entry[field]))
    .filter((value) => stripInlineMarks(value).trim());
}

// Apply a per-value text transform to every instance of one style field: the
// section headings, one entry column across standard entries, or the skill
// labels. Shared by the emphasis and font bulk controls so both walk the same
// fields identically.
function mapStyleField(
  data: ResumeData,
  field: StyleTextField,
  transform: (value: string) => string
): ResumeData {
  if (field === "contact") {
    let contactChanged = false;
    const contact = data.contact.map((value) => {
      const next = transform(value);
      if (next !== value) contactChanged = true;
      return next;
    });
    return contactChanged ? { ...data, contact } : data;
  }
  let changed = false;
  const sections = data.sections.map((section) => {
    if (field === "sectionHeading") {
      const heading = transform(section.heading);
      if (heading === section.heading) return section;
      changed = true;
      return { ...section, heading };
    }
    if (field === "skillLabel") {
      if (section.type !== "skills") return section;
    } else if (section.type === "skills" || section.type === "summary") {
      return section;
    }
    const entryField = field === "skillLabel" ? "titleLeft" : field;
    let sectionChanged = false;
    const items = section.items.map((entry) => {
      const next = transform(entry[entryField]);
      if (next === entry[entryField]) return entry;
      changed = true;
      sectionChanged = true;
      return { ...entry, [entryField]: next };
    });
    return sectionChanged ? { ...section, items } : section;
  });
  return changed ? { ...data, sections } : data;
}

export function setStyleFieldMark(
  data: ResumeData,
  field: StyleTextField,
  mark: FieldMark,
  on: boolean
): ResumeData {
  return mapStyleField(data, field, (value) => setFieldMark(value, mark, on));
}

export function setStyleFieldFont(
  data: ResumeData,
  field: StyleTextField,
  family: FieldFontFamily | "default"
): ResumeData {
  return mapStyleField(data, field, (value) => setFieldFont(value, family));
}

export function setStyleFieldSize(
  data: ResumeData,
  field: StyleTextField,
  sizePt: number | "default"
): ResumeData {
  return mapStyleField(data, field, (value) => setFieldSize(value, sizePt));
}

export function styleFieldMarkStates(data: ResumeData): StyleFieldMarkStates {
  const marks: FieldMark[] = ["bold", "italic", "underline"];
  return Object.fromEntries(STYLE_TEXT_FIELDS.map((field) => {
    const values = valuesForStyleField(data, field);
    return [field, Object.fromEntries(marks.map((mark) => {
      const states = values.map((value) => fieldMarkState(value, mark));
      if (!states.length) return [mark, false];
      const first = states[0];
      return [mark, first !== null && states.every((state) => state === first) ? first : null];
    }))];
  })) as StyleFieldMarkStates;
}

// Bidirectional truth per field: the shared resolved family (falling back to the
// document font where unoverridden), or null when the field's instances diverge.
export function styleFieldFontStates(data: ResumeData, documentFont: FieldFontFamily): StyleFieldFontStates {
  return Object.fromEntries(STYLE_TEXT_FIELDS.map((field) => {
    const values = valuesForStyleField(data, field);
    if (!values.length) return [field, documentFont];
    const states = values.map((value) => effectiveFieldFont(value, documentFont));
    const first = states[0];
    return [field, first !== null && states.every((state) => state === first) ? first : null];
  })) as StyleFieldFontStates;
}

// Same truth model for size: the shared resolved size (falling back to each
// field's role default), or null when the field's instances diverge.
export function styleFieldSizeStates(data: ResumeData, baseFontSizePt: number): StyleFieldSizeStates {
  return Object.fromEntries(STYLE_TEXT_FIELDS.map((field) => {
    const fallback = styleFieldDefaultSizePt(field, baseFontSizePt);
    const values = valuesForStyleField(data, field);
    if (!values.length) return [field, fallback];
    const states = values.map((value) => effectiveFieldSize(value, fallback));
    const first = states[0];
    return [field, first !== null && states.every((state) => state === first) ? first : null];
  })) as StyleFieldSizeStates;
}

// The alignment every instance of a scope's fields agrees on (resolving to the
// document default where nothing overrides), or null when instances diverge —
// the same truth model as the font/size/mark states above.
function commonAlignment(values: string[], fallback: FieldAlignment): FieldAlignment | null {
  const alignments = values
    .filter((value) => stripInlineMarks(value).trim())
    .map((value) => effectiveFieldAlignment(value, fallback));
  if (!alignments.length) return fallback;
  const first = alignments[0];
  return first && alignments.every((alignment) => alignment === first) ? first : null;
}

// Document-wide alignment state per scope (body / header / heading), consumed
// by the toolbar's global alignment pickers.
export function globalAlignmentState(resume: ResumeData, style: DocumentStyle) {
  const bodyFields = resume.sections.flatMap((section) =>
    section.items.flatMap((entry) =>
      section.type === "skills"
        ? [entry.titleLeft, entry.subtitleLeft]
        : entry.bullets.map((bullet) => bullet.text)
    )
  );
  return {
    body: commonAlignment(bodyFields, style.bodyAlign),
    header: commonAlignment([resume.name, ...resume.contact], style.headerAlign),
    heading: commonAlignment(resume.sections.map((section) => section.heading), style.headingAlign)
  };
}

export function resetStyleFieldFormatting(data: ResumeData): ResumeData {
  let next = data;
  for (const field of STYLE_TEXT_FIELDS) {
    for (const mark of ["bold", "italic", "underline"] as const) {
      next = setStyleFieldMark(next, field, mark, STYLE_FIELD_MARK_DEFAULTS[field][mark]);
    }
    next = setStyleFieldFont(next, field, "default");
    next = setStyleFieldSize(next, field, "default");
  }
  return next;
}
