// PDF read-back guard: the emitted PDF must place glyphs where the engine's
// `measure()` does, kerning included. `pdf-font-parity` proves the embedded
// fonts SHAPE like the engine; this proves the emitter WRITES that shaping —
// a PDF that shows bare glyph ids is spaced by plain advances, so every kern
// pair (AVATAR, To, Wa…) renders wider than the editor.
//
// Each run is emitted, read back with pdf.js, and its rendered advance is summed
// from the operator list (glyph widths, TJ adjustments, and Tc) — the numbers a
// viewer paints with. The text layer must still extract every run intact.
//
// Run: node --experimental-strip-types src/typeset/__evals__/pdf-kerning.mjs

import { readFileSync } from "node:fs";
import fontkit from "@pdf-lib/fontkit";

import { PAGE_HEIGHT_BP } from "../blocks.ts";
import { DOCUMENT_FONT_FAMILIES, sfntAssetFile } from "../fontRegistry.ts";
import { measure, texLigatures } from "../measure.ts";
import { emitPdf } from "../pdf/emit.ts";

const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

// Same budget as pdf-font-parity: bit-exact for 1000/em faces, plus half a
// metrics-table unit per glyph for faces drawn on a finer grid.
const SIZE = 10;
const TOLERANCE = 0.05;
const QUANTISATION_BP_PER_GLYPH = (0.5 / 1000) * SIZE;

// Kern pairs, ligatures that meet kerned neighbours, display punctuation, and a
// realistic line (interior spaces are part of one run's glyph stream).
const SAMPLES = [
  "AVATAR", "To", "Wa", "LT", "Yo", "P.", "Type", "WAVY", "AWKWARD", "Tr",
  "office", "Terrific", "Vé", "it's", "e--f",
  "VP of Tooling, AT&T"
];
const TRACKING = 0.35; // one tracked sample per face proves Tc still applies

const fontBytes = (family, face) =>
  new Uint8Array(readFileSync(new URL(`../../../fonts/${sfntAssetFile(family, face)}`, import.meta.url)));

let failures = 0;
let checks = 0;
const fail = (message) => {
  failures += 1;
  if (failures <= 40) console.error(message);
};

for (const [family, def] of Object.entries(DOCUMENT_FONT_FAMILIES)) {
  const fonts = new Map();
  const expected = [];
  const pages = [];
  let kernedSamples = 0;
  for (const face of Object.keys(def.faces)) {
    const bytes = fontBytes(family, face);
    fonts.set(`${family}:${face}`, bytes);
    const upm = fontkit.create(bytes).unitsPerEm;
    const exact = 1000 % upm === 0 || upm % 1000 === 0;
    const lines = [];
    const variants = [
      ...SAMPLES.map((text) => ({ text, tracking: 0 })),
      { text: "AVATAR", tracking: TRACKING },
      { text: "linked To", tracking: 0, href: "https://example.test/kern" }
    ];
    for (const [index, { text: raw, tracking, href }] of variants.entries()) {
      const text = texLigatures(raw); // runs carry display-form text
      const style = { family, face, size: SIZE, tracking };
      const width = measure(text, style);
      const baseline = 40 + index * 16;
      const run = { text, style, x: 72, width, ...(href ? { href, underline: true } : {}) };
      lines.push({ baseline, runs: [run] });
      if (tracking === 0) {
        const unkerned = [...text].reduce((sum, ch) => sum + measure(ch, style), 0);
        if (!/f[fil]/.test(text) && Math.abs(unkerned - width) > 1e-9) kernedSamples += 1;
      }
      expected.push({
        page: pages.length + 1,
        y: PAGE_HEIGHT_BP - baseline,
        text,
        width,
        tracking,
        budget: TOLERANCE + (exact ? 0 : QUANTISATION_BP_PER_GLYPH * text.length),
        where: `${family}:${face}${tracking ? ` tracking ${tracking}` : ""} ${JSON.stringify(text)}`
      });
    }
    pages.push({ lines });
  }
  if (kernedSamples === 0) fail(`${family}: no sample carries a kern pair, so this family proves nothing`);

  const bytes = await emitPdf({ pages }, fonts, { title: `kerning ${family}` });
  const pdf = await pdfjs.getDocument({ data: bytes.slice(), useWorkerFetch: false, isEvalSupported: false }).promise;
  for (let p = 1; p <= pdf.numPages; p += 1) {
    const page = await pdf.getPage(p);
    const drawn = new Map(); // y -> { advance, text }
    const ops = await page.getOperatorList();
    let size = 0;
    let charSpacing = 0;
    let y = 0;
    for (const [i, fn] of ops.fnArray.entries()) {
      const args = ops.argsArray[i];
      if (fn === pdfjs.OPS.setFont) size = args[1];
      else if (fn === pdfjs.OPS.setCharSpacing) charSpacing = args[0];
      else if (fn === pdfjs.OPS.setTextMatrix) y = Math.round(args[0][5] * 1000) / 1000;
      else if (fn === pdfjs.OPS.showText || fn === pdfjs.OPS.showSpacedText) {
        const entry = drawn.get(y) ?? { advance: 0, glyphs: 0, charSpacing };
        for (const item of args[0]) {
          if (typeof item === "number") entry.advance -= (item / 1000) * size;
          else if (item) {
            entry.advance += (item.width / 1000) * size + charSpacing;
            entry.glyphs += 1;
          }
        }
        drawn.set(y, entry);
      }
    }
    const extracted = new Map(); // y -> extracted text items
    for (const item of (await page.getTextContent()).items) {
      if (!item.str) continue;
      const iy = Math.round(item.transform[5] * 1000) / 1000;
      extracted.set(iy, [...(extracted.get(iy) ?? []), item.str]);
    }
    for (const e of expected.filter((entry) => entry.page === p)) {
      checks += 1;
      const hit = drawn.get(e.y);
      if (!hit) {
        fail(`MISSING ${e.where}: no text drawn at y=${e.y}`);
        continue;
      }
      // Tc follows every glyph, the last included; the engine's run width
      // counts only the gaps between glyphs.
      const rendered = hit.advance - hit.charSpacing;
      const delta = Math.abs(rendered - e.width);
      if (delta > e.budget) {
        fail(`WIDTH ${e.where}: PDF ${rendered.toFixed(4)}bp vs engine ${e.width.toFixed(4)}bp (Δ ${delta.toFixed(4)}, budget ${e.budget.toFixed(4)})`);
      }
      if (hit.charSpacing !== e.tracking) fail(`TRACKING ${e.where}: PDF Tc ${hit.charSpacing} vs ${e.tracking}`);
      // Kern adjustments must not split a run's text item or inject spaces.
      const items = extracted.get(e.y) ?? [];
      if (items.length !== 1 || items[0] !== e.text) fail(`TEXT ${e.where}: extracted ${JSON.stringify(items)}`);
    }
    const links = (await page.getAnnotations()).filter((a) => a.subtype === "Link");
    if (links.length !== 1) fail(`${family} page ${p}: ${links.length} link annotations, expected 1`);
  }
}

console.log(`\n${checks} PDF runs read back across ${Object.keys(DOCUMENT_FONT_FAMILIES).length} families`);
if (failures > 40) console.error(`(… ${failures - 40} more failures suppressed)`);
if (failures) {
  console.error(`\nFAIL: ${failures} check(s) — the exported PDF does not place glyphs where the engine does.`);
  process.exit(1);
}
console.log("PASS: every PDF run renders at the engine's kerned width, with Tc, links, and extractable text intact.");
