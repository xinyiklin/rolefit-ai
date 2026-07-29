import {
  PAGE_MARGIN_BOUNDS_PT,
  PAGE_MARGIN_PRESETS_PT,
  pageMarginsForValues,
  pageMarginValuesFor,
  type PageMargins
} from "./pageMargins.ts";
import type { FieldAlignment } from "./inlineMarksText.ts";
import { coerceFontFamily, FONT_FAMILIES, type FontFamily } from "./fontFamilies.ts";

export type { PageMargins } from "./pageMargins.ts";

export type { FontFamily } from "./fontFamilies.ts";
export type HeadingCase = "smallcaps" | "uppercase" | "none";
export type HeaderAlign = "left" | "center" | "right";
// The document-level name for the one alignment union (see FieldAlignment).
export type BodyAlign = FieldAlignment;
export type AlignmentScope = "body" | "header" | "heading";

// The page every document is set on: its face, its body size and leading, its
// text alignment, and the four physical margins. A resume and a letter are the
// same page; only what sits on it differs.
export type PageStyle = {
  fontFamily: FontFamily;
  baseFontSizePt: number;
  lineHeight: number; // unitless body-leading multiplier
  bodyAlign: BodyAlign;
  pageMarginTopPt: number;
  pageMarginRightPt: number;
  pageMarginBottomPt: number;
  pageMarginLeftPt: number;
};

// The letterhead: a name, contact items, and the space around them. Genuinely
// shared, because both documents paint it from the same stream.
export type HeaderStyle = {
  contactDivider: string;
  headerAlign: HeaderAlign;
  nameContactGapPt: number;
  contactGapPt: number;
  headerSectionGapPt: number;
};

// Sections, entries, and bullets — structure a cover letter does not have. Kept
// separate so a letter cannot inherit a resume's body settings by accident.
export type ResumeBodyStyle = {
  entryIndentPt: number;
  entryEndIndentPt: number;
  sectionGapPt: number;
  sectionEntryGapPt: number;
  entryGapPt: number;
  titleSubGapPt: number;
  headBulletGapPt: number;
  skillsRowGapPt: number;
  bulletGapPt: number;
  headingCase: HeadingCase;
  headingAlign: HeaderAlign;
  sectionRule: boolean;
};

// What a cover letter's layout reads, and nothing else.
export type CoverLetterDocumentStyle = PageStyle & HeaderStyle;

// Everything that changes a resume's printed output. Keep this explicit rather
// than deriving it from the view state: `.resume` validation treats it as a
// strict, versioned persistence contract, and its field set is unchanged by the
// split above.
export type DocumentStyle = PageStyle & HeaderStyle & ResumeBodyStyle;

// User-adjustable typography and page layout for the browser typesetting engine.
export type DocStyle = DocumentStyle & {
  // Derived editor state only. Portable files persist the four physical margin
  // values, so renaming or removing a preset cannot change document meaning.
  pageMargins: PageMargins;
  // Page zoom, Google-Docs style: 1 (= "100%") is the comfortable default page
  // (75% of the pane); width and font scale by the same factor.
  zoom: number;
  // Browser spell-check underlines in the editable page. A local view
  // preference like zoom — off by default and never written to a .resume file.
  spellCheck: boolean;
};

// Every gap below is plain space ADDED at its junction, in PDF points. A gap of
// 0 adds nothing: rows sit one line advance apart, and the contact separator
// touches its neighbours.

// Menu/validation view of lib/fontFamilies.ts. Derived, not declared, so the
// codec enum and the toolbar can never disagree about which families exist.
export const FONT_FAMILY_OPTIONS: readonly {
  value: FontFamily;
  label: string;
  metricsOf?: string;
}[] = FONT_FAMILIES.map((family) => ({
  value: family.id,
  label: family.label,
  ...("metricsOf" in family ? { metricsOf: family.metricsOf } : {})
}));

