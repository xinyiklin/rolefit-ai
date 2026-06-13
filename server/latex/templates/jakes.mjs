// Jake's Resume template — https://github.com/jakegut/resume
// Single-column, compact, ATS-friendly. Uses only packages that ship with
// Tectonic / TeX Live by default.

import { escapeTex, escapeTexUrl, titleCase, linkify, isSummarySection } from "../util.mjs";

// Map the editor's DocStyle (em values, 11pt base font) → LaTeX pt overrides
// for the four template knobs. Mirrors the CSS variables consumed by the HTML
// editor so the on-screen page and the compiled PDF share rhythm.
//
// Jake's original hardcoded values, restored as the FALLBACK so a request
// without docStyle compiles identically to the upstream template.
const DEFAULTS = {
  // \vspace BEFORE the section's titlerule (negative pulls section up)
  sectionPreVSpacePt: -4,
  // \vspace AFTER the titlerule (pulls first content up)
  sectionPostVSpacePt: -5,
  // \vspace after each \resumeSubheading row
  subheadingTrailVSpacePt: -7,
  // \vspace after each \resumeItem bullet
  itemTrailVSpacePt: -2,
  // \vspace after \resumeItemListEnd
  itemListEndVSpacePt: -5,
  // \baselinestretch (Jake's default is implicit 1.0 ≈ 1.2x leading)
  baselineStretch: 1.0,
  // Bold/italic toggles — Jake's upstream defaults
  boldHeadings: false,
  boldTitles: true,
  boldSkillLabels: true,
  italicSubtitles: true,
  italicDates: true
};

// 11pt base font: 1em = 11pt. The HTML editor's gap values are in ems, so we
// convert via *11 and then subtract Jake's natural rhythm to land at the same
// visual cadence. We keep the math simple — the user-tunable Format menu only
// has 4 knobs that affect the PDF; the rest stay at Jake's defaults.
function styleToLatex(docStyle) {
  if (!docStyle || typeof docStyle !== "object") return DEFAULTS;
  const num = (v, fallback) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
  const sectionGapEm = num(docStyle.sectionGap, 0.85);
  const entryGapEm = num(docStyle.entryGap, 0.42);
  const bulletGapEm = num(docStyle.bulletGap, 0.2);
  const lineHeight = num(docStyle.lineHeight, 1.18);
  // \section already has a natural ~1.2em parskip; subtract that so sectionGap
  // measures total gap, not extra-on-top.
  const sectionPrePt = Math.round((sectionGapEm - 1.2) * 11);
  // Entry trail: tighter (negative) when entryGap < 0.65em (Jake's effective).
  const subheadingTrailPt = Math.round((entryGapEm - 0.65) * 11);
  // Bullet trail: itemize's natural item separation is ~0.15em — anything below
  // that goes negative.
  const itemTrailPt = Math.round((bulletGapEm - 0.18) * 11);
  // CSS line-height 1.0 ≈ LaTeX \baselinestretch 0.83; CSS 1.2 ≈ stretch 1.0.
  const baselineStretch = lineHeight / 1.2;
  const bool = (v, fallback) => (typeof v === "boolean" ? v : fallback);
  return {
    sectionPreVSpacePt: sectionPrePt,
    sectionPostVSpacePt: DEFAULTS.sectionPostVSpacePt,
    subheadingTrailVSpacePt: subheadingTrailPt,
    itemTrailVSpacePt: itemTrailPt,
    itemListEndVSpacePt: DEFAULTS.itemListEndVSpacePt,
    baselineStretch,
    boldHeadings: bool(docStyle.boldHeadings, DEFAULTS.boldHeadings),
    boldTitles: bool(docStyle.boldTitles, DEFAULTS.boldTitles),
    boldSkillLabels: bool(docStyle.boldSkillLabels, DEFAULTS.boldSkillLabels),
    italicSubtitles: bool(docStyle.italicSubtitles, DEFAULTS.italicSubtitles),
    italicDates: bool(docStyle.italicDates, DEFAULTS.italicDates)
  };
}

// Wrap helpers — at preamble-build time, optional `\textbf{}` / `\textit{}`
// decorations are either inlined or removed entirely. Keeping the parameter
// `#N` even when undecorated means the macro signature stays stable.
function bf(arg, on) {
  return on ? `\\textbf{${arg}}` : arg;
}
function it(arg, on) {
  return on ? `\\textit{${arg}}` : arg;
}

