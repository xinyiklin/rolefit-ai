// Offline, deterministic probe: the typeset engine's full-page layout must
// match real TeX baselines. vertical-truth.json holds per-line {page, y, x0}
// from a Tectonic compile of a synthetic one-page resume (see the fixture note
// for regeneration). Covers every junction type of the jakes vertical model:
// header (name/contact), section headings, standard entries with locations,
// project-style heads with UNDERLINED linked metas (the \lineskip-floor case),
// skills rows, and wrapped bullets.
//
//   node src/typeset/__evals__/vertical-parity.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const { layoutResume } = await import(join(here, "../layout.ts"));
const truth = JSON.parse(readFileSync(join(here, "vertical-truth.json"), "utf8"));

const TOL_Y = 0.5; // bp
const TOL_X = 0.6; // bp
// The name is measured with the lmbx12 display master (like TeX); centering
// holds the standard tolerance.
const TOL_X_NAME = 0.6;

const layout = layoutResume(truth.schema, truth.docStyle);
const engine = [];
layout.pages.forEach((page, pi) => {
  for (const line of page.lines) {
    const xRuns = line.runs.filter((r) => r.text !== "•");
    if (!xRuns.length) continue;
    engine.push({
      p: pi + 1,
      y: line.baseline,
      x0: Math.min(...xRuns.map((r) => r.x)),
      text: line.runs.map((r) => r.text).join("")
    });
  }
});

const norm = (t) => t.replace(/[^A-Za-z0-9]/g, "").slice(0, 16);
const used = new Set();
let failures = 0;
let matched = 0;
for (const e of engine) {
  const key = norm(e.text);
  if (!key) continue;
  let hit = null;
  for (let i = 0; i < truth.lines.length; i += 1) {
    if (used.has(i)) continue;
    const tk = norm(truth.lines[i].text);
    if (tk.length < 4) continue;
    if (tk.startsWith(key.slice(0, 10)) || key.startsWith(tk.slice(0, 10))) {
      hit = i;
      break;
    }
  }
  if (hit === null) {
    console.error(`ENGINE-ONLY: ${e.text.slice(0, 40)}`);
    failures += 1;
    continue;
  }
  used.add(hit);
  matched += 1;
  const t = truth.lines[hit];
  const isName = norm(t.text) === norm(truth.schema.name);
  const dy = e.y - t.y;
  const dx = e.x0 - t.x0;
  if (e.p !== t.p || Math.abs(dy) > TOL_Y || Math.abs(dx) > (isName ? TOL_X_NAME : TOL_X)) {
    console.error(`FAIL p${e.p}/${t.p} dy=${dy.toFixed(2)} dx=${dx.toFixed(2)} | ${e.text.slice(0, 44)}`);
    failures += 1;
  }
}
truth.lines.forEach((t, i) => {
  if (!used.has(i) && norm(t.text).length >= 4) {
    console.error(`TRUTH-ONLY: ${t.text.slice(0, 40)}`);
    failures += 1;
  }
});

if (failures) {
  console.error(`vertical-parity: ${failures} divergences from TeX (${matched} lines matched)`);
  process.exit(1);
}
console.log(`vertical-parity: ${matched} lines within ±${TOL_Y}bp of the Tectonic baselines`);
