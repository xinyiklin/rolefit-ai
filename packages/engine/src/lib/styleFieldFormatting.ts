import type { ResumeData } from "./resumeData.ts";
import type { DocumentStyle } from "./documentStyle.ts";
import { TEXT_SIZES_PT } from "./documentTypography.ts";
import {
  effectiveFieldAlignment,
  effectiveFieldFont,
  fieldMarkState,
  setFieldFont,
  setFieldMark,
  setFieldOuterFont,
  setFieldOuterSize,
  setFieldSize,
  stripInlineMarks,
  fieldMainSizePt,
  type FieldAlignment,
  type FieldFontFamily,
  type FieldFontState,
  type FieldMark
} from "./inlineMarksText.ts";

export type EntryTextField = "titleLeft" | "titleRight" | "subtitleLeft" | "subtitleRight";
export type StyleTextField = EntryTextField | "name" | "sectionHeading" | "skillLabel" | "contact" | "body";
export type StyleFieldMarkStates = Record<StyleTextField, Record<FieldMark, boolean | null>>;
export type StyleFieldFontStates = Record<StyleTextField, FieldFontState>;
export type StyleFieldSizeStates = Record<StyleTextField, number | null>;
export type { FieldFontFamily } from "./inlineMarksText.ts";

// The size a style field renders at when nothing overrides it.
export function styleFieldDefaultSizePt(field: StyleTextField): number {
  return TEXT_SIZES_PT[field];
}

const ENTRY_TEXT_FIELDS: readonly EntryTextField[] = [
  "titleLeft",
  "titleRight",
  "subtitleLeft",
  "subtitleRight"
];

const STYLE_TEXT_FIELDS: readonly StyleTextField[] = [
  "name",
  "sectionHeading",
  ...ENTRY_TEXT_FIELDS,
  "skillLabel",
  "contact",
  "body"
];

export const STYLE_FIELD_MARK_DEFAULTS: Record<StyleTextField, Record<FieldMark, boolean>> = {
  name: { bold: true, italic: false, underline: false },
  sectionHeading: { bold: false, italic: false, underline: false },
  titleLeft: { bold: true, italic: false, underline: false },
  titleRight: { bold: false, italic: false, underline: false },
  subtitleLeft: { bold: false, italic: true, underline: false },
  subtitleRight: { bold: false, italic: true, underline: false },
  skillLabel: { bold: true, italic: false, underline: false },
  contact: { bold: false, italic: false, underline: false },
  body: { bold: false, italic: false, underline: false }
};

// The non-empty values one style field covers across the document.
export function styleFieldValues(data: ResumeData, field: StyleTextField): string[] {
  if (field === "name") {
    const name = data.header?.name ?? null;
    return name !== null && stripInlineMarks(name).trim() ? [name] : [];
  }
  if (field === "contact") {
    return (data.header?.contact ?? []).filter((value) => stripInlineMarks(value).trim());
  }
  if (field === "sectionHeading") {
    return data.sections.map((section) => section.heading).filter((value) => stripInlineMarks(value).trim());
  }
  if (field === "body") {
    // Bullets, summary paragraphs, and the skills after each skill label.
    return data.sections
      .flatMap((section) => section.items.flatMap((entry) =>
        section.type === "skills" ? [entry.subtitleLeft ?? ""] : entry.bullets.map((bullet) => bullet.text)
      ))
      .filter((value) => stripInlineMarks(value).trim());
  }
  if (field === "skillLabel") {
    return data.sections
      .filter((section) => section.type === "skills")
      .flatMap((section) => section.items.map((entry) => entry.titleLeft))
      .filter((value): value is string => value !== null && Boolean(stripInlineMarks(value).trim()));
  }
  return data.sections
    .filter((section) => section.type !== "skills" && section.type !== "summary")
    .flatMap((section) => section.items.map((entry) => entry[field]))
    .filter((value): value is string => value !== null && Boolean(stripInlineMarks(value).trim()));
}

