import {
  DOC_STYLE_BOUNDS,
  DOC_STYLE_DEFAULTS,
  FONT_FAMILY_OPTIONS,
  type CoverLetterDocumentStyle,
  type DocStyle,
  type DocumentStyle,
  type FontFamily,
  type ResumeBodyStyle
} from "./documentStyle.ts";
import { pageMarginsForValues } from "./pageMargins.ts";
import {
  paragraphSpacingFromInlineMarks,
  stripInlineMarks
} from "./inlineMarksText.ts";
import {
  DOCUMENT_HEADER_LIMITS,
  newSummaryEntry,
  newSection,
  type DocumentHeader,
  type ResumeData
} from "./resumeData.ts";
import {
  parseJsonFile,
  serializeJsonFile
} from "./jsonFileCodec.ts";
import { upgradeLegacyTextSizes } from "./legacyTextSizes.ts";

export const COVER_LETTER_FILE_MAGIC = "typeset-cover-letter" as const;
export const COVER_LETTER_FILE_SCHEMA_VERSION = 1 as const;
export const MAX_COVER_LETTER_FILE_BYTES = 2 * 1024 * 1024;
export const DEFAULT_COVER_LETTER_SPACE_BEFORE_PT = 8;

// The letter's style keys share the resume's names and bounds, so one value
// means the same thing in both documents.
export type CoverLetterStyle = Pick<
  DocumentStyle,
  | "fontFamily"
  | "lineHeight"
  | "pageMarginTopPt"
  | "pageMarginRightPt"
  | "pageMarginBottomPt"
  | "pageMarginLeftPt"
  | "contactDivider"
  | "nameContactGapPt"
  | "contactGapPt"
  | "headerSectionGapPt"
  | "headerAlign"
  | "bodyAlign"
>;

export const COVER_LETTER_STYLE_DEFAULTS: CoverLetterStyle = {
  fontFamily: DOC_STYLE_DEFAULTS.fontFamily,
  lineHeight: DOC_STYLE_DEFAULTS.lineHeight,
  pageMarginTopPt: DOC_STYLE_DEFAULTS.pageMarginTopPt,
  pageMarginRightPt: DOC_STYLE_DEFAULTS.pageMarginRightPt,
  pageMarginBottomPt: DOC_STYLE_DEFAULTS.pageMarginBottomPt,
  pageMarginLeftPt: DOC_STYLE_DEFAULTS.pageMarginLeftPt,
  contactDivider: DOC_STYLE_DEFAULTS.contactDivider,
  nameContactGapPt: DOC_STYLE_DEFAULTS.nameContactGapPt,
  contactGapPt: DOC_STYLE_DEFAULTS.contactGapPt,
  headerSectionGapPt: DOC_STYLE_DEFAULTS.headerSectionGapPt,
  headerAlign: DOC_STYLE_DEFAULTS.headerAlign,
  bodyAlign: DOC_STYLE_DEFAULTS.bodyAlign
};

export type CoverLetterFileV1 = {
  format: typeof COVER_LETTER_FILE_MAGIC;
  schemaVersion: typeof COVER_LETTER_FILE_SCHEMA_VERSION;
  document: {
    header: {
      visible: boolean;
      name: string | null;
      contact: string[];
    } | null;
    paragraphs: string[];
  };
  style: CoverLetterStyle;
};

export type ParsedCoverLetterFile = {
  data: ResumeData;
  style: CoverLetterStyle;
};

export type CoverLetterFileErrorCode =
  | "too-large"
  | "invalid-json"
  | "invalid-format"
  | "unsupported-version"
  | "invalid-document"
  | "invalid-style";

export class CoverLetterFileError extends Error {
  readonly code: CoverLetterFileErrorCode;

  constructor(code: CoverLetterFileErrorCode, message: string) {
    super(message);
    this.name = "CoverLetterFileError";
    this.code = code;
  }
}

type JsonRecord = Record<string, unknown>;

