// Optimal line breaker: dynamic programming over legal break points minimizes
// total demerits, producing stable wrapping that greedy CSS cannot reproduce.
//
// Semantics implemented for the resume's alignment modes:
//   - Ragged modes (left/center/right) do not penalize unused width. A line can
//     still shrink interword space, which can keep one more word on the line.
//   - Justify: badness comes from stretch or shrink ratio; shrink has a hard
//     budget, while stretch is bounded by the tolerance threshold.
//   - Breaking after an explicit hyphen costs 50, so an equal-line-count break
//     at a space is preferred over splitting a compound.
//   - Demerits per line: (linepenalty + badness)² + penalty·|penalty|; the
//     final line has no under-full penalty in any mode.
//
// Paragraphs here are a handful of lines, so the O(n²) DP is microseconds.

import type { BoxItem, GlueItem, Line, ParaItem, ParagraphAlign } from "./types.ts";
import { measure } from "./measure.ts";

type SoftParaItem = Exclude<ParaItem, { kind: "forcedBreak" }>;

const LINE_PENALTY = 10;
// Lines with badness above this threshold are not feasible breaks.
const TOLERANCE = 200;
const INFEASIBLE = Number.POSITIVE_INFINITY;

// Badness uses integer arithmetic (⌊100·r³⌉). A lightly shrunk line can round
// to 0 and tie with a clean break, after which the fuller line wins. Using a
// float here changes that tie and causes unstable wrapping.
function texBadness(r: number): number {
  return Math.min(10000, Math.round(100 * r * r * r));
}

type Candidate = { index: number; penalty: number }; // break AFTER items[index-1]

function badnessFor(
  natural: number,
  stretch: number,
  shrink: number,
  target: number,
  align: ParagraphAlign,
  isLast: boolean
): number {
  if (natural > target) {
    // Overfull at natural width: even the final line must shrink real interword
    // space to fit.
    const need = natural - target;
    if (shrink <= 0 || need > shrink) return INFEASIBLE;
    const b = texBadness(need / shrink);
    return b > TOLERANCE ? INFEASIBLE : b;
  }
  if (isLast) return 0; // unused width on the final line is free
  if (align !== "justify") return 0; // unused width in ragged modes is free
  const need = target - natural;
  if (need === 0) return 0;
  if (stretch <= 0) return INFEASIBLE;
  // Unlike shrink (a hard physical limit), stretch can exceed its preferred
  // budget with badness growing as 100r³. The tolerance check is the cutoff; an
  // r>1 early-out would incorrectly reject usable justified lines.
  const b = texBadness(need / stretch);
  return b > TOLERANCE ? INFEASIBLE : b;
}

// Break a paragraph's item stream to `target` bp. Returns lines of positioned
// glyph runs (x relative to the paragraph's left edge).
export function breakParagraph(items: ParaItem[], target: number, align: ParagraphAlign): Line[] {
  // A literal newline is stronger than the optimization problem: partition the
  // stream first, then run the optimal breaker independently on each
  // authored line. Empty partitions are intentional blank visual lines, so
  // leading, repeated, and trailing newlines all survive.
  if (items.some((item) => item.kind === "forcedBreak")) {
    const lines: Line[] = [];
    let chunk: SoftParaItem[] = [];
    for (const item of items) {
      if (item.kind === "forcedBreak") {
        lines.push(...breakSoftParagraph(chunk, target, align));
        chunk = [];
      } else {
        chunk.push(item);
      }
    }
    lines.push(...breakSoftParagraph(chunk, target, align));
    return lines;
  }
  return breakSoftParagraph(items as SoftParaItem[], target, align);
}

