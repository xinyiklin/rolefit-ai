// A measured character a face lacks (Roboto's `→`, Latin Modern's `≥`, PT
// Serif's `Ŵ`) is measured, painted, and embedded from its family's fallback
// instead of a 500-unit guess drawn as `.notdef`. This proves, for every family
// and face: the fallback covers every gap; the face's own fonts really lack a
// borrowed character and the fallback's PDF font has it; a mark the face draws
// unmeasured is never borrowed; `faceSegments` pieces shape in fontkit to
// `measure()`'s width and offsets; no pair kerns across a face boundary;
// decomposed accents compose only where the face has the letter; and an
// exported PDF embeds the fallback face only when a run borrows from it.
//
// Run: node --experimental-strip-types src/typeset/__evals__/glyph-fallback.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PDFDict, PDFName } from "pdf-lib";

import { DOC_STYLE_DEFAULTS } from "../../lib/documentStyle.ts";
import { DOCUMENT_FONT_FAMILIES, sfntAssetFile } from "../fontRegistry.ts";
import { layoutResume } from "../layout.ts";
import { faceSegments, measure, runFamilies } from "../measure.ts";
import { emitPdf, fetchFontBytes } from "../pdf/emit.ts";
import { toTypesetSchema } from "../schema.ts";

const SIZE = 10;
const fontFile = (family, face) => new URL(`../../../fonts/${sfntAssetFile(family, face)}`, import.meta.url);
const webFontFile = (family, face) => new URL(`../../..${DOCUMENT_FONT_FAMILIES[family].faces[face].assetPath}`, import.meta.url);
const shapers = new Map();
const shaper = (family, face) => {
  const key = `${family}:${face}`;
  if (!shapers.has(key)) shapers.set(key, fontkit.create(readFileSync(fontFile(family, face))));
  return shapers.get(key);
};
const webFonts = new Map();
const webFont = (family, face) => {
  const key = `${family}:${face}`;
  if (!webFonts.has(key)) webFonts.set(key, fontkit.create(readFileSync(webFontFile(family, face))));
  return webFonts.get(key);
};

const repertoire = new Set();
for (const def of Object.values(DOCUMENT_FONT_FAMILIES)) {
  for (const face of Object.values(def.faces)) for (const ch of Object.keys(face.metrics.adv)) repertoire.add(ch);
}

let gaps = 0;
let checks = 0;
let unmeasuredMarks = 0;
let crossFacePairs = 0;
const NEIGHBOURS = [..."AVTWYafkoty.,'1"];
for (const [family, def] of Object.entries(DOCUMENT_FONT_FAMILIES)) {
  for (const [face, faceDef] of Object.entries(def.faces)) {
    const own = faceDef.metrics;
    const style = { family, face, size: SIZE, tracking: 0 };
    // A mark-class glyph the generator leaves unmeasured is still the face's to
    // draw, as the browser draws it: it stays in the face's own run.
    for (const ch of own.unmeasured) {
      unmeasuredMarks += 1;
      assert.notEqual(shaper(family, face).glyphForCodePoint(ch.codePointAt(0)).id, 0, `${family}/${face} draws its unmeasured ${JSON.stringify(ch)}`);
      assert.deepEqual(runFamilies(`a${ch}a`, style), [family], `${family}/${face} keeps its unmeasured ${JSON.stringify(ch)}`);
    }
    const missing = [...repertoire].filter((ch) => own.adv[ch] === undefined && !own.unmeasured.includes(ch));
    if (!def.fallback) {
      assert.deepEqual(missing, [], `${family}/${face} is a fallback, so it must cover the whole repertoire`);
      continue;
    }
    const fallbackMetrics = DOCUMENT_FONT_FAMILIES[def.fallback].faces[face].metrics;
    const fallbackFont = shaper(def.fallback, face);
    for (const ch of missing) {
      gaps += 1;
      const codePoint = ch.codePointAt(0);
      // The browser picks a font by what it maps, so a borrowed character must
      // be one the face's web and PDF fonts cannot draw at all.
      assert.equal(shaper(family, face).hasGlyphForCodePoint(codePoint), false, `${family}/${face} PDF font draws the borrowed ${JSON.stringify(ch)}`);
      assert.equal(webFont(family, face).hasGlyphForCodePoint(codePoint), false, `${family}/${face} web font draws the borrowed ${JSON.stringify(ch)}`);
      assert.notEqual(fallbackMetrics.adv[ch], undefined, `${family}/${face} lacks ${JSON.stringify(ch)} and so does ${def.fallback}`);
      assert.notEqual(fallbackFont.glyphForCodePoint(codePoint).id, 0, `${def.fallback}/${face} PDF font has no glyph for ${JSON.stringify(ch)}`);
      // Pairs never kern across the face boundary, in either order. Today no
      // fallback face kerns a gap character, so this guards future fonts.
      for (const neighbour of NEIGHBOURS) {
        for (const pair of [neighbour + ch, ch + neighbour]) {
          if (fallbackMetrics.kern[pair]) crossFacePairs += 1;
          const parts = measure(pair[0], style) + measure(pair[1], style);
          assert.ok(Math.abs(measure(pair, style) - parts) < 1e-9, `${family}/${face} ${JSON.stringify(pair)} kerns across faces`);
        }
      }
    }
    // Each borrowed character between the face's own letters: the PDF draws
    // the pieces in their own fonts at `faceSegments` offsets, so each piece's
    // fontkit shaping must equal its measured advance, and the pieces must
    // tile the run's measured width, with and without letter tracking.
    for (const ch of missing) {
      for (const text of [`Ka${ch}To`, `${ch}${ch} 5`]) {
        for (const tracking of [0, 0.4]) {
          const style = { family, face, size: SIZE, tracking };
          const segments = faceSegments(text, style);
          assert.ok(segments.some((segment) => segment.family === def.fallback), `${family}/${face} ${JSON.stringify(text)} borrows`);
          assert.deepEqual(runFamilies(text, style), [family, def.fallback]);
          const last = segments.at(-1);
          const tiled = last.offset + measure(last.text, style);
          assert.ok(Math.abs(tiled - measure(text, style)) < 1e-9, `${family}/${face} ${JSON.stringify(text)} pieces tile the run`);
          if (tracking) continue;
          for (const segment of segments) {
            const font = shaper(segment.family, face);
            const shaped = (font.layout(segment.text).advanceWidth / font.unitsPerEm) * SIZE;
            const engine = measure(segment.text, style);
            const budget = 0.05 + (0.5 / 1000) * SIZE * segment.text.length;
            checks += 1;
            assert.ok(Math.abs(shaped - engine) <= budget, `${family}/${face} ${JSON.stringify(segment.text)}: fontkit ${shaped} vs engine ${engine}`);
          }
        }
      }
    }
  }
}