const STYLE_KEYS = [
  "fontFamily",
  "lineHeight",
  "pageMarginTopPt",
  "pageMarginRightPt",
  "pageMarginBottomPt",
  "pageMarginLeftPt",
  "contactDivider",
  "nameContactGapPt",
  "contactGapPt",
  "headerSectionGapPt",
  "headerAlign",
  "bodyAlign"
] as const satisfies readonly (keyof CoverLetterStyle)[];
// Letters saved before alignment was a letter setting omit these keys and keep
// the alignment they were drawn with.
const OPTIONAL_STYLE_DEFAULTS = {
  headerAlign: "center",
  bodyAlign: "left"
} as const satisfies Partial<CoverLetterStyle>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(code: CoverLetterFileErrorCode, message: string): never {
  throw new CoverLetterFileError(code, message);
}

function requireRecord(value: unknown, code: CoverLetterFileErrorCode, label: string): JsonRecord {
  if (!isRecord(value)) fail(code, `${label} must be an object.`);
  return value;
}

function requireExactKeys(
  record: JsonRecord,
  keys: readonly string[],
  code: CoverLetterFileErrorCode,
  label: string
) {
  const allowed = new Set(keys);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) fail(code, `${label} contains unsupported field ${JSON.stringify(key)}.`);
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      fail(code, `${label} is missing required field ${JSON.stringify(key)}.`);
    }
  }
}

function requireNumber(
  value: unknown,
  key: string,
  min: number,
  max: number
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    fail("invalid-style", `Cover-letter style ${key} must be between ${min} and ${max}.`);
  }
  return value;
}

// Letters saved before the style keys took the resume's names (see
// legacyTextSizes.ts): the old margin names and the retired paragraph size.
const LEGACY_STYLE_KEY_NAMES = {
  marginTopPt: "pageMarginTopPt",
  marginRightPt: "pageMarginRightPt",
  marginBottomPt: "pageMarginBottomPt",
  marginLeftPt: "pageMarginLeftPt"
} as const;
const LEGACY_FONT_SIZE_KEY = "fontSizePt";

function readLegacyStyle(style: JsonRecord): { style: JsonRecord; legacySizeBasePt: number | null } {
  const isLegacy = [LEGACY_FONT_SIZE_KEY, ...Object.keys(LEGACY_STYLE_KEY_NAMES)]
    .every((key) => Object.prototype.hasOwnProperty.call(style, key));
  if (!isLegacy) return { style, legacySizeBasePt: null };
  for (const current of Object.values(LEGACY_STYLE_KEY_NAMES)) {
    if (Object.prototype.hasOwnProperty.call(style, current)) {
      fail("invalid-style", `Cover-letter style mixes legacy and current field ${JSON.stringify(current)}.`);
    }
  }
  const { [LEGACY_FONT_SIZE_KEY]: legacySize, ...rest } = style;
  const renamed: JsonRecord = {};
  for (const [key, value] of Object.entries(rest)) {
    renamed[LEGACY_STYLE_KEY_NAMES[key as keyof typeof LEGACY_STYLE_KEY_NAMES] ?? key] = value;
  }
  return { style: renamed, legacySizeBasePt: requireNumber(legacySize, LEGACY_FONT_SIZE_KEY, 9, 13) };
}

