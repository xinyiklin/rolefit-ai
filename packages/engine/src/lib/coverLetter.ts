import {
  DOC_STYLE_DEFAULTS,
  FONT_FAMILY_OPTIONS,
  type DocStyle,
  type DocumentStyle,
  type FontFamily
} from "./documentStyle.ts";
import {
  PAGE_MARGIN_BOUNDS_PT,
  pageMarginsForValues
} from "./pageMargins.ts";
import { stripInlineMarks } from "./inlineMarksText.ts";
import { newSummaryEntry, newSection, type ResumeData } from "./resumeData.ts";

export const COVER_LETTER_FILE_MAGIC = "typeset-cover-letter" as const;
export const COVER_LETTER_FILE_SCHEMA_VERSION = 2 as const;
export const MAX_COVER_LETTER_FILE_BYTES = 2 * 1024 * 1024;

export type CoverLetterStyle = {
  fontFamily: FontFamily;
  fontSizePt: number;
  lineHeight: number;
  paragraphGapPt: number;
  marginTopPt: number;
  marginRightPt: number;
  marginBottomPt: number;
  marginLeftPt: number;
  contactDivider: string;
};

export const COVER_LETTER_STYLE_DEFAULTS: CoverLetterStyle = {
  // A cover letter is business correspondence, and the face business
  // correspondence is written in is Calibri — the word processor default most
  // applications are drafted in, and one of the handful career offices name.
  // Carlito carries its metrics, so a letter keeps its line and page count if
  // the reader ever opens it in Word. The resume default stays Latin Modern:
  // that document is a typographic artifact, this one is a letter.
  fontFamily: "carlito",
  fontSizePt: 11,
  lineHeight: 2,
  paragraphGapPt: 0,
  marginTopPt: 54,
  marginRightPt: 54,
  marginBottomPt: 54,
  marginLeftPt: 54,
  contactDivider: "|"
};

