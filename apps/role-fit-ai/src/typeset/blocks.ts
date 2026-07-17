// Vertical layout for the jakes resume model: converts the template schema +
// DocStyle into a vertical stream of line boxes and glue, mirroring the
// compiled PDF's baseline rhythm.
//
// MODEL — a TeX-style vertical list, flattened to baseline arithmetic:
//   nextBaseline = prevBaseline + junction(prev, next)
// where each junction distance is either pure TeX mechanics (paragraph lines:
// \baselineskip × stretch) or a NAMED constant fitted against the compiled-PDF
// oracle (the same empirical method as the old CSS calibration, but the
// constants now live in exactly one place and are locked by the parity eval).
// DocStyle sliders enter linearly (em × 11 TeX pt → bp).

import { LM_METRICS } from "./metrics.gen.ts";
import type { FieldSrc, GlyphRun, ParagraphAlign } from "./types.ts";
import { FONT_SIZES_BP } from "./types.ts";
import { faceFor, inkExtent, measure, paragraphItems, segmentsFromInlineMarks, texLigatures } from "./measure.ts";
import { breakParagraph } from "./linebreak.ts";

// TeX pt → PDF pt (bp).
const PT = 72 / 72.27;

// \baselineskip of the 11pt article class per size command, in bp.
const BSK = {
  normalsize: 13.6 * PT,
  small: 12 * PT,
  large: 14 * PT
} as const;

export type DocStyleIn = {
  lineHeight?: number;
  nameContactGap?: number;
  contactGap?: number;
  headerSectionGap?: number;
  sectionGap?: number;
  sectionEntryGap?: number;
  entryGap?: number;
  titleSubGap?: number;
  headBulletGap?: number;
  skillsRowGap?: number;
  bulletGap?: number;
  headerAlign?: string;
  bodyAlign?: string;
  headingAlign?: string;
  nameSize?: string;
  pageMargins?: string;
  boldTitles?: boolean;
  boldHeadings?: boolean;
  boldSkillLabels?: boolean;
  italicSubtitles?: boolean;
  headingCase?: string;
  sectionRule?: boolean;
  contactDivider?: string;
};

export type SchemaEntry = {
  // Two field-name shapes exist upstream (toTemplateSchema emits title/meta/…;
  // the template evals use titleLeft/titleRight/…) — normalize via entryFields.
  titleLeft?: string;
  titleRight?: string;
  subtitleLeft?: string;
  subtitleRight?: string;
  title?: string;
  meta?: string;
  subtitle?: string;
  location?: string;
  bullets?: string[];
  // Provenance ids (Exact-mode editing); absent in server-eval fixtures.
  id?: string;
  bulletIds?: (string | undefined)[];
};

function entryFields(item: SchemaEntry) {
  return {
    titleLeft: item.titleLeft ?? item.title ?? "",
    titleRight: item.titleRight ?? item.meta ?? "",
    subtitleLeft: item.subtitleLeft ?? item.subtitle ?? "",
    subtitleRight: item.subtitleRight ?? item.location ?? ""
  };
}

export type SchemaSection = {
  heading?: string;
  type?: string;
  id?: string;
  items?: SchemaEntry[];
};

export type ResumeSchemaIn = {
  name?: string;
  contact?: string[];
  sections?: SchemaSection[];
};

// One typeset line placed in the vertical stream. x/runs are relative to the
// text column's left edge; `dist` is the baseline distance from the PREVIOUS
// line (page breaking recomputes the first line of each page via \topskip).
export type VLine = {
  runs: GlyphRun[]; // x already includes the line's indent
  height: number; // ink height above baseline (page-top placement)
  depth: number; // ink depth below baseline
  dist: number; // baseline distance from previous line in the stream
  // Pagination policy: "keep" lines may not start a page-break separation from
  // their predecessor (entry head rows, a bullet after its head, rules).
  keepWithPrev: boolean;
  rule?: { x: number; width: number; yOffset: number; thickness: number };
};

const num = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