// Accepts the legacy shape too (renamed, its paragraph size dropped), so a
// letter style saved anywhere before the rename still loads.
export function parseCoverLetterStyle(value: unknown): CoverLetterStyle {
  const { style: read } = readLegacyStyle(requireRecord(value, "invalid-style", "Cover-letter style"));
  const style: JsonRecord = { ...OPTIONAL_STYLE_DEFAULTS, ...read };
  requireExactKeys(style, STYLE_KEYS, "invalid-style", "Cover-letter style");
  const fontFamilies = FONT_FAMILY_OPTIONS.map((option) => option.value);
  if (typeof style.fontFamily !== "string" || !fontFamilies.includes(style.fontFamily as FontFamily)) {
    fail("invalid-style", "Cover-letter style fontFamily is unsupported.");
  }
  const bounded = (key: Exclude<(typeof STYLE_KEYS)[number], "fontFamily" | "contactDivider" | "headerAlign" | "bodyAlign">) =>
    requireNumber(style[key], key, DOC_STYLE_BOUNDS[key].min, DOC_STYLE_BOUNDS[key].max);
  return {
    fontFamily: style.fontFamily as FontFamily,
    lineHeight: bounded("lineHeight"),
    nameContactGapPt: bounded("nameContactGapPt"),
    contactGapPt: bounded("contactGapPt"),
    headerSectionGapPt: bounded("headerSectionGapPt"),
    pageMarginTopPt: bounded("pageMarginTopPt"),
    pageMarginRightPt: bounded("pageMarginRightPt"),
    pageMarginBottomPt: bounded("pageMarginBottomPt"),
    pageMarginLeftPt: bounded("pageMarginLeftPt"),
    headerAlign: ["left", "center", "right"].includes(style.headerAlign as string)
      ? style.headerAlign as CoverLetterStyle["headerAlign"]
      : fail("invalid-style", "Cover-letter style headerAlign must be left, center, or right."),
    bodyAlign: ["left", "center", "right", "justify"].includes(style.bodyAlign as string)
      ? style.bodyAlign as CoverLetterStyle["bodyAlign"]
      : fail("invalid-style", "Cover-letter style bodyAlign must be left, center, right, or justify."),
    contactDivider:
      typeof style.contactDivider === "string" &&
          style.contactDivider.length >= 1 &&
          style.contactDivider.length <= 2
        ? style.contactDivider
        : fail("invalid-style", "Cover-letter style contactDivider must be one or two characters.")
  };
}

function validateParagraphs(value: unknown): string[] {
  if (!Array.isArray(value)) fail("invalid-document", "Cover-letter paragraphs must be an array.");
  if (value.length === 0 || value.length > 500) {
    fail("invalid-document", "A cover letter must contain between 1 and 500 paragraphs.");
  }
  return value.map((paragraph, index) => {
    if (typeof paragraph !== "string") {
      fail("invalid-document", `Cover-letter paragraph ${index + 1} must be text.`);
    }
    if (paragraph.length > 100_000) {
      fail("invalid-document", `Cover-letter paragraph ${index + 1} is too long.`);
    }
    return paragraph;
  });
}

function validateHeader(value: unknown): DocumentHeader {
  const header = requireRecord(value, "invalid-document", "Cover-letter header");
  requireExactKeys(header, ["visible", "name", "contact"], "invalid-document", "Cover-letter header");
  if (typeof header.visible !== "boolean") {
    fail("invalid-document", "Cover-letter header visible must be true or false.");
  }
  const { textChars, contactItems } = DOCUMENT_HEADER_LIMITS;
  if (header.name !== null && (typeof header.name !== "string" || header.name.length > textChars)) {
    fail("invalid-document", `Cover-letter header name must be null or text no longer than ${textChars.toLocaleString("en-US")} characters.`);
  }
  if (
    !Array.isArray(header.contact) ||
    header.contact.length > contactItems ||
    header.contact.some((item) => typeof item !== "string" || item.length > textChars)
  ) {
    fail(
      "invalid-document",
      `Cover-letter header must contain at most ${contactItems.toLocaleString("en-US")} text contact items, each no longer than ${textChars.toLocaleString("en-US")} characters.`
    );
  }
  const validated = {
    visible: header.visible,
    name: header.name as string | null,
    contact: [...header.contact] as string[]
  };
  if (validated.name === null && validated.contact.length === 0) {
    fail(
      "invalid-document",
      "Cover-letter header must contain a name field or at least one contact field."
    );
  }
  return validated;
}

const coverLetterFileTooLarge = (): never =>
  fail("too-large", "This .cover file is larger than the 2 MB limit.");

export function coverLetterResumeData(
  paragraphs: readonly string[],
  header: DocumentHeader | null = null
): ResumeData {
  const section = newSection("summary", "");
  const normalized = paragraphs.length ? paragraphs : [""];
  return {
    header: header
      ? {
          visible: header.visible,
          name: header.name,
          contact: [...header.contact]
        }
      : null,
    sections: [
      {
        ...section,
        items: normalized.map((text) => {
          const entry = newSummaryEntry();
          return {
            ...entry,
            bullets: [{ ...entry.bullets[0], text }]
          };
        })
      }
    ]
  };
}

