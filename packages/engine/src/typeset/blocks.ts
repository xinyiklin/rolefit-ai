// Vertical layout for the generic resume model: converts structured resume data
// and DocStyle into the line-and-spacing stream shared by editing and print.
//
// MODEL — a vertical list flattened to baseline arithmetic:
//   nextBaseline = prevBaseline + junction(prev, next)
// Each junction is the following row's own line advance plus the document's gap
// for that junction, so every rendering surface shares the same rhythm and a
// gap of 0 adds nothing.

import { documentFontFamily, type DocumentFontFamily } from "./fontRegistry.ts";
import type { FieldSrc, FontStyle, GlyphRun, ParagraphAlign } from "./types.ts";
import {
  bulletMarkerSizePt,
  fieldRoleSizePt,
  rowRoleSizePt,
  TEXT_SIZES_PT
} from "../lib/documentTypography.ts";
import {
  faceExtent,
  faceFor,
  faceForOverride,
  inkExtent,
  measure,
  paragraphItems,
  segmentsFromInlineMarks,
  texLigatures,
  underlineRule,
  underlineSpans,
  type FaceOverride
} from "./measure.ts";
import { automaticLinkHref } from "../lib/links.ts";
import { breakParagraph } from "./linebreak.ts";
import { wrapHeadRow, wrapSingleField } from "./headRows.ts";
import {
  alignmentFromInlineMarks,
  hasInlineMarkTags,
  paragraphIndentFromInlineMarks,
  paragraphSpacingFromInlineMarks,
  skillsRowText,
  stripInlineMarks,
  uppercaseInlineMarkedText
} from "../lib/inlineMarksText.ts";
import {
  DOC_STYLE_DEFAULTS,
  type DocumentStyle,
  type HeaderStyle,
  type PageStyle
} from "../lib/documentStyle.ts";
import type { TypesetSchema } from "./schema.ts";

// US-Letter page in bp (1/72in): 8.5in × 11in. The one owner of the physical
// page size shared by geometry, the DOM painter, the PDF emitter, and the
// editor's pointer math.
export const PAGE_WIDTH_BP = 612;
export const PAGE_HEIGHT_BP = 792;

// One typeset line placed in the vertical stream. x/runs are relative to the
// text column's left edge; `dist` is the baseline distance from the PREVIOUS
// line. Page breaking recomputes the first line from the page's minimum inset.
export type VLine = {
  // A wrapped continuation (of a heading row, or of a kept-together paragraph)
  // where layout may split an otherwise over-tall keep chain.
  emergencyBreakBefore?: boolean;
  runs: GlyphRun[]; // x already includes the line's indent
  // The row's role-size footprint for page-top placement and page-bottom fit.
  // Headers reserve face boxes; body rows a fixed reference-string ink box.
  // Oversized inline runs contribute through the overflow fields instead.
  height: number;
  depth: number;
  // Extra room this line needs beyond its calibrated junction because an inline
  // run is LARGER than the row's role size. Derived from face boxes, never from
  // the glyphs on the line, so typing a taller or deeper character inside an
  // oversized run cannot change the spacing around it.
  riseOverflow: number; // above the baseline
  dropOverflow: number; // below the baseline
  dist: number; // baseline distance from previous line in the stream
  // Paragraph rows expose selection geometry independently of their calibrated
  // junction distance. The editor can then paint authored paragraph spacing
  // without trying to reverse-engineer it from neighbouring baselines.
  leading?: number;
  paragraphSpaceBefore?: number;
  paragraphSpaceAfter?: number;
  // Inline line-height adjusts the following junction without moving this baseline.
  afterDist?: number;
  // Pagination policy: "keep" lines may not start a page-break separation from
  // their predecessor (entry head rows, a bullet after its head, rules).
  keepWithPrev: boolean;
  rule?: { x: number; width: number; yOffset: number; thickness: number };
};

const num = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

// Defaults mirror DOC_STYLE_DEFAULTS. These are physical PDF/DTP points of
// space ADDED to a junction, not font-relative CSS em values: 0 is no added
// space anywhere.
const GAP_PT = {
  nameContactGapPt: 4,
  contactGapPt: 18,
  headerSectionGapPt: 14,
  sectionGapPt: 8.9,
  sectionEntryGapPt: 5.4,
  entryGapPt: 4.5,
  titleSubGapPt: 0,
  headBulletGapPt: 4.5,
  skillsRowGapPt: 1.5,
  bulletGapPt: 2.1
} as const;

// ---- Geometry (bp) ----
// Minimum distance from the top margin to a page's first baseline.
const FIRST_BASELINE_INSET_PT = 11;
// Distance from the bullet dot to its text.
const BULLET_TEXT_GAP_PT = 9.47;

// The page box: margins, the measure, and the first/last baseline limits. A
// cover letter needs exactly this much geometry.
export function pageBox(style: PageStyle) {
  const margins = {
    top: style.pageMarginTopPt,
    right: style.pageMarginRightPt,
    bottom: style.pageMarginBottomPt,
    left: style.pageMarginLeftPt
  };
  return {
    marginTop: margins.top,
    marginRight: margins.right,
    marginBottom: margins.bottom,
    marginLeft: margins.left,
    textWidth: PAGE_WIDTH_BP - margins.left - margins.right,
    firstBaselineMin: margins.top + FIRST_BASELINE_INSET_PT,
    lastBaselineMax: PAGE_HEIGHT_BP - margins.bottom
  };
}

