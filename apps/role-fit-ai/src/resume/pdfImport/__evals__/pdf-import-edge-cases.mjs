// Deterministic edge cases found in independent review, each as a synthetic
// PDF: content glyphs in Symbol fonts, filled form fields and text boxes, one
// run per glyph (readable and unmapped), formatting code split across runs,
// superscripts, a role title at a page break, right-aligned dates that must not
// read as a second column, and a sidebar that must.
//
//   node apps/role-fit-ai/src/resume/pdfImport/__evals__/pdf-import-edge-cases.mjs
import assert from "node:assert/strict";
import { PDFDocument, PDFName, PDFString, StandardFonts } from "pdf-lib";
import { stripInlineMarks } from "@typeset/engine/lib/inlineMarksText.ts";
import { importResumePdf } from "../importResumePdf.ts";
import { PdfImportError } from "../importErrors.ts";

const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

async function pdf(draw, pages = 1) {
  const doc = await PDFDocument.create();
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    symbol: await doc.embedFont(StandardFonts.Symbol)
  };
  const pageList = Array.from({ length: pages }, () => doc.addPage([612, 792]));
  const text = (value, x, y, size = 10, font = fonts.regular, page = pageList[0]) => page.drawText(value, { x, y, size, font });
  await draw({ doc, fonts, pages: pageList, text });
  return doc.save();
}
const header = ({ text, fonts }) => {
  text("Jane Doe", 54, 730, 18, fonts.bold);
  text("jane@example.test | 555-0100", 54, 712);
  text("EXPERIENCE", 54, 684, 12, fonts.bold);
  text("Acme Corp", 54, 668, 10, fonts.bold);
  text("2019 – 2021", 500, 668);
};
const plainTexts = (data) => data.sections.flatMap((section) => section.items.flatMap((item) => [
  item.titleLeft, item.titleRight, item.subtitleLeft, item.subtitleRight, ...item.bullets.map((bullet) => bullet.text)
])).map((text) => stripInlineMarks(text ?? ""));
const unplaced = (result) => result.findings.filter((finding) => finding.kind === "unplaced");

const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test("a Symbol-font character at a line start is content, not a bullet marker", async () => {
  const result = await importResumePdf(await pdf((context) => {
    header(context);
    const { text, fonts } = context;
    text("•", 57, 641);
    text("Kept availability at 99.95% across regions", 68, 641);
    text("≥", 68, 628, 10, fonts.symbol);
    text("40% faster builds after the cache rollout", 76, 628);
  }), pdfjs);
  assert.ok(result.audit.ok);
  assert.ok(plainTexts(result.data).some((text) => text.includes("≥")), JSON.stringify(plainTexts(result.data)));
});

test("a filled form field is refused instead of silently missing", async () => {
  const bytes = await pdf(({ doc, pages, ...context }) => {
    header({ ...context, pages });
    const field = doc.getForm().createTextField("extra");
    field.setText("Promoted to Staff Engineer in 2021");
    field.addToPage(pages[0], { x: 68, y: 615, width: 300, height: 14, borderWidth: 0 });
  });
  await assert.rejects(importResumePdf(bytes, pdfjs), (error) => error instanceof PdfImportError && error.kind === "overlay-text");
});

test("a text box added in a viewer is refused instead of silently missing", async () => {
  const bytes = await pdf(({ doc, pages, ...context }) => {
    header({ ...context, pages });
    const ctx = doc.context;
    const font = ctx.register(ctx.obj({ Type: "Font", Subtype: "Type1", BaseFont: "Helvetica" }));
    const appearance = ctx.stream("BT /Helv 10 Tf 2 4 Td (Promoted to Staff Engineer in 2021) Tj ET", {
      Type: "XObject", Subtype: "Form", BBox: [0, 0, 300, 16], Resources: { Font: { Helv: font } }
    });
    const box = ctx.obj({
      Type: "Annot", Subtype: "FreeText", Rect: [68, 615, 368, 631], F: 4,
      Contents: PDFString.of("Promoted to Staff Engineer in 2021"), DA: PDFString.of("/Helv 10 Tf 0 g"), AP: { N: ctx.register(appearance) }
    });
    pages[0].node.set(PDFName.of("Annots"), ctx.obj([ctx.register(box)]));
  });
  await assert.rejects(importResumePdf(bytes, pdfjs), (error) => error instanceof PdfImportError && error.kind === "overlay-text");
});

test("an empty form field does not block the import", async () => {
  const result = await importResumePdf(await pdf(({ doc, pages, ...context }) => {
    header({ ...context, pages });
    context.text("•", 57, 641);
    context.text("Led the billing migration for three regions", 68, 641);
    doc.getForm().createTextField("unused").addToPage(pages[0], { x: 68, y: 615, width: 300, height: 14, borderWidth: 0 });
  }), pdfjs);
  assert.ok(result.audit.ok);
});

