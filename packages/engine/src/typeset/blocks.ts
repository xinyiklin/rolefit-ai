// Vertical layout for the generic resume model: converts structured resume data
// and DocStyle into the line-and-spacing stream shared by editing and print.
//
// MODEL — a vertical list flattened to baseline arithmetic:
//   nextBaseline = prevBaseline + junction(prev, next)
// Each junction is either line leading or a named constant calibrated against
// committed visual truth fixtures. Constants live in one place, and DocStyle
// sliders enter linearly so every rendering surface shares the same rhythm.

import { documentFontFamily, type DocumentFontFamily } from "./fontRegistry.ts";
import type { FieldSrc, FontStyle, GlyphRun, ParagraphAlign } from "./types.ts";
import type { FaceName } from "./metrics.gen.ts";
import { fontSizesFor, nameSizePt } from "../lib/documentTypography.ts";
import {
  faceExtent,
  faceFor,
  inkExtent,
  measure,
  paragraphItems,
  segmentsFromInlineMarks,
  texLigatures
} from "./measure.ts";
import { automaticLinkHref } from "../lib/links.ts";
import { breakParagraph } from "./linebreak.ts";
import {
  alignmentFromInlineMarks,
  hasInlineMarkTags,
  paragraphIndentFromInlineMarks,
  paragraphSpacingFromInlineMarks,
  stripInlineMarks
} from "../lib/inlineMarksText.ts";
import { DOC_STYLE_DEFAULTS, type DocumentStyle } from "../lib/documentStyle.ts";
import type { TypesetSchema } from "./schema.ts";

// US-Letter page in bp (1/72in): 8.5in × 11in. The one owner of the physical
// page size shared by geometry, the DOM painter, the PDF emitter, and the
// editor's pointer math.
export const PAGE_WIDTH_BP = 612;
export const PAGE_HEIGHT_BP = 792;

// Source font point → PDF point (bp).
const PT = 72 / 72.27;

// Baseline spacing for the resume's 11pt font scale, in bp.
const BSK = {
  normalsize: 13.6 * PT,
  small: 12 * PT,
  large: 14 * PT
} as const;

// One typeset line placed in the vertical stream. x/runs are relative to the
// text column's left edge; `dist` is the baseline distance from the PREVIOUS
// line. Page breaking recomputes the first line from the page's minimum inset.
export type VLine = {
  runs: GlyphRun[]; // x already includes the line's indent
  // The row's own footprint at its role size: ink above/below the baseline with
  // every run measured at no more than that size (page-top placement, page-bottom
  // fit). Oversized inline runs contribute through the overflow fields instead.
  height: number;
  depth: number;
  // Extra room this line needs beyond its calibrated junction because an inline
  // run is LARGER than the row's role size. Derived from face boxes, never from
  // the glyphs on the line, so typing a taller or deeper character inside an
  // oversized run cannot change the spacing around it.
  riseOverflow: number; // above the baseline
  dropOverflow: number; // below the baseline
  dist: number; // baseline distance from previous line in the stream
  // Paragraph rows expose owned leading so selections exclude unrelated block gaps.
  leading?: number;
  // Inline line-height adjusts the following junction without moving this baseline.
  afterDist?: number;
  // Pagination policy: "keep" lines may not start a page-break separation from
  // their predecessor (entry head rows, a bullet after its head, rules).
  keepWithPrev: boolean;
  rule?: { x: number; width: number; yOffset: number; thickness: number };
};

const num = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

// Defaults mirror DOC_STYLE_DEFAULTS. These are physical PDF/DTP points, not
// font-relative CSS em values. The exact numbers preserve the calibrated layout.
const GAP_PT = {
  nameContactGapPt: 1 * PT,
  contactGapPt: 18.2 * PT,
  headerSectionGapPt: 0.85 * 11 * PT,
  sectionGapPt: 0.85 * 11 * PT,
  sectionEntryGapPt: 0.42 * 11 * PT,
  entryGapPt: 0.42 * 11 * PT,
  titleSubGapPt: 0.06 * 11 * PT,
  headBulletGapPt: 0.42 * 11 * PT,
  skillsRowGapPt: 0,
  bulletGapPt: 0.2 * 11 * PT
} as const;

