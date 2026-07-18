import {
  PAGE_MARGIN_BOUNDS_PT,
  PAGE_MARGIN_PRESETS_PT,
  pageMarginValuesFor,
  type PageMargins
} from "./pageMargins.ts";
import type { FieldAlignment } from "./inlineMarksText.ts";

export type { PageMargins } from "./pageMargins.ts";

export type FontFamily = "latin-modern" | "source-serif" | "source-sans";
export type HeadingCase = "smallcaps" | "uppercase" | "none";
export type HeaderAlign = "left" | "center" | "right";
// The document-level name for the one alignment union (see FieldAlignment).
export type BodyAlign = FieldAlignment;
export type NameSize = "large" | "xlarge" | "huge";
export type AlignmentScope = "body" | "header" | "heading";

// Everything that changes printed output. Keep this explicit rather than
// deriving it from the view state: `.resume` validation treats this as a strict,
// versioned persistence contract.
export type DocumentStyle = {
  fontFamily: FontFamily;
  baseFontSizePt: number;
  letterSpacingPt: number;
  lineHeight: number; // unitless body-leading multiplier
  entryIndentPt: number;
  entryEndIndentPt: number;
  nameContactGapPt: number;
  contactGapPt: number;
  headerSectionGapPt: number;
  sectionGapPt: number;
  sectionEntryGapPt: number;
  entryGapPt: number;
  titleSubGapPt: number;
  headBulletGapPt: number;
  skillsRowGapPt: number;
  bulletGapPt: number;
  headingCase: HeadingCase;
  sectionRule: boolean;
  contactDivider: string;
  headerAlign: HeaderAlign;
  bodyAlign: BodyAlign;
  headingAlign: HeaderAlign;
  nameSize: NameSize;
  pageMargins: PageMargins;
  pageMarginTopPt: number;
  pageMarginRightPt: number;
  pageMarginBottomPt: number;
  pageMarginLeftPt: number;
};

// User-adjustable typography and page layout for the browser typesetting engine.
export type DocStyle = DocumentStyle & {
  // Page zoom, Google-Docs style: 1 (= "100%") is the comfortable default page
  // (75% of the pane); width and font scale by the same factor.
  zoom: number;
  // Browser spell-check underlines in the editable page. A local view
  // preference like zoom — off by default and never written to a .resume file.
  spellCheck: boolean;
};

const TEX_PT_TO_DOCUMENT_PT = 72 / 72.27;
const CALIBRATED_NAME_CONTACT_GAP = 0.04;
const CALIBRATED_HEADER_SECTION_GAP = 1.19;
const CALIBRATED_SECTION_GAP = 0.85;

const nameContactGapToPt = (value: number) =>
  (1 + (value - CALIBRATED_NAME_CONTACT_GAP) * 10) * TEX_PT_TO_DOCUMENT_PT;
const contactGapToPt = (value: number) => value * 10 * TEX_PT_TO_DOCUMENT_PT;
const headerSectionGapToPt = (value: number) =>
  (value - CALIBRATED_HEADER_SECTION_GAP + CALIBRATED_SECTION_GAP) * 11 * TEX_PT_TO_DOCUMENT_PT;
const normalGapToPt = (value: number) => value * 11 * TEX_PT_TO_DOCUMENT_PT;
const smallGapToPt = (value: number) => value * 10 * TEX_PT_TO_DOCUMENT_PT;

export const FONT_FAMILY_OPTIONS = [
  { value: "latin-modern", label: "Latin Modern" },
  { value: "source-serif", label: "Source Serif 4" },
  { value: "source-sans", label: "Source Sans 3" }
] as const satisfies readonly { value: FontFamily; label: string }[];

