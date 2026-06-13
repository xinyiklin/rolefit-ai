// Deedy-CV-inspired template — two-column layout with a narrow left rail for
// contact + skills and a wide right column for experience/projects/education.
//
// Uses only pdfLaTeX-safe packages (paracol instead of multicol-with-skips,
// no fontspec) so it compiles under Tectonic without custom font installs.
//
// Original (XeLaTeX, Open Sans): https://github.com/deedy/Deedy-Resume

import { escapeTex, escapeTexUrl, titleCase, linkify, isSummarySection } from "../util.mjs";

const PREAMBLE = String.raw`\documentclass[10pt,letterpaper]{article}

\usepackage[letterpaper,top=1cm,bottom=1cm,left=1cm,right=1cm]{geometry}
\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage{lmodern}
\renewcommand{\familydefault}{\sfdefault}
\usepackage{xcolor}
\usepackage{enumitem}
\usepackage{titlesec}
\usepackage{tabularx}
\usepackage{paracol}
\usepackage[hidelinks]{hyperref}

\definecolor{accent}{HTML}{1F5D4A}
\definecolor{ink}{HTML}{161611}
\definecolor{soft}{HTML}{6E6C5E}

\pagestyle{empty}
\setlength{\parindent}{0pt}
\setlist[itemize]{leftmargin=*, itemsep=1pt, topsep=2pt}

\titleformat{\section}{\normalsize\bfseries\color{accent}\uppercase}{}{0em}{}[\vspace{-4pt}\color{accent}\titlerule\vspace{2pt}]
\titlespacing{\section}{0pt}{8pt}{4pt}

\newcommand{\dheader}[2]{%
  {\Huge\bfseries\color{ink} #1}\par\vspace{2pt}%
  {\small\color{soft} #2}\par\vspace{6pt}%
  {\color{accent}\rule{\linewidth}{0.6pt}}\par\vspace{6pt}%
}

\newcommand{\dentry}[4]{%
  \textbf{\color{ink}#1}\hfill{\small\color{soft}#3}\\%
  \textit{\small\color{soft}#2}\hfill{\small\color{soft}#4}\par\vspace{1pt}%
}

\newcommand{\drail}[1]{{\small\color{ink} #1}\par\vspace{4pt}}
`;

function renderHeader(resume) {
  const name = escapeTex(resume.name);
  const pieces = (resume.contact ?? []).map((item) => {
    const link = linkify(item);
    if (link) return `\\href{${escapeTexUrl(link.url)}}{${escapeTex(link.label)}}`;
    return escapeTex(item);
  });
  const contactRow = pieces.join("  $\\cdot$  ");
  return `\\dheader{${name}}{${contactRow}}`;
}

function renderItem(item, { railMode = false } = {}) {
  const hasHeader = item.title || item.subtitle || item.meta || item.location;
  if (!hasHeader && item.bullets.length) {
    if (railMode) {
      return item.bullets.map((bullet) => `\\drail{${escapeTex(bullet)}}`).join("\n");
    }
    return `\\drail{${item.bullets.map(escapeTex).join(" \\,\\textbullet\\, ")}}`;
  }
  const header = `\\dentry{${escapeTex(item.title || "")}}{${escapeTex(item.subtitle || "")}}{${escapeTex(item.meta || "")}}{${escapeTex(item.location || "")}}`;
  if (!item.bullets.length) return header;
  const bullets = `\\begin{itemize}
${item.bullets.map((bullet) => `  \\item \\small\\color{ink} ${escapeTex(bullet)}`).join("\n")}
\\end{itemize}`;
  return `${header}
${bullets}`;
}

function isRailSection(section) {
  // Rail sections: short, no per-item headers (e.g., Skills, Languages,
  // Coursework, Interests). Summaries are headerless too but belong in the
  // wide main column, never the narrow rail.
  if (isSummarySection(section)) return false;
  const heading = (section.heading || "").toLowerCase();
  if (/(skill|tools|languages|interests|coursework|technical)/.test(heading)) return true;
  return section.items.every((item) => !item.title && !item.subtitle);
}

function renderSection(section, opts = {}) {
  const heading = titleCase(section.heading);
  const hasAnyHeader = section.items.some((item) => item.title || item.subtitle || item.meta || item.location);

  // Summary-like sections: one paragraph per row (the flat render would join
  // paragraphs with inline bullet separators).
  if (!hasAnyHeader && section.items.length && isSummarySection(section)) {
    const paragraphs = section.items
      .flatMap((item) => item.bullets)
      .map((text) => String(text ?? "").trim())
      .filter(Boolean);
    if (!paragraphs.length) return "";
    return `\\section{${escapeTex(heading)}}
${paragraphs.map((text) => `\\drail{${escapeTex(text)}}`).join("\n")}`;
  }

  const items = section.items.map((item) => renderItem(item, opts)).filter(Boolean).join("\n\n");
  return `\\section{${escapeTex(heading)}}
${items}`;
}

export default {
  id: "deedy",
  name: "Deedy CV (two-column)",
  description: "Two-column layout with a skills rail. Best for technical resumes with many skills.",
  source: "https://github.com/deedy/Deedy-Resume",
  render(resume) {
    const allSections = resume.sections ?? [];
    const railSections = allSections.filter(isRailSection);
    const mainSections = allSections.filter((section) => !isRailSection(section));

    const railContent = railSections.length
      ? railSections.map((section) => renderSection(section, { railMode: true })).join("\n\n")
      : "";

    const mainContent = mainSections.map((section) => renderSection(section, { railMode: false })).join("\n\n");

    if (!railContent) {
      // Single-column fallback if there are no rail-eligible sections.
      return `${PREAMBLE}
\\begin{document}

${renderHeader(resume)}

${mainContent}

\\end{document}
`;
    }

    return `${PREAMBLE}
\\begin{document}

${renderHeader(resume)}

\\columnratio{0.32, 0.68}
\\begin{paracol}{2}

${railContent}

\\switchcolumn

${mainContent}

\\end{paracol}

\\end{document}
`;
  }
};
