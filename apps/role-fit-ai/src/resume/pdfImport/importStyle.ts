// Maps what the PDF shows onto the existing document style: the nearest
// bundled family, page margins, header alignment, heading case, and section
// rules, plus the body size the body-sized fields take. Everything else keeps
// the editor defaults; spacing is not inferred.

import {
  DOC_STYLE_DEFAULTS,
  toDocumentStyle,
  type DocumentStyle,
  type HeaderAlign
} from "@typeset/engine/lib/documentStyle.ts";
import type { FontFamily } from "@typeset/engine/lib/fontFamilies.ts";
import type { ResumeData } from "@typeset/engine/lib/resumeData.ts";
import {
  setStyleFieldSize,
  styleFieldDefaultSizePt,
  type StyleTextField
} from "@typeset/engine/lib/styleFieldFormatting.ts";
import { PAGE_MARGIN_BOUNDS_PT } from "@typeset/engine/lib/pageMargins.ts";
import type { LayoutLine } from "./layoutLines.ts";
import type { PdfLayout } from "./pdfLayout.ts";
import type { ImportDraft } from "./resumeFromLayout.ts";

export type StyleNote = { reason: string; source: string };

// Added families match their upstream name only when nothing but an optical
// size, a variable-font marker, or style words follows, so another design
// sharing the prefix (Roboto Slab, Interstate) still falls back. RoleFit's
// exports embed them as "Typeset Document <hash>", the first 12 hex of
// sha256(id) (packages/engine/scripts/generate_font_assets.py).
const STYLE_TAIL = "(?:\\d+pt)?(?:variable|var)?(?:regular|roman|book|text|italic|oblique|thin|hairline|hair|light|medium|semi|demi|extra|ultra|bold|black|heavy|caps)*$";
const added = (name: string, hash: string, family: FontFamily): [RegExp, FontFamily] => [
  new RegExp(`^(?:typesetdocument${hash}|${name}${STYLE_TAIL})`, "i"),
  family
];

const FAMILY_PATTERNS: readonly [RegExp, FontFamily][] = [
  [/^(?:typeset)?(?:tinos|times|liberationserif|nimbusrom|termes)/i, "tinos"],
  [/^(?:typeset)?(?:carlito|calibri)/i, "carlito"],
  [/^(?:typeset)?(?:arimo|arial|helvetica|liberationsans|nimbussans)/i, "arimo"],
  [/^(?:typeset)?(?:sourceserif|serif4)/i, "source-serif"],
  [/^(?:typeset)?(?:sourcesans|sans3)/i, "source-sans"],
  [/^(?:lmroman|lmsans|latinmodern|cmr|cmbx|cmti|cmcsc|cmss|sfrm)/i, "latin-modern"],
  added("crimsonpro", "8d9f5c64733d", "crimson-pro"),
  added("dmsans", "9a232178fc32", "dm-sans"),
  added("firasans", "b2d2fdcc8fa9", "fira-sans"),
  added("ibmplexsans", "43071f94c33c", "ibm-plex-sans"),
  added("ibmplexserif", "e2262bc03e44", "ibm-plex-serif"),
  added("inter", "c84c80163560", "inter"),
  added("lato(?:latin)?", "4acb5d021cd5", "lato"),
  added("librebaskerville", "21dfd06eac29", "libre-baskerville"),
  added("librefranklin", "5aa9eb1ad016", "libre-franklin"),
  added("lora", "d339f720de1f", "lora"),
  added("merriweather", "e84622f018de", "merriweather"),
  added("merriweathersans", "d4a47445e457", "merriweather-sans"),
  added("montserrat", "3eeceb71042d", "montserrat"),
  added("notosans", "fffe2a601bcc", "noto-sans"),
  added("notoserif", "a96c3d229111", "noto-serif"),
  added("nunito", "24b2322b419a", "nunito"),
  added("nunitosans", "58a7dc0545a1", "nunito-sans"),
  added("opensans", "5e4c8b4cd741", "open-sans"),
  added("ptsans", "a4770ba31d29", "pt-sans"),
  added("ptserif", "f7c7ef138168", "pt-serif"),
  added("raleway", "b10c9f25282f", "raleway"),
  added("roboto", "9b68aef6bbcc", "roboto"),
  added("rubik", "85b935080587", "rubik"),
  added("worksans", "57eac634745a", "work-sans")
];
const SERIF_HINT_RE = /serif|roman|times|garamond|georgia|cambria|baskerville|palatino|minion|charter|caslon|bodoni|didot|book/i;

export function familyForFont(font: string): { family: FontFamily; exact: boolean } {
  const compact = font.replace(/[\s,_-]/g, "");
  const match = FAMILY_PATTERNS.find(([pattern]) => pattern.test(compact));
  if (match) return { family: match[1], exact: true };
  return { family: SERIF_HINT_RE.test(compact) && !/sans/i.test(compact) ? "tinos" : "arimo", exact: false };
}

function clampMargin(value: number): { value: number; clamped: boolean } {
  const rounded = Math.round(value * 10) / 10;
  const bounded = Math.min(PAGE_MARGIN_BOUNDS_PT.max, Math.max(PAGE_MARGIN_BOUNDS_PT.min, rounded));
  return { value: bounded, clamped: bounded !== rounded };
}

