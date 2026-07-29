import {
  newBullet,
  newEntry,
  newSection,
  newSkillEntry,
  newSummaryEntry,
  type DocumentHeader,
  type ResumeData,
  type ResumeEntry,
  type ResumeSectionType
} from "./resumeData.ts";
import {
  DOC_STYLE_BOUNDS,
  FONT_FAMILY_OPTIONS,
  toDocumentStyle,
  type DocStyle,
  type DocumentStyle
} from "./documentStyle.ts";
import {
  assertJsonFileSize,
  parseJsonFile,
  serializeJsonFile
} from "./jsonFileCodec.ts";

export const RESUME_FILE_MAGIC = "typeset-resume" as const;
export const RESUME_FILE_SCHEMA_VERSION = 1 as const;
export const MAX_RESUME_FILE_BYTES = 2 * 1024 * 1024;

type PortableResumeBullet = { text: string };

type PortableResumeEntry = {
  titleLeft: string;
  titleRight: string;
  subtitleLeft: string;
  subtitleRight: string;
  bullets: PortableResumeBullet[];
};

type PortableResumeSection = {
  heading: string;
  type: ResumeSectionType;
  items: PortableResumeEntry[];
};

export type PortableResumeDocumentV1 = {
  header: DocumentHeader | null;
  sections: PortableResumeSection[];
};

export type ResumeFileV1 = {
  format: typeof RESUME_FILE_MAGIC;
  schemaVersion: typeof RESUME_FILE_SCHEMA_VERSION;
  document: PortableResumeDocumentV1;
  // The marker states which spacing model the numbers are on. It is written on
  // every save and stays optional on read, so schemaVersion 1 still describes
  // both the files this build writes and the ones written before it.
  style: DocumentStyle & { spacingModel: "absolute" };
};

export type ParsedResumeFile = {
  data: ResumeData;
  documentStyle: DocumentStyle;
};

export type ResumeFileErrorCode =
  | "too-large"
  | "invalid-json"
  | "invalid-format"
  | "unsupported-version"
  | "invalid-document"
  | "invalid-style";

export class ResumeFileError extends Error {
  readonly code: ResumeFileErrorCode;

  constructor(code: ResumeFileErrorCode, message: string) {
    super(message);
    this.name = "ResumeFileError";
    this.code = code;
  }
}

type JsonRecord = Record<string, unknown>;

const DOCUMENT_KEYS = ["header", "sections"] as const;
const HEADER_KEYS = ["visible", "name", "contact"] as const;
const SECTION_KEYS = ["heading", "type", "items"] as const;
const ENTRY_KEYS = ["titleLeft", "titleRight", "subtitleLeft", "subtitleRight", "bullets"] as const;
const BULLET_KEYS = ["text"] as const;
const STYLE_KEYS = [
  "fontFamily",
  "baseFontSizePt",
  "lineHeight",
  "entryIndentPt",
  "entryEndIndentPt",
  "nameContactGapPt",
  "contactGapPt",
  "headerSectionGapPt",
  "sectionGapPt",
  "sectionEntryGapPt",
  "entryGapPt",
  "titleSubGapPt",
  "headBulletGapPt",
  "skillsRowGapPt",
  "bulletGapPt",
  "headingCase",
  "sectionRule",
  "contactDivider",
  "headerAlign",
  "bodyAlign",
  "headingAlign",
  "pageMarginTopPt",
  "pageMarginRightPt",
  "pageMarginBottomPt",
  "pageMarginLeftPt",
  // Which spacing model the numbers above are on. Required: a file without it
  // predates absolute spacing and is not a v1 file.
  "spacingModel"
] as const satisfies readonly (keyof DocumentStyle | "spacingModel")[];

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validationCode(path: string): ResumeFileErrorCode {
  return path === "file" ? "invalid-format" : path.startsWith("style") ? "invalid-style" : "invalid-document";
}

function invalid(path: string, detail: string): never {
  throw new ResumeFileError(validationCode(path), `Invalid resume file: ${path} ${detail}.`);
}

