// Jake's Resume template — https://github.com/jakegut/resume
// Single-column, compact, ATS-friendly. Uses only packages that ship with
// Tectonic / TeX Live by default.

import { escapeTex, titleCase, linkify } from "../util.mjs";

const PREAMBLE = String.raw`\documentclass[letterpaper,11pt]{article}

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
\input{glyphtounicode}

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

\urlstyle{same}
\raggedbottom
\raggedright
\setlength{\tabcolsep}{0in}

\titleformat{\section}{\vspace{-4pt}\scshape\raggedright\large}{}{0em}{}[\color{black}\titlerule \vspace{-5pt}]

\pdfgentounicode=1

\newcommand{\resumeItem}[1]{\item\small{{#1 \vspace{-2pt}}}}

\newcommand{\resumeSubheading}[4]{%
  \vspace{-2pt}\item
    \begin{tabular*}{0.97\textwidth}[t]{l@{\extracolsep{\fill}}r}
      \textbf{#1} & #2 \\
      \textit{\small#3} & \textit{\small #4} \\
    \end{tabular*}\vspace{-7pt}
}

\newcommand{\resumeSubSubheading}[2]{%
    \item
    \begin{tabular*}{0.97\textwidth}{l@{\extracolsep{\fill}}r}
      \textit{\small#1} & \textit{\small #2} \\
    \end{tabular*}\vspace{-7pt}
}

\newcommand{\resumeProjectHeading}[2]{%
    \item
    \begin{tabular*}{0.97\textwidth}{l@{\extracolsep{\fill}}r}
      \small#1 & #2 \\
    \end{tabular*}\vspace{-7pt}
}

\newcommand{\resumeSubItem}[1]{\resumeItem{#1}\vspace{-4pt}}
\renewcommand\labelitemii{$\vcenter{\hbox{\tiny$\bullet$}}$}
\newcommand{\resumeSubHeadingListStart}{\begin{itemize}[leftmargin=0.15in, label={}]}
\newcommand{\resumeSubHeadingListEnd}{\end{itemize}}
\newcommand{\resumeItemListStart}{\begin{itemize}}
\newcommand{\resumeItemListEnd}{\end{itemize}\vspace{-5pt}}
`;

function renderHeader(resume) {
  const contactPieces = (resume.contact ?? []).map((item) => {
    const link = linkify(item);
    if (link) {
      return `\\href{${link.url}}{\\underline{${escapeTex(link.label)}}}`;
    }
    return escapeTex(item);
  });

  return `\\begin{center}
    \\textbf{\\Huge \\scshape ${escapeTex(resume.name)}} \\\\ \\vspace{1pt}
    \\small ${contactPieces.join(" $|$ ")}
\\end{center}`;
}

function renderItem(item) {
  const hasFourSlots = item.title || item.subtitle || item.meta || item.location;
  const isProjectish = !item.subtitle && !item.location && (item.title || item.meta);
  const isSkillsLike = !hasFourSlots && item.bullets.length;

  if (isSkillsLike) {
    // Render as a single inline item — common for Skills / Technical sections.
    return `    \\small{\\item{
${item.bullets.map((bullet) => `        ${escapeTex(bullet)} \\\\`).join("\n")}
    }}`;
  }

  const heading = isProjectish
    ? `    \\resumeProjectHeading
      {\\textbf{${escapeTex(item.title || "")}}}{${escapeTex(item.meta || "")}}`
    : `    \\resumeSubheading
      {${escapeTex(item.title || "")}}{${escapeTex(item.meta || "")}}
      {${escapeTex(item.subtitle || "")}}{${escapeTex(item.location || "")}}`;

  if (!item.bullets.length) return heading;

  return `${heading}
      \\resumeItemListStart
${item.bullets.map((bullet) => `        \\resumeItem{${escapeTex(bullet)}}`).join("\n")}
      \\resumeItemListEnd`;
}

function renderSection(section) {
  const hasAnyHeading = section.items.some((item) => item.title || item.subtitle || item.meta || item.location);
  const heading = titleCase(section.heading);

  // Skills-style: no heading rows at all → render as one flat block.
  if (!hasAnyHeading && section.items.length) {
    const allBullets = section.items.flatMap((item) => item.bullets);
    return `\\section{${escapeTex(heading)}}
 \\begin{itemize}[leftmargin=0.15in, label={}]
    \\small{\\item{
${allBullets.map((bullet) => `      ${escapeTex(bullet)} \\\\`).join("\n")}
    }}
 \\end{itemize}`;
  }

  return `\\section{${escapeTex(heading)}}
  \\resumeSubHeadingListStart
${section.items.map(renderItem).filter(Boolean).join("\n")}
  \\resumeSubHeadingListEnd`;
}

export default {
  id: "jakes",
  name: "Jake's Resume",
  description: "Single-column, compact, ATS-friendly. The classic CS internship template.",
  source: "https://github.com/jakegut/resume",
  render(resume) {
    return `${PREAMBLE}
\\begin{document}

${renderHeader(resume)}

${(resume.sections ?? []).map(renderSection).join("\n\n")}

\\end{document}
`;
  }
};