function breakSoftParagraph(items: SoftParaItem[], target: number, align: ParagraphAlign): Line[] {
  // Legal break candidates: after any glue, at any penalty < 10000, plus the
  // forced end-of-paragraph break.
  const candidates: Candidate[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i];
    if (it.kind === "glue" && i > 0 && items[i - 1].kind === "box") {
      candidates.push({ index: i, penalty: 0 });
    } else if (it.kind === "penalty" && it.penalty < 10000) {
      candidates.push({ index: i, penalty: it.penalty });
    }
  }
  candidates.push({ index: items.length, penalty: 0 });

  // Prefix sums of width/stretch/shrink so a line's natural measure is O(1).
  // Glue at a break point is discarded (spaces vanish at line ends).
  const n = items.length;
  const w = new Float64Array(n + 1);
  const st = new Float64Array(n + 1);
  const sh = new Float64Array(n + 1);
  for (let i = 0; i < n; i += 1) {
    const it = items[i];
    w[i + 1] = w[i] + (it.kind === "penalty" ? 0 : it.width);
    st[i + 1] = st[i] + (it.kind === "glue" ? it.stretch : 0);
    sh[i + 1] = sh[i] + (it.kind === "glue" ? it.shrink : 0);
  }
  // measure(from, to): from = first item index of the line, to = break index.
  const measureLine = (from: number, to: number) => {
    let start = from;
    while (start < to && items[start].kind !== "box") start += 1; // skip leading glue/penalty
    let end = to;
    while (end > start && items[end - 1].kind !== "box") end -= 1; // discard trailing glue
    return {
      natural: w[end] - w[start],
      stretch: st[end] - st[start],
      shrink: sh[end] - sh[start],
      start,
      end
    };
  };

  // DP: best[c] = minimal total demerits ending a line at candidate c.
  const best = new Array<number>(candidates.length).fill(INFEASIBLE);
  const prev = new Array<number>(candidates.length).fill(-1);
  for (let ci = 0; ci < candidates.length; ci += 1) {
    const cand = candidates[ci];
    const isLast = ci === candidates.length - 1;
    for (let pi = -1; pi < ci; pi += 1) {
      const from = pi === -1 ? 0 : candidates[pi].index;
      const base = pi === -1 ? 0 : best[pi];
      if (base === INFEASIBLE) continue;
      const m = measureLine(from, cand.index);
      const bad = badnessFor(m.natural, m.stretch, m.shrink, target, align, isLast);
      if (bad === INFEASIBLE) continue;
      const demerits = (LINE_PENALTY + bad) ** 2 + cand.penalty * Math.abs(cand.penalty);
      // <= so ties prefer the LATEST previous break: in ragged modes every
      // feasible split has badness 0 and equal demerits, so this tie-break fills
      // each line maximally.
      if (base + demerits <= best[ci]) {
        best[ci] = base + demerits;
        prev[ci] = pi;
      }
    }
  }

  // Emergency fallback (a single box wider than the line): force break points
  // greedily, including measured grapheme boundaries inside an oversized box.
  if (best[candidates.length - 1] === INFEASIBLE) {
    return greedyFallback(items, target, align);
  }

  // Walk back the chosen breaks, then set each line's glue and positions.
  const breaks: number[] = [];
  let ci = candidates.length - 1;
  while (ci >= 0) {
    breaks.unshift(candidates[ci].index);
    ci = prev[ci];
  }
  const lines: Line[] = [];
  let from = 0;
  for (let bi = 0; bi < breaks.length; bi += 1) {
    const to = breaks[bi];
    lines.push(setLine(items, measureLine(from, to), target, align, bi === breaks.length - 1));
    from = to;
  }
  return lines;
}