function requireRecord(value: unknown, path: string): JsonRecord {
  if (!isRecord(value)) invalid(path, "must be an object");
  return value;
}

function requireExactKeys(
  record: JsonRecord,
  keys: readonly string[],
  path: string,
  optionalKeys: readonly string[] = []
) {
  const allowed = new Set([...keys, ...optionalKeys]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) invalid(path, `contains unsupported field ${JSON.stringify(key)}`);
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) invalid(path, `is missing required field ${JSON.stringify(key)}`);
  }
}

function requireString(value: unknown, path: string, maxLength = 100_000): string {
  if (typeof value !== "string") invalid(path, "must be a string");
  if (value.length > maxLength) invalid(path, `must be at most ${maxLength.toLocaleString()} characters`);
  return value;
}

function requireArray(value: unknown, path: string, maxLength: number): unknown[] {
  if (!Array.isArray(value)) invalid(path, "must be an array");
  if (value.length > maxLength) invalid(path, `must contain at most ${maxLength.toLocaleString()} items`);
  return value;
}

function requireNumber(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) invalid(path, "must be a finite number");
  if (value < min || value > max) invalid(path, `must be between ${min} and ${max}`);
  return value;
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalid(path, "must be true or false");
  return value;
}

function requireEnum<T extends string>(value: unknown, values: readonly T[], path: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    invalid(path, `must be one of ${values.map((item) => JSON.stringify(item)).join(", ")}`);
  }
  return value as T;
}

function validateContact(value: unknown, path: string): string[] {
  return requireArray(value, path, 1_000).map((item, index) =>
    requireString(item, `${path}[${index}]`, 10_000)
  );
}

function validateHeader(value: unknown, path: string): DocumentHeader | null {
  if (value === null) return null;
  const header = requireRecord(value, path);
  requireExactKeys(header, HEADER_KEYS, path);
  const validated = {
    visible: requireBoolean(header.visible, `${path}.visible`),
    name: header.name === null ? null : requireString(header.name, `${path}.name`, 10_000),
    contact: validateContact(header.contact, `${path}.contact`)
  };
  if (validated.name === null && validated.contact.length === 0) {
    invalid(path, "must contain a name field or at least one contact field");
  }
  return validated;
}

function validateDocument(
  value: unknown
): PortableResumeDocumentV1 {
  const document = requireRecord(value, "document");
  requireExactKeys(document, DOCUMENT_KEYS, "document");

  const sections = requireArray(document.sections, "document.sections", 500).map((rawSection, sectionIndex) => {
    const path = `document.sections[${sectionIndex}]`;
    const section = requireRecord(rawSection, path);
    requireExactKeys(section, SECTION_KEYS, path);

    const type = requireEnum(section.type, ["standard", "skills", "summary"] as const, `${path}.type`);
    const items = requireArray(section.items, `${path}.items`, 5_000).map((rawItem, itemIndex) => {
      const itemPath = `${path}.items[${itemIndex}]`;
      const item = requireRecord(rawItem, itemPath);
      requireExactKeys(item, ENTRY_KEYS, itemPath);

      const bullets = requireArray(item.bullets, `${itemPath}.bullets`, 20_000).map((rawBullet, bulletIndex) => {
        const bulletPath = `${itemPath}.bullets[${bulletIndex}]`;
        const bullet = requireRecord(rawBullet, bulletPath);
        requireExactKeys(bullet, BULLET_KEYS, bulletPath);
        return { text: requireString(bullet.text, `${bulletPath}.text`) };
      });

      return {
        titleLeft: requireString(item.titleLeft, `${itemPath}.titleLeft`),
        titleRight: requireString(item.titleRight, `${itemPath}.titleRight`),
        subtitleLeft: requireString(item.subtitleLeft, `${itemPath}.subtitleLeft`),
        subtitleRight: requireString(item.subtitleRight, `${itemPath}.subtitleRight`),
        bullets
      };
    });

    return {
      heading: requireString(section.heading, `${path}.heading`, 10_000),
      type,
      items
    };
  });

  return {
    header: validateHeader(document.header, "document.header"),
    sections
  };
}