test("one run per glyph is read as text, not refused as a scan", async () => {
  const result = await importResumePdf(await pdf(({ fonts, pages }) => {
    const draw = (value, x, y, size, font) => {
      for (const char of value) {
        if (char !== " ") pages[0].drawText(char, { x, y, size, font });
        x += font.widthOfTextAtSize(char, size);
      }
    };
    draw("Jane Doe", 54, 730, 18, fonts.bold);
    draw("jane@example.test", 54, 712, 10, fonts.regular);
    draw("EXPERIENCE", 54, 684, 12, fonts.bold);
    draw("Acme Corp", 54, 668, 10, fonts.bold);
    draw("Built the billing service for partners", 68, 641, 10, fonts.regular);
  }), pdfjs);
  assert.ok(result.audit.ok);
  assert.equal(result.data.header.name, "Jane Doe");
  assert.ok(plainTexts(result.data).includes("Built the billing service for partners"), JSON.stringify(plainTexts(result.data)));
  assert.equal(result.audit.sourceWords, 12, "the summary counts words, not glyph runs");
});

test("unmapped glyphs painted one per run are refused as unreadable", async () => {
  // pdf-lib cannot embed a font without a Unicode map, so pdf.js is stubbed.
  const glyphs = Array.from({ length: 60 }, (_, index) => ({
    str: String.fromCharCode(0xe020 + (index % 26)),
    transform: [10, 0, 0, 10, 72 + (index % 20) * 6, 700 - Math.floor(index / 20) * 14],
    width: 5.5,
    fontName: "f1"
  }));
  const page = {
    getViewport: () => ({ width: 612, height: 792, transform: [1, 0, 0, -1, 0, 792] }),
    getOperatorList: async () => ({ fnArray: [], argsArray: [] }),
    getAnnotations: async () => [],
    getTextContent: async () => ({ items: glyphs }),
    commonObjs: { has: () => true, get: () => ({ name: "ABCDEF+CustomFont" }) }
  };
  const stub = {
    OPS: pdfjs.OPS,
    getDocument: () => ({ destroy: async () => {}, promise: Promise.resolve({ numPages: 1, getPage: async () => page }) })
  };
  await assert.rejects(
    importResumePdf(new TextEncoder().encode("%PDF-1.7"), stub),
    (error) => error instanceof PdfImportError && error.kind === "unreadable"
  );
});

test("formatting code split across runs is listed, not imported or refused", async () => {
  const result = await importResumePdf(await pdf((context) => {
    header(context);
    const { text, fonts } = context;
    text("•", 57, 641);
    text("Parsed <", 68, 641);
    text("b> tags in legacy email templates", 68 + fonts.regular.widthOfTextAtSize("Parsed <", 10), 641);
  }), pdfjs);
  assert.ok(result.audit.ok);
  assert.ok(unplaced(result).some((finding) => /formatting code/.test(finding.reason)));
  assert.ok(!plainTexts(result.data).some((text) => text.includes("tags in legacy")));
});

test("a link tag split by bold and regular runs cannot hide behind the importer's own marks", async () => {
  const result = await importResumePdf(await pdf((context) => {
    header(context);
    const { text, fonts } = context;
    text("•", 57, 641);
    text("Wrote docs <", 68, 641);
    text("link=https://evil.example.test>here", 68 + fonts.regular.widthOfTextAtSize("Wrote docs <", 10), 641, 10, fonts.bold);
  }), pdfjs);
  assert.ok(result.audit.ok && !result.audit.latentMarkup);
  assert.ok(!JSON.stringify(result.data).includes("evil.example.test"));
  assert.ok(unplaced(result).some((finding) => finding.text.includes("evil.example.test")));
});

test("a superscript joins its line", async () => {
  const result = await importResumePdf(await pdf((context) => {
    header(context);
    const { text, fonts } = context;
    text("•", 57, 641);
    const lead = "Ranked 1";
    text(lead, 68, 641);
    const after = 68 + fonts.regular.widthOfTextAtSize(lead, 10);
    text("st", after, 645, 6);
    text("of 40 teams in the region", after + fonts.regular.widthOfTextAtSize("st", 6) + 2.5, 641);
  }), pdfjs);
  assert.ok(plainTexts(result.data).includes("Ranked 1st of 40 teams in the region"), JSON.stringify(plainTexts(result.data)));
});