// Materialize one line: distribute glue (justify) or offset (center/right),
// append a hyphen-free trailing fragment's runs, merge same-style neighbors.
function setLine(
  items: SoftParaItem[],
  m: { natural: number; stretch: number; shrink: number; start: number; end: number },
  target: number,
  align: ParagraphAlign,
  isLast: boolean
): Line {
  // Glue set ratio for this line. Each glue's set width is width ± r·(its own
  // stretch/shrink); every bundled family uses the same proportional glue
  // budget, so that reduces to a single scale factor on every space.
  let glueScale = 1;
  if (m.natural > target && m.shrink > 0) {
    const r = Math.min(1, (m.natural - target) / m.shrink);
    glueScale = 1 - r / 3; // width − r·(width/3)
  } else if (align === "justify" && !isLast && m.stretch > 0 && m.natural < target) {
    const r = (target - m.natural) / m.stretch;
    glueScale = 1 + r / 2; // width + r·(width/2)
  }

  const runs: Line["runs"] = [];
  let x = 0;
  let setWidth = 0;
  for (let i = m.start; i < m.end; i += 1) {
    const it = items[i];
    if (it.kind === "penalty") continue;
    if (it.kind === "glue") {
      const gw = it.width * glueScale;
      x += gw;
      setWidth += gw;
      continue;
    }
    const box = it as BoxItem;
    const last = runs[runs.length - 1];
    if (
      last &&
      last.style.family === box.style.family &&
      last.style.face === box.style.face &&
      last.style.size === box.style.size &&
      last.style.tracking === box.style.tracking &&
      last.href === box.href &&
      last.underline === box.underline &&
      last.x + last.width === x
    ) {
      last.text += box.text;
      last.width += box.width;
    } else {
      runs.push({ text: box.text, style: box.style, x, width: box.width, href: box.href, underline: box.underline });
    }
    x += box.width;
    setWidth += box.width;
  }

  // Horizontal placement for centered and right-aligned lines.
  let offset = 0;
  if (align === "center") offset = Math.max(0, (target - setWidth) / 2);
  else if (align === "right") offset = Math.max(0, target - setWidth);
  if (offset) for (const r of runs) r.x += offset;

  return { runs, width: m.natural };
}

// Keep combining marks, variation selectors, and ZWJ sequences with their base
// character. This is deliberately local and deterministic rather than relying
// on host-specific Intl.Segmenter behavior.
function graphemeClusters(text: string): string[] {
  const clusters: string[] = [];
  for (const codePoint of Array.from(text)) {
    const previous = clusters[clusters.length - 1];
    const joinsPrevious =
      clusters.length > 0 &&
      (/^\p{Mark}$/u.test(codePoint) ||
        codePoint === "\uFE0E" ||
        codePoint === "\uFE0F" ||
        codePoint === "\u200D" ||
        previous.endsWith("\u200D"));
    if (joinsPrevious) clusters[clusters.length - 1] += codePoint;
    else clusters.push(codePoint);
  }
  return clusters;
}