// One source of truth for UI constraints, local-state coercion, and strict file
// validation. Point-gap bounds preserve the calibrated editor ranges.
export const DOC_STYLE_BOUNDS = {
  zoom: { min: 0.5, max: 2, step: 0.01 },
  baseFontSizePt: { min: 8, max: 12, step: 0.5 },
  letterSpacingPt: { min: -0.2, max: 0.5, step: 0.05 },
  lineHeight: { min: 1, max: 2, step: 0.01 },
  entryIndentPt: { min: 0, max: 36, step: 0.1 },
  entryEndIndentPt: { min: 0, max: 36, step: 0.1 },
  nameContactGapPt: { min: nameContactGapToPt(0), max: nameContactGapToPt(0.8), step: 0.1 },
  contactGapPt: { min: contactGapToPt(0.4), max: contactGapToPt(3), step: 0.1 },
  headerSectionGapPt: {
    min: headerSectionGapToPt(0),
    max: headerSectionGapToPt(2.4),
    step: 0.1
  },
  sectionGapPt: { min: normalGapToPt(0), max: normalGapToPt(2), step: 0.1 },
  sectionEntryGapPt: { min: normalGapToPt(0), max: normalGapToPt(1.2), step: 0.1 },
  entryGapPt: { min: normalGapToPt(0), max: normalGapToPt(1.6), step: 0.1 },
  titleSubGapPt: { min: normalGapToPt(0), max: normalGapToPt(0.6), step: 0.1 },
  headBulletGapPt: { min: normalGapToPt(0), max: normalGapToPt(1.4), step: 0.1 },
  skillsRowGapPt: { min: smallGapToPt(0), max: smallGapToPt(0.8), step: 0.1 },
  bulletGapPt: { min: normalGapToPt(0), max: normalGapToPt(1.2), step: 0.1 },
  pageMarginTopPt: PAGE_MARGIN_BOUNDS_PT,
  pageMarginRightPt: PAGE_MARGIN_BOUNDS_PT,
  pageMarginBottomPt: PAGE_MARGIN_BOUNDS_PT,
  pageMarginLeftPt: PAGE_MARGIN_BOUNDS_PT
} as const;

export const DOC_STYLE_DEFAULTS: DocStyle = {
  zoom: 1,
  spellCheck: false,
  fontFamily: "latin-modern",
  baseFontSizePt: 10,
  letterSpacingPt: 0,
  lineHeight: 1.18,
  entryIndentPt: 10.8,
  entryEndIndentPt: 0,
  nameContactGapPt: nameContactGapToPt(0.04),
  contactGapPt: contactGapToPt(1.82),
  headerSectionGapPt: headerSectionGapToPt(1.19),
  sectionGapPt: normalGapToPt(0.85),
  sectionEntryGapPt: normalGapToPt(0.42),
  entryGapPt: normalGapToPt(0.42),
  titleSubGapPt: normalGapToPt(0.18),
  headBulletGapPt: normalGapToPt(0.42),
  skillsRowGapPt: smallGapToPt(0),
  bulletGapPt: normalGapToPt(0.2),
  headingCase: "smallcaps",
  sectionRule: true,
  contactDivider: "|",
  headerAlign: "center",
  bodyAlign: "left",
  headingAlign: "left",
  nameSize: "huge",
  pageMargins: "normal",
  pageMarginTopPt: PAGE_MARGIN_PRESETS_PT.normal,
  pageMarginRightPt: PAGE_MARGIN_PRESETS_PT.normal,
  pageMarginBottomPt: PAGE_MARGIN_PRESETS_PT.normal,
  pageMarginLeftPt: PAGE_MARGIN_PRESETS_PT.normal
};