export function assertCoverLetterDocumentShape(data: ResumeData): void {
  if (data.sections.length !== 1) {
    fail(
      "invalid-document",
      "A cover letter must contain exactly one paragraph section."
    );
  }
  const section = data.sections[0];
  if (section.type !== "summary" || section.heading !== "") {
    fail(
      "invalid-document",
      "A cover letter must use one untitled paragraph section."
    );
  }
  for (const [index, item] of section.items.entries()) {
    if (
      item.titleLeft !== "" ||
      item.titleRight !== "" ||
      item.subtitleLeft !== "" ||
      item.subtitleRight !== ""
    ) {
      fail(
        "invalid-document",
        `Cover-letter paragraph ${index + 1} contains unsupported entry text.`
      );
    }
    if (item.bullets.length !== 1) {
      fail(
        "invalid-document",
        `Cover-letter paragraph ${index + 1} must contain exactly one text value.`
      );
    }
  }
}

export function coverLetterParagraphs(data: ResumeData): string[] {
  assertCoverLetterDocumentShape(data);
  return data.sections[0].items.map((item) => item.bullets[0].text);
}

export function parseCoverLetterText(text: string): ResumeData {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  const paragraphs = normalized
    ? normalized
        .split(/\n[ \t]*\n+/)
        .map((paragraph) => paragraph.trim())
    : [""];
  const formatted = paragraphs.map((paragraph) =>
    paragraphSpacingFromInlineMarks(paragraph).spaceBeforePt === null
      ? `<space-before=${DEFAULT_COVER_LETTER_SPACE_BEFORE_PT}>${paragraph}</space-before>`
      : paragraph
  );
  return coverLetterResumeData(formatted);
}

export function coverLetterPlainText(data: ResumeData): string {
  return coverLetterParagraphs(data)
    .map((paragraph) => stripInlineMarks(paragraph).trim())
    .join("\n\n")
    .trim();
}

// A letter has no sections, entries, or bullets, so none of these settings can
// reach its page. They exist only because the shared editor's DocStyle is the
// resume's shape; they are stated here as inert zeroes rather than inherited
// from the resume defaults, so changing a resume default can never move a
// letter. What a letter's layout actually reads is CoverLetterDocumentStyle.
const NO_RESUME_BODY: ResumeBodyStyle = {
  entryIndentPt: 0,
  entryEndIndentPt: 0,
  bulletIndentPt: 0,
  sectionGapPt: 0,
  sectionEntryGapPt: 0,
  entryGapPt: 0,
  titleSubGapPt: 0,
  headBulletGapPt: 0,
  skillsRowGapPt: 0,
  bulletGapPt: 0,
  headingCase: "none",
  headingAlign: "left",
  sectionRule: false
};

// The letter's own document style: page + letterhead, and nothing else.
export function coverLetterDocumentStyle(
  style: CoverLetterStyle
): CoverLetterDocumentStyle {
  return {
    fontFamily: style.fontFamily,
    lineHeight: style.lineHeight,
    bodyAlign: style.bodyAlign,
    pageMarginTopPt: style.pageMarginTopPt,
    pageMarginRightPt: style.pageMarginRightPt,
    pageMarginBottomPt: style.pageMarginBottomPt,
    pageMarginLeftPt: style.pageMarginLeftPt,
    contactDivider: style.contactDivider,
    headerAlign: style.headerAlign,
    nameContactGapPt: style.nameContactGapPt,
    contactGapPt: style.contactGapPt,
    headerSectionGapPt: style.headerSectionGapPt
  };
}

// The same letter widened to the shape the shared editor and its toolbars are
// typed against.
export function coverLetterStyleToDocumentStyle(
  style: CoverLetterStyle,
  view: Pick<DocStyle, "zoom" | "spellCheck"> = {
    zoom: DOC_STYLE_DEFAULTS.zoom,
    spellCheck: DOC_STYLE_DEFAULTS.spellCheck
  }
): DocStyle {
  const pageMargins = pageMarginsForValues({
    top: style.pageMarginTopPt,
    right: style.pageMarginRightPt,
    bottom: style.pageMarginBottomPt,
    left: style.pageMarginLeftPt
  });
  return {
    ...NO_RESUME_BODY,
    ...coverLetterDocumentStyle(style),
    ...view,
    pageMargins
  };
}

