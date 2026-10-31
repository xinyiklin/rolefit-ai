// The line setter merges adjacent same-style boxes (hyphen fragments, literal
// spaces, a redundant mark boundary) into one run, and the DOM and PDF shape
// that run's whole text: the kern across "Non-|Technical" or the ligature across
// "of<font>fice" is in what they draw. So a merged run's width is the measured
// width of its text, and the words after it sit where its ink ends. Summing the
// fragments' separate widths left a visible gap after each compound in the PDF.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import fontkit from "@pdf-lib/fontkit";

import { DOC_STYLE_DEFAULTS } from "../../lib/documentStyle.ts";
import { FONT_FAMILY_IDS } from "../../lib/fontFamilies.ts";
import { ensureAllFontMetrics, sfntAssetFile } from "../fontRegistry.ts";
import { layoutResume } from "../layout.ts";
import { measure } from "../measure.ts";

await ensureAllFontMetrics();

const bullet = (family) => Array.from({ length: 3 }, () =>
  `Led Non-Technical A-Team E-Verify rollout across teams, wrote One-sentence notes in the of<font=${family}>fice</font> and filed VAT  Tax returns`
).join(" ");
const resume = (text) => ({
  header: { name: "Name", contact: [] },
  sections: [{ id: "s", type: "standard", heading: "Experience", items: [{
    id: "e", titleLeft: "Engineer", titleRight: "", subtitleLeft: "Company", subtitleRight: "", bullets: [text], bulletIds: ["b"]
  }] }]
});
const bulletLines = (doc) => doc.pages.flatMap((page) => page.lines)
  .map((line) => line.runs.filter((run) => run.src?.kind === "bullet" && !run.marker && run.text))
  .filter((runs) => runs.length);

let checked = 0;
for (const family of FONT_FAMILY_IDS) {
  const shapers = new Map();
  const shaper = (face) => {
    if (!shapers.has(face)) shapers.set(face, fontkit.create(readFileSync(new URL(`../../../fonts/${sfntAssetFile(family, face)}`, import.meta.url))));
    return shapers.get(face);
  };
  const ends = {};
  for (const bodyAlign of ["left", "right", "justify"]) {
    const lines = bulletLines(layoutResume(resume(bullet(family)), { ...DOC_STYLE_DEFAULTS, fontFamily: family, bodyAlign }));
    assert.ok(lines.length > 1, `${family}/${bodyAlign}: the bullet wraps`);
    assert.ok(lines.flat().some((run) => run.text.includes("Non-Technical")), `${family}/${bodyAlign}: a compound sets as one run`);
    for (const runs of lines) {
      for (const [index, run] of runs.entries()) {
        assert.equal(run.width, measure(run.text, run.style), `${family}/${bodyAlign} ${JSON.stringify(run.text)}: a run is as wide as its text measures`);
        const font = shaper(run.style.face);
        const shaped = (font.layout(run.text).advanceWidth / font.unitsPerEm) * run.style.size;
        // The 2048/em families carry a per-glyph rounding residue (pdf-font-parity).
        const budget = 0.05 + (0.5 / 1000) * run.style.size * run.text.length;
        assert.ok(Math.abs(shaped - run.width) <= budget, `${family}/${bodyAlign} ${JSON.stringify(run.text)}: layout ${run.width.toFixed(3)} vs drawn ${shaped.toFixed(3)}`);
        if (index > 0) assert.ok(run.x >= runs[index - 1].x + runs[index - 1].width - 1e-9, `${family}/${bodyAlign}: runs never overlap`);
        checked += 1;
      }
    }
    ends[bodyAlign] = lines.slice(0, -1).map((runs) => runs.at(-1).x + runs.at(-1).width);
  }
  // Right and justified lines end at the column edge measured from merged runs.
  const edge = ends.right[0];
  for (const end of [...ends.right, ...ends.justify]) assert.ok(Math.abs(end - edge) < 1e-6, `${family}: a full line ends at the column edge (${end} vs ${edge})`);
  for (const end of ends.left) assert.ok(end <= edge + 1e-6, `${family}: a ragged line stays inside the column (${end} vs ${edge})`);
}

// Merging stays linear: each run is measured once, not once per box it absorbs.
// A valid bullet of 10,000 redundant mark boundaries re-measured on every merge
// took about 15 s instead of about 50 ms, so this budget is generous for a slow
// machine while the quadratic version still misses it.
const ZWSP = String.fromCharCode(0x200b);
{
  const started = performance.now();
  layoutResume(resume(`Shipped <b>${`${ZWSP}</b><b>`.repeat(10000)}x</b> done`), DOC_STYLE_DEFAULTS);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 2000, `10,000 mark boundaries lay out in ${elapsed.toFixed(0)} ms (budget 2000 ms)`);
  console.log(`merged-run timing: 10,000 mark boundaries in ${elapsed.toFixed(0)} ms`);
}

console.log(`merged-run checks passed: ${checked} runs across ${FONT_FAMILY_IDS.length} families in three alignments`);
