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
        },
        {
          titleLeft: "Format Controls",
          titleRight: "2026",
          subtitleLeft: "CSS and LaTeX parity",
          subtitleRight: "Local",
          bullets: [
            "Split document spacing into independently routed controls.",
            "Kept conversion checks offline and deterministic."
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
  italicSubtitles: true
};

const styles = {
  compact: {
    ...base,
    lineHeight: 1.16,
    nameContactGap: 0.02,
    contactGap: 1.6,
    headerSectionGap: 0.82,
    sectionGap: 0.48,
    sectionEntryGap: 0.3,
    entryGap: 0.24,
    titleSubGap: 0.03,
    headBulletGap: 0.24,
    skillsRowGap: 0,
    bulletGap: 0.08
  },
  normal: {
    ...base,
    lineHeight: 1.18,
    nameContactGap: 0.04,
    contactGap: 1.82,
    headerSectionGap: 1.19,
    sectionGap: 0.85,
    sectionEntryGap: 0.42,
    entryGap: 0.42,
    titleSubGap: 0.06,
    headBulletGap: 0.42,
    skillsRowGap: 0,
    bulletGap: 0.2
  },
  loose: {
    ...base,
    lineHeight: 1.3,
    nameContactGap: 0.1,
    contactGap: 2.1,
    headerSectionGap: 1.54,
    sectionGap: 1.2,
    sectionEntryGap: 0.6,
    entryGap: 0.7,
    titleSubGap: 0.12,
    headBulletGap: 0.7,
    skillsRowGap: 0.16,
    bulletGap: 0.36
  }
};

function render(docStyle) {
  return renderResumeTexFromSchema({ schema, templateId: "jakes", docStyle }).tex;
}

function first(tex, regex) {
  return tex.match(regex)?.[1] ?? "";
}

function pt(tex, regex) {
  return Number(first(tex, regex));
}

// Every gap in this template is a pure SEPARATOR between siblings — no trailing
// glue on the last bullet/entry/section. These probes read the single LaTeX
// length each control maps to and assert it grows monotonically with the slider,
// while the structural checks below lock the between-only model itself.
function knobs(tex) {
  const sectionSpace = tex.match(/titlespacing\*\{\\section\}\{0pt\}\{(-?\d+(?:\.\d+)?)pt\}\{(-?\d+(?:\.\d+)?)pt\}/);
  return {
    baseline: Number(first(tex, /renewcommand\{\\baselinestretch\}\{([^}]+)\}/)),
    nameContact: pt(tex, /\\\\ \\vspace\{(-?\d+(?:\.\d+)?)pt\}/),
    contactWidth: pt(tex, /\\makebox\[(-?\d+(?:\.\d+)?)pt\]\[c\]\{\$\|\$\}/),
    // Header → first section: the explicit \vspace after \end{center}; absorbs the
    // first section's \titlespacing "before" so the visible gap = headerSectionGap.
    headerSection: pt(tex, /\\end\{center\}\s*\\vspace\{(-?\d+(?:\.\d+)?)pt\}/),
    // \titlespacing "before" = whole gap above each heading (= section gap).
    sectionGap: Number(sectionSpace?.[1] ?? NaN),
    // \titlespacing "after" = rule → first entry/row (= section/entry gap).
    sectionEntry: Number(sectionSpace?.[2] ?? NaN),
    // \resumeEntryGap is inserted ONLY between entries.
    entryGap: pt(tex, /newcommand\{\\resumeEntryGap\}\{\\vspace\{(-?\d+(?:\.\d+)?)pt\}\}/),
    titleSub: pt(tex, /\\resumeRow\{\\textbf\{#1\}\}\{#2\}%\s*\\vspace\{(-?\d+(?:\.\d+)?)pt\}%\s*\\resumeRow/s),
    // Entry head → first bullet: the explicit \vspace the renderer emits right
    // before \resumeItemListStart (only present when an entry has bullets).
    headBullet: pt(tex, /\\vspace\{(-?\d+(?:\.\d+)?)pt\}\s*\\resumeItemListStart/),
    // Between-bullet gap = the inner list \itemsep.
    bulletGap: pt(tex, /resumeItemListStart\}\{\\begin\{itemize\}\[topsep=0pt, partopsep=0pt, parsep=0pt, itemsep=(-?\d+(?:\.\d+)?)pt\]/),
    // Between-skill-row gap = the skills list \itemsep (the body block ending in
    // \item{\small …}). This replaces the old \\[len] row break, which the
    // template's global \raggedright silently dropped — the actual reported bug.
    skillsRow: pt(tex, /label=\{\}, topsep=0pt, partopsep=0pt, parsep=0pt, itemsep=(-?\d+(?:\.\d+)?)pt\]\s*\n\s*\\item\{\\small/)
  };
}

const rendered = Object.fromEntries(Object.entries(styles).map(([name, style]) => [name, render(style)]));
const compact = knobs(rendered.compact);
const normal = knobs(rendered.normal);
const loose = knobs(rendered.loose);
const fallback = render(undefined);

// The header→section \vspace must cancel the `center` env's measured closing
// glue so the visible header gap equals headerSectionGap. Recompute the expected
// value from each preset's OWN gap fields and the conversion factors the renderer
// uses (the ~1.085em glue at the 11pt base, rounded to fmtPt's one decimal), so
// the check follows the formula instead of pinning a literal that silently
// encodes "headerSectionGap = sectionGap + 0.34" across the fixtures.
const CENTER_GLUE_EM = 1.085;
const round1 = (n) => Math.round(n * 10) / 10;
const expectedHeaderSection = (s) => round1((s.headerSectionGap - s.sectionGap - CENTER_GLUE_EM) * 11);

const checks = [
  ["compact/normal/loose baselines increase", compact.baseline < normal.baseline && normal.baseline < loose.baseline],
  ["name/contact gap maps to increasing vspace", compact.nameContact < normal.nameContact && normal.nameContact < loose.nameContact],
  ["contact gap maps to increasing separator width", compact.contactWidth < normal.contactWidth && normal.contactWidth < loose.contactWidth],
  // The header→section \vspace is negative: it pulls the first section up to
  // cancel the `center` env's closing glue, so the visible header gap equals
  // headerSectionGap instead of running ~8pt taller. Checked against the formula
  // (per-preset) rather than a pinned literal.
  [
    "header/section vspace cancels the center-env closing glue (per-preset formula)",
    compact.headerSection === expectedHeaderSection(styles.compact) &&
      normal.headerSection === expectedHeaderSection(styles.normal) &&
      loose.headerSection === expectedHeaderSection(styles.loose) &&
      normal.headerSection < 0
  ],
  ["section gap maps to increasing title-space-before", compact.sectionGap < normal.sectionGap && normal.sectionGap < loose.sectionGap],
  ["section/entry gap maps to increasing title-space-after", compact.sectionEntry < normal.sectionEntry && normal.sectionEntry < loose.sectionEntry],
  ["entry gap maps to increasing inter-entry vspace", compact.entryGap < normal.entryGap && normal.entryGap < loose.entryGap],
  ["title/subtitle gap maps to increasing vspace", compact.titleSub < normal.titleSub && normal.titleSub < loose.titleSub],
  ["head/bullets gap maps to increasing vspace", compact.headBullet < normal.headBullet && normal.headBullet < loose.headBullet],
  ["bullet gap maps to increasing itemsep", compact.bulletGap < normal.bulletGap && normal.bulletGap < loose.bulletGap],
  ["skills row gap maps to increasing itemsep (raggedright-safe)", compact.skillsRow === 0 && normal.skillsRow === 0 && normal.skillsRow < loose.skillsRow],
  // --- between-only structural invariants (the reported bug + its siblings) ---
  ["last bullet adds no trailing glue (resumeItem has no \\vspace)", rendered.normal.includes("\\newcommand{\\resumeItem}[1]{\\item\\small{#1}}")],
  ["bullet list closes with no trailing glue", rendered.normal.includes("\\newcommand{\\resumeItemListEnd}{\\end{itemize}}")],
  ["inner bullet list zeroes topsep so the gap can't leak into the entry gap", rendered.normal.includes("resumeItemListStart}{\\begin{itemize}[topsep=0pt,")],
  ["outer entry list itemsep=0 so the entry gap is solely \\resumeEntryGap", rendered.normal.includes("resumeSubHeadingListStart}{\\begin{itemize}[leftmargin=0.15in, label={}, topsep=0pt, partopsep=0pt, parsep=0pt, itemsep=0pt]")],
  ["skills rows never use the raggedright-broken \\\\[len] break", !rendered.loose.includes("\\\\[")],
  ["normal preset emits expected baseline", normal.baseline === 0.983],
  [
    "compact preset emits expected macro tuple",
    JSON.stringify(compact) ===
      JSON.stringify({
        baseline: 0.967,
        nameContact: 0.8,
        contactWidth: 16,
        headerSection: -8.2,
        sectionGap: 5.3,
        sectionEntry: 3.3,
        entryGap: 2.6,
        titleSub: -4.2,
        headBullet: 2.6,
        bulletGap: 0.9,
        skillsRow: 0
      })
  ],
  [
    "loose probe emits expected macro tuple",
    JSON.stringify(loose) ===
      JSON.stringify({
        baseline: 1.083,
        nameContact: 1.6,
        contactWidth: 21,
        headerSection: -8.2,
        sectionGap: 13.2,
        sectionEntry: 6.6,
        entryGap: 7.7,
        titleSub: -3.2,
        headBullet: 7.7,
        bulletGap: 4,
        skillsRow: 1.6
      })
  ],
  ["no-docStyle fallback preserves Jake baseline", knobs(fallback).baseline === 1],
  ["no-docStyle fallback omits explicit inter-entry macro", !fallback.includes("\\newcommand{\\resumeEntryGap}")],
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