function fmtPt(value) {
  // LaTeX accepts negative pt directly. Round to integer pts for stable output.
  return `${value}pt`;
}

function buildPreamble(style) {
  return String.raw`\documentclass[letterpaper,11pt]{article}

\usepackage[T1]{fontenc}
\usepackage{lmodern}
\usepackage{latexsym}
\usepackage[empty]{fullpage}
\usepackage{titlesec}
\usepackage{marvosym}
\usepackage[usenames,dvipsnames]{xcolor}
\usepackage{verbatim}
\usepackage{enumitem}
\usepackage[hidelinks]{hyperref}
\usepackage{fancyhdr}
\usepackage[english]{babel}
\usepackage{tabularx}
% glyphtounicode is pdfTeX-only; guard it so the template also compiles under
% XeTeX/Tectonic while pdfLaTeX still gets ATS glyph mapping.
\ifdefined\pdfgentounicode\input{glyphtounicode}\fi

\pagestyle{fancy}
\fancyhf{}
\fancyfoot{}
\renewcommand{\headrulewidth}{0pt}
\renewcommand{\footrulewidth}{0pt}

\addtolength{\oddsidemargin}{-0.5in}
\addtolength{\evensidemargin}{-0.5in}
\addtolength{\textwidth}{1in}
\addtolength{\topmargin}{-.5in}
\addtolength{\textheight}{1.0in}
\setlength{\footskip}{14pt}

\renewcommand{\baselinestretch}{${style.baselineStretch.toFixed(3)}}

\urlstyle{same}
\raggedbottom
\raggedright
\setlength{\tabcolsep}{0in}

\titleformat{\section}{\vspace{${fmtPt(style.sectionPreVSpacePt)}}\scshape\raggedright\large${style.boldHeadings ? "\\bfseries" : ""}}{}{0em}{}[\color{black}\titlerule \vspace{${fmtPt(style.sectionPostVSpacePt)}}]

\ifdefined\pdfgentounicode\pdfgentounicode=1\fi

\newcommand{\resumeItem}[1]{\item\small{{#1 \vspace{${fmtPt(style.itemTrailVSpacePt)}}}}}

\newcommand{\resumeSubheading}[4]{%
  \vspace{-2pt}\item
    \begin{tabular*}{0.97\textwidth}[t]{l@{\extracolsep{\fill}}r}
      ${bf("#1", style.boldTitles)} & #2 \\
      ${it("\\small#3", style.italicSubtitles)} & ${it("\\small #4", style.italicDates)} \\
    \end{tabular*}\vspace{${fmtPt(style.subheadingTrailVSpacePt)}}
}

\newcommand{\resumeSubSubheading}[2]{%
    \item
    \begin{tabular*}{0.97\textwidth}{l@{\extracolsep{\fill}}r}
      ${it("\\small#1", style.italicSubtitles)} & ${it("\\small #2", style.italicDates)} \\
    \end{tabular*}\vspace{${fmtPt(style.subheadingTrailVSpacePt)}}
}

\newcommand{\resumeProjectHeading}[2]{%
    \item
    \begin{tabular*}{0.97\textwidth}{l@{\extracolsep{\fill}}r}
      \small#1 & #2 \\
    \end{tabular*}\vspace{${fmtPt(style.subheadingTrailVSpacePt)}}
}

\newcommand{\resumeSubItem}[1]{\resumeItem{#1}\vspace{-4pt}}
\renewcommand\labelitemii{$\vcenter{\hbox{\tiny$\bullet$}}$}
\newcommand{\resumeSubHeadingListStart}{\begin{itemize}[leftmargin=0.15in, label={}]}
\newcommand{\resumeSubHeadingListEnd}{\end{itemize}}
\newcommand{\resumeItemListStart}{\begin{itemize}}
\newcommand{\resumeItemListEnd}{\end{itemize}\vspace{${fmtPt(style.itemListEndVSpacePt)}}}
`;
}

function renderHeader(resume) {
  const contactPieces = (resume.contact ?? []).map((item) => {
    const link = linkify(item);
    if (link) {
      return `\\href{${escapeTexUrl(link.url)}}{\\underline{${escapeTex(link.label)}}}`;
    }
    return escapeTex(item);
  });

  return `\\begin{center}
    \\textbf{\\Huge \\scshape ${escapeTex(resume.name)}} \\\\ \\vspace{1pt}
    \\small ${contactPieces.join(" $|$ ")}
\\end{center}`;
}

