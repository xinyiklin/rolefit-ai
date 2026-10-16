// Link annotations survive PDF serialization for every destination shape the
// link normalizer admits: balanced and unbalanced parentheses, backslashes,
// non-ASCII mailto local parts, and already percent-encoded paths. pdf-lib
// writes literal strings verbatim, so the emitter has to escape them itself.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PDFDocument, PDFName } from "pdf-lib";

import { DOC_STYLE_DEFAULTS } from "../../lib/documentStyle.ts";
import { encodeLinkHref } from "../../lib/links.ts";
import { DOCUMENT_FONT_FAMILIES, sfntAssetFile } from "../fontRegistry.ts";
import { layoutResume } from "../layout.ts";
import { emitPdf } from "../pdf/emit.ts";
import { toTypesetSchema } from "../schema.ts";

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