// Defaults mirror DOC_STYLE_DEFAULTS / jakes DOC_EM.
const EM = {
  nameContactGap: 0.04,
  contactGap: 1.82,
  headerSectionGap: 1.19,
  sectionGap: 0.85,
  sectionEntryGap: 0.42,
  entryGap: 0.42,
  titleSubGap: 0.06,
  headBulletGap: 0.42,
  skillsRowGap: 0,
  bulletGap: 0.2
};

// ---- Geometry (bp) ----
const MARGIN_IN = { narrow: 0.4, normal: 0.5, wide: 0.75 } as const;
export function pageGeometry(style: DocStyleIn) {
  const m = MARGIN_IN[(style.pageMargins as keyof typeof MARGIN_IN) ?? "normal"] ?? 0.5;
  const margin = m * 72;
  const textWidth = 612 - 2 * margin;
  return {
    margin,
    textWidth,
    // Entry content indent (\resumeSubHeadingListStart leftmargin=0.15in) and
    // the inner bullet list's leftmarginii (2.2em of \normalsize).
    entryIndent: 0.15 * 72,
    bulletIndent: 0.15 * 72 + 2.2 * FONT_SIZES_BP.normalsize,
    // Head-row tabulars are 0.97\textwidth wide.
    headRowWidth: 0.97 * textWidth,
    firstBaselineMin: margin + 11 * PT, // \topskip (11pt class)
    lastBaselineMax: 792 - margin
  };
}

// ---- Junction constants (bp), fitted against the compiled-PDF oracle ----
// Each J_* is the baseline-distance REMAINDER after the linear docStyle terms;
// see the vertical-parity eval for the lock. All scale with baselineStretch
// where the underlying TeX glue does.
const J = {
  // name baseline → contact baseline, minus nameContactVSpace(1pt + slider).
  nameContact: BSK.normalsize,
  // contact → section heading, minus (headerSectionGap − sectionGap − 1.085em
  // center-close)·11pt − sectionGap·11pt terms (jakes headerSectionVSpacePt).
  contactHeading: 19.18,
  // section heading → first entry title / skills row, minus sectionEntryGap·11.
  headingEntry: 14.04,
  headingSkills: 12.2,
  // subtitle (or title) → first bullet, minus headBulletGap·11.
  headBullet: 11.9,
  // last line of an entry → next entry title, minus entryGap·11.
  entryEntry: 13.12,
  // last content line → next section heading, minus sectionGap·11.
  contentHeading: 14.02,
  // skills row → skills row, minus skillsRowGap·10.
  skillsRow: BSK.normalsize,
  // bullet last line → next bullet first line, minus bulletGap·11.
  bulletBullet: BSK.small
} as const;

// TeX \lineskip (1pt) and the tabular array strut: \@arstrutbox is built from
// the \baselineskip in effect when the tabular STARTS (\normalsize here), with
// height 0.7·bsk and depth 0.3·bsk — summing to exactly bsk, so two plain head
// rows sit at \baselineskip. A deeper box (an \underline'd link's rule hangs
// below the strut) trips the \lineskip floor and the distance goes ink-based:
// that is why project heads with linked metas sit ~1.1–1.7bp looser than
// standard entries. Computed mechanically from ink extents, no fitted constant.
const LINESKIP = 1 * PT;
// \underline places its rule ~2pt below the content's ink depth (fitted 2.04bp
// against linked metas; see the vertical-parity eval).
const UNDERLINE_EXTRA = 2.04;
// jakes \resumeSubheading row separator: \vspace{−4.5pt + titleSubGap·11pt}.
const TITLE_SUB_VSPACE_BASE = -4.5 * PT;