// The page box plus the entry insets only a resume's body uses.
export function pageGeometry(style: DocumentStyle) {
  const box = pageBox(style);
  const entryIndent = num(style.entryIndentPt, DOC_STYLE_DEFAULTS.entryIndentPt);
  const entryEndIndent = num(style.entryEndIndentPt, DOC_STYLE_DEFAULTS.entryEndIndentPt);
  const bulletMarker = entryIndent + num(style.bulletIndentPt, DOC_STYLE_DEFAULTS.bulletIndentPt);
  const textWidth = box.textWidth;
  return {
    ...box,
    entryIndent,
    entryEndIndent,
    bulletMarker,
    bulletIndent: bulletMarker + BULLET_TEXT_GAP_PT,
    // Start indent moves only the left edge. End indent independently moves the
    // right edge, so changing one never drags the other. The inset applies to
    // the entry's right edge, so every row of the entry keeps it — head rows,
    // bullets, summary paragraphs, and skills rows alike.
    headRowWidth: Math.max(1, textWidth - entryIndent - entryEndIndent)
  };
}

// ---- Junctions ----
// Every structural junction is "the next row's own line advance, plus the gap
// the user set". A gap of 0 therefore means exactly what 0 means in the
// paragraph before/after controls: no space beyond one line, so every control
// can close the gap it names.
const lineAdvance = (size: number, lineHeight: number) => size * lineHeight;
// The header is a letterhead, not body copy: its rows sit one line apart at
// their own size and do not inherit the document's line spacing. That leaves
// the header's own gaps as the only thing that moves them, and makes a gap of 0
// mean the same distance in a resume and in a double-spaced cover letter.
const HEADER_LINE_HEIGHT = 1;

// Minimal clear gap between the title's descender ink and the subtitle's
// ascender ink. Ink extents do not scale with line height, so a tight line
// height or a negative head-row gap would otherwise drive the rows into
// overlap; this floors the distance so they can never collapse onto each other.
const MIN_TITLE_SUB_INK_GAP = 0.3;
// Calibrated clearance below an underlined or linked title's ink; the floor also
// honours the real rule depth, which this constant undershoots at larger sizes.
const UNDERLINE_EXTRA = 2.04;

function inkOfRuns(runs: GlyphRun[]): { height: number; depth: number } {
  let height = 0;
  let depth = 0;
  for (const run of runs) {
    const e = inkExtent(run.text, run.style);
    if (e.height > height) height = e.height;
    if (e.depth > depth) depth = e.depth;
  }
  return { height, depth };
}

// The row's page-top and page-fit footprint: a fixed reference string in each
// run's font at its role size, so typed glyphs never move a page break. (Face
// boxes would too, but Latin Modern's ascent exceeds the first-baseline inset
// and would move page-top baselines.) Runs larger than the role size contribute
// their excess through boxOverflowOfRuns.
const ROW_FOOTPRINT_TEXT = "Agjpqy";
function rowFootprint(runs: GlyphRun[], roleSize: number): { height: number; depth: number } {
  let height = 0;
  let depth = 0;
  for (const run of runs) {
    const extent = inkExtent(ROW_FOOTPRINT_TEXT, {
      ...run.style,
      size: Math.min(run.style.size, roleSize)
    });
    height = Math.max(height, extent.height);
    depth = Math.max(depth, extent.depth);
  }
  return { height, depth };
}

// Header page placement reserves the face box even for blank or short letters.
// Oversized runs contribute only their role-size box here; overflow is separate.
function headerRowExtent(runs: GlyphRun[], roleSize: number): { height: number; depth: number } {
  let height = 0;
  let depth = 0;
  for (const run of runs) {
    const extent = faceExtent({ ...run.style, size: Math.min(run.style.size, roleSize) });
    height = Math.max(height, extent.height);
    depth = Math.max(depth, extent.depth);
  }
  return { height, depth };
}

// Room an oversized inline run needs beyond the row's role size, measured from
// face boxes so it is the same for every glyph the run could hold. Zero whenever
// every run fits the role size, which keeps ordinary rows on their calibrated
// junctions exactly.
function boxOverflowOfRuns(runs: GlyphRun[], roleSize: number): { rise: number; drop: number } {
  let rise = 0;
  let drop = 0;
  for (const run of runs) {
    // An empty field's caret run has no glyphs to overflow with.
    if (run.style.size <= roleSize || run.text === "") continue;
    const box = faceExtent(run.style);
    const role = faceExtent({ ...run.style, size: roleSize });
    rise = Math.max(rise, box.height - role.height);
    drop = Math.max(drop, box.depth - role.depth);
  }
  return { rise, drop };
}

