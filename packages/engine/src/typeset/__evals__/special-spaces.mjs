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
const NARROW = String.fromCharCode(0x202f);
const FIGURE = String.fromCharCode(0x2007);
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
  for (const tie of [NARROW, FIGURE]) {
    const tied = bulletLines(`${before}${tie}${after}`);
    const name = tie.codePointAt(0).toString(16);
    assert.equal(tied.length, 2, `a ${name} space still wraps the bullet once`);
    assert.notEqual(tied[0].runs.at(-1).text, "$5", `a ${name} space is never the break`);
    const next = tied[1].runs.map((run) => run.text);
    assert.ok(next.indexOf("$5") >= 0 && next.indexOf("$5") < next.indexOf("million"), `a ${name} space moves $5 down with million`);
  }
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
  ["contact", {}, [`Lisbon,${NBSP}PT`, `City${TAB}Region`]],
  ["titleRight", { titleRight: `Jan${NARROW}2020 - Mar${FIGURE}2024` }]
];
let checked = 0;
const shapers = new Map();
const fontFor = (family, face) => {
  const key = `${family}:${face}`;
  if (!shapers.has(key)) shapers.set(key, fontkit.create(readFileSync(new URL(`../../../fonts/${sfntAssetFile(family, face)}`, import.meta.url))));
  return shapers.get(key);
};
for (const family of FONT_FAMILY_IDS) {
  for (const [field, item, contact] of cases) {
    const doc = layoutResume(resume(item, contact), { ...DOC_STYLE_DEFAULTS, fontFamily: family });
    const rightEdge = 612 - doc.geometry.marginRight;
    const runs = lines(doc).flatMap((line) => line.runs)
      .filter((run) => (run.src?.kind === "entry" && run.src.field === field) || (field === "contact" && run.src?.kind === "contact"));
    assert.ok(runs.length, `${family}/${field} lays out`);
    for (const run of runs) {
      assert.doesNotMatch(run.text, new RegExp(`[${TAB}${NBSP}${NARROW}${FIGURE}]`), `${family}/${field} paints a tab or no-break space as one space`);
      assert.equal(run.style.family, family, `${family}/${field} draws in its own family`);
      const face = fontFor(family, run.style.face);
      const shaped = (face.layout(run.text).advanceWidth / face.unitsPerEm) * run.style.size;
      // The 2048/em families carry a per-glyph rounding residue (pdf-font-parity).
      const budget = 0.05 + (0.5 / 1000) * run.style.size * run.text.length;
      assert.ok(Math.abs(shaped - run.width) <= budget, `${family}/${field} ${JSON.stringify(run.text)}: layout ${run.width.toFixed(3)} vs drawn ${shaped.toFixed(3)}`);
      assert.ok(run.x + shaped <= rightEdge + budget, `${family}/${field} stays inside the right margin`);
      checked += 1;
    }
  }
}

// Invisible format characters (pasted from web pages and LinkedIn dates) have
// no advance in the browser or the PDF, so they measure none: a 500-unit
// unknown-glyph charge left a right-pinned date short of the margin in both.
// The emitter drops a soft hyphen before shaping (pdf-hyphens), so glyphs
// either side of it kern and ligate as if it were absent.
const SOFT_HYPHEN = String.fromCharCode(0xad);
const [ZWSP, ZWNJ, ZWJ, LRM, RLM] = [0x200b, 0x200c, 0x200d, 0x200e, 0x200f].map((code) => String.fromCharCode(code));
const WORD_JOINER = String.fromCharCode(0x2060);
const BOM = String.fromCharCode(0xfeff);
const invisibleCases = [
  ["titleRight", { titleRight: `Jun 2023${LRM} - Present${ZWSP}` }],
  ["subtitleLeft", { subtitleLeft: `Acme${ZWJ}Corp${ZWNJ}${RLM} Group` }],
  ["titleLeft", { titleLeft: `DATA${SOFT_HYPHEN}VAULT of${SOFT_HYPHEN}fice` }],
  ["contact", {}, [`Lisbon${WORD_JOINER}PT`, `${BOM}City Region`]],
  ["bullet", { bullets: [`Rolled out E${ZWSP}Verify, co${SOFT_HYPHEN}ordinated ${WORD_JOINER}teams and AV${SOFT_HYPHEN}AV${LRM} work`], bulletIds: ["b"] }]
];
let invisibleChecked = 0;
for (const family of FONT_FAMILY_IDS) {
  for (const [field, item, contact] of invisibleCases) {
    const doc = layoutResume(resume(item, contact), { ...DOC_STYLE_DEFAULTS, fontFamily: family });
    const rightEdge = 612 - doc.geometry.marginRight;
    const runs = lines(doc).flatMap((line) => line.runs).filter((run) => run.text.trim() && (
      (run.src?.kind === "entry" && run.src.field === field) ||
      (field === "contact" && run.src?.kind === "contact") ||
      (field === "bullet" && run.src?.kind === "bullet" && !run.marker)));
    assert.ok(runs.length, `${family}/${field} lays out`);
    for (const run of runs) {
      assert.equal(run.style.family, family, `${family}/${field} draws in its own family`);
      const face = fontFor(family, run.style.face);
      const drawn = run.text.replaceAll(SOFT_HYPHEN, "");
      const shaped = (face.layout(drawn).advanceWidth / face.unitsPerEm) * run.style.size;
      const budget = 0.05 + (0.5 / 1000) * run.style.size * drawn.length;
      assert.ok(Math.abs(shaped - run.width) <= budget, `${family}/${field} ${JSON.stringify(run.text)}: layout ${run.width.toFixed(3)} vs drawn ${shaped.toFixed(3)}`);
      if (field === "titleRight") assert.ok(Math.abs(run.x + shaped - (rightEdge - doc.geometry.entryEndIndent)) <= budget, `${family}: the date with invisible characters still ends at the right margin`);
      invisibleChecked += 1;
    }
  }
}

console.log(`special-space checks passed: a no-break paragraph space, ${checked} single-line runs and ${invisibleChecked} runs with invisible characters across ${FONT_FAMILY_IDS.length} families`);
