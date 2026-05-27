// Awesome-CV-inspired template — color accent header, sans-serif body.
// We use pdfLaTeX-safe packages (no fontspec) so this compiles under
// Tectonic without custom font installs.
//
// Original (XeLaTeX, custom fonts): https://github.com/posquit0/Awesome-CV

import { escapeTex, titleCase, linkify } from "../util.mjs";

const PREAMBLE = String.raw`\documentclass[10pt,a4paper]{article}

\usepackage[a4paper,top=1.4cm,bottom=1.4cm,left=1.5cm,right=1.5cm]{geometry}
\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage{lmodern}
\renewcommand{\familydefault}{\sfdefault}
\usepackage{xcolor}
\usepackage{enumitem}
\usepackage{titlesec}
\usepackage{tabularx}
\usepackage{ifsym}
\usepackage[hidelinks]{hyperref}
\usepackage{fancyhdr}

\definecolor{accent}{HTML}{1F5D4A}
\definecolor{ink}{HTML}{161611}
\definecolor{soft}{HTML}{6E6C5E}

\pagestyle{fancy}
\fancyhf{}
\renewcommand{\headrulewidth}{0pt}

\setlist[itemize]{leftmargin=*, itemsep=2pt, topsep=2pt}

\titleformat{\section}{\large\bfseries\color{accent}\uppercase}{}{0em}{}[\vspace{-6pt}\color{accent}\titlerule\vspace{2pt}]
\titlespacing{\section}{0pt}{14pt}{6pt}

\newcommand{\cvheader}[2]{%
  {\Huge\bfseries\color{ink} #1}\\[4pt]%
  {\small\color{soft} #2}\\[6pt]%
  {\color{accent}\rule{\linewidth}{0.6pt}}\par\vspace{4pt}%
}

\newcommand{\cventry}[4]{%
  \noindent\begin{tabularx}{\linewidth}{@{}X r@{}}
    \textbf{\color{ink}#1} & \small\color{soft}#3 \\
    \small\color{soft}\textit{#2} & \small\color{soft}\textit{#4} \\
  \end{tabularx}\vspace{2pt}
}

\newcommand{\cvinline}[1]{\small\color{ink} #1 \par\vspace{2pt}}
`;

function renderHeader(resume) {
  const name = escapeTex(resume.name);
  const pieces = (resume.contact ?? []).map((item) => {
    const link = linkify(item);
    if (link) return `\\href{${link.url}}{${escapeTex(link.label)}}`;
    return escapeTex(item);
  });
  const contactRow = pieces.join("  $\\cdot$  ");
  return `\\cvheader{${name}}{${contactRow}}`;
}

function renderItem(item) {
  const hasHeader = item.title || item.subtitle || item.meta || item.location;
  if (!hasHeader && item.bullets.length) {
    // Skills-style flat bullets
    return `\\cvinline{${item.bullets.map(escapeTex).join(" \\,\\textbullet\\, ")}}`;
  }
  const header = `\\cventry{${escapeTex(item.title || "")}}{${escapeTex(item.subtitle || "")}}{${escapeTex(item.meta || "")}}{${escapeTex(item.location || "")}}`;
  if (!item.bullets.length) return header;
  const bullets = `\\begin{itemize}
${item.bullets.map((bullet) => `  \\item \\small\\color{ink} ${escapeTex(bullet)}`).join("\n")}
\\end{itemize}`;
  return `${header}
${bullets}`;
}

function renderSection(section) {
  const heading = titleCase(section.heading);
  const items = section.items.map(renderItem).filter(Boolean).join("\n\n");
  return `\\section{${escapeTex(heading)}}
${items}`;
}

export default {
  id: "awesome-cv",
  name: "Awesome-CV (compact)",
  description: "Color accent header, sans-serif body. Modern recruiter-friendly look.",
  source: "https://github.com/posquit0/Awesome-CV",
  render(resume) {
    return `${PREAMBLE}
\\begin{document}
\\pagestyle{empty}

${renderHeader(resume)}

${(resume.sections ?? []).map(renderSection).join("\n\n")}

\\end{document}
`;
  }
};
