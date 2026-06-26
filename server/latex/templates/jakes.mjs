// Jake's Resume template — https://github.com/jakegut/resume
// Single-column, compact, ATS-friendly. Uses only packages that ship with
// Tectonic / TeX Live by default.

import { escapeTex, escapeTexUrl, titleCase, linkify, splitLinkSegments, isSummarySection } from "../util.mjs";

// Map the editor's DocStyle (em values, 11pt base font) → LaTeX pt overrides.
// Mirrors the CSS variables consumed by the HTML editor so the on-screen page
// and the compiled PDF share rhythm.
//
// SPACING MODEL — every gap is a pure SEPARATOR between siblings, never a
// trailing margin on the last one. Sections, entries, bullets, and skill rows
// each own exactly one gap that sits *between* consecutive items, so the last
// bullet/entry adds nothing on top of the enclosing entry/section gap:
//   - sectionGap       → \titlespacing "before" (gap above each section heading)
//   - sectionEntryGap  → \titlespacing "after"  (rule → first entry/row)
//   - entryGap         → \resumeEntryGap, inserted only BETWEEN entries
//   - headBulletGap    → inner bullet list \topsep (entry head → first bullet)
//   - bulletGap        → inner bullet list \itemsep (between bullets only)
//   - skillsRowGap     → skills list \itemsep (between skill rows only)
// The lists set topsep/parsep/partopsep to 0 (except the bullet list's topsep,
// which IS headBulletGap) so no implicit list glue leaks into a parent gap.
// NB: \\[len] is unreliable here — the template's global \raggedright drops the
// optional length — so row spacing uses \itemsep, which survives \raggedright.
//
// Jake's original look, restored as the FALLBACK so a request without docStyle
// compiles close to the upstream template.
const DEFAULTS = {
  usesDocStyle: false,
  // \vspace between the name row and contact row
  nameContactVSpacePt: 1,
  // Header contact separator, preserving the previous no-docStyle template text.
  contactSeparatorTex: " $|$ ",
  // \vspace after the header, before the first section
  headerSectionVSpacePt: null,
  // \titlespacing before/after the section heading
  sectionGapPt: 9.5,
  sectionEntryGapPt: 4.6,
  // \resumeEntryGap between entries; null preserves the previous no-docStyle output
  entryGapPt: null,
  // \vspace between the title row and subtitle row (clean tight-lines baseline;
  // see styleToLatex — the old -7 collided the two rows)
  titleSubVSpacePt: -4.5,
  // inner bullet list \topsep (entry head → first bullet)
  headBulletPt: 4.6,
  // skills list \itemsep (between skill rows)
  skillsRowGapPt: 0,
  // inner bullet list \itemsep (between bullets)
  bulletGapPt: 2.2,
  // \baselinestretch (Jake's default is implicit 1.0 ≈ 1.2x leading)
  baselineStretch: 1.0,
  // Bold/italic toggles — Jake's upstream defaults
  boldHeadings: false,
  boldTitles: true,
  boldSkillLabels: true,
  italicSubtitles: true,
  italicDates: true
};

const DOC_EM = {
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
};