function styledRun(
  text: string,
  size: number,
  bold: boolean,
  italic: boolean,
  x: number,
  family: DocumentFontFamily,
  tracking: number,
  src?: FieldSrc
): GlyphRun {
  const style: FontStyle = { family, face: faceFor(bold, italic), size, tracking };
  // Same display-form contract as pushWord: punctuation transforms (– — ’) are
  // already applied and consistent with measured width.
  const display = texLigatures(text);
  return { text: display, style, x, width: measure(display, style), src };
}

// Head-row field (entry title/subtitle) that honors inline <b>/<i> marks so a
// per-entry override survives. When the field carries NO marks it falls back to
// the whole-field bold/italic FLAGS exactly as before — so already-plain fixture
// text (and every untouched resume) renders byte-identically.
function styledFieldRuns(
  value: string,
  size: number,
  flagBold: boolean,
  flagItalic: boolean,
  x: number,
  family: DocumentFontFamily,
  tracking: number,
  src?: FieldSrc,
  faceOverride?: FaceOverride
): GlyphRun[] {
  if (!hasInlineMarkTags(value)) {
    const run = styledRun(value, size, flagBold, flagItalic, x, family, tracking, src);
    run.href = automaticLinkHref(value) ?? undefined;
    if (faceOverride) {
      run.style = { ...run.style, face: faceForOverride(flagBold, flagItalic, faceOverride) };
      run.width = measure(run.text, run.style);
    }
    return [run];
  }
  const runs: GlyphRun[] = [];
  let cursorX = x;
  for (const seg of segmentsFromInlineMarks(value)) {
    if (!seg.text) continue;
    const style: FontStyle = {
      family: seg.fontFamily ?? family,
      face: faceForOverride(seg.bold || flagBold, seg.italic || flagItalic, faceOverride),
      size: seg.fontSizePt ?? size,
      tracking
    };
    const display = texLigatures(seg.text);
    const width = measure(display, style);
    runs.push({
      text: display,
      style,
      x: cursorX,
      width,
      src,
      href: seg.linkSuppressed ? undefined : seg.href ?? automaticLinkHref(seg.text) ?? undefined,
      underline: seg.underline,
      linkSuppressed: seg.linkSuppressed,
      ...(seg.lineHeight === null ? {} : { lineHeight: seg.lineHeight })
    });
    cursorX += width;
  }
  if (runs.length) return runs;
  const empty = styledRun("", size, flagBold, flagItalic, x, family, tracking, src);
  if (faceOverride) empty.style = { ...empty.style, face: faceForOverride(flagBold, flagItalic, faceOverride) };
  return [empty];
}

// Mark a run as a link when its source is an email address or URL-like value.
// Bare domains default to HTTPS.
function linkified(run: GlyphRun, source: string): GlyphRun {
  if (run.linkSuppressed || run.href) return run;
  const t = segmentsFromInlineMarks(source).map((segment) => segment.text).join("").trim();
  const href = automaticLinkHref(t);
  return href ? { ...run, href } : run;
}

// A two-sided head row: left text, right text pinned to the row's right edge.
function headRow(
  left: GlyphRun[],
  right: string,
  size: number,
  rightItalic: boolean,
  geo: ReturnType<typeof pageGeometry>,
  family: DocumentFontFamily,
  tracking: number,
  rightSrc?: FieldSrc
): GlyphRun[] {
  const runs = [...left];
  // Always emit the right field's runs, even when empty: styledFieldRuns("")
  // returns a single zero-width run that renders nothing but carries the field's
  // provenance, so an empty date/location keeps a caret target at the right edge
  // (matching the left fields) and can be clicked into and filled. Skipping it
  // when `right` was falsy made empty right fields uneditable in the page.
  if (rightSrc || right) {
    const rightRuns = styledFieldRuns(right, size, false, rightItalic, 0, family, tracking, rightSrc);
    const width = rightRuns.length ? rightRuns[rightRuns.length - 1].x + rightRuns[rightRuns.length - 1].width : 0;
    const dx = geo.entryIndent + geo.headRowWidth - width;
    runs.push(...rightRuns.map((run) => linkified({ ...run, x: run.x + dx }, right)));
  }
  return runs;
}

function runLineHeight(runs: GlyphRun[], fallback: number): number {
  const overrides = runs.flatMap((run) => run.lineHeight === undefined ? [] : [run.lineHeight]);
  return overrides.length ? Math.max(...overrides) : fallback;
}

// A title/subtitle row owns its leading when it wraps or carries a line-height
// mark, so the mark spaces the row identically either way. Other rows keep the
// calibrated junction and publish no leading.
function headRowLeading(
  runs: GlyphRun[],
  size: number,
  lineHeight: number,
  wrapped: boolean
): { leading?: number; afterDist?: number } {
  if (!wrapped && runs.every((run) => run.lineHeight === undefined)) return {};
  const leading = size * runLineHeight(runs, lineHeight);
  return { leading, afterDist: leading - lineAdvance(size, lineHeight) };
}

// The authored paragraph indent, held back so the paragraph keeps at least one
// glyph of measure inside `room` (the column it indents into). The stored mark
// is unchanged; only impossible geometry — a 3-inch margin plus a 3-inch
// indent — is clamped, so text never leaves the page in any renderer.
export function fitParagraphIndent(indentPt: number, room: number, size: number): number {
  return Math.max(0, Math.min(indentPt, room - size));
}

