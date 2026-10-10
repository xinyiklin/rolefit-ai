// Deterministic edge cases found in independent review, each as a synthetic
// PDF: content glyphs in Symbol fonts; form fields, text boxes, stamps, and
// other annotations; one run per glyph and private-use glyphs; formatting code
// split across runs; superscripts; a role title at a page break; and row values
// that must not read as a second column beside sidebars that must.
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

// An annotation with its own appearance stream, added to the first page; a
// checkbox's appearance is keyed by its state.
const withAnnotation = (dict, content) => ({ doc, pages, ...context }) => {
  header({ ...context, pages });
  const ctx = doc.context;
  const font = (BaseFont) => ctx.register(ctx.obj({ Type: "Font", Subtype: "Type1", BaseFont }));
  const resources = { Font: { Helv: font("Helvetica"), ZaDb: font("ZapfDingbats"), Wing: font("Wingdings") } };
  const appearance = ctx.register(ctx.stream(content, { Type: "XObject", Subtype: "Form", BBox: [0, 0, 300, 16], Resources: resources }));
  const annotation = ctx.register(ctx.obj({ Type: "Annot", Rect: [68, 615, 368, 631], F: 4, ...dict, AP: { N: dict.AS ? { [dict.AS.asString().slice(1)]: appearance } : appearance } }));
  pages[0].node.set(PDFName.of("Annots"), ctx.obj([annotation]));
  if (dict.Subtype === "Widget") doc.catalog.set(PDFName.of("AcroForm"), ctx.obj({ Fields: [annotation] }));
};
const PAINTED_TEXT = "BT /Helv 10 Tf 2 4 Td (Promoted to Staff Engineer in 2021) Tj ET";

test("a form field whose appearance shows text it does not hold is refused", async () => {
  const bytes = await pdf(withAnnotation({ Subtype: "Widget", FT: "Tx", T: PDFString.of("extra") }, PAINTED_TEXT));
  await assert.rejects(importResumePdf(bytes, pdfjs), (error) => error instanceof PdfImportError && error.kind === "overlay-text");
});

test("a stamp that paints text is refused, whatever the text operator or a nested dingbat font", async () => {
  for (const content of [
    PAINTED_TEXT,
    "BT /Helv 10 Tf 2 4 Td [(Promoted to) -250 (Staff Engineer)] TJ ET",
    "BT /Helv 10 Tf 12 TL 2 4 Td (Promoted to Staff Engineer) ' ET",
    // A dingbat font set inside q...Q is restored away before the text.
    "BT /Helv 10 Tf ET q BT /ZaDb 10 Tf 1 2 Td (4) Tj ET Q BT 20 4 Td (Promoted to Staff Engineer) Tj ET"
  ]) {
    const bytes = await pdf(withAnnotation({ Subtype: "Stamp" }, content));
    await assert.rejects(importResumePdf(bytes, pdfjs), (error) => error instanceof PdfImportError && error.kind === "overlay-text", content);
  }
});

