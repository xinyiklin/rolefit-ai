// Parse a plain-text resume (the human-readable format the AI produces) into a
// canonical schema for LaTeX rendering.
//
// Schema:
//   {
//     name: string,
//     contact: string[],
//     sections: [
//       {
//         heading: string,
//         items: [
//           {
//             title: string,
//             subtitle: string,
//             meta: string,        // typically dates
//             location: string,
//             bullets: string[],
//             raw?: string         // if no heading-like structure (e.g., Skills)
//           }
//         ]
//       }
//     ]
//   }
//
// The parser is heuristic. It detects:
//   - the first line as the name
//   - subsequent lines (before the first section header) as contact lines,
//     split on | • · , and similar separators
//   - SECTION HEADERS as short ALL-CAPS lines
//   - bullet lines (-, *, •, ◦, 1., etc.) attach to the most recent item
//   - non-bullet lines inside a section are interpreted as item headings,
//     split on | (or " — ") for title / subtitle / dates / location

const BULLET_RE = /^\s*(?:[-*•◦▪‣]|\d+[.)])\s+/;
const SECTION_RE = /^[A-Z0-9][A-Z0-9 &/\-]+$/;
const HEADING_SPLIT_RE = /\s*[|•·]\s+/;
const CONTACT_SPLIT_RE = /\s*[|•·]\s+/;

function isSectionHeader(line) {
  const trimmed = line.trim();
  if (trimmed.length < 2 || trimmed.length > 50) return false;
  if (!SECTION_RE.test(trimmed)) return false;
  // Avoid catching a SHOUTING company name. Section headings are usually
  // single words or two words. Allow up to 4 words.
  return trimmed.split(/\s+/).length <= 4;
}

function stripBullet(line) {
  return line.replace(BULLET_RE, "").trim();
}

function parseItemHeading(line) {
  const trimmed = line.trim();
  // Handle "Title — Subtitle — Dates — Location" with em-dash or hyphen too
  const sepNormalized = trimmed.replace(/\s+[—–]\s+/g, " | ");
  const parts = sepNormalized.split(HEADING_SPLIT_RE).map((piece) => piece.trim()).filter(Boolean);

  return {
    title: parts[0] || "",
    subtitle: parts[1] || "",
    meta: parts[2] || "",
    location: parts[3] || "",
    bullets: []
  };
}

function parseContactLines(lines) {
  if (!lines.length) return [];
  // Join all contact lines into one logical line, then split on separators.
  const joined = lines.join(" | ");
  return joined.split(CONTACT_SPLIT_RE).map((piece) => piece.trim()).filter(Boolean);
}

export function parseResumeText(text) {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim());

  // Find first non-empty line as name
  let i = 0;
  while (i < lines.length && !lines[i]) i += 1;

  const name = lines[i] || "";
  i += 1;

  // Collect contact lines until first section header (or first bullet)
  const contactBuffer = [];
  while (i < lines.length && !isSectionHeader(lines[i])) {
    if (lines[i]) contactBuffer.push(lines[i]);
    i += 1;
  }
  const contact = parseContactLines(contactBuffer);

  // Sections
  const sections = [];
  let currentSection = null;
  let currentItem = null;

  for (; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;

    if (isSectionHeader(line)) {
      currentSection = { heading: line.trim(), items: [] };
      sections.push(currentSection);
      currentItem = null;
      continue;
    }

    if (!currentSection) {
      // Lines before any section — treat as additional contact entries
      contact.push(line);
      continue;
    }

    if (BULLET_RE.test(line)) {
      if (!currentItem) {
        currentItem = { title: "", subtitle: "", meta: "", location: "", bullets: [] };
        currentSection.items.push(currentItem);
      }
      currentItem.bullets.push(stripBullet(line));
      continue;
    }

    // Non-bullet, non-section-header line inside a section: new item heading
    currentItem = parseItemHeading(line);
    currentSection.items.push(currentItem);
  }

  return { name, contact, sections };
}