export type CoverLetterFileV2 = {
  format: typeof COVER_LETTER_FILE_MAGIC;
  schemaVersion: typeof COVER_LETTER_FILE_SCHEMA_VERSION;
  document: {
    header: {
      name: string;
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
  "fontSizePt",
  "lineHeight",
  "paragraphGapPt",
  "marginTopPt",
  "marginRightPt",
  "marginBottomPt",
  "marginLeftPt",
  "contactDivider"
] as const satisfies readonly (keyof CoverLetterStyle)[];

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

export function parseCoverLetterStyle(value: unknown, legacy = false): CoverLetterStyle {
  const style = requireRecord(value, "invalid-style", "Cover-letter style");
  const keys = legacy ? STYLE_KEYS.filter((key) => key !== "contactDivider") : STYLE_KEYS;
  requireExactKeys(style, keys, "invalid-style", "Cover-letter style");
  const fontFamilies = FONT_FAMILY_OPTIONS.map((option) => option.value);
  if (typeof style.fontFamily !== "string" || !fontFamilies.includes(style.fontFamily as FontFamily)) {
    fail("invalid-style", "Cover-letter style fontFamily is unsupported.");
  }
  return {
    fontFamily: style.fontFamily as FontFamily,
    fontSizePt: requireNumber(style.fontSizePt, "fontSizePt", 9, 13),
    lineHeight: requireNumber(style.lineHeight, "lineHeight", 1, 2),
    paragraphGapPt: requireNumber(style.paragraphGapPt, "paragraphGapPt", 0, 36),
    marginTopPt: requireNumber(style.marginTopPt, "marginTopPt", PAGE_MARGIN_BOUNDS_PT.min, PAGE_MARGIN_BOUNDS_PT.max),
    marginRightPt: requireNumber(style.marginRightPt, "marginRightPt", PAGE_MARGIN_BOUNDS_PT.min, PAGE_MARGIN_BOUNDS_PT.max),
    marginBottomPt: requireNumber(style.marginBottomPt, "marginBottomPt", PAGE_MARGIN_BOUNDS_PT.min, PAGE_MARGIN_BOUNDS_PT.max),
    marginLeftPt: requireNumber(style.marginLeftPt, "marginLeftPt", PAGE_MARGIN_BOUNDS_PT.min, PAGE_MARGIN_BOUNDS_PT.max),
    contactDivider:
      legacy
        ? COVER_LETTER_STYLE_DEFAULTS.contactDivider
        : typeof style.contactDivider === "string" &&
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

function validateHeader(value: unknown): { name: string; contact: string[] } {
  const header = requireRecord(value, "invalid-document", "Cover-letter header");
  requireExactKeys(header, ["name", "contact"], "invalid-document", "Cover-letter header");
  if (typeof header.name !== "string" || header.name.length > 1_000) {
    fail("invalid-document", "Cover-letter header name must be text no longer than 1,000 characters.");
  }
  if (
    !Array.isArray(header.contact) ||
    header.contact.length > 20 ||
    header.contact.some((item) => typeof item !== "string" || item.length > 1_000)
  ) {
    fail(
      "invalid-document",
      "Cover-letter header must contain at most 20 text contact items, each no longer than 1,000 characters."
    );
  }
  return { name: header.name, contact: [...header.contact] as string[] };
}

function enforceSize(byteLength: number) {
  if (byteLength > MAX_COVER_LETTER_FILE_BYTES) {
    fail("too-large", "This .cover file is larger than the 2 MB limit.");
  }
}

function decodeInput(input: string | ArrayBuffer | Uint8Array): string {
  if (typeof input === "string") {
    enforceSize(new TextEncoder().encode(input).byteLength);
    return input;
  }
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  enforceSize(bytes.byteLength);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("invalid-json", "This .cover file is not valid UTF-8 text.");
  }
}

export function coverLetterResumeData(
  paragraphs: readonly string[],
  header: { name: string; contact: readonly string[] } | null = null
): ResumeData {
  const section = newSection("summary", "");
  const normalized = paragraphs.length ? paragraphs : [""];
  return {
    name: header?.name ?? "",
    contact: header ? [...header.contact] : [],
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

export function coverLetterParagraphs(data: ResumeData): string[] {
  const section = data.sections[0];
  if (!section || section.type !== "summary") return [""];
  const paragraphs = section.items.map((item) => item.bullets[0]?.text ?? "");
  return paragraphs.length ? paragraphs : [""];
}

export function parseCoverLetterText(text: string): ResumeData {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  const paragraphs = normalized
    ? normalized.split(/\n[ \t]*\n+/).map((paragraph) => paragraph.trim())
    : [""];
  return coverLetterResumeData(paragraphs);
}

export function coverLetterPlainText(data: ResumeData): string {
  return coverLetterParagraphs(data)
    .map((paragraph) => stripInlineMarks(paragraph).trim())
    .join("\n\n")
    .trim();
}

export function coverLetterStyleToDocumentStyle(
  style: CoverLetterStyle,
  view: Pick<DocStyle, "zoom" | "spellCheck"> = { zoom: 1, spellCheck: true }
): DocStyle {
  const pageMargins = pageMarginsForValues({
    top: style.marginTopPt,
    right: style.marginRightPt,
    bottom: style.marginBottomPt,
    left: style.marginLeftPt
  });
  return {
    ...DOC_STYLE_DEFAULTS,
    ...view,
    fontFamily: style.fontFamily,
    baseFontSizePt: style.fontSizePt,
    lineHeight: style.lineHeight,
    bulletGapPt: style.paragraphGapPt,
    entryIndentPt: 0,
    entryEndIndentPt: 0,
    sectionRule: false,
    headingCase: "none",
    headerAlign: "center",
    contactDivider: style.contactDivider,
    bodyAlign: "left",
    headingAlign: "left",
    pageMargins,
    pageMarginTopPt: style.marginTopPt,
    pageMarginRightPt: style.marginRightPt,
    pageMarginBottomPt: style.marginBottomPt,
    pageMarginLeftPt: style.marginLeftPt
  };
}

export function documentStyleToCoverLetterStyle(style: DocumentStyle): CoverLetterStyle {
  return parseCoverLetterStyle({
    fontFamily: style.fontFamily,
    fontSizePt: style.baseFontSizePt,
    lineHeight: style.lineHeight,
    paragraphGapPt: style.bulletGapPt,
    marginTopPt: style.pageMarginTopPt,
    marginRightPt: style.pageMarginRightPt,
    marginBottomPt: style.pageMarginBottomPt,
    marginLeftPt: style.pageMarginLeftPt,
    contactDivider: style.contactDivider
  });
}

export function createCoverLetterFile(
  data: ResumeData,
  style: CoverLetterStyle
): CoverLetterFileV2 {
  const paragraphs = validateParagraphs(coverLetterParagraphs(data));
  const validatedHeader = validateHeader({
    name: (data as Partial<ResumeData>).name,
    contact: (data as Partial<ResumeData>).contact
  });
  const header = validatedHeader.name.trim() || validatedHeader.contact.some((item) => item.trim())
    ? validatedHeader
    : null;
  return {
    format: COVER_LETTER_FILE_MAGIC,
    schemaVersion: COVER_LETTER_FILE_SCHEMA_VERSION,
    document: { header, paragraphs },
    style: parseCoverLetterStyle(style)
  };
}

export function serializeCoverLetterFile(data: ResumeData, style: CoverLetterStyle): string {
  const serialized = `${JSON.stringify(createCoverLetterFile(data, style), null, 2)}\n`;
  enforceSize(new TextEncoder().encode(serialized).byteLength);
  return serialized;
}

export function parseCoverLetterFile(
  input: string | ArrayBuffer | Uint8Array
): ParsedCoverLetterFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeInput(input)) as unknown;
  } catch (error) {
    if (error instanceof CoverLetterFileError) throw error;
    fail("invalid-json", "This .cover file does not contain valid JSON.");
  }
  const file = requireRecord(parsed, "invalid-format", "Cover-letter file");
  if (file.format !== COVER_LETTER_FILE_MAGIC) {
    fail("invalid-format", "This is not a Typeset .cover file.");
  }
  if (file.schemaVersion !== 1 && file.schemaVersion !== COVER_LETTER_FILE_SCHEMA_VERSION) {
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
  const legacy = file.schemaVersion === 1;
  requireExactKeys(
    document,
    legacy ? ["paragraphs"] : ["header", "paragraphs"],
    "invalid-document",
    "Cover-letter document"
  );
  const paragraphs = validateParagraphs(document.paragraphs);
  let header: { name: string; contact: string[] } | null = null;
  if (!legacy && document.header !== null) {
    header = validateHeader(document.header);
  }
  return {
    data: coverLetterResumeData(paragraphs, header),
    style: parseCoverLetterStyle(file.style, legacy)
  };
}

export async function readCoverLetterFile(file: File): Promise<ParsedCoverLetterFile> {
  enforceSize(file.size);
  return parseCoverLetterFile(await file.arrayBuffer());
}

export function coverLetterFileName(suggestedName: string): string {
  const withoutExtension = suggestedName.replace(/\.cover$/i, "");
  const safeBase = withoutExtension
    .replace(/<\/?(?:b|i|u)>/gi, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 120);
  return `${safeBase || "Untitled cover letter"}.cover`;
}