export function toDocumentStyle(style: DocStyle): DocumentStyle {
  return {
    fontFamily: style.fontFamily,
    baseFontSizePt: style.baseFontSizePt,
    letterSpacingPt: style.letterSpacingPt,
    lineHeight: style.lineHeight,
    entryIndentPt: style.entryIndentPt,
    entryEndIndentPt: style.entryEndIndentPt,
    nameContactGapPt: style.nameContactGapPt,
    contactGapPt: style.contactGapPt,
    headerSectionGapPt: style.headerSectionGapPt,
    sectionGapPt: style.sectionGapPt,
    sectionEntryGapPt: style.sectionEntryGapPt,
    entryGapPt: style.entryGapPt,
    titleSubGapPt: style.titleSubGapPt,
    headBulletGapPt: style.headBulletGapPt,
    skillsRowGapPt: style.skillsRowGapPt,
    bulletGapPt: style.bulletGapPt,
    headingCase: style.headingCase,
    sectionRule: style.sectionRule,
    contactDivider: style.contactDivider,
    headerAlign: style.headerAlign,
    bodyAlign: style.bodyAlign,
    headingAlign: style.headingAlign,
    nameSize: style.nameSize,
    pageMargins: style.pageMargins,
    pageMarginTopPt: style.pageMarginTopPt,
    pageMarginRightPt: style.pageMarginRightPt,
    pageMarginBottomPt: style.pageMarginBottomPt,
    pageMarginLeftPt: style.pageMarginLeftPt
  };
}

// Structural fields owned by the Paragraph and Styles menus. Direct text
// formatting and page geometry are intentionally excluded from this reset.
export type DocStyleFields = Pick<
  DocStyle,
  | "entryIndentPt"
  | "entryEndIndentPt"
  | "headingCase"
  | "sectionRule"
  | "contactDivider"
  | "headerAlign"
  | "bodyAlign"
  | "headingAlign"
>;

// Default values for the fields controlled by the Text style menu. The name
// renders in natural case regardless because it is not one of these fields.
export const TEXT_STYLE_DEFAULTS: DocStyleFields = {
  entryIndentPt: DOC_STYLE_DEFAULTS.entryIndentPt,
  entryEndIndentPt: DOC_STYLE_DEFAULTS.entryEndIndentPt,
  headingCase: "smallcaps",
  sectionRule: true,
  contactDivider: "|",
  headerAlign: "center",
  bodyAlign: "left",
  headingAlign: "left"
};

export type DocSpacingKey =
  | "nameContactGapPt"
  | "contactGapPt"
  | "headerSectionGapPt"
  | "sectionGapPt"
  | "sectionEntryGapPt"
  | "entryGapPt"
  | "titleSubGapPt"
  | "headBulletGapPt"
  | "skillsRowGapPt"
  | "bulletGapPt";

export const DOC_SPACING_KEYS: DocSpacingKey[] = [
  "nameContactGapPt",
  "contactGapPt",
  "headerSectionGapPt",
  "sectionGapPt",
  "sectionEntryGapPt",
  "entryGapPt",
  "titleSubGapPt",
  "headBulletGapPt",
  "skillsRowGapPt",
  "bulletGapPt"
];

export type DocSpacingPreset = Pick<DocStyle, DocSpacingKey>;

export const DOC_SPACING_PRESETS = {
  compact: {
    label: "Compact",
    values: {
      nameContactGapPt: nameContactGapToPt(0.02),
      contactGapPt: contactGapToPt(1.6),
      headerSectionGapPt: headerSectionGapToPt(0.82),
      sectionGapPt: normalGapToPt(0.48),
      sectionEntryGapPt: normalGapToPt(0.3),
      entryGapPt: normalGapToPt(0.24),
      titleSubGapPt: normalGapToPt(0.1),
      headBulletGapPt: normalGapToPt(0.24),
      skillsRowGapPt: smallGapToPt(0),
      bulletGapPt: normalGapToPt(0.08)
    }
  },
  balanced: {
    label: "Balanced",
    values: {
      nameContactGapPt: DOC_STYLE_DEFAULTS.nameContactGapPt,
      contactGapPt: DOC_STYLE_DEFAULTS.contactGapPt,
      headerSectionGapPt: DOC_STYLE_DEFAULTS.headerSectionGapPt,
      sectionGapPt: DOC_STYLE_DEFAULTS.sectionGapPt,
      sectionEntryGapPt: DOC_STYLE_DEFAULTS.sectionEntryGapPt,
      entryGapPt: DOC_STYLE_DEFAULTS.entryGapPt,
      titleSubGapPt: DOC_STYLE_DEFAULTS.titleSubGapPt,
      headBulletGapPt: DOC_STYLE_DEFAULTS.headBulletGapPt,
      skillsRowGapPt: DOC_STYLE_DEFAULTS.skillsRowGapPt,
      bulletGapPt: DOC_STYLE_DEFAULTS.bulletGapPt
    }
  },
  spacious: {
    label: "Spacious",
    values: {
      nameContactGapPt: 1.4,
      contactGapPt: 20,
      headerSectionGapPt: 11,
      sectionGapPt: 12,
      sectionEntryGapPt: 5.8,
      entryGapPt: 6,
      titleSubGapPt: 3.2,
      headBulletGapPt: 5.6,
      skillsRowGapPt: 1.2,
      bulletGapPt: 3.2
    }
  }
} as const satisfies Record<string, { label: string; values: DocSpacingPreset }>;