// Paragraph → VLines at an indent within a column width.
export function paragraphLines(
  value: string,
  size: number,
  indent: number,
  column: number,
  align: ParagraphAlign,
  baselineskip: number,
  firstDist: number,
  keepFirst: boolean,
  family: DocumentFontFamily,
  tracking: number,
  // Bullets keep all their lines together (editor policy); free-standing
  // paragraphs (summaries) may break mid-paragraph, so an over-tall
  // paragraph can never silently overflow a page.
  keepLinesTogether = true,
  src?: FieldSrc,
  // Empty fields carry outgoing spacing explicitly because they have no glyph run.
  emptyLineHeight?: number,
  // The size text without its own size tag paints at: the role default the
  // editor also shows. `size` (the field's size) sets only the spacing.
  textSize = size
): VLine[] {
  const lines = breakParagraph(paragraphItems(value, textSize, family, tracking), column, align);
  // Defensive fallback: the breaker normally returns one runless line for an
  // empty item stream. Keep one caret-bearing row even if that contract changes.
  if (!lines.length) lines.push({ runs: [], width: 0 });
  const defaultLineHeight = baselineskip / size;
  const leadingFor = (line: (typeof lines)[number]) => {
    if (!line.runs.length && emptyLineHeight !== undefined) {
      return size * emptyLineHeight;
    }
    return size * runLineHeight(line.runs, defaultLineHeight);
  };
  return lines.map((line, i) => {
    let runs = line.runs.map((r) => ({ ...r, x: r.x + indent, src }));
    const bodyStyle: FontStyle = { family, face: "regular", size: textSize, tracking };
    if (!runs.length) {
      // Preserve every authored blank line (including repeated/trailing hard
      // breaks), not only a wholly empty paragraph. The zero-width run gives the
      // editor a caret target while both DOM and PDF retain the same baseline.
      runs = [{ text: "", style: bodyStyle, x: indent, width: 0, src }];
    }
    if (line.breakAfter !== undefined) runs[runs.length - 1].breakAfter = line.breakAfter;
    const footprint = rowFootprint(runs, size);
    const overflow = boxOverflowOfRuns(runs, size);
    return {
      runs,
      height: footprint.height,
      depth: footprint.depth,
      riseOverflow: overflow.rise,
      dropOverflow: overflow.drop,
      dist: i === 0 ? firstDist : baselineskip,
      leading: leadingFor(line),
      afterDist: leadingFor(line) - baselineskip,
      keepWithPrev: i === 0 ? keepFirst : keepLinesTogether,
      // A kept-together paragraph taller than a page cannot keep together: its
      // continuations are where the chain splitter may paginate it rather than
      // letting lines run off the page bottom.
      ...(i > 0 && keepLinesTogether ? { emergencyBreakBefore: true } : {})
    };
  });
}

function alignRuns(runs: GlyphRun[], width: number, mode: string, origin = 0): GlyphRun[] {
  if (!runs.length) return runs;
  const w = runs[runs.length - 1].x + runs[runs.length - 1].width - runs[0].x;
  const dx = mode === "center"
    ? origin + (width - w) / 2 - runs[0].x
    : mode === "right"
      ? origin + width - w - runs[0].x
      : origin - runs[0].x;
  return runs.map((run) => ({ ...run, x: run.x + dx }));
}

