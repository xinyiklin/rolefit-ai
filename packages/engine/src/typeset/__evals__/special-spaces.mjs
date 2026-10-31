// A tab or no-break space in a single-line field run paints as one space. The
// run's measured width must be what the PDF draws (and the editor paints, from the same run text): a 500-unit
// unknown-glyph charge or a four-space tab used to push a right-pinned date
// past the margin, or leave it short of it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import fontkit from "@pdf-lib/fontkit";

import { DOC_STYLE_DEFAULTS } from "../../lib/documentStyle.ts";
import { FONT_FAMILY_IDS } from "../../lib/fontFamilies.ts";
import { ensureAllFontMetrics, sfntAssetFile } from "../fontRegistry.ts";
import { layoutResume } from "../layout.ts";

await ensureAllFontMetrics();

// Built from code points: a literal no-break space is invisible in source.
const NBSP = String.fromCharCode(0xa0);
const TAB = String.fromCharCode(0x09);
const lines = (doc) => doc.pages.flatMap((page) => page.lines);
const resume = (item, contact = []) => ({
  header: { name: "Name", contact },
  sections: [{ id: "s", type: "standard", heading: "Experience", items: [{
    id: "e", titleLeft: "Engineer", titleRight: "", subtitleLeft: "Company", subtitleRight: "", bullets: [], bulletIds: [], ...item
  }] }]
});

// In a paragraph a no-break space is unbreakable glue: the bullet that wraps
// between "$5" and "million" at an ordinary space keeps them on one line.
{
  const before = "Grew annual recurring revenue for the enterprise analytics suite and its partner integrations by about roughly $5";
  const after = "million across three product lines";
  const bulletLines = (text) => lines(layoutResume(resume({ bullets: [text], bulletIds: ["b"] }), DOC_STYLE_DEFAULTS))
    .filter((line) => line.runs.some((run) => run.src?.kind === "bullet"));
  const broken = bulletLines(`${before} ${after}`);
  assert.ok(broken.length === 2 && broken[0].runs.at(-1).text === "$5", "the ordinary space is where this bullet wraps");
  const kept = bulletLines(`${before}${NBSP}${after}`);
  assert.equal(kept.length, 2, "the bullet still wraps once");
  assert.notEqual(kept[0].runs.at(-1).text, "$5", "the no-break space is never the break");
  const second = kept[1].runs.map((run) => run.text);
  assert.ok(second.indexOf("$5") >= 0 && second.indexOf("$5") < second.indexOf("million"), "$5 moves to the next line with million");
  // Text pasted with only no-break spaces has no legal break, so the emergency
  // breaker wraps it, at a no-break space rather than inside a word.
  const pasted = "Led a cross functional migration of billing services to a new platform while reducing incident volume and improving release cadence for partner teams";
  const pastedLines = bulletLines(pasted.replaceAll(" ", NBSP));
  assert.ok(pastedLines.length > 1, "the pasted bullet still wraps");
  const words = new Set([...pasted.split(" "), "•"]);
  for (const run of pastedLines.flatMap((line) => line.runs).filter((run) => run.src?.kind === "bullet" && run.text.trim())) {
    assert.ok(words.has(run.text.trim()), `a pasted no-break bullet wraps between words, not inside one: ${JSON.stringify(run.text)}`);
  }
}

// Single-line fields: the painted text holds no tab or no-break space, and
//    its measured width is the width the embedded font shapes it to.
const cases = [
  ["titleRight", { titleRight: `Jan${NBSP}2020 - Mar${NBSP}2024` }],
  ["subtitleRight", { subtitleRight: `San Francisco, CA${TAB}2019 - 2024` }],
  ["titleLeft", { titleLeft: `<b>Senior${TAB}Engineer</b>` }],
  ["contact", {}, [`Lisbon,${NBSP}PT`, `City${TAB}Region`]]
];
let checked = 0;
for (const family of FONT_FAMILY_IDS) {
  const faces = new Map();
  const fontFor = (face) => {
    if (!faces.has(face)) faces.set(face, fontkit.create(readFileSync(new URL(`../../../fonts/${sfntAssetFile(family, face)}`, import.meta.url))));
    return faces.get(face);
  };
  for (const [field, item, contact] of cases) {
    const doc = layoutResume(resume(item, contact), { ...DOC_STYLE_DEFAULTS, fontFamily: family });
    const rightEdge = 612 - doc.geometry.marginRight;
    const runs = lines(doc).flatMap((line) => line.runs)
      .filter((run) => (run.src?.kind === "entry" && run.src.field === field) || (field === "contact" && run.src?.kind === "contact"));
    assert.ok(runs.length, `${family}/${field} lays out`);
    for (const run of runs) {
      assert.doesNotMatch(run.text, new RegExp(`[${TAB}${NBSP}]`), `${family}/${field} paints a tab or no-break space as one space`);
      assert.equal(run.style.family, family, `${family}/${field} draws in its own family`);
      const face = fontFor(run.style.face);
      const shaped = (face.layout(run.text).advanceWidth / face.unitsPerEm) * run.style.size;
      // The 2048/em families carry a per-glyph rounding residue (pdf-font-parity).
      const budget = 0.05 + (0.5 / 1000) * run.style.size * run.text.length;
      assert.ok(Math.abs(shaped - run.width) <= budget, `${family}/${field} ${JSON.stringify(run.text)}: layout ${run.width.toFixed(3)} vs drawn ${shaped.toFixed(3)}`);
      assert.ok(run.x + shaped <= rightEdge + budget, `${family}/${field} stays inside the right margin`);
      checked += 1;
    }
  }
}

console.log(`special-space checks passed: a no-break paragraph space and ${checked} single-line runs across ${FONT_FAMILY_IDS.length} families`);