// ---- Geometry (bp) ----
export function pageGeometry(style: DocumentStyle) {
  const margins = {
    top: style.pageMarginTopPt,
    right: style.pageMarginRightPt,
    bottom: style.pageMarginBottomPt,
    left: style.pageMarginLeftPt
  };
  const textWidth = PAGE_WIDTH_BP - margins.left - margins.right;
  const sizes = fontSizesFor(num(style.baseFontSizePt, 10));
  const entryIndent = num(style.entryIndentPt, DOC_STYLE_DEFAULTS.entryIndentPt);
  const entryEndIndent = num(style.entryEndIndentPt, DOC_STYLE_DEFAULTS.entryEndIndentPt);
  return {
    marginTop: margins.top,
    marginRight: margins.right,
    marginBottom: margins.bottom,
    marginLeft: margins.left,
    textWidth,
    // Entry content is inset 0.15in; bullets add 2.2em at the body size.
    entryIndent,
    entryEndIndent,
    bulletIndent: entryIndent + 2.2 * sizes.normalsize,
    // Start indent moves only the left edge. End indent independently moves the
    // right edge, so changing one never drags the other. The default end inset
    // is the size of Jake's 0.97\textwidth entry table at normal page margins:
    // that table starts at 46.8bp and ends 5.4bp short of the 576bp text edge.
    //
    // Where it APPLIES is a deliberate product choice, not Jake's: the inset is
    // the entry's right edge, so every row of the entry keeps it — head rows,
    // bullets, summary paragraphs, and skills rows alike. Jake insets only the
    // head row (his bullets are a plain `itemize` with no right margin), so the
    // frozen TeX fixture wraps one long bullet a word later than we do; that
    // divergence is expected and `vertical-parity.mjs` zeroes the inset for the
    // legacy comparison rather than the engine changing to match it.
    headRowWidth: Math.max(1, textWidth - entryIndent - entryEndIndent),
    firstBaselineMin: margins.top + sizes.normalsize, // minimum first-line inset
    lastBaselineMax: PAGE_HEIGHT_BP - margins.bottom
  };
}

// ---- Junction constants (bp), calibrated against visual truth fixtures ----
// Each J_* is the baseline-distance REMAINDER after the linear docStyle terms;
// see the vertical-parity check. Values scale with line-height stretch where
// flexible leading applies.
const J = {
  // name baseline → contact baseline, before the user-controlled gap.
  nameContact: BSK.normalsize,
  // contact → section heading, after the header/section slider terms.
  contactHeading: 19.18,
  // section heading → first entry title / skills row, before its point gap.
  headingEntry: 14.04,
  headingSkills: 12.2,
  // subtitle (or title) → first bullet, before its point gap.
  headBullet: 11.9,
  // last line of an entry → next entry title, before its point gap.
  entryEntry: 13.12,
  // last content line → next section heading, before its point gap.
  contentHeading: 14.02,
  // skills row → skills row, before its point gap.
  skillsRow: BSK.normalsize,
  // bullet last line → next bullet first line, before its point gap.
  bulletBullet: BSK.small
} as const;

// Head rows use a strut split into 0.7·baseline spacing above and 0.3 below.
// Deeper ink, such as an underlined link, switches the distance to an ink-based
// 1pt floor. This makes linked metadata sit slightly looser than plain rows and
// is computed mechanically from ink extents.
const LINESKIP = 1 * PT;
// Shared link rules extend about 2pt below the content's ink depth.
const UNDERLINE_EXTRA = 2.04;
// Base title-to-subtitle spacing adjustment before the user-controlled gap.
const TITLE_SUB_VSPACE_BASE = -4.5 * PT;
// Minimal clear gap between the title's descender ink and the subtitle's ascender
// ink. Ink extents do not scale with line height but the calibrated distance
// does, so tightening the line height below the default drives the rows into
// overlap; this floors the distance so they can never collapse onto each other.
const MIN_TITLE_SUB_INK_GAP = 0.3;

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

