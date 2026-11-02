// A soft hyphen or a non-breaking hyphen must never change how "-" paints or
// extracts. fontkit swaps the glyph a soft hyphen shares with "-" for a space
// once one reaches it, and pdf-lib's ToUnicode map keeps the first character
// that reached a shared glyph, so both used to leak into every later hyphen.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import fontkit from "@pdf-lib/fontkit";
import { PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from "pdf-lib";

import { DOC_STYLE_DEFAULTS } from "../../lib/documentStyle.ts";
import { DOCUMENT_FONT_FAMILIES, ensureAllFontMetrics, sfntAssetFile } from "../fontRegistry.ts";
import { layoutResume } from "../layout.ts";
import { emitPdf } from "../pdf/emit.ts";
import { toTypesetSchema } from "../schema.ts";

await ensureAllFontMetrics();
const fontUrl = (family, face) => new URL(`../../../fonts/${sfntAssetFile(family, face)}`, import.meta.url);
// Built from code points: a literal soft hyphen is invisible and easy to lose.
const SOFT_HYPHEN = String.fromCharCode(0xad);
const NON_BREAKING_HYPHEN = String.fromCharCode(0x2011);
const HYPHEN = String.fromCharCode(0x2010);
const decoded = (stream) => Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1");

// The families whose "-" glyph is shared with U+00AD, U+2010 or U+2011.
for (const family of ["tinos", "arimo", "source-serif", "source-sans", "lato"]) {
  const fonts = new Map();
  for (const face of Object.keys(DOCUMENT_FONT_FAMILIES[family].faces)) fonts.set(`${family}:${face}`, new Uint8Array(readFileSync(fontUrl(family, face))));
  const regular = fontkit.create(readFileSync(fontUrl(family, "regular")));
  const hyphenCid = regular.glyphForCodePoint(0x2d).id.toString(16).toUpperCase().padStart(4, "0");
  const spaceCid = regular.glyphForCodePoint(0x20).id.toString(16).toUpperCase().padStart(4, "0");
  const schema = toTypesetSchema({
    header: { visible: true, name: "Sam Example", contact: [] },
    sections: [{ id: "s", heading: "Experience", type: "standard", items: [{ id: "e", titleLeft: "Engineer", titleRight: "", subtitleLeft: "", subtitleRight: "", bullets: [{ id: "b", text: `co${SOFT_HYPHEN}ordinated x${NON_BREAKING_HYPHEN}y x${HYPHEN}y a-b` }] }] }]
  });
  const pdf = await PDFDocument.load(await emitPdf(layoutResume(schema, { ...DOC_STYLE_DEFAULTS, fontFamily: family }), fonts, {}));
  const contents = pdf.getPages().flatMap((page) => {
    const c = page.node.Contents();
    return c instanceof PDFRawStream ? [c] : c.asArray().map((ref) => pdf.context.lookup(ref));
  }).map(decoded).join("\n")
    // Join each TJ array's glyph ids across its kerning adjustments.
    .replace(/>\s*-?[\d.]+\s*</g, "");
  const cid = (char) => regular.glyphForCodePoint(char.codePointAt(0)).id.toString(16).toUpperCase().padStart(4, "0");
  // "co" + soft hyphen + "ordinated": the soft hyphen paints nothing at all.
  assert.match(contents, new RegExp(`<[0-9A-F]*${cid("c")}${cid("o")}${cid("o")}${cid("r")}`), `${family}: a soft hyphen never paints mid-word`);
  // "a-b": glyph a, then the hyphen glyph (never the space glyph), then b.
  const a = cid("a");
  assert.match(contents, new RegExp(`<[0-9A-F]*${a}${hyphenCid}`), `${family}: "-" still paints as the hyphen glyph after a soft hyphen`);
  assert.doesNotMatch(contents, new RegExp(`<[0-9A-F]*${a}${spaceCid}`), `${family}: "-" never paints as a space`);
  // The regular face drew the bullet, so its ToUnicode map is the one a
  // U+2010 or U+2011 reached before "-".
  const regularMaps = [...pdf.context.enumerateIndirectObjects()]
    .map(([, obj]) => obj)
    .filter((obj) => obj instanceof PDFDict && obj.get(PDFName.of("Subtype"))?.toString() === "/Type0" && /Regular/.test(obj.get(PDFName.of("BaseFont"))?.toString() ?? ""))
    .map((font) => decoded(pdf.context.lookup(font.get(PDFName.of("ToUnicode")))));
  assert.equal(regularMaps.length, 1, `${family}: one regular face is embedded`);
  assert.ok(regularMaps[0].includes(`<${hyphenCid}> <002D>`), `${family}: the hyphen glyph extracts as "-", not as U+2010 or U+2011`);
}

console.log("PDF hyphen probes: soft and non-breaking hyphens never change how - paints or extracts");