// Extract a plain-text resume from a Jake's-style .tex source so the AI can
// polish it the same way it polishes DOCX/text uploads.
export function extractPlainTextFromLatex(tex) {
  const source = String(tex ?? "");

  // Drop everything before \begin{document}
  const docStart = source.indexOf("\\begin{document}");
  const body = docStart >= 0 ? source.slice(docStart + "\\begin{document}".length) : source;
  const trimmedBody = body.replace(/\\end\{document\}[\s\S]*$/, "");

  const lines = [];

  // Pull the name from \textbf{\Huge \scshape NAME}, \Huge NAME, or {\Huge NAME}.
  const nameMatch = trimmedBody.match(/\\textbf\{\s*\\(?:Huge|huge|LARGE)\s*(?:\\scshape\s*)?([^{}\\]+)\}/) ||
    trimmedBody.match(/\\(?:Huge|huge|LARGE)\s*(?:\\scshape\s*)?\{?([A-Za-z][^{}\\\n]+)/);
  if (nameMatch) lines.push(stripLatexInline(nameMatch[1]));

  // Pull contact info from the center block right after the name.
  // Jake's uses: \small phone $|$ \href{mailto:..}{..} $|$ \href{..}{..}
  const centerMatch = trimmedBody.match(/\\begin\{center\}([\s\S]*?)\\end\{center\}/);
  if (centerMatch) {
    const contactText = stripLatexInline(centerMatch[1])
      .replace(/\$\|\$/g, " | ")
      .replace(/\$\\bullet\$/g, " | ")
      .replace(/\\\\/g, " ")
      .trim();
    // Take the part after the name, if name was in the center block.
    let cleaned = contactText;
    if (nameMatch && contactText.startsWith(stripLatexInline(nameMatch[1]))) {
      cleaned = contactText.slice(stripLatexInline(nameMatch[1]).length).trim();
    }
    if (cleaned) lines.push(cleaned);
  }

  // Walk \section{...} blocks
  const sectionRe = /\\section\*?\{([^}]+)\}/g;
  const sectionStarts = [];
  let match;
  while ((match = sectionRe.exec(trimmedBody)) !== null) {
    sectionStarts.push({ heading: stripLatexInline(match[1]), index: match.index, after: match.index + match[0].length });
  }

  for (let s = 0; s < sectionStarts.length; s += 1) {
    const start = sectionStarts[s];
    const end = s + 1 < sectionStarts.length ? sectionStarts[s + 1].index : trimmedBody.length;
    const segment = trimmedBody.slice(start.after, end);

    lines.push("");
    lines.push(start.heading.toUpperCase());

    // Subheadings: \resumeSubheading{a}{b}{c}{d} or \resumeProjectHeading{a}{b}
    const subRe = /\\resume(?:Sub)?heading\s*\{([^}]*)\}\s*\{([^}]*)\}\s*\{([^}]*)\}\s*\{([^}]*)\}/g;
    const projectRe = /\\resumeProjectHeading\s*\{([^}]*)\}\s*\{([^}]*)\}/g;
    const itemRe = /\\resumeItem\s*\{([^}]*)\}/g;

    const events = [];
    let m;
    while ((m = subRe.exec(segment)) !== null) {
      events.push({
        index: m.index,
        kind: "sub",
        text: `${stripLatexInline(m[1])} | ${stripLatexInline(m[3])} | ${stripLatexInline(m[2])} | ${stripLatexInline(m[4])}`
      });
    }
    while ((m = projectRe.exec(segment)) !== null) {
      events.push({
        index: m.index,
        kind: "sub",
        text: `${stripLatexInline(m[1])} | ${stripLatexInline(m[2])}`
      });
    }
    while ((m = itemRe.exec(segment)) !== null) {
      events.push({ index: m.index, kind: "item", text: stripLatexInline(m[1]) });
    }

    events.sort((a, b) => a.index - b.index);
    for (const event of events) {
      if (event.kind === "sub") {
        lines.push(event.text.replace(/\s+\|\s+(?=\|)/g, " | ").replace(/\|\s+$/, "").trim());
      } else {
        lines.push(`- ${event.text}`);
      }
    }

    // Fallback for skills-style sections: pull any \item or bare text.
    if (!events.length) {
      const itemsRe = /\\item\b\s*([^\n\\]+)/g;
      while ((m = itemsRe.exec(segment)) !== null) {
        lines.push(`- ${stripLatexInline(m[1])}`);
      }
      // Capture body text outside of macros
      const stripped = segment
        .replace(/\\begin\{[^}]+\}/g, "")
        .replace(/\\end\{[^}]+\}/g, "")
        .replace(/\\[A-Za-z]+\*?\s*(\[[^\]]*\])?\s*\{[^}]*\}/g, "")
        .replace(/\\[A-Za-z]+\*?/g, "")
        .replace(/[\{\}]/g, "")
        .trim();
      if (stripped) {
        for (const piece of stripped.split(/\r?\n/)) {
          const p = piece.trim();
          if (p && !lines.includes(p)) lines.push(p);
        }
      }
    }
  }

  return lines.join("\n");
}

function stripLatexInline(value) {
  return String(value ?? "")
    .replace(/\\href\{[^}]*\}\{([^}]*)\}/g, "$1")
    .replace(/\\underline\{([^}]*)\}/g, "$1")
    .replace(/\\textbf\{([^}]*)\}/g, "$1")
    .replace(/\\textit\{([^}]*)\}/g, "$1")
    .replace(/\\emph\{([^}]*)\}/g, "$1")
    .replace(/\\text(?:sc|tt|rm|sf)\{([^}]*)\}/g, "$1")
    .replace(/\\(?:Huge|huge|LARGE|Large|large|small|footnotesize|tiny|normalsize|scshape)\s*/g, "")
    .replace(/\\v?h?space\*?\{[^}]*\}/g, " ")
    .replace(/\\(?:hfill|vfill|noindent|par|newline|newpage|pagebreak|linebreak|bigskip|medskip|smallskip)\b/g, " ")
    .replace(/\\\\/g, " ")
    .replace(/\$([^$]*)\$/g, "$1")
    .replace(/\\&/g, "&")
    .replace(/\\%/g, "%")
    .replace(/\\\$/g, "$")
    .replace(/\\#/g, "#")
    .replace(/\\_/g, "_")
    .replace(/\\\{/g, "{")
    .replace(/\\\}/g, "}")
    .replace(/\\,|\\ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