// Spacing values are absolute points. A file whose gaps are on the retired
// scale is not a v1 file and is not read here: the workspace rewrite tool
// converts it, and this marker is how a converted file says so. Runtime parsing
// stays single-shape, so a stale document fails loudly instead of rendering
// quietly wrong.
const ABSOLUTE_SPACING = "absolute";

function requireStyleNumber<K extends keyof typeof DOC_STYLE_BOUNDS>(
  style: JsonRecord,
  key: K
): number {
  const { min, max } = DOC_STYLE_BOUNDS[key];
  return requireNumber(style[key], `style.${key}`, min, max);
}

function readDocumentStyle(style: JsonRecord): DocumentStyle {
  const fontFamilies = FONT_FAMILY_OPTIONS.map((option) => option.value);
  return {
    fontFamily: requireEnum(style.fontFamily, fontFamilies, "style.fontFamily"),
    baseFontSizePt: requireStyleNumber(style, "baseFontSizePt"),
    lineHeight: requireStyleNumber(style, "lineHeight"),
    entryIndentPt: requireStyleNumber(style, "entryIndentPt"),
    entryEndIndentPt: requireStyleNumber(style, "entryEndIndentPt"),
    nameContactGapPt: requireStyleNumber(style, "nameContactGapPt"),
    contactGapPt: requireStyleNumber(style, "contactGapPt"),
    headerSectionGapPt: requireStyleNumber(style, "headerSectionGapPt"),
    sectionGapPt: requireStyleNumber(style, "sectionGapPt"),
    sectionEntryGapPt: requireStyleNumber(style, "sectionEntryGapPt"),
    entryGapPt: requireStyleNumber(style, "entryGapPt"),
    titleSubGapPt: requireStyleNumber(style, "titleSubGapPt"),
    headBulletGapPt: requireStyleNumber(style, "headBulletGapPt"),
    skillsRowGapPt: requireStyleNumber(style, "skillsRowGapPt"),
    bulletGapPt: requireStyleNumber(style, "bulletGapPt"),
    headingCase: requireEnum(style.headingCase, ["smallcaps", "uppercase", "none"] as const, "style.headingCase"),
    sectionRule: requireBoolean(style.sectionRule, "style.sectionRule"),
    contactDivider: (() => {
      const divider = requireString(style.contactDivider, "style.contactDivider", 2);
      if (!divider.length) invalid("style.contactDivider", "must not be empty");
      return divider;
    })(),
    headerAlign: requireEnum(style.headerAlign, ["left", "center", "right"] as const, "style.headerAlign"),
    bodyAlign: requireEnum(style.bodyAlign, ["left", "justify", "center", "right"] as const, "style.bodyAlign"),
    headingAlign: requireEnum(style.headingAlign, ["left", "center", "right"] as const, "style.headingAlign"),
    pageMarginTopPt: requireStyleNumber(style, "pageMarginTopPt"),
    pageMarginRightPt: requireStyleNumber(style, "pageMarginRightPt"),
    pageMarginBottomPt: requireStyleNumber(style, "pageMarginBottomPt"),
    pageMarginLeftPt: requireStyleNumber(style, "pageMarginLeftPt")
  };
}

function validateStyle(value: unknown): DocumentStyle {
  const style = requireRecord(value, "style");
  requireExactKeys(style, STYLE_KEYS, "style");
  if (style.spacingModel !== ABSOLUTE_SPACING) {
    invalid("style.spacingModel", `must be ${JSON.stringify(ABSOLUTE_SPACING)}`);
  }
  return readDocumentStyle(style);
}