test("a role title at the bottom of one page and the top of the next is content, not a running header", async () => {
  const result = await importResumePdf(await pdf(({ pages, fonts, text }) => {
    const [first, second] = pages;
    text("Jane Doe", 54, 730, 18, fonts.bold, first);
    text("jane@example.test", 54, 712, 10, fonts.regular, first);
    text("EXPERIENCE", 54, 684, 12, fonts.bold, first);
    text("Company Z", 54, 300, 10, fonts.bold, first);
    text("2020 – 2021", 520, 300, 10, fonts.regular, first);
    text("Software Engineer", 54, 287, 10, fonts.italic, first);
    text("Software Engineer", 54, 740, 10, fonts.italic, second);
    text("•", 57, 726, 10, fonts.regular, second);
    text("Owned the search stack for the storefront", 68, 726, 10, fonts.regular, second);
  }, 2), pdfjs);
  assert.ok(!unplaced(result).some((finding) => /Repeated/.test(finding.reason)), JSON.stringify(unplaced(result)));
  assert.equal(plainTexts(result.data).filter((text) => text === "Software Engineer").length, 2);
});

test("equal-width right-aligned dates beside short bullets stay with their entries", async () => {
  const result = await importResumePdf(await pdf(({ text, fonts }) => {
    text("Jane Doe", 54, 730, 18, fonts.bold);
    text("jane@example.test", 54, 712);
    text("EXPERIENCE", 54, 684, 12, fonts.bold);
    for (let index = 0; index < 9; index += 1) {
      const y = 668 - index * 66;
      text(`Company ${String.fromCharCode(65 + index)}`, 54, y, 10, fonts.bold);
      text(`${2000 + index} – ${2001 + index}`, 500, y);
      text("Analyst", 54, y - 13, 10, fonts.italic);
      text("•", 57, y - 27);
      text(`Shipped ${index + 2} services for the payments team`, 68, y - 27);
    }
  }), pdfjs);
  assert.deepEqual([...new Set(result.lines.lines.map((line) => line.region))], ["main"]);
  const entries = result.data.sections[0].items;
  assert.equal(entries.length, 9);
  entries.forEach((entry, index) => assert.equal(entry.titleRight, `${2000 + index} – ${2001 + index}`));
});

test("flush-right years on consecutive rows stay with their rows", async () => {
  const result = await importResumePdf(await pdf(({ text, fonts }) => {
    const right = (value, y) => text(value, 556 - fonts.regular.widthOfTextAtSize(value, 10), y);
    text("Jane Doe", 54, 730, 18, fonts.bold);
    text("EXPERIENCE", 54, 700, 12, fonts.bold);
    for (let index = 0; index < 3; index += 1) {
      const y = 684 - index * 30;
      text(`Acme ${index}`, 54, y, 10, fonts.bold);
      right(`${2015 + index}`, y);
      text("•", 57, y - 13);
      text("Ran ops", 68, y - 13);
    }
    text("EDUCATION", 54, 580, 12, fonts.bold);
    ["BS Math", "MS Math", "PhD Math", "Postdoc"].forEach((degree, index) => {
      text(degree, 54, 564 - index * 13);
      right(`${2005 + index}`, 564 - index * 13);
    });
  }), pdfjs);
  assert.deepEqual([...new Set(result.lines.lines.map((line) => line.region))], ["main"]);
  const education = result.data.sections.find((section) => section.heading === "EDUCATION");
  assert.deepEqual(education.items.map((item) => item.titleRight), ["2005", "2006", "2007", "2008"]);
});

test("a right-hand sidebar on the main column's baselines is read as its own column", async () => {
  const result = await importResumePdf(await pdf(({ text, fonts }) => {
    text("Priya Natarajan", 54, 730, 22, fonts.bold);
    text("EXPERIENCE", 54, 690, 11, fonts.bold);
    text("SKILLS", 430, 690, 11, fonts.bold);
    const main = [
      ["Hooli", true], ["Product Designer, 2019 – 2023", false], ["Redesigned onboarding for 2M monthly users", false],
      ["Ran 40 usability sessions with partners", false], ["Pied Piper", true], ["UX Designer, 2015 – 2019", false],
      ["Shipped the first mobile app and its system", false], ["Built the shared research repository", false]
    ];
    const side = ["Figma", "Prototyping", "User research", "HTML and CSS", "React", "Accessibility", "Design systems", "Workshops"];
    main.forEach(([value, bold], index) => text(value, 54, 674 - index * 14, 10, bold ? fonts.bold : fonts.regular));
    side.forEach((value, index) => text(value, 430, 674 - index * 14));
  }), pdfjs);
  assert.deepEqual([...new Set(result.lines.lines.map((line) => line.region))].sort(), ["left", "right"]);
  assert.deepEqual(result.data.sections.map((section) => section.heading), ["EXPERIENCE", "SKILLS"]);
  assert.deepEqual(result.data.header.contact, []);
  const skills = plainTexts({ sections: [result.data.sections[1]] }).join(" ");
  assert.ok(skills.includes("Figma") && skills.includes("Workshops") && !skills.includes("Hooli"), skills);
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    await fn();
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}\n  ${error.message}`);
  }
}
console.log(`pdf-import-edge-cases: ${cases.length - failed}/${cases.length} passed`);
if (failed) process.exit(1);