test("an annotation that only draws, paints only spaces, or shows a dingbat check does not block the import", async () => {
  for (const [dict, content] of [
    [{ Subtype: "Square" }, "0 0 1 RG 1 w 0.5 0.5 299 15 re S"],
    [{ Subtype: "Widget", FT: "Tx", T: PDFString.of("blank") }, "BT /Helv 10 Tf 2 4 Td (   ) Tj ET"],
    [{ Subtype: "Widget", FT: "Btn", T: PDFString.of("checked"), V: PDFName.of("Yes"), AS: PDFName.of("Yes") }, "BT /ZaDb 10 Tf 1 2 Td (4) Tj ET"],
    [{ Subtype: "Widget", FT: "Btn", T: PDFString.of("ticked"), V: PDFName.of("Yes"), AS: PDFName.of("Yes") }, "BT /Wing 10 Tf 1 2 Td (\\374) Tj ET"]
  ]) {
    const result = await importResumePdf(await pdf(withAnnotation(dict, content)), pdfjs);
    assert.ok(result.audit.ok, dict.Subtype);
  }
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

// pdf-lib cannot embed a font without a Unicode map, so pdf.js is stubbed to
// return these text items on one page.
function stubPdfjs(items) {
  const page = {
    getViewport: () => ({ width: 612, height: 792, transform: [1, 0, 0, -1, 0, 792] }),
    getOperatorList: async () => ({ fnArray: [], argsArray: [] }),
    getAnnotations: async () => [],
    getTextContent: async () => ({ items }),
    commonObjs: { has: () => true, get: () => ({ name: "ABCDEF+CustomFont" }) }
  };
  return {
    OPS: pdfjs.OPS,
    getDocument: () => ({ destroy: async () => {}, promise: Promise.resolve({ numPages: 1, getPage: async () => page }) })
  };
}
const item = (str, x, y, size = 10) => ({ str, transform: [size, 0, 0, size, x, y], width: str.length * size * 0.5, fontName: "f1" });
const STUB_BYTES = new TextEncoder().encode("%PDF-1.7");
const isUnreadable = (error) => error instanceof PdfImportError && error.kind === "unreadable";

test("unmapped glyphs painted one per run are refused as unreadable", async () => {
  const glyphs = Array.from({ length: 60 }, (_, index) => item(String.fromCharCode(0xe020 + (index % 26)), 72 + (index % 20) * 6, 700 - Math.floor(index / 20) * 14));
  await assert.rejects(importResumePdf(STUB_BYTES, stubPdfjs(glyphs)), isUnreadable);
});

test("unmapped glyphs alternating with readable runs are refused as unreadable", async () => {
  const items = Array.from({ length: 40 }, (_, index) => [
    item("Bilt", 72 + (index % 10) * 40, 700 - Math.floor(index / 10) * 14),
    item(String.fromCharCode(0xe020 + (index % 26)), 92 + (index % 10) * 40, 700 - Math.floor(index / 10) * 14)
  ]).flat();
  await assert.rejects(importResumePdf(STUB_BYTES, stubPdfjs(items)), isUnreadable);
});

test("private-use bullets and contact icons import as text", async () => {
  const bullets = Array.from({ length: 10 }, (_, index) => [
    item("\uF0B7", 57, 660 - index * 14),
    item(`Shipped ${index + 2} payment services for the partner billing team`, 68, 660 - index * 14)
  ]).flat();
  const result = await importResumePdf(STUB_BYTES, stubPdfjs([
    item("Jane Doe", 54, 730, 18), item("\uF0E0", 54, 712), item("jane@example.test", 66, 712), item("EXPERIENCE", 54, 684, 12), ...bullets
  ]));
  assert.ok(result.audit.ok);
  assert.equal(result.data.sections[0].items.flatMap((entry) => entry.bullets).length, 10, "private-use glyphs at line starts are bullet markers");
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

// Rows as [left text, value at the tab stop, style]: an all-caps row without a
// style is a heading, any other unstyled row a bullet.
const tabStopVariants = {
  "places and dates": [
    ["EXPERIENCE"],
    ["Acme Corp", "San Francisco, CA", "bold"], ["Senior Engineer", "Jan 2019 – Present", "italic"], ["Cut build times in half for the payments team"],
    ["Globex", "Remote", "bold"], ["Engineer", "2016 – 2019", "italic"], ["Shipped the partner billing service"],
    ["EDUCATION"],
    ["State University", "Boston, MA", "bold"], ["BS Computer Science", "2012 – 2016", "italic"],
    ["Tech Institute", "Austin, TX", "bold"], ["MS Data Science", "2016 – 2017", "italic"]
  ],
  "single-word cities": [
    ["EXPERIENCE"],
    ["Acme GmbH", "London", "bold"], ["Senior Engineer", "Jan 2019 – Present", "italic"], ["Cut build times in half for the payments team"],
    ["EDUCATION"],
    ["State University", "Paris", "bold"], ["BS Computer Science", "2012 – 2016", "italic"],
    ["Tech Institute", "Munich", "bold"], ["MS Data Science", "2016 – 2017", "italic"]
  ],
  "dates beside GPAs": [
    ["EDUCATION"],
    ["State University", "2012 – 2016", "bold"], ["BS Computer Science", "GPA 3.8/4.0", "italic"],
    ["Tech Institute", "2016 – 2017", "bold"], ["MS Data Science", "GPA 3.9/4.0", "italic"],
    ["EXPERIENCE"], ["Acme Corp", "2019 – 2023", "bold"], ["Engineer", "Boston, MA", "italic"], ["Cut build times in half for the payments team"]
  ],
  "wide combined values": [
    ["EXPERIENCE"],
    ["Acme Corp", "Jan 2019 – Present · Boston, MA", "bold"], ["Senior Engineer", null, "italic"], ["Cut build times in half for the payments team"],
    ["Globex", "2016 – 2019 · Remote", "bold"], ["Engineer", null, "italic"],
    ["Initech", "2014 – 2016 · Austin, TX", "bold"], ["Analyst", null, "italic"],
    ["Hooli", "2012 – 2014 · Palo Alto, CA", "bold"], ["Intern", null, "italic"]
  ],
  "numeric months with durations": [
    ["EXPERIENCE"],
    ["Acme Corp", "06/2019 – Present (4 yrs)", "bold"], ["Senior Engineer", "Boston, MA (Hybrid)", "italic"], ["Cut build times in half for the payments team"],
    ["Globex", "03/2016 – 05/2019 (3 yrs)", "bold"], ["Engineer", "New York, NY (Remote)", "italic"],
    ["Initech", "01/2014 – 02/2016 (2 yrs)", "bold"], ["Analyst", "Austin, TX", "italic"]
  ]
};
test("values at a left-aligned tab stop stay with their rows, in the right-hand slot", async () => {
  for (const [label, rows] of Object.entries(tabStopVariants)) {
    const result = await importResumePdf(await pdf(({ text, fonts }) => {
      text("Jane Doe", 54, 730, 18, fonts.bold);
      text("jane@example.test", 54, 712);
      rows.forEach(([left, value, style], index) => {
        const y = 684 - index * 15;
        if (style) {
          text(left, 54, y, 10, fonts[style]);
          if (value) text(value, 430, y);
        } else if (left === left.toUpperCase()) {
          text(left, 54, y, 12, fonts.bold);
        } else {
          text("•", 57, y);
          text(left, 68, y);
        }
      });
    }), pdfjs);
    assert.deepEqual([...new Set(result.lines.lines.map((line) => line.region))], ["main"], label);
    // Each value lands in its own row's right-hand slot, nothing combined.
    const slots = result.data.sections.flatMap((section) => section.items.flatMap((item) => [
      [item.titleLeft, item.titleRight], [item.subtitleLeft, item.subtitleRight]
    ])).map((pair) => pair.map((text) => stripInlineMarks(text ?? "")));
    for (const [left, value] of rows.filter(([, value]) => value)) {
      assert.ok(slots.some(([leftSlot, rightSlot]) => leftSlot === left && rightSlot === value), `${label}: ${left} / ${value}: ${JSON.stringify(slots)}`);
    }
    assert.deepEqual(result.findings.filter((finding) => /combined/.test(finding.reason)), [], label);
  }
});

test("a one-off gap, or a gap shared in a row's left half, stays combined with a Check", async () => {
  const result = await importResumePdf(await pdf(({ text, fonts }) => {
    text("Jane Doe", 54, 730, 18, fonts.bold);
    text("jane@example.test", 54, 712);
    text("EXPERIENCE", 54, 684, 12, fonts.bold);
    text("Acme Corp", 54, 668, 10, fonts.bold);
    text("(acquired by Globex)", 330, 668);
    text("•", 57, 655);
    text("Ran the payments platform for three regions and cut settlement from two days to four hours", 68, 655);
    text("PROJECTS", 54, 627, 12, fonts.bold);
    text("RoleFit AI", 54, 611, 10, fonts.bold);
    text("TypeScript, Node", 200, 611);
    text("•", 57, 598);
    text("Built a local resume tailoring workbench", 68, 598);
    text("Typeset", 54, 585, 10, fonts.bold);
    text("React, Canvas", 200, 585);
    text("•", 57, 572);
    text("Built a browser resume editor", 68, 572);
  }), pdfjs);
  const entries = result.data.sections.flatMap((section) => section.items).map((item) => [stripInlineMarks(item.titleLeft), item.titleRight]);
  assert.deepEqual(entries, [["Acme Corp (acquired by Globex)", ""], ["RoleFit AI TypeScript, Node", ""], ["Typeset React, Canvas", ""]]);
  assert.equal(result.findings.filter((finding) => /combined/.test(finding.reason)).length, 3);
});

// A same-baseline sidebar beside the main column's rows, read as its own column.
// Bullets are a separate glyph, painted with their line ("• text"), or a
// ZapfDingbats glyph. Headings are larger and bold, bold only, or plain.
const sidebarPdf = (side, { bullets = null, headings = "larger" } = {}) => pdf(async ({ doc, text, fonts }) => {
  const dingbats = await doc.embedFont(StandardFonts.ZapfDingbats);
  const sideText = (value, y) => {
    const heading = headings !== "plain" && /^[A-Z]{4,}$/.test(value);
    text(value, 430, y, heading && headings === "larger" ? 11 : 10, heading ? fonts.bold : fonts.regular);
  };
  text("Priya Natarajan", 54, 730, 22, fonts.bold);
  text("EXPERIENCE", 54, 690, 11, fonts.bold);
  sideText(side[0], 690);
  ["Hooli", "Product Designer, 2019 – 2023", "Redesigned onboarding for 2M monthly users", "Ran 40 usability sessions with partners",
    "Pied Piper", "UX Designer, 2015 – 2019", "Shipped the first mobile app and its system", "Built the shared research repository"]
    .forEach((value, index) => {
      const y = 674 - index * 14;
      const font = index % 4 === 0 ? fonts.bold : fonts.regular;
      if (!bullets || index % 4 < 2) return text(value, 54, y, 10, font);
      if (bullets === "inline") return text(`• ${value}`, 57, y, 10, font);
      text(bullets === "dingbat" ? "●" : "•", 57, y, bullets === "dingbat" ? 6 : 10, bullets === "dingbat" ? dingbats : fonts.regular);
      text(value, 68, y, 10, font);
    });
  side.slice(1).forEach((value, index) => sideText(value, 674 - index * 14));
});
const regions = (result) => [...new Set(result.lines.lines.map((line) => line.region))].sort();
const DATED_SIDEBAR = ["EDUCATION", "BS Computer Science", "State University", "2012 – 2016",
  "CERTIFICATIONS", "AWS SAA · 2022", "CKA · 2021", "PMP · 2019", "CSM · 2018"];

test("a sidebar of skill lists with one dated education row is still a column", async () => {
  const result = await importResumePdf(await sidebarPdf(["SKILLS", "Python, Go, SQL", "React, TypeScript", "AWS, GCP, Docker", "Postgres, Redis",
    "Kafka, Airflow", "Figma, Jira", "EDUCATION", "Boston University, MA", "2012 – 2016"]), pdfjs);
  assert.deepEqual(regions(result), ["left", "right"]);
  assert.deepEqual(result.data.sections.map((section) => section.heading), ["EXPERIENCE", "SKILLS", "EDUCATION"]);
});

test("a mostly dated sidebar beside any kind of bullet is still a column", async () => {
  for (const bullets of ["glyph", "inline", "dingbat"]) {
    const result = await importResumePdf(await sidebarPdf(DATED_SIDEBAR, { bullets, headings: "plain" }), pdfjs);
    assert.deepEqual(regions(result), ["left", "right"], bullets);
  }
});

test("a mostly dated sidebar under its own headings is still a column beside plain lines", async () => {
  const titleCase = DATED_SIDEBAR.map((value) => (/^[A-Z]{4,}$/.test(value) ? value[0] + value.slice(1).toLowerCase() : value));
  // A heading styled exactly like body text is a column cue, but the local
  // reading has no signal to read it as a heading.
  for (const [label, side, headings, headingsFound] of [
    ["larger", DATED_SIDEBAR, "larger", true], ["bold", DATED_SIDEBAR, "bold", true],
    ["plain capitals", DATED_SIDEBAR, "plain", true], ["plain title case", titleCase, "plain", false]
  ]) {
    const result = await importResumePdf(await sidebarPdf(side, { headings }), pdfjs);
    assert.deepEqual(regions(result), ["left", "right"], label);
    if (!headingsFound) continue;
    const found = result.data.sections.map((section) => section.heading.toUpperCase());
    for (const heading of ["EXPERIENCE", "EDUCATION", "CERTIFICATIONS"]) assert.ok(found.includes(heading), `${label}: ${JSON.stringify(found)}`);
  }
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
