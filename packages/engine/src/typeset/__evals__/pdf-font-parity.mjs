// PDF fidelity guard: proves the "Export PDF" path reproduces the editor 1:1 at
// the layer where they could drift — per-run font shaping.
//
// WHY THIS IS THE RIGHT CHECK. The editor DOM and the PDF consume the SAME engine
// LayoutDocument, so line breaks, run x-positions, baselines, and pagination are
// identical by construction — no test can make them differ. The only freedom left
// is how each backend renders a single run's glyphs, and both are pinned to ONE
// contract: the engine's `measure()` (committed advances + kerning + the five
// modeled ligatures). The DOM is calibrated to it; the PDF must match it too.
//
// pdf-lib draws a run via `font.layout(text)` (@pdf-lib/fontkit), then places it at
// the engine's x. So if fontkit's shaped advance for every run equals the engine's
// `measure()`, the PDF's glyphs land exactly where the editor's do. This asserts
// that for every family/face over a corpus that exercises ligatures, kerning,
// accents, punctuation, and digits — catching the two regressions that broke 1:1
// (fontkit applying unmodeled ligatures like `ft`, and dropped letter tracking).
//
// Run: node --experimental-strip-types src/typeset/__evals__/pdf-font-parity.mjs

import { readFileSync } from "node:fs";
import fontkit from "@pdf-lib/fontkit";

import { measure, texLigatures } from "../measure.ts";
import { DOCUMENT_FONT_FAMILIES, sfntAssetFile } from "../fontRegistry.ts";

const SIZE = 10; // bp; the tolerances below are absolute bp at this size
const TOLERANCE = 0.05; // bp: sub-⅐ px at 96dpi — visually exact

// Per-glyph quantisation budget, on top of TOLERANCE.
//
// metrics.gen.ts stores advances as integer 1000ths of an em. A face whose own
// design grid is 1000/em (Latin Modern, both Source families) therefore round
// -trips exactly and gets NO budget: its parity is bit-exact and stays locked.
// The metric-compatible families are drawn on Microsoft's 2048/em grid, where an
// advance like Times New Roman's `a` (909/2048) is not representable in 1000ths,
// so each glyph may sit up to half a 1000th from its true width.
//
// That is a per-GLYPH error, so the budget has to scale with glyph count — an
// absolute tolerance either rejects long runs (the measured worst case here is
// 0.117bp over a 61-character sentence) or, if raised to cover them, stops
// catching real divergence in short ones. Modelling it per glyph keeps the guard
// tight exactly where shaping bugs show up: a dropped ligature or missed kern
// pair moves a run by whole design units (tenths of a bp), which still fails the
// 2- and 3-glyph sweeps below, whose budget is only 0.01–0.015bp.
//
// The error cannot be removed without rescaling the outlines to 1000/em, which
// would trade this invisible engine-vs-render difference for a visible break in
// the metric compatibility that is the whole reason to ship these families.
const QUANTISATION_BP_PER_GLYPH = (0.5 / 1000) * SIZE;

const quantisingFaces = new Set(); // "family:face" of every face on a finer grid
const toleranceFor = (family, face, text) =>
  quantisingFaces.has(`${family}:${face}`)
    ? TOLERANCE + QUANTISATION_BP_PER_GLYPH * text.length
    : TOLERANCE;

// Corpus chosen to stress every shaping mechanism the engine models.
const CORPUS = [
  // standard f-ligatures (must ligate identically in engine + fontkit)
  "office", "efficient", "affiliate", "workflow", "fluffing", "flourish", "final",
  // f-pairs the engine does NOT model — must stay unligated in the embedded font
  "Software", "after", "craft", "effect", "shaft", "left", "gift",
  // kerning-sensitive pairs
  "AVA", "To", "Wave", "Yes", "P.O.", "Type", "VILLA", "AWKWARD",
  // accents, punctuation, and the engine's display transforms (— – ’)
  "café résumé naïve Zürich", "e--f g---h it's", "1234567890 $%&@#",
  // realistic resume text
  "Shipped a metric — what you built, improved, and by how much.",
  "Languages: Python, TypeScript, JavaScript, SQL, Java"
];