// 11pt base font: 1em = 11pt for the main flow. Contact and skills rows are
// \small (10pt), so their own row-local gaps convert via 10pt/em. Each gap maps
// directly and monotonically to one LaTeX length, with no negative-glue hacks.
function styleToLatex(docStyle) {
  if (!docStyle || typeof docStyle !== "object") return DEFAULTS;
  const num = (v, fallback) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
  const nameContactGapEm = num(docStyle.nameContactGap, DOC_EM.nameContactGap);
  const contactGapEm = num(docStyle.contactGap, DOC_EM.contactGap);
  const headerSectionGapEm = num(docStyle.headerSectionGap, DOC_EM.headerSectionGap);
  const sectionGapEm = num(docStyle.sectionGap, DOC_EM.sectionGap);
  const sectionEntryGapEm = num(docStyle.sectionEntryGap, DOC_EM.sectionEntryGap);
  const entryGapEm = num(docStyle.entryGap, DOC_EM.entryGap);
  const titleSubGapEm = num(docStyle.titleSubGap, DOC_EM.titleSubGap);
  const headBulletGapEm = num(docStyle.headBulletGap, DOC_EM.headBulletGap);
  const skillsRowGapEm = num(docStyle.skillsRowGap, DOC_EM.skillsRowGap);
  const bulletGapEm = num(docStyle.bulletGap, DOC_EM.bulletGap);
  const lineHeight = num(docStyle.lineHeight, 1.18);
  // Section gap is the WHOLE gap above the heading; \titlespacing "before"
  // measures exactly that (predecessor adds no trailing glue in this model).
  const sectionGapPt = sectionGapEm * 11;
  // Rule → first entry/row = \titlespacing "after".
  const sectionEntryGapPt = sectionEntryGapEm * 11;
  // Between-entry separator.
  const entryGapPt = entryGapEm * 11;
  // Entry head → first bullet = inner list \topsep.
  const headBulletPt = headBulletGapEm * 11;
  // Between-bullet separator = inner list \itemsep.
  const bulletGapPt = bulletGapEm * 11;
  // The header → first section vspace must absorb the first section's own
  // \titlespacing "before" (= sectionGap) plus the center block's natural
  // bottom (~0.34em), so the visible first gap equals headerSectionGap.
  const headerSectionVSpacePt = (headerSectionGapEm - sectionGapEm - 0.34) * 11;
  // The two subheading rows are \par-stacked, so a -4.5pt baseline pulls them to
  // clean tight consecutive lines (below ~-5pt they collide); each em then adds
  // 11pt of air on top, matching the editor's title→subtitle margin. Measured
  // against compiled PDFs.
  const titleSubPt = DEFAULTS.titleSubVSpacePt + titleSubGapEm * 11;
  // CSS line-height 1.0 ≈ LaTeX \baselinestretch 0.83; CSS 1.2 ≈ stretch 1.0.
  const baselineStretch = lineHeight / 1.2;
  const bool = (v, fallback) => (typeof v === "boolean" ? v : fallback);
  return {
    usesDocStyle: true,
    nameContactVSpacePt: DEFAULTS.nameContactVSpacePt + (nameContactGapEm - DOC_EM.nameContactGap) * 10,
    contactSeparatorTex: `\\makebox[${fmtPt(contactGapEm * 10)}][c]{$|$}`,
    headerSectionVSpacePt,
    sectionGapPt,
    sectionEntryGapPt,
    entryGapPt,
    titleSubVSpacePt: titleSubPt,
    headBulletPt,
    skillsRowGapPt: skillsRowGapEm * 10,
    bulletGapPt,
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
  // LaTeX accepts negative and decimal pt values directly. Keep one decimal for
  // the small-granularity header/contact controls, but emit integers when exact.
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}pt`;
}

function buildPreamble(style) {
  const entryGapMacro =
    style.entryGapPt === null
      ? ""
      : `\n\\newcommand{\\resumeEntryGap}{\\vspace{${fmtPt(style.entryGapPt)}}}`;

  // Outer (entry) list: in docStyle mode all implicit list glue is zeroed so the
  // ONLY inter-entry gap is \resumeEntryGap; the fallback keeps Jake's natural
  // list spacing.
  const subListOpts = style.usesDocStyle
    ? "[leftmargin=0.15in, label={}, topsep=0pt, partopsep=0pt, parsep=0pt, itemsep=0pt]"
    : "[leftmargin=0.15in, label={}]";

  // Inner (bullet) list: \itemsep is the sole between-bullet gap; topsep/parsep
  // are zeroed so the last bullet adds nothing and the head→bullet gap (an
  // explicit \vspace emitted by the renderer) and the entry gap fully own the
  // spacing around the list.
  const itemListOpts = `[topsep=0pt, partopsep=0pt, parsep=0pt, itemsep=${fmtPt(style.bulletGapPt)}]`;

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

% Section gaps are pure separators: \titlespacing "before" is the WHOLE gap
% above the heading (= sectionGap), "after" is the rule→first-row gap
% (= sectionEntryGap). titlesec drops the before-glue at the top of a page, so
% the first section's gap is set by the header \vspace instead.
\titleformat{\section}{\scshape\raggedright\large${style.boldHeadings ? "\\bfseries" : ""}}{}{0em}{}[\color{black}\titlerule]
\titlespacing*{\section}{0pt}{${fmtPt(style.sectionGapPt)}}{${fmtPt(style.sectionEntryGapPt)}}

\ifdefined\pdfgentounicode\pdfgentounicode=1\fi

\newcommand{\resumeItem}[1]{\item\small{#1}}

% The right column is a right-aligned tabularx X cell (not a single-line r): it
% claims the space left of the title and WRAPS, so a long link — or two links
% split by " / " — breaks into the empty space on that row instead of running
% off the page margin. A short date/link still sits flush-right, unchanged.
\newcolumntype{R}{>{\raggedleft\arraybackslash}X}

% Each row is its OWN tabularx so the left column on the title row is sized only
% by the (short) title — not by a long subtitle on the row below. Sharing one
% tabular would let a wide subtitle inflate the shared left column and needlessly
% squeeze/wrap the title row's link. \resumeRow stacks rows with the list's
% natural leading via \par so the two-line rhythm matches the old tabular.
\newcommand{\resumeRow}[2]{%
  \begin{tabularx}{0.97\textwidth}{@{}l R@{}}#1 & #2 \\\end{tabularx}\par}

% Entry heads carry no trailing glue: the head→bullet gap is an explicit
% \vspace the renderer inserts only when bullets follow, and the inter-entry gap
% is \resumeEntryGap. A bullet-less entry (e.g. Education) therefore adds nothing
% after itself, so the next entry/section gap stands alone.
\newcommand{\resumeSubheading}[4]{%
  \item
    \resumeRow{${bf("#1", style.boldTitles)}}{#2}%
    \vspace{${fmtPt(style.titleSubVSpacePt)}}%
    \resumeRow{${it("\\small#3", style.italicSubtitles)}}{${it("\\small #4", style.italicDates)}}%
}

\newcommand{\resumeSubSubheading}[2]{%
    \item
    \resumeRow{${it("\\small#1", style.italicSubtitles)}}{${it("\\small #2", style.italicDates)}}%
}

\newcommand{\resumeProjectHeading}[2]{%
    \item
    \resumeRow{\small#1}{#2}%
}

\newcommand{\resumeSubItem}[1]{\resumeItem{#1}}
\renewcommand\labelitemii{$\vcenter{\hbox{\tiny$\bullet$}}$}
\newcommand{\resumeSubHeadingListStart}{\begin{itemize}${subListOpts}}
\newcommand{\resumeSubHeadingListEnd}{\end{itemize}}
\newcommand{\resumeItemListStart}{\begin{itemize}${itemListOpts}}
\newcommand{\resumeItemListEnd}{\end{itemize}}
${entryGapMacro}
`;
}