// The row's footprint at its role size. Runs larger than the role size are
// measured AT that size here and contribute their excess through
// boxOverflowOfRuns, so one oversized word cannot silently restyle the row.
function rowInkOfRuns(
  runs: GlyphRun[],
  roleSize: number,
  fallback: { height: number; depth: number }
): { height: number; depth: number } {
  if (!runs.some((run) => run.text)) return fallback;
  let height = 0;
  let depth = 0;
  for (const run of runs) {
    const extent = inkExtent(run.text, {
      ...run.style,
      size: Math.min(run.style.size, roleSize)
    });
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
    if (run.style.size <= roleSize) continue;
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
  faceOverride?: FaceName
): GlyphRun[] {
  if (!hasInlineMarkTags(value)) {
    const run = styledRun(value, size, flagBold, flagItalic, x, family, tracking, src);
    run.href = automaticLinkHref(value) ?? undefined;
    if (faceOverride) {
      run.style = { ...run.style, face: faceOverride };
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
      face: faceOverride ?? faceFor(seg.bold || flagBold, seg.italic || flagItalic),
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
      linkSuppressed: seg.linkSuppressed
    });
    cursorX += width;
  }
  return runs.length ? runs : [styledRun(value, size, flagBold, flagItalic, x, family, tracking, src)];
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
  emptyLineHeight?: number
): VLine[] {
  const lines = breakParagraph(paragraphItems(value, size, family, tracking), column, align);
  // Defensive fallback: the breaker normally returns one runless line for an
  // empty item stream. Keep one caret-bearing row even if that contract changes.
  if (!lines.length) lines.push({ runs: [], width: 0 });
  const defaultLineHeight = baselineskip / size;
  const leadingFor = (line: (typeof lines)[number]) => {
    if (!line.runs.length && emptyLineHeight !== undefined) {
      return size * emptyLineHeight;
    }
    const override = line.runs.reduce<number | null>(
      (current, run) =>
        run.lineHeight === undefined
          ? current
          : current === null
            ? run.lineHeight
            : Math.max(current, run.lineHeight),
      null
    );
    return size * (override ?? defaultLineHeight);
  };
  return lines.map((line, i) => {
    let runs = line.runs.map((r) => ({ ...r, x: r.x + indent, src }));
    const bodyStyle: FontStyle = { family, face: "regular", size, tracking };
    if (!runs.length) {
      // Preserve every authored blank line (including repeated/trailing hard
      // breaks), not only a wholly empty paragraph. The zero-width run gives the
      // editor a caret target while both DOM and PDF retain the same baseline.
      runs = [{ text: "", style: bodyStyle, x: indent, width: 0, src }];
    }
    // A textless row keeps a full body-height footprint so a blank line occupies
    // the same space as a written one.
    const rowInk = rowInkOfRuns(runs, size, inkExtent("Ag", bodyStyle));
    const overflow = boxOverflowOfRuns(runs, size);
    return {
      runs,
      height: rowInk.height,
      depth: rowInk.depth,
      riseOverflow: overflow.rise,
      dropOverflow: overflow.drop,
      dist: i === 0 ? firstDist : baselineskip,
      leading: leadingFor(line),
      afterDist: leadingFor(line) - baselineskip,
      keepWithPrev: i === 0 ? keepFirst : keepLinesTogether
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
export function buildHeaderVerticalStream(schema: TypesetSchema, style: DocumentStyle): VLine[] {
  const geo = pageGeometry(style);
  const family = documentFontFamily(style.fontFamily);
  const baseFontSize = num(style.baseFontSizePt, 10);
  const sizes = fontSizesFor(baseFontSize);
  const fontScale = baseFontSize / 10;
  const tracking = num(style.letterSpacingPt, 0);
  const stretch = num(style.lineHeight, 1.18) / 1.2;
  const gap = (key: keyof typeof GAP_PT) => num(style[key], GAP_PT[key]);
  const headerAlign = style.headerAlign === "left" || style.headerAlign === "right" ? style.headerAlign : "center";
  const nameSize = nameSizePt(sizes, style.nameSize);
  const out: VLine[] = [];

  if (schema.name) {
    const nameRuns = styledFieldRuns(
      schema.name, nameSize, true, false, 0, family, tracking, { kind: "name" }, "boldDisplay"
    );
    const runs = alignRuns(nameRuns, geo.textWidth, alignmentFromInlineMarks(schema.name) ?? headerAlign);
    const rowInk = rowInkOfRuns(runs, nameSize, inkOfRuns(runs));
    const overflow = boxOverflowOfRuns(runs, nameSize);
    out.push({
      runs,
      height: rowInk.height,
      depth: rowInk.depth,
      riseOverflow: overflow.rise,
      dropOverflow: overflow.drop,
      dist: 0,
      keepWithPrev: false
    });
  }
  if (schema.contact.length) {
    const size = sizes.small;
    const divider = (style.contactDivider || "|").slice(0, 2);
    const dividerBox = gap("contactGapPt");
    const rows: GlyphRun[][] = [];
    let runs: GlyphRun[] = [];
    let x = 0;
    schema.contact.forEach((piece, index) => {
      const pieceRunsAtOrigin = styledFieldRuns(
        piece, size, false, false, 0, family, tracking, { kind: "contact", index }
      );
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
    const contactAlignment = schema.contact.map(alignmentFromInlineMarks).find(Boolean) ?? headerAlign;
    rows.forEach((row, rowIndex) => {
      const aligned = alignRuns(row, geo.textWidth, contactAlignment);
      const rowInk = rowInkOfRuns(aligned, size, inkOfRuns(aligned));
      const overflow = boxOverflowOfRuns(aligned, size);
      out.push({
        runs: aligned,
        height: rowInk.height,
        depth: rowInk.depth,
        riseOverflow: overflow.rise,
        dropOverflow: overflow.drop,
        dist: rowIndex === 0
          ? schema.name ? J.nameContact * stretch * fontScale + gap("nameContactGapPt") : 0
          : size * style.lineHeight,
        keepWithPrev: Boolean(schema.name || rowIndex > 0)
      });
    });
  }
  return out;
}

export function buildVerticalStream(schema: TypesetSchema, style: DocumentStyle): VLine[] {
  const geo = pageGeometry(style);
  const family = documentFontFamily(style.fontFamily);
  const baseFontSize = num(style.baseFontSizePt, 10);
  const sizes = fontSizesFor(baseFontSize);
  const fontScale = baseFontSize / 10;
  const tracking = num(style.letterSpacingPt, 0);
  const stretch = num(style.lineHeight, 1.18) / 1.2;
  const bsk = {
    normalsize: BSK.normalsize * stretch * fontScale,
    small: BSK.small * stretch * fontScale,
    large: BSK.large * stretch * fontScale
  };
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
      const headingText = caseMode === "uppercase" ? rawHeading.toUpperCase() : rawHeading;
      // Small-caps headings use the dedicated caps face with true lowercase
      // advances. That face has no bold variant; explicit inline marks remain
      // available in uppercase and plain modes.
      const paintedHeading = headingText || " ";
      const headingRuns = styledFieldRuns(
        paintedHeading,
        sizes.large,
        false,
        false,
        0,
        family,
        tracking,
        { kind: "heading", sectionId: section.id },
        caseMode === "smallcaps" ? "caps" : undefined
      );
      const runs = alignRuns(headingRuns, geo.textWidth, alignmentFromInlineMarks(section.heading) ?? headingAlign);
      const fallbackHeadingStyle: FontStyle = { family, face: caseMode === "smallcaps" ? "caps" : "regular", size: sizes.large, tracking };
      // A cleared heading paints one injected space. Its row keeps the full
      // heading footprint so the section's spacing does not change when the
      // text is emptied.
      const blankHeadingInk = inkExtent("Ag", fallbackHeadingStyle);
      const rowInk = headingText ? rowInkOfRuns(runs, sizes.large, blankHeadingInk) : blankHeadingInk;
      const overflow = boxOverflowOfRuns(runs, sizes.large);
      // Header→first-heading depends only on headerSectionGap. The sectionGap
      // slider must not move the first heading.
      const beforeGap =
        prevKind === "header"
          ? J.contactHeading * stretch * fontScale + gap("headerSectionGapPt")
          : J.contentHeading * stretch * fontScale + gap("sectionGapPt");
      push({
        runs,
        height: rowInk.height,
        depth: rowInk.depth,
        riseOverflow: overflow.rise,
        dropOverflow: overflow.drop,
        dist: beforeGap,
        keepWithPrev: false,
        // Section-rule geometry is calibrated to the owned page layout: the
        // center sits 4.3125bp below the heading baseline and is 0.4bp thick.
        rule:
          style.sectionRule === false
            ? undefined
            : { x: 0, width: geo.textWidth, yOffset: 4.113 * fontScale, thickness: 0.4 }
      });
    }

    const isSkills = section.type === "skills";
    const isSummary = section.type === "summary";
    let firstInSection = true;
    let previousParagraphSpaceAfterPt = 0;

    for (const item of items) {
      const f = item;
      const ids = { sectionId: section.id, entryId: item.id };
      const entrySrc = (field: "titleLeft" | "titleRight" | "subtitleLeft" | "subtitleRight"): FieldSrc =>
        ({ kind: "entry", ...ids, field });
      const bulletSrc = (bi: number): FieldSrc =>
        ({ kind: "bullet", ...ids, bulletId: item.bulletIds[bi] });
      if (isSkills) {
        const size = sizes.small;
        let label = f.titleLeft.trimStart();
        // The backing field omits the one canonical separator space. Preserve
        // every authored space so the painter matches the editor value.
        let skills = f.subtitleLeft;
        // Keep the complete separator even before any skills are typed so the
        // first trailing space after a rebuilt label survives the repaint.
        const text = label ? `${label}: ${skills}` : skills;
        const dist = firstInSection
          ? J.headingSkills * stretch * fontScale + gap("sectionEntryGapPt")
          : J.skillsRow * stretch * fontScale + gap("skillsRowGapPt");
        const lines = paragraphLines(
          text,
          size,
          geo.entryIndent,
          geo.textWidth - geo.entryIndent - geo.entryEndIndent,
          alignmentFromInlineMarks(label) ?? alignmentFromInlineMarks(skills) ?? bodyAlign,
          bsk.small,
          dist,
          firstInSection,
          family,
          tracking,
          true,
          { kind: "skillsRow", ...ids }
        );
        lines.forEach(push);
        firstInSection = false;
        continue;
      }
      if (isSummary) {
        const summaryText = f.subtitleLeft || f.titleLeft || item.bullets?.[0] || "";
        const paragraphSpacing = paragraphSpacingFromInlineMarks(summaryText);
        // Left indent: every line of the paragraph starts further in and its
        // measure narrows to match (see paragraphIndentFromInlineMarks).
        const summaryIndent = paragraphIndentFromInlineMarks(summaryText);
        const dist = (firstInSection
          ? J.headingSkills * stretch * fontScale + gap("sectionEntryGapPt")
          : J.bulletBullet * stretch * fontScale + gap("bulletGapPt"))
          + previousParagraphSpaceAfterPt
          + (paragraphSpacing.spaceBeforePt ?? 0);
        paragraphLines(
          summaryText,
          sizes.small,
          geo.entryIndent + summaryIndent,
          Math.max(
            sizes.small,
            geo.textWidth - geo.entryIndent - summaryIndent - geo.entryEndIndent
          ),
          alignmentFromInlineMarks(summaryText) ?? bodyAlign,
          sizes.small * style.lineHeight,
          dist,
          firstInSection,
          family,
          tracking,
          false, // summaries may break mid-paragraph (see paragraphLines)
          bulletSrc(0),
          stripInlineMarks(summaryText).trim().length === 0
            ? paragraphSpacing.lineHeight ?? undefined
            : undefined
        ).forEach(push);
        previousParagraphSpaceAfterPt = paragraphSpacing.spaceAfterPt ?? 0;
        firstInSection = false;
        continue;
      }

      // Standard entry: title row, optional subtitle row, bullets.
      const titleSize = sizes.normalsize;
      const subSize = sizes.small;
      const titleLeft = styledFieldRuns(
        f.titleLeft,
        titleSize,
        false,
        false,
        geo.entryIndent,
        family,
        tracking,
        entrySrc("titleLeft")
      );
      const rawTitleRuns = headRow(titleLeft, f.titleRight, titleSize, false, geo, family, tracking, entrySrc("titleRight"));
      const titleAlignment = alignmentFromInlineMarks(f.titleLeft) ?? alignmentFromInlineMarks(f.titleRight);
      const titleRuns = titleAlignment && titleAlignment !== "justify"
        ? alignRuns(rawTitleRuns, geo.headRowWidth, titleAlignment, geo.entryIndent)
        : rawTitleRuns;
      const inkT = inkOfRuns(titleRuns);
      const titleRowInk = rowInkOfRuns(titleRuns, titleSize, inkT);
      const titleOverflow = boxOverflowOfRuns(titleRuns, titleSize);
      push({
        runs: titleRuns,
        height: titleRowInk.height,
        depth: titleRowInk.depth,
        riseOverflow: titleOverflow.rise,
        dropOverflow: titleOverflow.drop,
        dist: firstInSection
          ? J.headingEntry * stretch * fontScale + gap("sectionEntryGapPt")
          : J.entryEntry * stretch * fontScale + gap("entryGapPt"),
        keepWithPrev: firstInSection
      });
      firstInSection = false;

      // Editable entries always paint the subtitle row so a new or subtitle-less
      // entry keeps a caret target to fill (the pencil form that used to add one
      // is gone). Paint-only callers without ids still drop an empty subtitle.
      // The row lives in the shared layout, so editor and PDF stay identical.
      const hasSub = Boolean(f.subtitleLeft.trim() || f.subtitleRight.trim());
      if (hasSub || ids) {
        const subLeft = styledFieldRuns(
          f.subtitleLeft,
          subSize,
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
          subSize,
          false,
          geo,
          family,
          tracking,
          entrySrc("subtitleRight")
        );
        const subAlignment = alignmentFromInlineMarks(f.subtitleLeft) ?? alignmentFromInlineMarks(f.subtitleRight);
        const subRuns = subAlignment && subAlignment !== "justify"
          ? alignRuns(rawSubRuns, geo.headRowWidth, subAlignment, geo.entryIndent)
          : rawSubRuns;
        const inkS = inkOfRuns(subRuns);
        const subRowInk = rowInkOfRuns(subRuns, subSize, inkS);
        const subOverflow = boxOverflowOfRuns(subRuns, subSize);
        // Row-strut mechanics (see LINESKIP above): use baseline spacing unless
        // a box extends beyond the strut, as underlined links can.
        const arstrutH = 0.7 * BSK.normalsize * stretch * fontScale;
        const arstrutD = 0.3 * BSK.normalsize * stretch * fontScale;
        const titleInkDepth = inkT.depth + (titleRuns.some((run) => run.href || run.underline) ? UNDERLINE_EXTRA : 0);
        const row1Depth = Math.max(arstrutD, titleInkDepth);
        const row2Height = Math.max(arstrutH, inkS.height);
        const bskRow = BSK.normalsize * stretch * fontScale;
        const solid = row1Depth + LINESKIP + row2Height;
        const rowDist = bskRow - row1Depth - row2Height >= -1e-6 ? bskRow : solid;
        const spaced = rowDist + TITLE_SUB_VSPACE_BASE * fontScale + gap("titleSubGapPt");
        // A tight line height must never pull the subtitle up into the title:
        // clamp to an ink-based floor that keeps a hair of clearance regardless.
        const inkFloor = titleInkDepth + inkS.height + MIN_TITLE_SUB_INK_GAP * fontScale;
        push({
          runs: subRuns,
          height: subRowInk.height,
          depth: subRowInk.depth,
          riseOverflow: subOverflow.rise,
          dropOverflow: subOverflow.drop,
          dist: Math.max(spaced, inkFloor),
          keepWithPrev: true
        });
      }

      let previousBulletSpaceAfterPt = 0;
      item.bullets.forEach((bullet, bi) => {
        const paragraphSpacing = paragraphSpacingFromInlineMarks(bullet);
        const bulletIndentPt = paragraphIndentFromInlineMarks(bullet);
        const dist = (
          bi === 0
            ? J.headBullet * stretch * fontScale + gap("headBulletGapPt")
            : J.bulletBullet * stretch * fontScale + gap("bulletGapPt")
        ) + previousBulletSpaceAfterPt + (paragraphSpacing.spaceBeforePt ?? 0);
        const lines = paragraphLines(
          bullet,
          sizes.small,
          geo.bulletIndent + bulletIndentPt,
          Math.max(
            sizes.small,
            geo.textWidth - geo.bulletIndent - bulletIndentPt - geo.entryEndIndent
          ),
          alignmentFromInlineMarks(bullet) ?? bodyAlign,
          sizes.small * style.lineHeight,
          dist,
          true, // bullets keep with their entry head / previous bullet start
          family,
          tracking,
          true,
          bulletSrc(bi),
          stripInlineMarks(bullet).trim().length === 0
            ? paragraphSpacing.lineHeight ?? undefined
            : undefined
        );
        // First line carries the bullet marker (tiny math bullet at 25.53bp).
        // It shares the bullet's provenance so clicking it edits the bullet.
        if (lines.length) {
          const marker = {
            ...styledRun(
              "•",
              sizes.tiny,
              false,
              false,
              geo.entryIndent + bulletIndentPt + 14.73 * fontScale,
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
        previousBulletSpaceAfterPt = paragraphSpacing.spaceAfterPt ?? 0;
      });
    }
    prevKind = "content";
  }
  return out;
}

// Exposed for the vertical-parity checks.
export const JUNCTIONS = J;
export const BASELINESKIPS = BSK;
