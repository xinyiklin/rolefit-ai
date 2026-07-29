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
import {
  PAGE_MARGIN_BOUNDS_PT,
  pageMarginsForValues
} from "./pageMargins.ts";
import {
  paragraphSpacingFromInlineMarks,
  stripInlineMarks
} from "./inlineMarksText.ts";
import {
  newSummaryEntry,
  newSection,
  type DocumentHeader,
  type ResumeData
} from "./resumeData.ts";

export const COVER_LETTER_FILE_MAGIC = "typeset-cover-letter" as const;
export const COVER_LETTER_FILE_SCHEMA_VERSION = 1 as const;
export const MAX_COVER_LETTER_FILE_BYTES = 2 * 1024 * 1024;
export const DEFAULT_COVER_LETTER_SPACE_BEFORE_PT = 8;

export type CoverLetterStyle = {
  fontFamily: FontFamily;
  fontSizePt: number;
  lineHeight: number;
  marginTopPt: number;
  marginRightPt: number;
  marginBottomPt: number;
  marginLeftPt: number;
  contactDivider: string;
  // The three gaps a letter shares with a resume, all of them the header's:
  // name to contact, the contact separator's slot, and header to body. The
  // other structural gaps belong to sections and entries, which a letter has
  // none of. Absolute points, same meaning and bounds as a resume's.
  nameContactGapPt: number;
  contactGapPt: number;
  headerSectionGapPt: number;
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
  marginTopPt: 36,
  marginRightPt: 54,
  marginBottomPt: 36,
  marginLeftPt: 54,
  contactDivider: "|",
  // Tuned on the letterhead itself: the contact line sits close under the name,
  // the separators breathe, and the body clears the header.
  nameContactGapPt: 10,
  contactGapPt: 18,
  headerSectionGapPt: 14
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
  "fontSizePt",
  "lineHeight",
  "marginTopPt",
  "marginRightPt",
  "marginBottomPt",
  "marginLeftPt",
  "contactDivider",
  "nameContactGapPt",
  "contactGapPt",
  "headerSectionGapPt"
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

export function parseCoverLetterStyle(value: unknown): CoverLetterStyle {
  const style = requireRecord(value, "invalid-style", "Cover-letter style");
  requireExactKeys(style, STYLE_KEYS, "invalid-style", "Cover-letter style");
  const fontFamilies = FONT_FAMILY_OPTIONS.map((option) => option.value);
  if (typeof style.fontFamily !== "string" || !fontFamilies.includes(style.fontFamily as FontFamily)) {
    fail("invalid-style", "Cover-letter style fontFamily is unsupported.");
  }
  const fontSizePt = requireNumber(style.fontSizePt, "fontSizePt", 9, 13);
  const lineHeight = requireNumber(style.lineHeight, "lineHeight", 1, 2);
  const spacing = (key: "nameContactGapPt" | "contactGapPt" | "headerSectionGapPt") =>
    requireNumber(style[key], key, DOC_STYLE_BOUNDS[key].min, DOC_STYLE_BOUNDS[key].max);
  return {
    fontFamily: style.fontFamily as FontFamily,
    fontSizePt,
    lineHeight,
    nameContactGapPt: spacing("nameContactGapPt"),
    contactGapPt: spacing("contactGapPt"),
    headerSectionGapPt: spacing("headerSectionGapPt"),
    marginTopPt: requireNumber(style.marginTopPt, "marginTopPt", PAGE_MARGIN_BOUNDS_PT.min, PAGE_MARGIN_BOUNDS_PT.max),
    marginRightPt: requireNumber(style.marginRightPt, "marginRightPt", PAGE_MARGIN_BOUNDS_PT.min, PAGE_MARGIN_BOUNDS_PT.max),
    marginBottomPt: requireNumber(style.marginBottomPt, "marginBottomPt", PAGE_MARGIN_BOUNDS_PT.min, PAGE_MARGIN_BOUNDS_PT.max),
    marginLeftPt: requireNumber(style.marginLeftPt, "marginLeftPt", PAGE_MARGIN_BOUNDS_PT.min, PAGE_MARGIN_BOUNDS_PT.max),
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
  if (header.name !== null && (typeof header.name !== "string" || header.name.length > 1_000)) {
    fail("invalid-document", "Cover-letter header name must be null or text no longer than 1,000 characters.");
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
    baseFontSizePt: style.fontSizePt,
    lineHeight: style.lineHeight,
    bodyAlign: "left",
    pageMarginTopPt: style.marginTopPt,
    pageMarginRightPt: style.marginRightPt,
    pageMarginBottomPt: style.marginBottomPt,
    pageMarginLeftPt: style.marginLeftPt,
    contactDivider: style.contactDivider,
    headerAlign: "center",
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
    top: style.marginTopPt,
    right: style.marginRightPt,
    bottom: style.marginBottomPt,
    left: style.marginLeftPt
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
    fontSizePt: style.baseFontSizePt,
    lineHeight: style.lineHeight,
    marginTopPt: style.pageMarginTopPt,
    marginRightPt: style.pageMarginRightPt,
    marginBottomPt: style.pageMarginBottomPt,
    marginLeftPt: style.pageMarginLeftPt,
    contactDivider: style.contactDivider,
    nameContactGapPt: style.nameContactGapPt,
    contactGapPt: style.contactGapPt,
    headerSectionGapPt: style.headerSectionGapPt
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
  return {
    data: coverLetterResumeData(paragraphs, header),
    style: parseCoverLetterStyle(file.style)
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