// If the field looks like a URL or domain, render as an underlined \href so the
// PDF link is clickable; otherwise plain escape. Used for the project meta slot
// (right-aligned link/date) where users commonly drop "myproject.com".
function renderMaybeLink(text) {
  const link = linkify(text);
  if (!link) return escapeTex(text);
  return `\\href{${escapeTexUrl(link.url)}}{\\underline{${escapeTex(link.label)}}}`;
}

// Skills bullets arrive as a single string "Languages: Python, JS, ..."; split
// on the FIRST colon and bold the label so it renders like Jake's source where
// `\textbf{Languages}{: Python...}`. With boldSkillLabels=false, the whole row
// stays plain.
function renderSkillBullet(bullet, boldLabel) {
  const idx = bullet.indexOf(":");
  if (!boldLabel || idx === -1) return escapeTex(bullet);
  const label = bullet.slice(0, idx);
  const rest = bullet.slice(idx);
  return `\\textbf{${escapeTex(label)}}${escapeTex(rest)}`;
}

function renderItem(item, style) {
  const hasFourSlots = item.title || item.subtitle || item.meta || item.location;
  const isProjectish = !item.subtitle && !item.location && (item.title || item.meta);
  const isSkillsLike = !hasFourSlots && item.bullets.length;

  if (isSkillsLike) {
    // Render as a single inline item — common for Skills / Technical sections.
    return `    \\small{\\item{
${item.bullets.map((bullet) => `        ${renderSkillBullet(bullet, style.boldSkillLabels)} \\\\`).join("\n")}
    }}`;
  }

  const heading = isProjectish
    ? `    \\resumeProjectHeading
      {${bf(escapeTex(item.title || ""), style.boldTitles)}}{${renderMaybeLink(item.meta || "")}}`
    : `    \\resumeSubheading
      {${escapeTex(item.title || "")}}{${renderMaybeLink(item.meta || "")}}
      {${escapeTex(item.subtitle || "")}}{${renderMaybeLink(item.location || "")}}`;

  if (!item.bullets.length) return heading;

  return `${heading}
      \\resumeItemListStart
${item.bullets.map((bullet) => `        \\resumeItem{${escapeTex(bullet)}}`).join("\n")}
      \\resumeItemListEnd`;
}

function renderSection(section, style) {
  const hasAnyHeading = section.items.some((item) => item.title || item.subtitle || item.meta || item.location);
  const heading = titleCase(section.heading);

  // Summary-like headings render their rows as plain small paragraphs instead of
  // the skills block (which draws \\ line breaks and bolds "Label:" prefixes).
  if (!hasAnyHeading && section.items.length && isSummarySection(section)) {
    const paragraphs = section.items
      .flatMap((item) => item.bullets)
      .map((text) => String(text ?? "").trim())
      .filter(Boolean);
    if (!paragraphs.length) return "";
    return `\\section{${escapeTex(heading)}}
${paragraphs.map((text) => `  {\\small ${escapeTex(text)}\\par}`).join("\n")}`;
  }

  // Skills-style: no heading rows at all → render as one flat block.
  if (!hasAnyHeading && section.items.length) {
    const allBullets = section.items.flatMap((item) => item.bullets);
    if (!allBullets.length) return "";
    return `\\section{${escapeTex(heading)}}
 \\begin{itemize}[leftmargin=0.15in, label={}]
    \\small{\\item{
${allBullets.map((bullet) => `      ${renderSkillBullet(bullet, style.boldSkillLabels)} \\\\`).join("\n")}
    }}
 \\end{itemize}`;
  }

  const body = section.items.map((item) => renderItem(item, style)).filter(Boolean).join("\n");
  if (!body) return "";

  return `\\section{${escapeTex(heading)}}
  \\resumeSubHeadingListStart
${body}
  \\resumeSubHeadingListEnd`;
}

export default {
  id: "jakes",
  name: "Jake's Resume",
  description: "Single-column, compact, ATS-friendly. The classic CS internship template.",
  source: "https://github.com/jakegut/resume",
  render(resume, docStyle) {
    const style = styleToLatex(docStyle);
    const preamble = buildPreamble(style);
    return `${preamble}
\\begin{document}

${renderHeader(resume)}

${(resume.sections ?? []).map((section) => renderSection(section, style)).join("\n\n")}

\\end{document}
`;
  }
};
