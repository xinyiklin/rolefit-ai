// TeX-model line breaker: dynamic programming over legal break points,
// minimizing total demerits — the piece of TeX that greedy CSS wrapping cannot
// imitate and the reason the engine can match the compiled PDF exactly.
//
// Semantics implemented (for the alignments the resume templates use):
//   - Ragged modes (left/center/right): \rightskip (and/or \leftskip) carry
//     "plus 1fil", so under-full lines have badness 0. A line can still SHRINK
//     its interword glue (fil has no shrink) — badness 100·r³ — which is how
//     TeX pulls "EC2"/"physicians" onto a line a greedy wrapper gives up on.
//   - Justify: badness from stretch or shrink ratio, infeasible past r > 1.
//   - Breaking after an explicit hyphen costs \exhyphenpenalty (50), so TeX
//     prefers an equal-line-count break at a space ("and ⏎ base-URL config")
//     over splitting the compound ("base- ⏎ URL config").
//   - Demerits per line: (linepenalty + badness)² + penalty·|penalty|; the
//     final line ends on \parfillskip 1fil (badness 0) in every mode.
//
// Paragraphs here are a handful of lines, so the O(n²) DP is microseconds.

import type { BoxItem, Line, ParaItem, ParagraphAlign } from "./types.ts";

type SoftParaItem = Exclude<ParaItem, { kind: "forcedBreak" }>;

const LINE_PENALTY = 10;
// LaTeX's \tolerance: lines with badness above this are not feasible breaks.
const TOLERANCE = 200;
const INFEASIBLE = Number.POSITIVE_INFINITY;

// TeX's badness is INTEGER arithmetic (⌊100·r³⌉). This matters: a lightly
// shrunk line (r≈0.13 → 100r³≈0.2) has badness 0 in TeX, tying with a clean
// break — and the tie-break then prefers the fuller line. Float badness here
// broke that tie the other way and diverged from real TeX output.
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
    // Overfull at natural width: \parfillskip/\rightskip fil is STRETCH only —
    // even the final line must shrink real interword glue to fit.
    const need = natural - target;
    if (shrink <= 0 || need > shrink) return INFEASIBLE;
    const b = texBadness(need / shrink);
    return b > TOLERANCE ? INFEASIBLE : b;
  }
  if (isLast) return 0; // \parfillskip 1fil absorbs any underfull final line
  if (align !== "justify") return 0; // ragged modes: fil stretch, badness 0
  const need = target - natural;
  if (need === 0) return 0;
  if (stretch <= 0) return INFEASIBLE;
  // Unlike shrink (a hard physical limit — glue cannot shrink past its budget),
  // TeX allows stretching BEYOND the budget with badness growing as 100r³; the
  // \tolerance check is the only cutoff (review finding: an r>1 early-out here
  // made the effective tolerance 100, breaking justified lines TeX accepts).
  const b = texBadness(need / stretch);
  return b > TOLERANCE ? INFEASIBLE : b;
}

// Break a paragraph's item stream to `target` bp. Returns lines of positioned
// glyph runs (x relative to the paragraph's left edge).
export function breakParagraph(items: ParaItem[], target: number, align: ParagraphAlign): Line[] {
  // A literal newline is stronger than the optimization problem: partition the
  // stream first, then run the existing TeX-style breaker independently on each
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
      // feasible split has badness 0 and equal demerits, and TeX's output
      // fills each line maximally — the tie-break carries that behavior.
      if (base + demerits <= best[ci]) {
        best[ci] = base + demerits;
        prev[ci] = pi;
      }
    }
  }

  // Emergency fallback (a single box wider than the line): force break points
  // greedily rather than failing — mirrors TeX's overfull box behavior.
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
  // stretch/shrink); with LM's uniform stretch = width/2 and shrink = width/3,
  // that reduces to a single scale factor on every space.
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
    if (last && last.style.face === box.style.face && last.style.size === box.style.size && last.x + last.width === x) {
      last.text += box.text;
      last.width += box.width;
    } else {
      runs.push({ text: box.text, style: box.style, x, width: box.width });
    }
    x += box.width;
    setWidth += box.width;
  }

  // Horizontal placement for center/right (TeX leftskip fil / both fils).
  let offset = 0;
  if (align === "center") offset = Math.max(0, (target - setWidth) / 2);
  else if (align === "right") offset = Math.max(0, target - setWidth);
  if (offset) for (const r of runs) r.x += offset;

  return { runs, width: m.natural };
}

// Emergency path for content no legal break set can fit (e.g. one unbroken
// token wider than the line): greedy first-fit, letting the oversized box
// overflow its line — the analogue of TeX's overfull \hbox.
function greedyFallback(items: SoftParaItem[], target: number, align: ParagraphAlign): Line[] {
  const measure = (start: number, end: number) => {
    let natural = 0;
    let stretch = 0;
    let shrink = 0;
    for (let i = start; i < end; i += 1) {
      const it = items[i];
      if (it.kind === "penalty") continue;
      natural += it.width;
      if (it.kind === "glue") {
        stretch += it.stretch;
        shrink += it.shrink;
      }
    }
    return { natural, stretch, shrink, start, end };
  };
  const lines: Line[] = [];
  let from = 0;
  let lastBoxEnd = 0;
  let widthAcc = 0;
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i];
    if (it.kind === "penalty") continue;
    widthAcc += it.width;
    if (it.kind === "box" && widthAcc > target && lastBoxEnd > from) {
      lines.push(setLine(items, measure(from, lastBoxEnd), target, align, false));
      from = lastBoxEnd;
      widthAcc = it.width;
    }
    if (it.kind === "box") lastBoxEnd = i + 1;
  }
  lines.push(setLine(items, measure(from, items.length), target, align, true));
  return lines;
}