function renderHeader(resume, style) {
  const contactPieces = (resume.contact ?? []).map((item) => {
    const link = linkify(item);
    if (link) {
      return `\\href{${escapeTexUrl(link.url)}}{\\underline{${escapeTex(link.label)}}}`;
    }
    return escapeTex(item);
  });

  return `\\begin{center}
    \\textbf{\\Huge \\scshape ${escapeTex(resume.name)}} \\\\ \\vspace{${fmtPt(style.nameContactVSpacePt)}}
    \\small ${contactPieces.join(style.contactSeparatorTex)}
\\end{center}${style.headerSectionVSpacePt === null ? "" : `\n\\vspace{${fmtPt(style.headerSectionVSpacePt)}}`}`;
}

// If the field looks like a URL or domain, render as an underlined \href so the
// PDF link is clickable; otherwise plain escape. Used for the project meta slot
// (right-aligned link/date) where users commonly drop "myproject.com". A field
// holding two links split by " / " (or " | ", " , ", " ; ") linkifies each half
// independently so both stay clickable; the delimiter is escaped as plain text.
function renderMaybeLink(text) {
  const segments = splitLinkSegments(text);
  if (segments.length === 1 && !segments[0].link) return escapeTex(text);
  return segments
    .map((segment) =>
      segment.link
        ? `\\href{${escapeTexUrl(segment.link.url)}}{\\underline{${escapeTex(segment.link.label)}}}`
        : escapeTex(segment.text)
    )
    .join("");
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

// Separator BETWEEN skill rows that share one \item (the inline isSkillsLike
// case). \par ends the row; the optional \vspace adds the row gap. \\[len] would
// be silently dropped under the template's global \raggedright, so we never use
// it for row spacing. The last row gets no separator (rows are join()ed).
function renderSkillRowSep(style) {
  return style.skillsRowGapPt ? `\\par\\vspace{${fmtPt(style.skillsRowGapPt)}}\n        ` : "\\par\n        ";
}

function renderItem(item, style) {
  const hasFourSlots = item.title || item.subtitle || item.meta || item.location;
  const isProjectish = !item.subtitle && !item.location && (item.title || item.meta);
  const isSkillsLike = !hasFourSlots && item.bullets.length;

  if (isSkillsLike) {
    // Inline skill rows inside the entry list (a standard section whose item is
    // all bullets). One \item; rows separated by the skills-row gap, never after
    // the last row.
    return `    \\item{\\small ${item.bullets
      .map((bullet) => renderSkillBullet(bullet, style.boldSkillLabels))
      .join(renderSkillRowSep(style))}}`;
  }

  const heading = isProjectish
    ? `    \\resumeProjectHeading
      {${bf(escapeTex(item.title || ""), style.boldTitles)}}{${renderMaybeLink(item.meta || "")}}`
    : `    \\resumeSubheading
      {${escapeTex(item.title || "")}}{${renderMaybeLink(item.meta || "")}}
      {${escapeTex(item.subtitle || "")}}{${renderMaybeLink(item.location || "")}}`;

  if (!item.bullets.length) return heading;

  // Head→bullet gap lives here (not in the macro) so a bullet-less entry leaves
  // no trailing space. topsep is 0, so this \vspace is the whole head→bullet gap.
  return `${heading}
      \\vspace{${fmtPt(style.headBulletPt)}}
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

  // Skills-style: no heading rows at all → one row per \item. \itemsep is the
  // sole between-row gap (skillsRowGap); topsep/parsep are zeroed so the last row
  // adds nothing and the rule→first-row gap is owned by the section "after" gap.
  if (!hasAnyHeading && section.items.length) {
    const allBullets = section.items.flatMap((item) => item.bullets);
    if (!allBullets.length) return "";
    return `\\section{${escapeTex(heading)}}
 \\begin{itemize}[leftmargin=0.15in, label={}, topsep=0pt, partopsep=0pt, parsep=0pt, itemsep=${fmtPt(style.skillsRowGapPt)}]
${allBullets.map((bullet) => `    \\item{\\small ${renderSkillBullet(bullet, style.boldSkillLabels)}}`).join("\n")}
 \\end{itemize}`;
  }

  const entryJoiner = style.entryGapPt === null ? "\n" : "\n    \\resumeEntryGap\n";
  const body = section.items.map((item) => renderItem(item, style)).filter(Boolean).join(entryJoiner);
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

${renderHeader(resume, style)}

${(resume.sections ?? []).map((section) => renderSection(section, style)).join("\n\n")}

\\end{document}
`;
  }
};