// One source of truth for UI constraints, local-state coercion, and strict file
// validation. Gap bounds start at 0 because 0 is now a meaningful setting: no
// space added at that junction.
export const DOC_STYLE_BOUNDS = {
  zoom: { min: 0.5, max: 2, step: 0.01 },
  baseFontSizePt: { min: 8, max: 12, step: 0.5 },
  lineHeight: { min: 1, max: 2, step: 0.01 },
  entryIndentPt: { min: 0, max: 36, step: 0.1 },
  entryEndIndentPt: { min: 0, max: 36, step: 0.1 },
  nameContactGapPt: { min: 0, max: 24, step: 0.1 },
  // Horizontal slot for the contact separator; the painter floors it at the
  // separator glyph's own width.
  contactGapPt: { min: 0, max: 30, step: 0.1 },
  headerSectionGapPt: { min: 0, max: 48, step: 0.1 },
  sectionGapPt: { min: 0, max: 36, step: 0.1 },
  sectionEntryGapPt: { min: 0, max: 24, step: 0.1 },
  entryGapPt: { min: 0, max: 24, step: 0.1 },
  // The one junction inside a block rather than between them: a resume's entry
  // head is a title/subtitle pair traditionally set TIGHTER than single
  // spacing. 0 is single-spaced like every other gap; negative pulls the
  // subtitle up under its title, and the painter's ink floor still stops the
  // two rows from ever touching.
  titleSubGapPt: { min: -6, max: 18, step: 0.1 },
  headBulletGapPt: { min: 0, max: 24, step: 0.1 },
  skillsRowGapPt: { min: 0, max: 18, step: 0.1 },
  bulletGapPt: { min: 0, max: 18, step: 0.1 },
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
  lineHeight: 1.18,
  entryIndentPt: 10.8,
  // A 5.4 pt end inset at the default US-Letter text width, matching the
  // entry's 0.15in start inset.
  entryEndIndentPt: 5.4,
  nameContactGapPt: 4,
  contactGapPt: 18,
  headerSectionGapPt: 14,
  sectionGapPt: 8.9,
  sectionEntryGapPt: 5.4,
  entryGapPt: 4.5,
  titleSubGapPt: 0,
  headBulletGapPt: 4.5,
  skillsRowGapPt: 1.5,
  bulletGapPt: 2.1,
  headingCase: "smallcaps",
  sectionRule: true,
  contactDivider: "|",
  headerAlign: "center",
  bodyAlign: "left",
  headingAlign: "left",
  pageMargins: "narrow",
  pageMarginTopPt: PAGE_MARGIN_PRESETS_PT.narrow,
  pageMarginRightPt: PAGE_MARGIN_PRESETS_PT.narrow,
  pageMarginBottomPt: PAGE_MARGIN_PRESETS_PT.narrow,
  pageMarginLeftPt: PAGE_MARGIN_PRESETS_PT.narrow
};

export function toDocumentStyle(style: DocStyle): DocumentStyle {
  return {
    fontFamily: style.fontFamily,
    baseFontSizePt: style.baseFontSizePt,
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
  | "lineHeight"
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
  "lineHeight",
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
      lineHeight: 1.08,
      nameContactGapPt: 3.2,
      contactGapPt: 15.9,
      headerSectionGapPt: 9.6,
      sectionGapPt: 4.9,
      sectionEntryGapPt: 4.0,
      entryGapPt: 2.6,
      titleSubGapPt: 0,
      headBulletGapPt: 2.5,
      skillsRowGapPt: 1.4,
      bulletGapPt: 0.8
    }
  },
  balanced: {
    label: "Balanced",
    values: {
      lineHeight: DOC_STYLE_DEFAULTS.lineHeight,
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
      lineHeight: 1.3,
      nameContactGapPt: 5.7,
      contactGapPt: 20,
      headerSectionGapPt: 16.2,
      sectionGapPt: 11.6,
      sectionEntryGapPt: 6.7,
      entryGapPt: 5.9,
      titleSubGapPt: 0.4,
      headBulletGapPt: 5.5,
      skillsRowGapPt: 2.9,
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
  const legacyPageMargins: PageMargins =
    r.pageMargins === "narrow" || r.pageMargins === "custom"
      ? r.pageMargins
      : "normal";
  const fallbackMargins = pageMarginValuesFor(legacyPageMargins);
  const physicalMargins = {
    top: clampStyleNumber("pageMarginTopPt", r.pageMarginTopPt, fallbackMargins.top),
    right: clampStyleNumber("pageMarginRightPt", r.pageMarginRightPt, fallbackMargins.right),
    bottom: clampStyleNumber("pageMarginBottomPt", r.pageMarginBottomPt, fallbackMargins.bottom),
    left: clampStyleNumber("pageMarginLeftPt", r.pageMarginLeftPt, fallbackMargins.left)
  };
  return {
    zoom: clampStyleNumber("zoom", r.zoom, DOC_STYLE_DEFAULTS.zoom),
    spellCheck: typeof r.spellCheck === "boolean" ? r.spellCheck : DOC_STYLE_DEFAULTS.spellCheck,
    fontFamily: coerceFontFamily(r.fontFamily, DOC_STYLE_DEFAULTS.fontFamily),
    baseFontSizePt: clampStyleNumber("baseFontSizePt", r.baseFontSizePt, DOC_STYLE_DEFAULTS.baseFontSizePt),
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
    pageMargins: pageMarginsForValues(physicalMargins),
    pageMarginTopPt: physicalMargins.top,
    pageMarginRightPt: physicalMargins.right,
    pageMarginBottomPt: physicalMargins.bottom,
    pageMarginLeftPt: physicalMargins.left
  };
}

// Line height plus the ten point-gap fields that make up a spacing preset.
export function pickDocSpacing(style: DocStyle): DocSpacingPreset {
  const preset = {} as DocSpacingPreset;
  for (const key of DOC_SPACING_KEYS) preset[key] = style[key];
  return preset;
}