// Exhaustive pair sweep: every adjacent character pair the engine can produce.
// A pair check catches BOTH divergence directions — a kern pair fontkit applies
// that the engine's flattened table missed, and any 2-component ligature left in
// the embedded font that the engine does not model (`ft`, `fj`, quote/dash
// ligatures…), because fontkit would ligate the pair and change its advance.
// The `ff`+X triples extend that to every 3-component ligature (ffi/ffl/fft/ffj).
const ASCII = [];
for (let c = 0x21; c <= 0x7e; c += 1) ASCII.push(String.fromCharCode(c));
const ACCENTS = [..."ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ–—‘’“”•·…"];
const COMMON = [..."abcdefghijklmnopqrstuvwxyzAVTWY.,'\""];
const LETTERS = [..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"];
const PAIRS = [];
for (const a of ASCII) for (const b of ASCII) PAIRS.push(a + b);
for (const a of ACCENTS) for (const b of COMMON) { PAIRS.push(a + b); PAIRS.push(b + a); }
// accent×accent pairs: Source Serif's ccmp swapped `ïï` to a narrow-dieresis
// variant — a class of divergence only same-accent adjacency exposes.
for (const a of ACCENTS) for (const b of ACCENTS) PAIRS.push(a + b);
const TRIPLES = ASCII.map((c) => "ff" + c);
// letter·pivot·letter triples: contextual chains fire on 3-glyph patterns that
// no pair can trigger — Source's Catalan `l·l` (ccmp geminada in Sans, GPOS
// chained kerning in Serif) is the discovered case; sweep every letter pair
// around each punctuation pivot so future font revisions cannot smuggle one in.
for (const pivot of ["·", ".", ",", "'", "-", "’"]) {
  for (const a of LETTERS) for (const b of LETTERS) TRIPLES.push(a + pivot + b);
}

const faceStyle = (family) => ({ family, size: SIZE, tracking: 0 });

let failures = 0;
let checks = 0;
let worst = { delta: 0, where: "" };
// Worst delta among the exactly-representable faces, reported separately so a
// regression there cannot hide behind the quantising families' budget.
let worstExact = { delta: 0, where: "" };
const grids = new Map(); // upem -> families on that design grid

for (const [family, def] of Object.entries(DOCUMENT_FONT_FAMILIES)) {
  for (const face of Object.keys(def.faces)) {
    const file = sfntAssetFile(family, face);
    const font = fontkit.create(readFileSync(new URL(`../../../fonts/${file}`, import.meta.url)));
    const upm = font.unitsPerEm;
    // A face is exact only if its own grid divides the metrics table's 1000ths.
    if (1000 % upm !== 0 && upm % 1000 !== 0) quantisingFaces.add(`${family}:${face}`);
    if (!grids.has(upm)) grids.set(upm, new Set());
    grids.get(upm).add(family);
    const check = (raw) => {
      const display = texLigatures(raw); // emit draws display-form run text
      const engine = measure(display, { ...faceStyle(family), face });
      const shaped = (font.layout(display).advanceWidth / upm) * SIZE;
      const delta = Math.abs(engine - shaped);
      const budget = toleranceFor(family, face, display);
      checks += 1;
      const where = `${family}:${face} ${JSON.stringify(raw)}`;
      if (delta > Math.abs(worst.delta)) worst = { delta, where };
      if (!quantisingFaces.has(`${family}:${face}`) && delta > Math.abs(worstExact.delta)) {
        worstExact = { delta, where };
      }
      if (delta > budget) {
        failures += 1;
        if (failures <= 40) {
          console.error(
            `MISMATCH ${where} — engine ${engine.toFixed(4)}bp vs fontkit ${shaped.toFixed(4)}bp (Δ ${delta.toFixed(4)}, budget ${budget.toFixed(4)})`
          );
        }
      }
    };
    for (const raw of CORPUS) check(raw);
    for (const pair of PAIRS) check(pair);
    for (const triple of TRIPLES) check(triple);
  }
}

const familyCount = Object.keys(DOCUMENT_FONT_FAMILIES).length;
console.log(
  `\n${checks} checks (corpus + exhaustive pairs + ff-triples) across ${familyCount} families × 6 faces`
);
for (const [upm, families] of [...grids].sort((a, b) => a[0] - b[0])) {
  console.log(`  ${upm} units/em: ${[...families].join(", ")}`);
}
console.log(`  worst Δ overall ${worst.delta.toFixed(4)}bp @ ${worst.where}`);
console.log(
  `  worst Δ on exactly-representable faces ${worstExact.delta.toFixed(4)}bp @ ${worstExact.where || "n/a"}`
);
if (failures > 40) console.error(`(… ${failures - 40} more mismatches suppressed)`);
if (failures) {
  console.error(
    `\nFAIL: ${failures} run(s) exceed their budget — the PDF would not reproduce the editor 1:1.`
  );
  process.exit(1);
}
console.log(
  `PASS: every run's PDF shaping matches the engine within ${TOLERANCE}bp plus ${QUANTISATION_BP_PER_GLYPH}bp/glyph where the font's design grid is finer than the metrics table — Export PDF is 1:1 with the editor layout.`
);