// URL-ish meta/location cells render as \href{\underline{...}} in the PDF —
// mirror renderMaybeLink's heuristic closely enough for depth purposes (worst
// case of a mismatch is ±2bp on one row in the \lineskip-floor regime). The
// lowercase-TLD requirement rejects abbreviations like "B.S." that the server
// leaves plain.
function looksLinked(text: string): boolean {
  const t = text.trim();
  return !/\s/.test(t) && /\.[a-z]{2,}([/?#][^\s]*)?$/.test(t);
}

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

function styledRun(text: string, size: number, bold: boolean, italic: boolean, x: number, src?: FieldSrc): GlyphRun {
  const style = { face: faceFor(bold, italic), size };
  // Same display-form contract as pushWord: run text carries TeX ligatures
  // (– — ’), consistent with the measured width; renderers draw verbatim.
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
  src?: FieldSrc
): GlyphRun[] {
  if (!/<\/?(?:b|i|u)>/i.test(value)) return [styledRun(value, size, flagBold, flagItalic, x, src)];
  const runs: GlyphRun[] = [];
  let cursorX = x;
  for (const seg of segmentsFromInlineMarks(value)) {
    if (!seg.text) continue;
    const style = { face: faceFor(seg.bold, seg.italic), size };
    const display = texLigatures(seg.text);
    const width = measure(display, style);
    runs.push({ text: display, style, x: cursorX, width, src });
    cursorX += width;
  }
  return runs.length ? runs : [styledRun(value, size, flagBold, flagItalic, x, src)];
}

// Mark a run as a link (underline + PDF annotation) when the template would
// linkify it. Destination mirrors linkify()'s mailto/https-defaulting.
function linkified(run: GlyphRun, source: string): GlyphRun {
  const t = source.trim();
  if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(t)) return { ...run, href: `mailto:${t}` };
  if (!looksLinked(t)) return run;
  const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`;
  return { ...run, href: url };
}

// A two-sided head row: left text, right text pinned to the row's right edge.
function headRow(
  left: GlyphRun[],
  right: string,
  size: number,
  rightItalic: boolean,
  geo: ReturnType<typeof pageGeometry>,
  rightSrc?: FieldSrc
): GlyphRun[] {
  const runs = [...left];
  if (right) {
    const r = styledRun(right, size, false, rightItalic, 0, rightSrc);
    r.x = geo.entryIndent + geo.headRowWidth - r.width;
    runs.push(linkified(r, right));
  }
  return runs;
}

// Paragraph → VLines at an indent within a column width.
function paragraphLines(
  value: string,
  size: number,
  indent: number,
  column: number,
  align: ParagraphAlign,
  baselineskip: number,
  firstDist: number,
  keepFirst: boolean,
  // Bullets keep all their lines together (editor policy); free-standing
  // paragraphs (summaries) may break mid-paragraph like TeX, so an over-tall
  // paragraph can never silently overflow a page.
  keepLinesTogether = true,
  src?: FieldSrc
): VLine[] {
  const lines = breakParagraph(paragraphItems(value, size), column, align);
  // Defensive fallback: the breaker normally returns one runless line for an
  // empty item stream. Keep one caret-bearing row even if that contract changes.
  if (!lines.length) lines.push({ runs: [], width: 0 });
  return lines.map((line, i) => {
    let runs = line.runs.map((r) => ({ ...r, x: r.x + indent, src }));
    let ink = inkOfRuns(runs);
    if (!runs.length) {
      // Preserve every authored blank line (including repeated/trailing hard
      // breaks), not only a wholly empty paragraph. The zero-width run gives the
      // editor a caret target while both DOM and PDF retain the same baseline.
      const style = { face: "regular" as const, size };
      ink = inkExtent("Ag", style);
      runs = [{ text: "", style, x: indent, width: 0, src }];
    }
    return {
      runs,
      height: ink.height,
      depth: ink.depth,
      dist: i === 0 ? firstDist : baselineskip,
      keepWithPrev: i === 0 ? keepFirst : keepLinesTogether
    };
  });
}

// Build the full vertical stream for a resume schema at a doc style.
export function buildVerticalStream(schema: ResumeSchemaIn, style: DocStyleIn): VLine[] {
  const geo = pageGeometry(style);
  const stretch = num(style.lineHeight, 1.18) / 1.2;
  const bsk = {
    normalsize: BSK.normalsize * stretch,
    small: BSK.small * stretch,
    large: BSK.large * stretch
  };
  const slider = (key: keyof typeof EM) => num(style[key], EM[key]);
  const pt11 = (em: number) => em * 11 * PT;
  const bodyAlign = (["justify", "center", "right"].includes(style.bodyAlign ?? "") ? style.bodyAlign : "left") as ParagraphAlign;
  const headerAlign = style.headerAlign === "left" || style.headerAlign === "right" ? style.headerAlign : "center";
  const headingAlign = style.headingAlign === "center" || style.headingAlign === "right" ? style.headingAlign : "left";
  const nameSize =
    style.nameSize === "large" ? FONT_SIZES_BP.Large : style.nameSize === "xlarge" ? FONT_SIZES_BP.LARGE : FONT_SIZES_BP.Huge;
  const boldTitles = style.boldTitles !== false;
  const italicSubs = style.italicSubtitles !== false;
  const boldSkills = style.boldSkillLabels !== false;

  const out: VLine[] = [];
  const push = (line: VLine) => out.push(line);
  const alignRow = (runs: GlyphRun[], width: number, mode: string): GlyphRun[] => {
    if (!runs.length) return runs;
    const w = runs[runs.length - 1].x + runs[runs.length - 1].width - runs[0].x;
    const dx = mode === "center" ? (width - w) / 2 - runs[0].x : mode === "right" ? width - w - runs[0].x : -runs[0].x;
    return runs.map((r) => ({ ...r, x: r.x + dx }));
  };

  // ---- Header: name + contact line ----
  if (schema.name) {
    // TeX sets bold display sizes (\Large and up) from the lmbx12 optical
    // master — ~2% narrower than scaled lmbx10, which matters for centering.
    const style = { face: "boldDisplay" as const, size: nameSize };
    const nameRun: GlyphRun = { text: schema.name, style, x: 0, width: measure(schema.name, style), src: { kind: "name" } };
    const runs = alignRow([nameRun], geo.textWidth, headerAlign);
    const ink = inkOfRuns(runs);
    push({ runs, height: ink.height, depth: ink.depth, dist: 0, keepWithPrev: false });
  }
  if (schema.contact?.length) {
    const size = FONT_SIZES_BP.small;
    const divider = (style.contactDivider || "|").slice(0, 2);
    const gapEm = num(style.contactGap, EM.contactGap);
    const dividerBox = gapEm * 10 * PT; // \makebox[contactGap·10pt][c]{|}
    const runs: GlyphRun[] = [];
    let x = 0;
    schema.contact.forEach((piece, i) => {
      if (i > 0) {
        const d = styledRun(divider, size, false, false, 0);
        d.x = x + (dividerBox - d.width) / 2;
        runs.push(d);
        x += dividerBox;
      }
      const r = styledRun(piece, size, false, false, x, { kind: "contact", index: i });
      runs.push(linkified(r, piece));
      x += r.width;
    });
    const aligned = alignRow(runs, geo.textWidth, headerAlign);
    const ink = inkOfRuns(aligned);
    push({
      runs: aligned,
      height: ink.height,
      depth: ink.depth,
      dist: J.nameContact * stretch + (1 + (num(style.nameContactGap, EM.nameContactGap) - EM.nameContactGap) * 10) * PT,
      keepWithPrev: true
    });
  }

  // ---- Sections ----
  let prevKind: "header" | "content" = "header";
  for (const section of schema.sections ?? []) {
    const items = section.items ?? [];
    // Heading line (+ rule).
    // Keep an existing section reachable after its heading is cleared. A
    // single injected space gives the editor a caret-bearing run; it remains
    // visually blank in screen/PDF output while the rule and section spacing
    // continue to communicate that the section still exists.
    if (section.heading || section.id) {
      const caseMode = style.headingCase === "uppercase" ? "uppercase" : style.headingCase === "none" ? "none" : "smallcaps";
      const headingText = caseMode === "uppercase" ? (section.heading ?? "").toUpperCase() : section.heading ?? "";
      // \scshape headings use the real lmcsc10 caps face (lowercase glyphs ARE
      // small capitals, with true advances). lmodern has no bold caps — TeX
      // falls back to medium there, so boldHeadings only applies to the
      // uppercase/plain modes, matching the compiled output.
      const headingStyle =
        caseMode === "smallcaps"
          ? ({ face: "caps", size: FONT_SIZES_BP.large } as const)
          : ({ face: faceFor(style.boldHeadings === true, false), size: FONT_SIZES_BP.large } as const);
      const paintedHeading = headingText || " ";
      const run: GlyphRun = {
        text: paintedHeading,
        style: headingStyle,
        x: 0,
        width: measure(paintedHeading, headingStyle),
        src: section.id ? { kind: "heading", sectionId: section.id } : undefined
      };
      const runs = alignRow([run], geo.textWidth, headingAlign);
      const ink = headingText ? inkOfRuns(runs) : inkExtent("Ag", headingStyle);
      // Header→first-heading depends ONLY on headerSectionGap: the template's
      // headerSectionVSpace subtracts sectionGap exactly because titlesec adds
      // it back — the sectionGap slider must NOT move the first heading
      // (review finding: a leftover slider term drifted it ~1.1bp/0.1em).
      const beforeGap =
        prevKind === "header"
          ? J.contactHeading * stretch +
            (num(style.headerSectionGap, EM.headerSectionGap) - EM.headerSectionGap) * 11 * PT +
            pt11(EM.sectionGap)
          : J.contentHeading * stretch + pt11(slider("sectionGap"));
      push({
        runs,
        height: ink.height,
        depth: ink.depth,
        dist: beforeGap,
        keepWithPrev: false,
        // \titlerule geometry MEASURED from the Tectonic oracle (stroked line
        // in the PDF): rule CENTER sits 4.3125bp below the heading baseline,
        // 0.4pt thick → top edge = baseline + 4.3125 − 0.4/2. (Was a 2.5bp
        // guess, which drew the rule ~1.6bp too close to the heading.)
        rule: style.sectionRule === false ? undefined : { x: 0, width: geo.textWidth, yOffset: 4.113, thickness: 0.4 }
      });
    }

    const isSkills = section.type === "skills";
    const isSummary = section.type === "summary";
    let firstInSection = true;

    for (const item of items) {
      const f = entryFields(item);
      // Provenance (Exact-mode editing) — only when the schema carries ids.
      const ids = section.id && item.id ? { sectionId: section.id, entryId: item.id } : null;
      const entrySrc = (field: "titleLeft" | "titleRight" | "subtitleLeft" | "subtitleRight"): FieldSrc | undefined =>
        ids ? { kind: "entry", ...ids, field } : undefined;
      const bulletSrc = (bi: number): FieldSrc | undefined =>
        ids && item.bulletIds?.[bi] ? { kind: "bullet", ...ids, bulletId: item.bulletIds[bi] } : undefined;
      if (isSkills) {
        const size = FONT_SIZES_BP.small;
        // Skills entries carry the row in bullets[0] ("Label: a, b") in the
        // toTemplateSchema shape, or split across titleLeft/subtitleLeft.
        let label = f.titleLeft.trim();
        let skills = f.subtitleLeft.trim();
        if (!label && !skills && item.bullets?.length) {
          const row = item.bullets[0] ?? "";
          const colon = row.indexOf(":");
          if (colon > 0 && colon <= 40) {
            label = row.slice(0, colon).trim();
            skills = row.slice(colon + 1).trim();
          } else {
            skills = row.trim();
          }
        }
        const text = label && skills ? `<b>${label}</b>: ${skills}` : label || skills;
        const dist = firstInSection
          ? J.headingSkills * stretch + pt11(slider("sectionEntryGap"))
          : J.skillsRow * stretch + slider("skillsRowGap") * 10 * PT;
        const lines = paragraphLines(
          boldSkills ? text : text.replace(/<\/?b>/g, ""),
          size,
          geo.entryIndent,
          geo.textWidth - geo.entryIndent,
          bodyAlign,
          bsk.small,
          dist,
          firstInSection,
          true,
          ids ? { kind: "skillsRow", ...ids } : undefined
        );
        lines.forEach(push);
        firstInSection = false;
        continue;
      }
      if (isSummary) {
        const dist = firstInSection
          ? J.headingSkills * stretch + pt11(slider("sectionEntryGap"))
          : J.bulletBullet * stretch + pt11(slider("bulletGap"));
        paragraphLines(
          f.subtitleLeft || f.titleLeft || item.bullets?.[0] || "",
          FONT_SIZES_BP.small,
          geo.entryIndent,
          geo.textWidth - geo.entryIndent,
          bodyAlign,
          bsk.small,
          dist,
          firstInSection,
          false, // summaries may break mid-paragraph (see paragraphLines)
          bulletSrc(0)
        ).forEach(push);
        firstInSection = false;
        continue;
      }

      // Standard entry: title row, optional subtitle row, bullets.
      const titleSize = FONT_SIZES_BP.normalsize;
      const subSize = FONT_SIZES_BP.small;
      const titleLeft = styledFieldRuns(f.titleLeft, titleSize, boldTitles, false, geo.entryIndent, entrySrc("titleLeft"));
      const titleRuns = headRow(titleLeft, f.titleRight, titleSize, false, geo, entrySrc("titleRight"));
      const inkT = inkOfRuns(titleRuns);
      push({
        runs: titleRuns,
        height: inkT.height,
        depth: inkT.depth,
        dist: firstInSection
          ? J.headingEntry * stretch + pt11(slider("sectionEntryGap"))
          : J.entryEntry * stretch + pt11(slider("entryGap")),
        keepWithPrev: firstInSection
      });
      firstInSection = false;

      const hasSub = Boolean(f.subtitleLeft.trim() || f.subtitleRight.trim());
      if (hasSub) {
        const subLeft = styledFieldRuns(f.subtitleLeft, subSize, false, italicSubs, geo.entryIndent, entrySrc("subtitleLeft"));
        const subRuns = headRow(subLeft, f.subtitleRight, subSize, italicSubs, geo, entrySrc("subtitleRight"));
        const inkS = inkOfRuns(subRuns);
        // Tabular strut mechanics (see LINESKIP note above): distance is
        // \baselineskip unless a box out-inks the strut (underlined links).
        const arstrutH = 0.7 * BSK.normalsize * stretch;
        const arstrutD = 0.3 * BSK.normalsize * stretch;
        const row1Depth = Math.max(arstrutD, inkT.depth + (looksLinked(f.titleRight) ? UNDERLINE_EXTRA : 0));
        const row2Height = Math.max(arstrutH, inkS.height);
        const bskRow = BSK.normalsize * stretch;
        const solid = row1Depth + LINESKIP + row2Height;
        const rowDist = bskRow - row1Depth - row2Height >= -1e-6 ? bskRow : solid;
        push({
          runs: subRuns,
          height: inkS.height,
          depth: inkS.depth,
          dist: rowDist + TITLE_SUB_VSPACE_BASE + pt11(slider("titleSubGap")),
          keepWithPrev: true
        });
      }

      (item.bullets ?? []).forEach((bullet, bi) => {
        const dist =
          bi === 0
            ? J.headBullet * stretch + pt11(slider("headBulletGap"))
            : J.bulletBullet * stretch + pt11(slider("bulletGap"));
        const lines = paragraphLines(
          bullet,
          FONT_SIZES_BP.small,
          geo.bulletIndent,
          geo.textWidth - geo.bulletIndent,
          bodyAlign,
          bsk.small,
          dist,
          true, // bullets keep with their entry head / previous bullet start
          true,
          bulletSrc(bi)
        );
        // First line carries the bullet marker (tiny math bullet at 25.53bp).
        // It shares the bullet's provenance so clicking it edits the bullet.
        if (lines.length) {
          const marker = { ...styledRun("•", FONT_SIZES_BP.tiny, false, false, geo.entryIndent + 14.73, bulletSrc(bi)), marker: true };
          lines[0].runs.unshift(marker);
        }
        // Allow page breaks BETWEEN bullets (not before the first).
        if (bi > 0 && lines.length) lines[0].keepWithPrev = false;
        lines.forEach(push);
      });
    }
    prevKind = "content";
  }
  return out;
}

// Exposed for the vertical-parity harness/eval.
export const JUNCTIONS = J;
export const BASELINESKIPS = BSK;
export { LM_METRICS };
