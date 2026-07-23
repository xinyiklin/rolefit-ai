// Offline, deterministic probe: the typeset engine's full-page layout must
// stay within a narrow tolerance of the frozen TeX baseline that preceded the
// shared Typeset package. Typeset now owns additional word-processor typography
// controls, so this is a migration guard rather than byte-exact TeX emulation.
// vertical-truth.json holds per-line {page, y, x0} from the original Tectonic
// compile and covers every junction type of the legacy vertical model:
// header (name/contact), section headings, standard entries with locations,
// project-style heads with UNDERLINED linked metas (the \lineskip-floor case),
// skills rows, and wrapped bullets.
//
//   node src/typeset/__evals__/vertical-parity.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DOC_STYLE_DEFAULTS } from "@typeset/engine/lib/documentStyle.ts";
import { layoutResume } from "@typeset/engine/typeset/layout.ts";

const here = dirname(fileURLToPath(import.meta.url));
const truth = JSON.parse(readFileSync(join(here, "vertical-truth.json"), "utf8"));

const TEX_PT = 72 / 72.27;
const gap = (value) => value * 11 * TEX_PT;
const legacyStyle = (style) => ({
  ...DOC_STYLE_DEFAULTS,
  lineHeight: style.lineHeight,
  nameContactGapPt: (1 + (style.nameContactGap - 0.04) * 10) * TEX_PT,
  contactGapPt: style.contactGap * 10 * TEX_PT,
  headerSectionGapPt: (style.headerSectionGap - 1.19 + 0.85) * 11 * TEX_PT,
  sectionGapPt: gap(style.sectionGap),
  sectionEntryGapPt: gap(style.sectionEntryGap),
  entryGapPt: gap(style.entryGap),
  titleSubGapPt: gap(style.titleSubGap),
  headBulletGapPt: gap(style.headBulletGap),
  skillsRowGapPt: style.skillsRowGap * 10 * TEX_PT,
  bulletGapPt: gap(style.bulletGap),
  headingCase: style.headingCase,
  sectionRule: style.sectionRule,
  contactDivider: style.contactDivider,
  headerAlign: style.headerAlign,
  bodyAlign: style.bodyAlign,
  headingAlign: style.headingAlign,
  nameSize: style.nameSize,
  pageMargins: style.pageMargins
});
const entriesFor = (section, sectionIndex) => section.type === "skills"
  ? section.items.flatMap((item, itemIndex) => item.bullets.map((row, rowIndex) => {
      const split = row.indexOf(":");
      return {
        id: `skill-${sectionIndex}-${itemIndex}-${rowIndex}`,
        titleLeft: split >= 0 ? row.slice(0, split).trim() : "",
        titleRight: "",
        subtitleLeft: split >= 0 ? row.slice(split + 1).trim() : row,
        subtitleRight: "",
        bullets: [],
        bulletIds: []
      };
    }))
  : section.items.map((item, itemIndex) => ({
      id: item.id ?? `entry-${sectionIndex}-${itemIndex}`,
      titleLeft: item.title ?? "",
      titleRight: item.meta ?? "",
      subtitleLeft: item.subtitle ?? "",
      subtitleRight: item.location ?? "",
      bullets: item.bullets,
      bulletIds: item.bullets.map((_, bulletIndex) => `bullet-${sectionIndex}-${itemIndex}-${bulletIndex}`)
    }));
const typesetSchema = (schema) => ({
  name: schema.name,
  contact: schema.contact,
  sections: schema.sections.map((section, sectionIndex) => ({
    id: section.id ?? `section-${sectionIndex}`,
    heading: section.heading,
    type: section.type ?? "standard",
    items: entriesFor(section, sectionIndex)
  }))
});

// Tolerances are measured, not guessed. Instrumenting this eval against the
// current baseline+engine (`node src/typeset/__evals__/vertical-parity.mjs`,
// 2026-07-17) gave: max |dy| across all 20 matched lines = 1.4641bp; max
// name-row |dx| = 0.7475bp; max non-name |dx| = 0.4920bp (comfortably inside
// TOL_X, unaffected by the migration below). TOL_Y and TOL_X_NAME are that
// measured max rounded up to the nearest 0.05bp plus one explicit 0.05bp
// headroom tick, so a future loosening past these numbers is a deliberate,
// re-measured decision rather than another round guess.
const TOL_Y = 1.5; // bp; measured max |dy| 1.4641 -> round to 1.50 (~0.04bp headroom already; shared Typeset controls may shift old TeX baselines slightly)
const TOL_X = 0.6; // bp; non-name dx, unaffected by the legacyStyle() migration guard
// The name is measured with the lmbx12 display master (like TeX); centering
// holds a wider tolerance. Measured max name-row |dx| 0.7475 -> round to 0.75,
// + one 0.05bp headroom tick = 0.80.
const TOL_X_NAME = 0.8;

const schema = typesetSchema(truth.schema);
const layout = layoutResume(schema, legacyStyle(truth.docStyle));
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
  const isName = norm(t.text) === norm(schema.name);
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

// Floor: a corrupt/truncated/empty truth fixture (or an engine change that
// silently matches nothing) must fail loudly instead of reporting "0
// divergences" as a clean pass.
if (matched === 0) {
  console.error("vertical-parity: 0 lines matched — truth.lines is empty/corrupt, or nothing in the engine output matched it");
  failures += 1;
}

if (failures) {
  console.error(`vertical-parity: ${failures} divergences from TeX (${matched} lines matched)`);
  process.exit(1);
}
console.log(`vertical-parity: ${matched} lines within ±${TOL_Y}bp of the Tectonic baselines`);