export function documentStyleToCoverLetterStyle(style: DocumentStyle): CoverLetterStyle {
  return parseCoverLetterStyle({
    fontFamily: style.fontFamily,
    lineHeight: style.lineHeight,
    pageMarginTopPt: style.pageMarginTopPt,
    pageMarginRightPt: style.pageMarginRightPt,
    pageMarginBottomPt: style.pageMarginBottomPt,
    pageMarginLeftPt: style.pageMarginLeftPt,
    contactDivider: style.contactDivider,
    nameContactGapPt: style.nameContactGapPt,
    contactGapPt: style.contactGapPt,
    headerSectionGapPt: style.headerSectionGapPt,
    headerAlign: style.headerAlign,
    bodyAlign: style.bodyAlign
  });
}

export function createCoverLetterFile(
  data: ResumeData,
  style: CoverLetterStyle
): CoverLetterFileV1 {
  assertCoverLetterDocumentShape(data);
  const paragraphs = validateParagraphs(coverLetterParagraphs(data));
  const header = data.header
    ? validateHeader({
        visible: data.header.visible,
        name: data.header.name,
        contact: [...data.header.contact]
      })
    : null;
  return {
    format: COVER_LETTER_FILE_MAGIC,
    schemaVersion: COVER_LETTER_FILE_SCHEMA_VERSION,
    document: { header, paragraphs },
    style: parseCoverLetterStyle(style)
  };
}

export function serializeCoverLetterFile(data: ResumeData, style: CoverLetterStyle): string {
  return serializeJsonFile(
    createCoverLetterFile(data, style),
    MAX_COVER_LETTER_FILE_BYTES,
    coverLetterFileTooLarge
  );
}

export function parseCoverLetterFile(
  input: string | ArrayBuffer | Uint8Array
): ParsedCoverLetterFile {
  const parsed = parseJsonFile(input, MAX_COVER_LETTER_FILE_BYTES, {
    tooLarge: coverLetterFileTooLarge,
    invalidUtf8: () => fail("invalid-json", "This .cover file is not valid UTF-8 text."),
    invalidJson: () =>
      fail("invalid-json", "This .cover file does not contain valid JSON.")
  });
  const file = requireRecord(parsed, "invalid-format", "Cover-letter file");
  if (file.format !== COVER_LETTER_FILE_MAGIC) {
    fail("invalid-format", "This is not a Typeset .cover file.");
  }
  if (file.schemaVersion !== COVER_LETTER_FILE_SCHEMA_VERSION) {
    fail(
      "unsupported-version",
      `This cover letter uses unsupported schema version ${JSON.stringify(file.schemaVersion)}.`
    );
  }
  requireExactKeys(
    file,
    ["format", "schemaVersion", "document", "style"],
    "invalid-format",
    "Cover-letter file"
  );
  const document = requireRecord(file.document, "invalid-document", "Cover-letter document");
  requireExactKeys(
    document,
    ["header", "paragraphs"],
    "invalid-document",
    "Cover-letter document"
  );
  const paragraphs = validateParagraphs(document.paragraphs);
  let header: DocumentHeader | null = null;
  if (document.header !== null) {
    header = validateHeader(document.header);
  }
  const legacy = readLegacyStyle(requireRecord(file.style, "invalid-style", "Cover-letter style"));
  const data = coverLetterResumeData(paragraphs, header);
  return {
    data: legacy.legacySizeBasePt === null ? data : upgradeLegacyTextSizes(data, legacy.legacySizeBasePt),
    style: parseCoverLetterStyle(file.style)
  };
}

export function coverLetterFileName(suggestedName: string): string {
  const withoutExtension = suggestedName.replace(/\.cover$/i, "");
  const safeBase = stripInlineMarks(withoutExtension)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 120);
  return `${safeBase || "Untitled cover letter"}.cover`;
}
