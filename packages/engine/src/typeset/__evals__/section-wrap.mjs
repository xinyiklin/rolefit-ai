import assert from "node:assert/strict";
import { DOC_STYLE_DEFAULTS } from "../../lib/documentStyle.ts";
import { FONT_FAMILY_IDS } from "../../lib/fontFamilies.ts";
import { layoutResume } from "../layout.ts";

const fixture = heading => ({ sections: [{ id: "section", type: "standard", heading, items: [{
  id: "entry", titleLeft: "Engineer", titleRight: "2026", subtitleLeft: "Company", subtitleRight: "Remote",
  bullets: ["Following content."], bulletIds: ["bullet"]
}]}] });

function check(heading, style) {
  const doc = layoutResume(fixture(heading), style);
  const rows = doc.pages.flatMap(page => page.lines).filter(line => line.runs.some(run => run.src?.kind === "heading"));
  for (const page of doc.pages) {
    for (const line of page.lines) {
      assert(line.baseline <= doc.geometry.lastBaselineMax, "section continuation stays on its page");
      for (const run of line.runs) {
        assert(run.x >= doc.geometry.marginLeft - 1e-6, "section text stays inside left margin");
        assert(run.x + run.width <= 612 - doc.geometry.marginRight + 1e-6, "section text stays inside right margin");
      }
    }
  }
  assert.equal(rows.filter(line => line.rule).length, style.sectionRule === false ? 0 : 1, "one section rule only");
  if (style.sectionRule !== false) assert(rows.at(-1).rule, "section rule follows the final continuation");
  const plain = heading.replace(/<[^>]*>/g, "");
  const expected = style.headingCase === "uppercase" ? plain.toUpperCase() : plain;
  const painted = rows.map(line => line.runs.map((run, i) =>
    (i && run.x > line.runs[i-1].x + line.runs[i-1].width + .3 ? " " : "") + run.text + (run.breakAfter ?? "")
  ).join("")).join("");
  assert.equal(painted, expected || " ", "heading text and consumed separators remain complete");
  return { doc, rows };
}

for (const fontFamily of FONT_FAMILY_IDS) {
  for (const headingCase of ["none", "smallcaps", "uppercase"]) {
    for (const length of [80, 512, 4096]) {
      for (const spaced of [false, true]) {
        const text = spaced ? "Section words ".repeat(Math.ceil(length/14)).slice(0,length) : "W".repeat(length);
        const { rows } = check(text, { ...DOC_STYLE_DEFAULTS, fontFamily, headingCase });
        if (length >= 512) assert(rows.length > 1);
      }
    }
    for (const headingAlign of ["left", "center", "right"]) {
      check("Section words ".repeat(40), { ...DOC_STYLE_DEFAULTS, fontFamily, headingCase, headingAlign });
    }
    check("", { ...DOC_STYLE_DEFAULTS, fontFamily, headingCase });
  }
}
check("<size=24>Large heading words </size>".repeat(25), { ...DOC_STYLE_DEFAULTS, sectionRule: false });
check("<line-height=1>Section words </line-height>".repeat(30), { ...DOC_STYLE_DEFAULTS, lineHeight: 1 });
const tall = check("W".repeat(4096), DOC_STYLE_DEFAULTS);
assert(tall.doc.pages.length > 1, "very tall section heading paginates");
console.log("section wrapping: six fonts, three case modes, lengths80/512/4096, spaces/tokens, alignment, marks, rule placement and pagination passed");