function toPortableDocument(data: ResumeData): PortableResumeDocumentV1 {
  return {
    header: data.header
      ? {
          visible: data.header.visible,
          name: data.header.name,
          contact: [...data.header.contact]
        }
      : null,
    sections: data.sections.map((section) => ({
      heading: section.heading,
      type: section.type,
      items: section.items.map((item) => ({
        titleLeft: item.titleLeft,
        titleRight: item.titleRight,
        subtitleLeft: item.subtitleLeft,
        subtitleRight: item.subtitleRight,
        bullets: item.bullets.map((bullet) => ({ text: bullet.text }))
      }))
    }))
  };
}

function rehydrateDocument(document: PortableResumeDocumentV1): ResumeData {
  return {
    header: document.header
      ? {
          visible: document.header.visible,
          name: document.header.name,
          contact: [...document.header.contact]
        }
      : null,
    sections: document.sections.map((portableSection) => {
      const section = newSection(portableSection.type, portableSection.heading);
      const items: ResumeEntry[] = portableSection.items.map((portableItem) => {
        const entry =
          portableSection.type === "skills"
            ? newSkillEntry()
            : portableSection.type === "summary"
              ? newSummaryEntry()
              : newEntry();
        return {
          ...entry,
          titleLeft: portableItem.titleLeft,
          titleRight: portableItem.titleRight,
          subtitleLeft: portableItem.subtitleLeft,
          subtitleRight: portableItem.subtitleRight,
          bullets: portableItem.bullets.map((bullet) => newBullet(bullet.text))
        };
      });
      return { ...section, items };
    })
  };
}

const resumeFileTooLarge = (): never => {
  throw new ResumeFileError("too-large", "This resume file is larger than the 2 MB limit.");
};

export function createResumeFile(data: ResumeData, style: DocStyle): ResumeFileV1 {
  const file: ResumeFileV1 = {
    format: RESUME_FILE_MAGIC,
    schemaVersion: RESUME_FILE_SCHEMA_VERSION,
    document: toPortableDocument(data),
    style: { ...toDocumentStyle(style), spacingModel: ABSOLUTE_SPACING }
  };

  // Validate typed callers too. An unsafe cast can still corrupt runtime state,
  // and saving that corruption would create a file the app itself cannot reopen.
  validateDocument(file.document);
  validateStyle(file.style);
  return file;
}

export function serializeResumeFile(data: ResumeData, style: DocStyle): string {
  return serializeJsonFile(
    createResumeFile(data, style),
    MAX_RESUME_FILE_BYTES,
    resumeFileTooLarge
  );
}

export function parseResumeFile(input: string | ArrayBuffer | Uint8Array): ParsedResumeFile {
  const value = parseJsonFile(input, MAX_RESUME_FILE_BYTES, {
    tooLarge: resumeFileTooLarge,
    invalidUtf8: () => {
      throw new ResumeFileError("invalid-json", "This resume file is not valid UTF-8 text.");
    },
    invalidJson: () => {
      throw new ResumeFileError("invalid-json", "This resume file does not contain valid JSON.");
    }
  });
  const file = requireRecord(value, "file");

  if (file.format !== RESUME_FILE_MAGIC) {
    throw new ResumeFileError("invalid-format", "This is not a Typeset .resume file.");
  }
  if (file.schemaVersion !== RESUME_FILE_SCHEMA_VERSION) {
    throw new ResumeFileError(
      "unsupported-version",
      `This resume uses unsupported schema version ${JSON.stringify(file.schemaVersion)}.`
    );
  }
  requireExactKeys(file, ["format", "schemaVersion", "document", "style"], "file");
  const document = validateDocument(file.document);
  const documentStyle = validateStyle(file.style);
  return { data: rehydrateDocument(document), documentStyle };
}

export async function readResumeFile(file: File): Promise<ParsedResumeFile> {
  assertJsonFileSize(file.size, MAX_RESUME_FILE_BYTES, resumeFileTooLarge);
  return parseResumeFile(await file.arrayBuffer());
}

export function resumeFileName(suggestedName: string): string {
  const withoutExtension = suggestedName.replace(/\.resume$/i, "");
  const safeBase = withoutExtension
    .replace(/<\/?(?:b|i|u)>/gi, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 120);
  return `${safeBase || "Untitled resume"}.resume`;
}