/** The one shared name/contact stream used by resume and cover-letter pages. */
export function buildHeaderVerticalStream(
  schema: TypesetSchema,
  style: PageStyle & HeaderStyle
): VLine[] {
  const geo = pageBox(style);
  const sizes = TEXT_SIZES_PT;
  const family = documentFontFamily(style.fontFamily);
  // Tracking stays at the font's designed advances: the document style has no
  // letter-spacing control, so nothing widens or condenses them.
  const tracking = 0;
  const gap = (key: keyof HeaderStyle & keyof typeof GAP_PT) =>
    num(style[key], GAP_PT[key]);
  const headerAlign = style.headerAlign === "left" || style.headerAlign === "right" ? style.headerAlign : "center";
  const out: VLine[] = [];

  const header = schema.header;
  if (header?.name !== null && header?.name !== undefined) {
    const nameSize = fieldRoleSizePt(header.name, sizes.name);
    // An empty name's caret run shows what typing will produce: the name's
    // default bold when it is bare, or the emphasis its stored tags carry.
    const nameIsEmpty = !stripInlineMarks(header.name).trim();
    const emptyNameBold = nameIsEmpty && (hasInlineMarkTags(header.name) ? /<b>/i.test(header.name) : true);
    const emptyNameItalic = nameIsEmpty && /<i>/i.test(header.name);
    const nameRuns = styledFieldRuns(
      header.name, sizes.name, emptyNameBold, emptyNameItalic, 0, family, tracking, { kind: "name" }, "display"
    );
    const nameRows = wrapSingleField(header.name, nameRuns, geo.textWidth, sizes.name, family, tracking, "display");
    const nameAlignment = alignmentFromInlineMarks(header.name) ?? headerAlign;
    nameRows.forEach((row, index) => {
      const runs = alignRuns(row, geo.textWidth, nameAlignment);
      const rowBox = headerRowExtent(runs, nameSize);
      const overflow = boxOverflowOfRuns(runs, nameSize);
      out.push({
        runs,
        height: rowBox.height,
        depth: rowBox.depth,
        riseOverflow: overflow.rise,
        dropOverflow: overflow.drop,
        dist: index ? lineAdvance(nameSize, HEADER_LINE_HEIGHT) : 0,
        keepWithPrev: index > 0,
        ...(index > 0 ? { emergencyBreakBefore: true } : {})
      });
    });
  }
  if (header?.contact.length) {
    // The pieces share one row, so they share a role size when they agree on
    // one; the divider is set at it too.
    const filledPieces = header.contact.filter((piece) => stripInlineMarks(piece).trim());
    const pieceSizes = (filledPieces.length ? filledPieces : header.contact)
      .map((piece) => fieldRoleSizePt(piece, sizes.contact));
    const size = pieceSizes.every((pieceSize) => pieceSize === pieceSizes[0]) ? pieceSizes[0] : sizes.contact;
    const divider = (style.contactDivider || "|").slice(0, 2);
    // Horizontal slot the separator is centred in. Unlike the vertical gaps this
    // one contains a glyph, so it floors at that glyph's width: 0 is the
    // tightest legal setting rather than a separator overlapping its neighbours.
    const dividerWidth = measure(divider, { family, face: "regular", size, tracking });
    const dividerBox = Math.max(gap("contactGapPt"), dividerWidth);
    const rows: GlyphRun[][] = [];
    let runs: GlyphRun[] = [];
    let x = 0;
    header.contact.forEach((piece, index) => {
      const pieceRunsAtOrigin = styledFieldRuns(
        piece, sizes.contact, false, false, 0, family, tracking, { kind: "contact", index }
      );
      const pieceRows = wrapSingleField(piece, pieceRunsAtOrigin, geo.textWidth, sizes.contact, family, tracking);
      if (pieceRows.length > 1) {
        if (runs.length) rows.push(runs);
        for (const row of pieceRows) rows.push(row.map(run => linkified(run, piece)));
        runs = [];
        x = 0;
        return;
      }
      const pieceWidth = pieceRunsAtOrigin.length
        ? pieceRunsAtOrigin[pieceRunsAtOrigin.length - 1].x
          + pieceRunsAtOrigin[pieceRunsAtOrigin.length - 1].width
        : 0;
      if (runs.length && x + dividerBox + pieceWidth > geo.textWidth) {
        rows.push(runs);
        runs = [];
        x = 0;
      }
      if (runs.length) {
        const dividerRun = styledRun(divider, size, false, false, 0, family, tracking);
        dividerRun.x = x + (dividerBox - dividerRun.width) / 2;
        runs.push(dividerRun);
        x += dividerBox;
      }
      const pieceRuns = pieceRunsAtOrigin.map((run) => ({ ...run, x: run.x + x }));
      runs.push(...pieceRuns.map((run) => linkified(run, piece)));
      if (pieceRuns.length) x = pieceRuns[pieceRuns.length - 1].x + pieceRuns[pieceRuns.length - 1].width;
    });
    if (runs.length) rows.push(runs);
    const contactAlignment = header.contact.map(alignmentFromInlineMarks).find(Boolean) ?? headerAlign;
    rows.forEach((row, rowIndex) => {
      const aligned = alignRuns(row, geo.textWidth, contactAlignment);
      const rowBox = headerRowExtent(aligned, size);
      const overflow = boxOverflowOfRuns(aligned, size);
      out.push({
        runs: aligned,
        height: rowBox.height,
        depth: rowBox.depth,
        riseOverflow: overflow.rise,
        dropOverflow: overflow.drop,
        dist: rowIndex === 0
          ? header.name !== null
            ? lineAdvance(size, HEADER_LINE_HEIGHT) + gap("nameContactGapPt")
            : 0
          : lineAdvance(size, HEADER_LINE_HEIGHT),
        keepWithPrev: Boolean(header.name !== null || rowIndex > 0),
        ...(rowIndex > 0 ? { emergencyBreakBefore: true } : {})
      });
    });
  }
  return out;
}

