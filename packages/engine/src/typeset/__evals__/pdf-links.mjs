// Link annotations survive PDF serialization for every destination shape the
// link normalizer admits: balanced and unbalanced parentheses, backslashes,
// non-ASCII mailto local parts, and already percent-encoded paths. pdf-lib
// writes literal strings verbatim, so the emitter has to escape them itself.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PDFDocument, PDFName } from "pdf-lib";

import { DOC_STYLE_DEFAULTS } from "../../lib/documentStyle.ts";
import { encodeLinkHref } from "../../lib/links.ts";
import { DOCUMENT_FONT_FAMILIES, ensureAllFontMetrics, sfntAssetFile } from "../fontRegistry.ts";
import { layoutResume } from "../layout.ts";
import { emitPdf } from "../pdf/emit.ts";
import { toTypesetSchema } from "../schema.ts";

await ensureAllFontMetrics();

const fonts = new Map();
for (const face of Object.keys(DOCUMENT_FONT_FAMILIES["latin-modern"].faces)) {
  fonts.set(`latin-modern:${face}`, new Uint8Array(readFileSync(new URL(`../../../fonts/${sfntAssetFile("latin-modern", face)}`, import.meta.url))));
}

const cases = [
  ["https://en.wikipedia.org/wiki/Foo_(bar)", "https://en.wikipedia.org/wiki/Foo_(bar)"],
  ["https://example.test/a)b(c", "https://example.test/a)b(c"],
  ["mailto:a(b@example.test", "mailto:a(b@example.test"],
  ["mailto:a\\b@example.test", "mailto:a\\b@example.test"],
  // A URI is a byte string: other characters travel as UTF-8 percent-escapes.
  ["mailto:jöhn@example.test", "mailto:j%C3%B6hn@example.test"],
  ["https://example.test/caf%C3%A9?q=1#frag", "https://example.test/caf%C3%A9?q=1#frag"],
  ["tel:+12125550100;ext=42", "tel:+12125550100;ext=42"]
];
const schema = toTypesetSchema({
  header: { visible: true, name: "Name", contact: cases.map(([href], index) => `<link=${encodeLinkHref(href)}>Link ${index}</link>`) },
  sections: [{ id: "s", heading: "Links", type: "standard", items: [{ id: "e", titleLeft: "Title", titleRight: "", subtitleLeft: "", subtitleRight: "", bullets: [{ id: "b", text: "Body" }] }] }]
});
const layout = layoutResume(schema, DOC_STYLE_DEFAULTS);
const painted = layout.pages[0].lines.flatMap((line) => line.runs).filter((run) => run.src?.kind === "contact" && run.href);
assert.equal(new Set(painted.map((run) => run.href)).size, cases.length, "every case paints as a linked contact");

const bytes = await emitPdf(layout, fonts, { title: "Link (escaping) \\ probe" });
const pdf = await PDFDocument.load(bytes);
assert.equal(pdf.getTitle(), "Link (escaping) \\ probe");
const annots = pdf.getPage(0).node.lookup(PDFName.of("Annots"));
const uris = [];
for (let index = 0; index < annots.size(); index += 1) {
  const annot = pdf.context.lookup(annots.get(index));
  uris.push(annot.lookup(PDFName.of("A")).lookup(PDFName.of("URI")).decodeText());
}
for (const [href, expected] of cases) {
  assert.ok(uris.includes(expected), `${href} reaches the PDF as ${expected} (found ${JSON.stringify([...new Set(uris)])})`);
}
console.log(`pdf-links: ${cases.length} destination shapes round-trip through PDF link annotations`);