// Apply a per-value text transform to every instance of one style field: the
// section headings, one entry column across standard entries, the skill
// labels, or the body text. Shared by the emphasis and font bulk controls so both walk the same
// fields identically.
function mapStyleField(
  data: ResumeData,
  field: StyleTextField,
  transform: (value: string) => string
): ResumeData {
  if (field === "name") {
    if (data.header?.name === null || data.header?.name === undefined) return data;
    const name = transform(data.header.name);
    return name === data.header.name ? data : { ...data, header: { ...data.header, name } };
  }
  if (field === "contact") {
    if (!data.header) return data;
    let contactChanged = false;
    const contact = data.header.contact.map((value) => {
      const next = transform(value);
      if (next !== value) contactChanged = true;
      return next;
    });
    return contactChanged ? { ...data, header: { ...data.header, contact } } : data;
  }
  let changed = false;
  const sections = data.sections.map((section) => {
    if (field === "body") {
      let sectionChanged = false;
      const items = section.items.map((entry) => {
        if (section.type === "skills") {
          if (entry.subtitleLeft === null) return entry;
          const subtitleLeft = transform(entry.subtitleLeft);
          if (subtitleLeft === entry.subtitleLeft) return entry;
          sectionChanged = true;
          return { ...entry, subtitleLeft };
        }
        let bulletsChanged = false;
        const bullets = entry.bullets.map((bullet) => {
          const text = transform(bullet.text);
          if (text === bullet.text) return bullet;
          bulletsChanged = true;
          return { ...bullet, text };
        });
        if (!bulletsChanged) return entry;
        sectionChanged = true;
        return { ...entry, bullets };
      });
      if (!sectionChanged) return section;
      changed = true;
      return { ...section, items };
    }
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
      const value = entry[entryField];
      if (value === null) return entry;
      const next = transform(value);
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
  return mapStyleField(data, field, (value) =>
    field === "body" ? setFieldOuterFont(value, family) : setFieldFont(value, family)
  );
}

export function setStyleFieldSize(
  data: ResumeData,
  field: StyleTextField,
  sizePt: number | "default"
): ResumeData {
  return mapStyleField(data, field, (value) =>
    field === "body" ? setFieldOuterSize(value, sizePt) : setFieldSize(value, sizePt)
  );
}

export function styleFieldMarkStates(data: ResumeData): StyleFieldMarkStates {
  const marks: FieldMark[] = ["bold", "italic", "underline"];
  return Object.fromEntries(STYLE_TEXT_FIELDS.map((field) => {
    const values = styleFieldValues(data, field);
    return [field, Object.fromEntries(marks.map((mark) => {
      const states = values.map((value) => fieldMarkState(value, mark));
      if (!states.length) return [mark, STYLE_FIELD_MARK_DEFAULTS[field][mark]];
      const first = states[0];
      return [mark, first !== null && states.every((state) => state === first) ? first : null];
    }))];
  })) as StyleFieldMarkStates;
}

// Bidirectional truth per field: the shared resolved family (falling back to the
// document font where unoverridden), or null when the field's instances diverge.
export function styleFieldFontStates(data: ResumeData, documentFont: FieldFontFamily): StyleFieldFontStates {
  return Object.fromEntries(STYLE_TEXT_FIELDS.map((field) => {
    const values = styleFieldValues(data, field);
    if (!values.length) return [field, documentFont];
    const states = values.map((value) => effectiveFieldFont(value, documentFont));
    const first = states[0];
    return [field, first !== null && states.every((state) => state === first) ? first : null];
  })) as StyleFieldFontStates;
}

// Same truth model for size: the shared resolved size (falling back to each
// field's role default), or null when the field's instances diverge.
export function styleFieldSizeStates(data: ResumeData): StyleFieldSizeStates {
  return Object.fromEntries(STYLE_TEXT_FIELDS.map((field) => {
    const fallback = styleFieldDefaultSizePt(field);
    const values = styleFieldValues(data, field);
    if (!values.length) return [field, fallback];
    // A field's main size: the one most of its text carries; words may differ.
    const states = values.map((value) => fieldMainSizePt(value) ?? fallback);
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
        ? [entry.titleLeft ?? "", entry.subtitleLeft ?? ""]
        : entry.bullets.map((bullet) => bullet.text)
    )
  );
  return {
    body: commonAlignment(bodyFields, style.bodyAlign),
    header: commonAlignment(
      resume.header
        ? [
            ...(resume.header.name === null ? [] : [resume.header.name]),
            ...resume.header.contact
          ]
        : [],
      style.headerAlign
    ),
    heading: commonAlignment(resume.sections.map((section) => section.heading), style.headingAlign)
  };
}

// Fields whose emphasis the Styles menu sets as a whole. Body text is left out:
// its bold/italic/underline are per-word choices a whole-field toggle or reset
// would erase; its size and font change only a whole-field wrapper, keeping
// per-word sizes and fonts.
export const STYLE_FIELD_HAS_MARKS: Record<StyleTextField, boolean> = {
  name: true,
  sectionHeading: true,
  titleLeft: true,
  titleRight: true,
  subtitleLeft: true,
  subtitleRight: true,
  skillLabel: true,
  contact: true,
  body: false
};

export function resetStyleFieldFormatting(data: ResumeData): ResumeData {
  let next = data;
  for (const field of STYLE_TEXT_FIELDS) {
    if (STYLE_FIELD_HAS_MARKS[field]) for (const mark of ["bold", "italic", "underline"] as const) {
      next = setStyleFieldMark(next, field, mark, STYLE_FIELD_MARK_DEFAULTS[field][mark]);
    }
    next = setStyleFieldFont(next, field, "default");
    next = setStyleFieldSize(next, field, "default");
  }
  return next;
}