export function buildVerticalStream(schema: TypesetSchema, style: DocumentStyle): VLine[] {
  const geo = pageGeometry(style);
  const family = documentFontFamily(style.fontFamily);
  const sizes = TEXT_SIZES_PT;
  // Tracking stays at the font's designed advances: the document style has no
  // letter-spacing control, so nothing widens or condenses them.
  const tracking = 0;
  const gap = (key: keyof typeof GAP_PT) => num(style[key], GAP_PT[key]);
  const bodyAlign = (["justify", "center", "right"].includes(style.bodyAlign ?? "") ? style.bodyAlign : "left") as ParagraphAlign;
  const headingAlign = style.headingAlign === "center" || style.headingAlign === "right" ? style.headingAlign : "left";

  const out: VLine[] = buildHeaderVerticalStream(schema, style);
  const push = (line: VLine) => out.push(line);

  // ---- Sections ----
  let prevKind: "header" | "content" = "header";
  for (const section of schema.sections) {
    const items = section.items;
    // Heading line (+ rule).
    // Keep an existing section reachable after its heading is cleared. A
    // single injected space gives the editor a caret-bearing run; it remains
    // visually blank in screen/PDF output while the rule and section spacing
    // continue to communicate that the section still exists.
    if (section.heading || section.id) {
      const caseMode = style.headingCase === "uppercase" ? "uppercase" : style.headingCase === "none" ? "none" : "smallcaps";
      const rawHeading = caseMode === "smallcaps"
        ? section.heading.replace(/<\/?(?:b|i|u)>/gi, "")
        : section.heading;
      const headingText = caseMode === "uppercase" ? uppercaseInlineMarkedText(rawHeading) : rawHeading;
      // Small-caps headings use the dedicated caps face with true lowercase
      // advances. That face has no bold variant; explicit inline marks remain
      // available in uppercase and plain modes.
      const paintedHeading = headingText || " ";
      const headingSize = fieldRoleSizePt(section.heading, sizes.sectionHeading);
      const headingRuns = styledFieldRuns(
        paintedHeading,
        sizes.sectionHeading,
        false,
        false,
        0,
        family,
        tracking,
        { kind: "heading", sectionId: section.id },
        caseMode === "smallcaps" ? "caps" : undefined
      );
      const headingRows = wrapSingleField(paintedHeading, headingRuns, geo.textWidth, sizes.sectionHeading, family, tracking,
        caseMode === "smallcaps" ? "caps" : undefined);
      // Header→first-heading depends only on headerSectionGap. The sectionGap
      // slider must not move the first heading.
      const beforeGap =
        lineAdvance(headingSize, style.lineHeight) +
        (prevKind === "header" ? gap("headerSectionGapPt") : gap("sectionGapPt"));
      headingRows.forEach((row, index) => {
        const runs = alignRuns(row, geo.textWidth, alignmentFromInlineMarks(section.heading) ?? headingAlign);
        const footprint = rowFootprint(runs, headingSize);
        const overflow = boxOverflowOfRuns(runs, headingSize);
        push({
          runs,
          height: footprint.height,
          depth: footprint.depth,
          riseOverflow: overflow.rise,
          dropOverflow: overflow.drop,
          dist: index ? headingSize * runLineHeight(headingRows[index - 1], style.lineHeight) : beforeGap,
          keepWithPrev: index > 0,
          ...(index > 0 ? { emergencyBreakBefore: true } : {}),
          // One rule follows the final continuation at the calibrated offset.
          rule: style.sectionRule === false || index < headingRows.length - 1
            ? undefined
            : { x: 0, width: geo.textWidth, yOffset: 4.113 * headingSize / sizes.sectionHeading, thickness: 0.4 }
        });
      });
    }

    const isSkills = section.type === "skills";
    const isSummary = section.type === "summary";
    let firstInSection = true;
    let previousParagraphSpaceAfterPt = 0;

    for (const item of items) {
      const f = {
        titleLeft: item.titleLeft ?? "",
        titleRight: item.titleRight ?? "",
        subtitleLeft: item.subtitleLeft ?? "",
        subtitleRight: item.subtitleRight ?? ""
      };
      const ids = { sectionId: section.id, entryId: item.id };
      const entrySrc = (field: "titleLeft" | "titleRight" | "subtitleLeft" | "subtitleRight"): FieldSrc =>
        ({ kind: "entry", ...ids, field });
      const bulletSrc = (bi: number): FieldSrc =>
        ({ kind: "bullet", ...ids, bulletId: item.bulletIds[bi] });
      if (isSkills) {
        // Label and skills form one paragraph at the larger of their sizes.
        const size = rowRoleSizePt([[f.titleLeft, sizes.skillLabel], [f.subtitleLeft, sizes.body]]);
        let label = f.titleLeft.trimStart();
        // The backing field omits the one canonical separator space. Preserve
        // every authored space so the painter matches the editor value.
        let skills = f.subtitleLeft;
        // Keep the complete separator even before any skills are typed so the
        // first trailing space after a rebuilt label survives the repaint.
        const text = skillsRowText(label, skills);
        const dist =
          lineAdvance(size, style.lineHeight) +
          (firstInSection ? gap("sectionEntryGapPt") : gap("skillsRowGapPt"));
        const lines = paragraphLines(
          text,
          size,
          geo.entryIndent,
          geo.textWidth - geo.entryIndent - geo.entryEndIndent,
          alignmentFromInlineMarks(label) ?? alignmentFromInlineMarks(skills) ?? bodyAlign,
          lineAdvance(size, style.lineHeight),
          dist,
          firstInSection,
          family,
          tracking,
          true,
          { kind: "skillsRow", ...ids },
          undefined,
          sizes.body
        );
        lines.forEach(push);
        firstInSection = false;
        continue;
      }
      if (isSummary) {
        const summaryText = f.subtitleLeft || f.titleLeft || item.bullets?.[0] || "";
        const paragraphSpacing = paragraphSpacingFromInlineMarks(summaryText);
        const summarySize = fieldRoleSizePt(summaryText, sizes.body);
        // Left indent: every line of the paragraph starts further in and its
        // measure narrows to match (see paragraphIndentFromInlineMarks).
        const summaryIndent = fitParagraphIndent(
          paragraphIndentFromInlineMarks(summaryText),
          geo.textWidth - geo.entryIndent - geo.entryEndIndent,
          summarySize
        );
        const dist =
          lineAdvance(summarySize, style.lineHeight) +
          (firstInSection ? gap("sectionEntryGapPt") : gap("bulletGapPt")) +
          previousParagraphSpaceAfterPt +
          (paragraphSpacing.spaceBeforePt ?? 0);
        const lines = paragraphLines(
          summaryText,
          summarySize,
          geo.entryIndent + summaryIndent,
          Math.max(
            summarySize,
            geo.textWidth - geo.entryIndent - summaryIndent - geo.entryEndIndent
          ),
          alignmentFromInlineMarks(summaryText) ?? bodyAlign,
          summarySize * style.lineHeight,
          dist,
          firstInSection,
          family,
          tracking,
          false, // summaries may break mid-paragraph (see paragraphLines)
          bulletSrc(0),
          stripInlineMarks(summaryText).trim().length === 0
            ? paragraphSpacing.lineHeight ?? undefined
            : undefined,
          sizes.body
        );
        if (lines.length) {
          lines[0].paragraphSpaceBefore = paragraphSpacing.spaceBeforePt ?? 0;
          lines[lines.length - 1].paragraphSpaceAfter = paragraphSpacing.spaceAfterPt ?? 0;
        }
        lines.forEach(push);
        previousParagraphSpaceAfterPt = paragraphSpacing.spaceAfterPt ?? 0;
        firstInSection = false;
        continue;
      }

      // Standard entries may omit either heading row.
      const titleSize = rowRoleSizePt([[f.titleLeft, sizes.titleLeft], [f.titleRight, sizes.titleRight]]);
      const subSize = rowRoleSizePt([[f.subtitleLeft, sizes.subtitleLeft], [f.subtitleRight, sizes.subtitleRight]]);
      const hasTitle = item.titleLeft !== null;
      const hasSub = item.subtitleLeft !== null;
      let titleInkDepth = 0;
      let titleAfterDist = 0;
      if (hasTitle) {
        const titleLeft = styledFieldRuns(
          f.titleLeft,
          sizes.titleLeft,
          false,
          false,
          geo.entryIndent,
          family,
          tracking,
          entrySrc("titleLeft")
        );
        const rawTitleRuns = headRow(titleLeft, f.titleRight, sizes.titleRight, false, geo, family, tracking, entrySrc("titleRight"));
        const titleAlignment = alignmentFromInlineMarks(f.titleLeft) ?? alignmentFromInlineMarks(f.titleRight);
        const titleRows = wrapHeadRow(rawTitleRuns, f.titleLeft, f.titleRight, geo.entryIndent, geo.headRowWidth, sizes.titleLeft, sizes.titleRight, family, tracking);
        for (const [rowIndex, rawRuns] of titleRows.entries()) {
          const titleRuns = titleAlignment && titleAlignment !== "justify"
            ? alignRuns(rawRuns, geo.headRowWidth, titleAlignment, geo.entryIndent)
            : rawRuns;
          const inkT = inkOfRuns(titleRuns);
          const titleFootprint = rowFootprint(titleRuns, titleSize);
          const titleOverflow = boxOverflowOfRuns(titleRuns, titleSize);
          const titleLeading = headRowLeading(titleRuns, titleSize, style.lineHeight, titleRows.length > 1);
          push({
            ...titleLeading,
            runs: titleRuns,
            height: titleFootprint.height,
            depth: titleFootprint.depth,
            riseOverflow: titleOverflow.rise,
            dropOverflow: titleOverflow.drop,
            dist:
              lineAdvance(titleSize, style.lineHeight) +
              (rowIndex > 0 ? 0 : firstInSection ? gap("sectionEntryGapPt") : gap("entryGapPt")),
            keepWithPrev: rowIndex > 0 || firstInSection,
            ...(rowIndex > 0 ? { emergencyBreakBefore: true } : {})
          });
          firstInSection = false;
          const underlined = titleRuns.some((run) => run.href || run.underline);
          titleInkDepth = Math.max(inkT.depth + (underlined ? UNDERLINE_EXTRA : 0), ...underlineSpans(titleRuns).map((span) => {
            const rule = underlineRule(span.style);
            return rule.offset + rule.thickness;
          }));
          titleAfterDist = titleLeading.afterDist ?? 0;
        }
      }

      if (hasSub) {
        const subLeft = styledFieldRuns(
          f.subtitleLeft,
          sizes.subtitleLeft,
          false,
          false,
          geo.entryIndent,
          family,
          tracking,
          entrySrc("subtitleLeft")
        );
        const rawSubRuns = headRow(
          subLeft,
          f.subtitleRight,
          sizes.subtitleRight,
          false,
          geo,
          family,
          tracking,
          entrySrc("subtitleRight")
        );
        const subAlignment = alignmentFromInlineMarks(f.subtitleLeft) ?? alignmentFromInlineMarks(f.subtitleRight);
        const subRows = wrapHeadRow(rawSubRuns, f.subtitleLeft, f.subtitleRight, geo.entryIndent, geo.headRowWidth, sizes.subtitleLeft, sizes.subtitleRight, family, tracking);
        for (const [rowIndex, rawRuns] of subRows.entries()) {
          const subRuns = subAlignment && subAlignment !== "justify"
            ? alignRuns(rawRuns, geo.headRowWidth, subAlignment, geo.entryIndent)
            : rawRuns;
          const inkS = inkOfRuns(subRuns);
          const subFootprint = rowFootprint(subRuns, subSize);
          const subOverflow = boxOverflowOfRuns(subRuns, subSize);
          const spaced = lineAdvance(subSize, style.lineHeight) + gap("titleSubGapPt");
          // A tight line height, or a deep box such as an underlined link, must
          // never pull the subtitle up into the title: clamp to an ink-based floor
          // that keeps a hair of clearance regardless of the authored gap.
          const inkFloor = titleInkDepth + inkS.height + MIN_TITLE_SUB_INK_GAP * subSize / sizes.subtitleLeft;
          push({
            ...headRowLeading(subRuns, subSize, style.lineHeight, subRows.length > 1),
            runs: subRuns,
            height: subFootprint.height,
            depth: subFootprint.depth,
            riseOverflow: subOverflow.rise,
            dropOverflow: subOverflow.drop,
            dist: rowIndex > 0 ? lineAdvance(subSize, style.lineHeight) : hasTitle
              ? Math.max(spaced, inkFloor - titleAfterDist)
              : lineAdvance(subSize, style.lineHeight) + (firstInSection ? gap("sectionEntryGapPt") : gap("entryGapPt")),
            keepWithPrev: rowIndex > 0 || hasTitle || firstInSection,
            ...(rowIndex > 0 ? { emergencyBreakBefore: true } : {})
          });
          firstInSection = false;
        }
      }

      let previousBulletSpaceAfterPt = 0;
      // An empty bullet keeps its neighbour's size, so a blank line in a
      // sized list keeps the list's rhythm.
      let previousBulletSize: number = sizes.body;
      item.bullets.forEach((bullet, bi) => {
        const paragraphSpacing = paragraphSpacingFromInlineMarks(bullet);
        const bulletSize = stripInlineMarks(bullet).trim() ? fieldRoleSizePt(bullet, sizes.body) : previousBulletSize;
        previousBulletSize = bulletSize;
        const bulletIndentPt = fitParagraphIndent(
          paragraphIndentFromInlineMarks(bullet),
          geo.textWidth - geo.bulletIndent - geo.entryEndIndent,
          bulletSize
        );
        const dist =
          lineAdvance(bulletSize, style.lineHeight) +
          (bi === 0
            ? hasTitle || hasSub ? gap("headBulletGapPt") : gap(firstInSection ? "sectionEntryGapPt" : "entryGapPt")
            : gap("bulletGapPt")) +
          previousBulletSpaceAfterPt +
          (paragraphSpacing.spaceBeforePt ?? 0);
        const lines = paragraphLines(
          bullet,
          bulletSize,
          geo.bulletIndent + bulletIndentPt,
          Math.max(
            bulletSize,
            geo.textWidth - geo.bulletIndent - bulletIndentPt - geo.entryEndIndent
          ),
          alignmentFromInlineMarks(bullet) ?? bodyAlign,
          bulletSize * style.lineHeight,
          dist,
          hasTitle || hasSub || firstInSection,
          family,
          tracking,
          true,
          bulletSrc(bi),
          stripInlineMarks(bullet).trim().length === 0
            ? paragraphSpacing.lineHeight ?? undefined
            : undefined,
          sizes.body
        );
        // First line carries the bullet marker at the bullet indent.
        // It shares the bullet's provenance so clicking it edits the bullet.
        if (lines.length) {
          lines[0].paragraphSpaceBefore = paragraphSpacing.spaceBeforePt ?? 0;
          lines[lines.length - 1].paragraphSpaceAfter = paragraphSpacing.spaceAfterPt ?? 0;
          const marker = {
            ...styledRun(
              "•",
              bulletMarkerSizePt(bulletSize),
              false,
              false,
              geo.bulletMarker + bulletIndentPt,
              family,
              tracking,
              bulletSrc(bi)
            ),
            marker: true
          };
          lines[0].runs.unshift(marker);
        }
        // Allow page breaks BETWEEN bullets (not before the first).
        if (bi > 0 && lines.length) lines[0].keepWithPrev = false;
        lines.forEach(push);
        if (lines.length) firstInSection = false;
        previousBulletSpaceAfterPt = paragraphSpacing.spaceAfterPt ?? 0;
      });
    }
    prevKind = "content";
  }
  return out;
}