// Google-Docs-style zoom steps for the Resume tab's page-zoom select.
// 1 = true size (816 CSS px page). The select also offers a one-shot "Fit"
// that computes paneWidth/816 into a custom numeric zoom.
export const DOC_ZOOM_OPTIONS = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2] as const;

// The next preset step from an arbitrary zoom (a "Fit" zoom sits between
// presets), clamped at the ends. Shared by the toolbar buttons and the
// keyboard shortcuts.
export function nextZoomOption(current: number, direction: -1 | 1): number {
  const options = DOC_ZOOM_OPTIONS as readonly number[];
  if (direction < 0) return [...options].reverse().find((value) => value < current) ?? options[0];
  return options.find((value) => value > current) ?? options[options.length - 1];
}

// Logical page width in CSS px at 100% zoom (8.5in × 96px/in) — the divisor
// for the zoom select's "Fit" computation.
export const DOC_PAGE_WIDTH_PX = 816;

const clamp = (value: unknown, fallback: number, min: number, max: number) => {
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
};

const clampStyleNumber = <K extends keyof typeof DOC_STYLE_BOUNDS>(
  key: K,
  value: unknown,
  fallback: number
) => {
  const { min, max } = DOC_STYLE_BOUNDS[key];
  return clamp(value, fallback, min, max);
};

// Contact divider is a short glyph (UI offers | • · – /, plus a free 2-char
// input). Clamp to 2 chars so it can't blow out the header; empty falls back to
// the default "|".
const coerceDivider = (value: unknown): string => {
  if (typeof value !== "string") return DOC_STYLE_DEFAULTS.contactDivider;
  const trimmed = value.slice(0, 2);
  return trimmed.length ? trimmed : DOC_STYLE_DEFAULTS.contactDivider;
};