function splitBoxPrefix(
  box: BoxItem,
  maxWidth: number,
  forceOne = false
): { head: BoxItem | null; tail: BoxItem | null } {
  const clusters = graphemeClusters(box.text);
  if (clusters.length <= 1) {
    return box.width <= maxWidth || forceOne
      ? { head: box, tail: null }
      : { head: null, tail: box };
  }

  let low = 1;
  let high = clusters.length;
  let fit = 0;
  let fitWidth = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const text = clusters.slice(0, mid).join("");
    const width = measure(text, box.style);
    if (width <= maxWidth) {
      fit = mid;
      fitWidth = width;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (fit === 0) {
    if (!forceOne) return { head: null, tail: box };
    // A single glyph may itself exceed the whole column at extreme custom
    // sizes. Keep it intact and let only that glyph overflow an empty line.
    fit = 1;
    fitWidth = measure(clusters[0], box.style);
  }
  const headText = clusters.slice(0, fit).join("");
  const tailText = clusters.slice(fit).join("");
  return {
    head: { ...box, text: headText, width: fitWidth },
    tail: tailText
      ? { ...box, text: tailText, width: measure(tailText, box.style) }
      : null
  };
}

// One unbreakable unit: the boxes between two legal break opportunities. A word
// carrying inline family/size/mark boundaries arrives as several adjacent boxes,
// so the unit — not the box — is what must fit or move to the next line.
// `glue` is the interword space preceding the unit (null after a hyphen
// penalty, which is a legal break with no space of its own).
type GreedyUnit = { glue: GlueItem | null; boxes: BoxItem[]; width: number };

function greedyUnits(items: SoftParaItem[]): GreedyUnit[] {
  const units: GreedyUnit[] = [];
  let glue: GlueItem | null = null;
  let boxes: BoxItem[] = [];
  let width = 0;
  const close = () => {
    if (!boxes.length) return;
    units.push({ glue, boxes, width });
    glue = null;
    boxes = [];
    width = 0;
  };
  for (const item of items) {
    if (item.kind === "box") {
      boxes.push(item);
      width += item.width;
      continue;
    }
    close();
    if (item.kind === "glue") glue = item;
  }
  close();
  return units;
}

// Emergency path for content no legal break set can fit (e.g. one unbroken
// token wider than the line): greedy first-fit over unbreakable units, with
// measured character-level splitting reserved for a unit wider than the whole
// column. Normal paragraphs continue to use the optimal breaker above.
function greedyFallback(items: SoftParaItem[], target: number, align: ParagraphAlign): Line[] {
  const lineMeasure = (lineItems: SoftParaItem[]) => {
    let start = 0;
    while (start < lineItems.length && lineItems[start].kind !== "box") start += 1;
    let end = lineItems.length;
    while (end > start && lineItems[end - 1].kind !== "box") end -= 1;
    let natural = 0;
    let stretch = 0;
    let shrink = 0;
    for (let i = start; i < end; i += 1) {
      const it = lineItems[i];
      if (it.kind === "penalty") continue;
      natural += it.width;
      if (it.kind === "glue") {
        stretch += it.stretch;
        shrink += it.shrink;
      }
    }
    return { natural, stretch, shrink, start, end };
  };

  const chunks: SoftParaItem[][] = [];
  let current: SoftParaItem[] = [];
  let currentWidth = 0;
  let hasCurrentBox = false;
  const flush = () => {
    if (hasCurrentBox) chunks.push(current);
    current = [];
    currentWidth = 0;
    hasCurrentBox = false;
  };
  const place = (box: BoxItem) => {
    current.push(box);
    currentWidth += box.width;
    hasCurrentBox = true;
  };

  for (const unit of greedyUnits(items)) {
    // A space only materializes between two words on the same line; at a line
    // start it is discarded exactly as the optimal breaker discards it.
    if (unit.glue && hasCurrentBox) {
      current.push(unit.glue);
      currentWidth += unit.glue.width;
    }
    if (currentWidth + unit.width <= target) {
      for (const box of unit.boxes) place(box);
      continue;
    }
    // The unit does not fit the remainder but fits a column of its own: move it
    // intact. Splitting here would break a word at an inline style boundary,
    // which is not a legal break opportunity.
    if (unit.width <= target && hasCurrentBox) {
      flush();
      for (const box of unit.boxes) place(box);
      continue;
    }

    // Only now is the unit genuinely unbreakable and wider than the column:
    // fill through its boxes, splitting at measured grapheme boundaries.
    for (const unitBox of unit.boxes) {
      let box: BoxItem | null = unitBox;
      while (box) {
        const available = target - currentWidth;
        if (box.width <= available) {
          place(box);
          box = null;
          continue;
        }
        if (available <= 0 && hasCurrentBox) {
          flush();
          continue;
        }
        let { head, tail } = splitBoxPrefix(box, Math.max(0, available));
        if (!head && hasCurrentBox) {
          flush();
          continue;
        }
        if (!head) {
          // Not even one grapheme fits an empty column: let that single glyph
          // overflow rather than loop forever.
          ({ head, tail } = splitBoxPrefix(box, target, true));
        }
        if (!head) break;
        place(head);
        box = tail;
        if (box) flush();
      }
    }
  }
  flush();

  return chunks.map((lineItems, index) =>
    setLine(
      lineItems,
      lineMeasure(lineItems),
      target,
      align,
      index === chunks.length - 1
    )
  );
}