// Linked text paints, measures and extracts exactly as typed. Display
// punctuation (-- → –, ' → ’) used to rewrite a link's visible text, so the PDF
// showed and extracted "sean.o’brien@…" or "xn–bcher…" while the link opened
// the typed address. Words that are not links keep display punctuation.
{
  const { default: fontkit } = await import("@pdf-lib/fontkit");
  const { FONT_FAMILY_IDS } = await import("../../lib/fontFamilies.ts");
  const { PDFDict, PDFRawStream, decodePDFRawStream } = await import("pdf-lib");
  const email = "a--b@x.com";
  const quoted = "sean.o'brien@gmail.com";
  const url = "xn--bcher-kva.example/o'neil---cv";
  const explicit = "O'Neil--site";
  const linkData = toTypesetSchema({
    header: { visible: true, name: "Name", contact: [email, `<b>${quoted}</b>`, `<link=https://example.test/o'neil>${explicit}</link>`, "<b>sean.o'brien</b>@gmail.com"] },
    sections: [{ id: "s", heading: "Links", type: "standard", items: [{ id: "e", titleLeft: "Title", titleRight: "", subtitleLeft: "", subtitleRight: "", bullets: [
      { id: "b", text: `Mail ${email} or see ${url} -- O'Neil's notes` }
    ] }] }]
  });
  const typed = [email, quoted, explicit, url];
  const linkedText = (runs, href, kind = "contact") => runs.filter((run) => run.href === href && run.src?.kind === kind && run.src.index !== 3).map((run) => run.text).join("");
  let measured = 0;
  for (const family of FONT_FAMILY_IDS) {
    const doc = layoutResume(linkData, { ...DOC_STYLE_DEFAULTS, fontFamily: family });
    const runs = doc.pages.flatMap((page) => page.lines.flatMap((line) => line.runs));
    assert.equal(linkedText(runs, `mailto:${email}`), email, `${family}: a linked email paints as typed`);
    assert.equal(linkedText(runs, `mailto:${email}`, "bullet"), email, `${family}: a linked email in prose paints as typed`);
    assert.equal(linkedText(runs, `mailto:${quoted}`), quoted, `${family}: an apostrophe in a linked email paints as typed`);
    assert.equal(linkedText(runs, "https://example.test/o'neil"), explicit, `${family}: explicit link text paints as typed`);
    assert.equal(linkedText(runs, `https://${url}`, "bullet"), url, `${family}: a linked URL paints as typed`);
    // An address split by a mark is still one link-shaped word: every piece as typed.
    assert.equal(runs.filter((run) => run.src?.kind === "contact" && run.src.index === 3).map((run) => run.text).join(""), quoted, `${family}: a mark-split address paints as typed`);
    const prose = runs.filter((run) => run.src?.kind === "bullet" && !run.href).map((run) => run.text).join(" ");
    assert.ok(prose.includes("–") && prose.includes("O’Neil’s"), `${family}: words that are not links keep display punctuation (${prose})`);
    for (const run of runs.filter((run) => run.href && run.text)) {
      const font = fontkit.create(readFileSync(new URL(`../../../fonts/${sfntAssetFile(family, run.style.face)}`, import.meta.url)));
      const shaped = (font.layout(run.text).advanceWidth / font.unitsPerEm) * run.style.size;
      const budget = 0.05 + (0.5 / 1000) * run.style.size * run.text.length;
      assert.ok(Math.abs(shaped - run.width) <= budget, `${family} ${JSON.stringify(run.text)}: layout ${run.width.toFixed(3)} vs drawn ${shaped.toFixed(3)}`);
      measured += 1;
    }
    // Each typed address is measured as typed: its runs span what fontkit shapes.
    for (const text of typed) {
      const href = text === explicit ? "https://example.test/o'neil" : text.includes("@") ? `mailto:${text}` : `https://${text}`;
      const linked = runs.filter((run) => run.href === href && run.src?.kind === (text === url ? "bullet" : "contact") && run.src.index !== 3);
      if (linked.length !== 1) continue; // a wrapped link is checked per run above
      const font = fontkit.create(readFileSync(new URL(`../../../fonts/${sfntAssetFile(family, linked[0].style.face)}`, import.meta.url)));
      const shaped = (font.layout(text).advanceWidth / font.unitsPerEm) * linked[0].style.size;
      assert.ok(Math.abs(shaped - linked[0].width) <= 0.05 + (0.5 / 1000) * linked[0].style.size * text.length, `${family} ${text}: measured as typed`);
    }
  }

  // The PDF draws the typed glyphs, and its ToUnicode map extracts them as the
  // ASCII the user typed.
  const decoded = (stream) => Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1");
  const hex = (font, text) => font.layout(text).glyphs.map((glyph) => glyph.id.toString(16).toUpperCase().padStart(4, "0")).join("");
  for (const family of ["latin-modern", "tinos", "inter"]) {
    const faces = new Map();
    for (const face of Object.keys(DOCUMENT_FONT_FAMILIES[family].faces)) {
      faces.set(`${family}:${face}`, new Uint8Array(readFileSync(new URL(`../../../fonts/${sfntAssetFile(family, face)}`, import.meta.url))));
    }
    const layoutDoc = layoutResume(linkData, { ...DOC_STYLE_DEFAULTS, fontFamily: family });
    const pdf = await PDFDocument.load(await emitPdf(layoutDoc, faces, {}));
    const contents = pdf.getPages().flatMap((page) => {
      const c = page.node.Contents();
      return c instanceof PDFRawStream ? [c] : c.asArray().map((ref) => pdf.context.lookup(ref));
    }).map(decoded).join("\n").replace(/>\s*-?[\d.]+\s*</g, "");
    const regular = fontkit.create(faces.get(`${family}:regular`));
    const bold = fontkit.create(faces.get(`${family}:bold`));
    for (const [text, font] of [[email, regular], [url, regular], [explicit, regular], [quoted, bold], ["sean.o'brien", bold]]) {
      // A URL may wrap at a hyphen; its first fragment still draws as typed.
      const head = layoutDoc.pages[0].lines.flatMap((line) => line.runs).find((run) => text.startsWith(run.text) && run.href)?.text ?? text;
      assert.ok(contents.includes(hex(font, head)), `${family}: the PDF draws ${JSON.stringify(head)} with the typed glyphs`);
    }
    const toUnicode = [...pdf.context.enumerateIndirectObjects()].map(([, obj]) => obj)
      .filter((obj) => obj instanceof PDFDict && obj.get(PDFName.of("Subtype"))?.toString() === "/Type0")
      .map((font) => decoded(pdf.context.lookup(font.get(PDFName.of("ToUnicode"))))).join("\n");
    for (const [char, code] of [["-", "002D"], ["'", "0027"]]) {
      assert.ok(toUnicode.includes(`<${hex(regular, char)}> <${code}>`), `${family}: the ${JSON.stringify(char)} glyph extracts as U+${code}`);
    }
  }
  console.log(`pdf-links: linked emails and URLs paint, measure (${measured} runs across ${FONT_FAMILY_IDS.length} families) and extract as typed`);
}