export function coerceDocStyle(raw: unknown): DocStyle {
  const r = (raw ?? {}) as Record<string, unknown>;
  const pageMargins: PageMargins =
    r.pageMargins === "narrow" || r.pageMargins === "wide" || r.pageMargins === "custom"
      ? r.pageMargins
      : DOC_STYLE_DEFAULTS.pageMargins;
  const fallbackMargins = pageMarginValuesFor(pageMargins);
  return {
    zoom: clampStyleNumber("zoom", r.zoom, DOC_STYLE_DEFAULTS.zoom),
    spellCheck: typeof r.spellCheck === "boolean" ? r.spellCheck : DOC_STYLE_DEFAULTS.spellCheck,
    fontFamily:
      r.fontFamily === "source-serif" || r.fontFamily === "source-sans"
        ? r.fontFamily
        : DOC_STYLE_DEFAULTS.fontFamily,
    baseFontSizePt: clampStyleNumber("baseFontSizePt", r.baseFontSizePt, DOC_STYLE_DEFAULTS.baseFontSizePt),
    letterSpacingPt: clampStyleNumber("letterSpacingPt", r.letterSpacingPt, DOC_STYLE_DEFAULTS.letterSpacingPt),
    lineHeight: clampStyleNumber("lineHeight", r.lineHeight, DOC_STYLE_DEFAULTS.lineHeight),
    entryIndentPt: clampStyleNumber("entryIndentPt", r.entryIndentPt, DOC_STYLE_DEFAULTS.entryIndentPt),
    entryEndIndentPt: clampStyleNumber(
      "entryEndIndentPt",
      r.entryEndIndentPt,
      DOC_STYLE_DEFAULTS.entryEndIndentPt
    ),
    nameContactGapPt: clampStyleNumber("nameContactGapPt", r.nameContactGapPt, DOC_STYLE_DEFAULTS.nameContactGapPt),
    contactGapPt: clampStyleNumber("contactGapPt", r.contactGapPt, DOC_STYLE_DEFAULTS.contactGapPt),
    headerSectionGapPt: clampStyleNumber(
      "headerSectionGapPt",
      r.headerSectionGapPt,
      DOC_STYLE_DEFAULTS.headerSectionGapPt
    ),
    sectionGapPt: clampStyleNumber("sectionGapPt", r.sectionGapPt, DOC_STYLE_DEFAULTS.sectionGapPt),
    sectionEntryGapPt: clampStyleNumber(
      "sectionEntryGapPt",
      r.sectionEntryGapPt,
      DOC_STYLE_DEFAULTS.sectionEntryGapPt
    ),
    entryGapPt: clampStyleNumber("entryGapPt", r.entryGapPt, DOC_STYLE_DEFAULTS.entryGapPt),
    titleSubGapPt: clampStyleNumber("titleSubGapPt", r.titleSubGapPt, DOC_STYLE_DEFAULTS.titleSubGapPt),
    headBulletGapPt: clampStyleNumber(
      "headBulletGapPt",
      r.headBulletGapPt,
      DOC_STYLE_DEFAULTS.headBulletGapPt
    ),
    skillsRowGapPt: clampStyleNumber("skillsRowGapPt", r.skillsRowGapPt, DOC_STYLE_DEFAULTS.skillsRowGapPt),
    bulletGapPt: clampStyleNumber("bulletGapPt", r.bulletGapPt, DOC_STYLE_DEFAULTS.bulletGapPt),
    headingCase:
      r.headingCase === "uppercase" || r.headingCase === "none"
        ? r.headingCase
        : DOC_STYLE_DEFAULTS.headingCase,
    sectionRule: r.sectionRule !== false,
    contactDivider: coerceDivider(r.contactDivider),
    headerAlign:
      r.headerAlign === "left" || r.headerAlign === "right" ? r.headerAlign : DOC_STYLE_DEFAULTS.headerAlign,
    bodyAlign:
      r.bodyAlign === "justify" || r.bodyAlign === "center" || r.bodyAlign === "right"
        ? r.bodyAlign
        : DOC_STYLE_DEFAULTS.bodyAlign,
    headingAlign:
      r.headingAlign === "center" || r.headingAlign === "right" ? r.headingAlign : DOC_STYLE_DEFAULTS.headingAlign,
    nameSize: r.nameSize === "large" || r.nameSize === "xlarge" ? r.nameSize : DOC_STYLE_DEFAULTS.nameSize,
    pageMargins,
    pageMarginTopPt: clampStyleNumber("pageMarginTopPt", r.pageMarginTopPt, fallbackMargins.top),
    pageMarginRightPt: clampStyleNumber("pageMarginRightPt", r.pageMarginRightPt, fallbackMargins.right),
    pageMarginBottomPt: clampStyleNumber("pageMarginBottomPt", r.pageMarginBottomPt, fallbackMargins.bottom),
    pageMarginLeftPt: clampStyleNumber("pageMarginLeftPt", r.pageMarginLeftPt, fallbackMargins.left)
  };
}

// The ten point-gap fields that make up a spacing preset. Line height is an
// independent text-flow control and is deliberately not bundled into presets.
export function pickDocSpacing(style: DocStyle): DocSpacingPreset {
  const preset = {} as DocSpacingPreset;
  for (const key of DOC_SPACING_KEYS) preset[key] = style[key];
  return preset;
}