// Decomposed input measures, segments, and draws as its composed letter where
// the face has that letter, as browsers compose it. Where the face lacks the
// letter it stays decomposed and is never borrowed (DM Sans has no ĉ but draws
// c and the combining circumflex itself).
for (const family of ["latin-modern", "roboto", "pt-serif"]) {
  const style = { family, face: "regular", size: SIZE, tracking: 0 };
  assert.equal(measure("Jose\u0301 Zu\u0308rich", style), measure("José Zürich", style), `${family}: NFD measures as NFC`);
  assert.equal(faceSegments("Jose\u0301", style).map((segment) => segment.text).join(""), "José");
}
const dmSans = { family: "dm-sans", face: "regular", size: SIZE, tracking: 0 };
assert.deepEqual(runFamilies("c\u0302", dmSans), ["dm-sans"], "a letter the face lacks stays decomposed in its own face");
assert.deepEqual(faceSegments("c\u0302", dmSans).map((segment) => [segment.text, segment.family]), [["c\u0302", "dm-sans"]]);
assert.equal(faceSegments("\u212b", { ...dmSans, family: "roboto" })[0].text, "\u212b", "a singleton is not rewritten");

// A document that uses no borrowed character embeds no fallback face; one that
// does embeds exactly the fallback faces its runs borrow from.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const name = String(url).replace(/^https:\/\/fonts\.test\//, "");
  return new Response(readFileSync(new URL(`../../../fonts/${name}`, import.meta.url)));
};
const embeddedFamilies = async (family, bullet) => {
  const schema = toTypesetSchema({
    header: { visible: true, name: "Probe", contact: [] },
    sections: [{ id: "s", heading: "Experience", type: "standard", items: [{ id: "e", titleLeft: "Title", titleRight: "", subtitleLeft: "", subtitleRight: "", bullets: [{ id: "b", text: bullet }] }] }]
  });
  const layout = layoutResume(schema, { ...DOC_STYLE_DEFAULTS, fontFamily: family });
  const fonts = await fetchFontBytes(layout, "https://fonts.test");
  const pdf = await PDFDocument.load(await emitPdf(layout, fonts));
  const names = new Set();
  for (const page of pdf.getPages()) {
    const dict = page.node.Resources().lookup(PDFName.of("Font"), PDFDict);
    for (const key of dict.keys()) names.add(dict.lookup(key, PDFDict).lookup(PDFName.of("BaseFont")).decodeText?.() ?? String(dict.lookup(key, PDFDict).get(PDFName.of("BaseFont"))));
  }
  return { keys: [...fonts.keys()], names: [...names] };
};
const plain = await embeddedFamilies("roboto", "Cut p95 latency from 800ms to 120ms.");
assert.ok(plain.keys.every((key) => key.startsWith("roboto:")), `no fallback without a borrowed glyph: ${plain.keys}`);
const arrow = await embeddedFamilies("roboto", "Cut p95 latency 800ms → 120ms.");
assert.ok(arrow.keys.includes("arimo:regular"), `Roboto's → embeds Arimo: ${arrow.keys}`);
assert.ok(arrow.names.some((name) => /arimo/i.test(name)), `the PDF names an Arimo font: ${arrow.names}`);
const welsh = await embeddedFamilies("pt-serif", "Led the Ŵales rollout.");
assert.ok(welsh.keys.includes("tinos:regular"), `PT Serif's Ŵ embeds Tinos: ${welsh.keys}`);
globalThis.fetch = realFetch;

console.log(`PASS glyph fallback: ${gaps} face gaps covered by fonts that lack them, ${unmeasuredMarks} unmeasured marks kept, ${checks} shaped pieces at engine widths, no pair kerned across faces (${crossFacePairs} fallback pairs at risk), NFD composed where the face has the letter, PDF embeds fallback only when borrowed.`);
