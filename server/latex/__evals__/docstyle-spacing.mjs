// Offline, deterministic probes for Format-menu spacing -> LaTeX rendering.
// Synthetic fixture only; no personal resume text, no Tectonic/PDF compile.
//
//   node server/latex/__evals__/docstyle-spacing.mjs
//
// Locks the regression-prone path where editor spacing controls must change the
// generated .tex/PDF-LaTeX rhythm, while the Jake template stays Tectonic-safe.

import { renderResumeTexFromSchema } from "../index.mjs";

const schema = {
  name: "Candidate Name",
  contact: ["candidate@example.com", "github.com/candidate"],
  sections: [
    {
      heading: "Technical Skills",
      type: "skills",
      items: [
        { titleLeft: "Languages", subtitleLeft: "TypeScript, SQL", bullets: [] },
        { titleLeft: "Testing", subtitleLeft: "Build checks, regression probes", bullets: [] }
      ]
    },
    {
      heading: "Projects",
      type: "standard",
      items: [
        {
          titleLeft: "Resume Tool",
          titleRight: "github.com/candidate/resume-tool",
          subtitleLeft: "React, Node.js",
          subtitleRight: "Local-first",
          bullets: [
            "Built an editor/export pipeline with structured resume data.",
            "Added deterministic checks for generated LaTeX output."
          ]
        }
      ]
    }
  ]
};

const base = {
  zoom: 1,
  boldTitles: true,
  boldHeadings: false,
  boldSkillLabels: true,
  italicSubtitles: true,
  italicDates: false
};

const styles = {
  compact: { ...base, lineHeight: 1.16, sectionGap: 0.48, entryGap: 0.24, bulletGap: 0.08 },
  normal: { ...base, lineHeight: 1.18, sectionGap: 0.85, entryGap: 0.42, bulletGap: 0.2 },
  loose: { ...base, lineHeight: 1.3, sectionGap: 1.2, entryGap: 0.7, bulletGap: 0.36 }
};

function render(docStyle) {
  return renderResumeTexFromSchema({ schema, templateId: "jakes", docStyle }).tex;
}

function first(tex, regex) {
  return tex.match(regex)?.[1] ?? "";
}

function knobs(tex) {
  return {
    baseline: Number(first(tex, /renewcommand\{\\baselinestretch\}\{([^}]+)\}/)),
    sectionPre: Number(first(tex, /titleformat\{\\section\}\{\\vspace\{(-?\d+)pt\}/)),
    // The entry-gap knob is the trailing \vspace after a heading's last \resumeRow
    // (read from \resumeProjectHeading, the unambiguous single-row macro). It was
    // \end{tabular*}\vspace before the per-row tabularx refactor.
    subheadingTrail: Number(first(tex, /\\resumeRow\{\\small#1\}\{#2\}%\s*\\vspace\{(-?\d+)pt\}/)),
    itemTrail: Number(first(tex, /newcommand\{\\resumeItem\}\[1\]\{\\item\\small\{\{#1 \\vspace\{(-?\d+)pt\}/))
  };
}

const rendered = Object.fromEntries(Object.entries(styles).map(([name, style]) => [name, render(style)]));
const compact = knobs(rendered.compact);
const normal = knobs(rendered.normal);
const loose = knobs(rendered.loose);
const fallback = render(undefined);

const checks = [
  ["compact/normal/loose baselines increase", compact.baseline < normal.baseline && normal.baseline < loose.baseline],
  ["section gap maps to increasing vspace", compact.sectionPre < normal.sectionPre && normal.sectionPre < loose.sectionPre],
  ["entry gap maps to increasing vspace", compact.subheadingTrail < normal.subheadingTrail && normal.subheadingTrail < loose.subheadingTrail],
  ["bullet gap maps to increasing vspace", compact.itemTrail < normal.itemTrail && normal.itemTrail < loose.itemTrail],
  ["normal preset emits expected baseline", normal.baseline === 0.983],
  ["compact preset emits expected macro tuple", JSON.stringify(compact) === JSON.stringify({ baseline: 0.967, sectionPre: -8, subheadingTrail: -5, itemTrail: -1 })],
  ["loose probe emits expected macro tuple", JSON.stringify(loose) === JSON.stringify({ baseline: 1.083, sectionPre: 0, subheadingTrail: 1, itemTrail: 2 })],
  ["no-docStyle fallback preserves Jake baseline", knobs(fallback).baseline === 1],
  ["Tectonic-safe glyphtounicode guard present", rendered.normal.includes("\\ifdefined\\pdfgentounicode\\input{glyphtounicode}\\fi")],
  ["Tectonic-safe pdfgentounicode guard present", rendered.normal.includes("\\ifdefined\\pdfgentounicode\\pdfgentounicode=1\\fi")],
  ["skill labels render as bold label only", rendered.normal.includes("\\textbf{Languages}: TypeScript, SQL")]
];

const failures = checks.filter(([, ok]) => !ok);
if (failures.length) {
  for (const [name] of failures) console.error(`FAIL ${name}`);
  console.error(JSON.stringify({ compact, normal, loose }, null, 2));
  process.exit(1);
}

console.log(`docstyle-spacing probes passed (${checks.length}/${checks.length})`);
console.log(JSON.stringify({ compact, normal, loose }, null, 2));