// The range an inferred body size is kept within, so a misread size cannot set
// unreadable text.
const BODY_SIZE_BOUNDS_PT = { min: 8, max: 12 } as const;
// The fields a PDF's body text size applies to: body text and the small roles
// set beside it. Titles, headings, and the name keep their defaults.
const BODY_SIZED_FIELDS: readonly StyleTextField[] = ["body", "subtitleLeft", "subtitleRight", "contact", "skillLabel"];

export function applyImportedBodySize(data: ResumeData, bodySizePt: number): ResumeData {
  return BODY_SIZED_FIELDS.reduce(
    (next, field) => bodySizePt === styleFieldDefaultSizePt(field) ? next : setStyleFieldSize(next, field, bodySizePt),
    data
  );
}

export function inferImportStyle(
  layout: PdfLayout,
  evidence: ImportDraft["evidence"]
): { style: DocumentStyle; bodySizePt: number; notes: StyleNote[] } {
  const notes: StyleNote[] = [];
  const style = toDocumentStyle(DOC_STYLE_DEFAULTS);
  const lines = evidence.contentLines;
  const detectedSize = Math.round(evidence.bodySize * 2) / 2;
  const bodySizePt = Math.min(BODY_SIZE_BOUNDS_PT.max, Math.max(BODY_SIZE_BOUNDS_PT.min, detectedSize));
  if (bodySizePt !== detectedSize) {
    notes.push({ reason: `Body text size ${detectedSize} pt is outside the import's ${BODY_SIZE_BOUNDS_PT.min}–${BODY_SIZE_BOUNDS_PT.max} pt range and was adjusted.`, source: "" });
  }
  if (!lines.length) return { style, bodySizePt, notes };

  const fontWeights = new Map<string, number>();
  for (const line of lines) {
    if (Math.abs(line.size - evidence.bodySize) > 0.5) continue;
    for (const piece of line.segments.flat()) {
      if (piece.span.dingbat || !piece.span.font) continue;
      fontWeights.set(piece.span.font, (fontWeights.get(piece.span.font) ?? 0) + piece.text.length);
    }
  }
  const bodyFont = [...fontWeights.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (bodyFont) {
    const { family, exact } = familyForFont(bodyFont);
    style.fontFamily = family;
    if (!exact) notes.push({ reason: "The PDF's font isn't bundled; the closest available family was used.", source: bodyFont });
  } else {
    notes.push({ reason: "The PDF's font couldn't be identified; the default family was used.", source: "" });
  }

  const page = layout.pages[0];
  const wideRules = layout.rules.filter((rule) => rule.x1 - rule.x0 >= page.width * 0.4);
  const left = Math.min(...lines.map((line) => line.marker?.x ?? line.x));
  const right = Math.max(...lines.map((line) => line.right), ...wideRules.map((rule) => rule.x1));
  const firstLines = layout.pages.map((_, index) => lines.find((line) => line.page === index)).filter((line): line is LayoutLine => Boolean(line));
  const top = Math.min(...firstLines.map((line) => line.y - 0.95 * line.size));
  const fullPages = layout.pages.slice(0, -1).map((_, index) => lines.filter((line) => line.page === index).pop()).filter((line): line is LayoutLine => Boolean(line));
  const bottom = fullPages.length ? page.height - Math.max(...fullPages.map((line) => line.y + 0.25 * line.size)) : top;
  const margins = {
    pageMarginLeftPt: clampMargin(left),
    pageMarginRightPt: clampMargin(page.width - right),
    pageMarginTopPt: clampMargin(top),
    pageMarginBottomPt: clampMargin(bottom)
  };
  for (const [key, margin] of Object.entries(margins) as [keyof typeof margins, { value: number; clamped: boolean }][]) {
    style[key] = margin.value;
  }
  if (Object.values(margins).some((margin) => margin.clamped)) {
    notes.push({ reason: "A page margin was outside the editor's range and was adjusted.", source: "" });
  }

  const contentLeft = style.pageMarginLeftPt;
  const contentRight = page.width - style.pageMarginRightPt;
  const tolerance = 0.03 * (contentRight - contentLeft);
  const alignOf = (line: LayoutLine): HeaderAlign => {
    if (Math.abs((line.x + line.right) / 2 - (contentLeft + contentRight) / 2) <= tolerance && line.x > contentLeft + tolerance) return "center";
    if (Math.abs(line.right - contentRight) <= tolerance && line.x > contentLeft + tolerance) return "right";
    return "left";
  };
  style.headerAlign = evidence.nameLine ? alignOf(evidence.nameLine) : "left";

  const headings = evidence.headingLines;
  if (headings.length) {
    const centered = headings.filter((line) => alignOf(line) === "center").length;
    style.headingAlign = centered > headings.length / 2 ? "center" : "left";
    style.headingCase = headings.filter((line) => line.smallCaps).length > headings.length / 2 ? "smallcaps" : "none";
    style.sectionRule = evidence.ruledHeadings >= Math.max(1, headings.length / 2);
  } else {
    style.headingCase = "none";
    style.sectionRule = false;
  }
  return { style, bodySizePt, notes };
}
