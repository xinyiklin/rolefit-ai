type PdfFont = "regular" | "bold";

type PdfLine = {
  text: string;
  font: PdfFont;
  size: number;
  x: number;
  y: number;
  color?: string;
};

type ResumeHeader = {
  name: string;
  contact: string;
  bodyLines: string[];
};

const pageWidth = 612;
const pageHeight = 792;
const marginX = 48;
const marginTop = 42;
const marginBottom = 48;
const contentWidth = pageWidth - marginX * 2;
const bodySize = 9.25;
const bodyLineHeight = 11.8;

function cleanPdfText(text: string) {
  return text
    .replace(/[•]/g, "-")
    .replace(/[–—]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\u00a0/g, " ")
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapePdfString(text: string) {
  return cleanPdfText(text).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function isContactLine(line: string) {
  return /@|https?:\/\/|github\.com|linkedin\.com|\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/i.test(line);
}

function isNameLine(line: string) {
  return /^[A-Z][A-Za-z' -]+$/.test(line) && line.split(/\s+/).length <= 4 && !isSectionHeading(line);
}

function isSectionHeading(line: string) {
  const normalized = cleanPdfText(line).toLowerCase();
  return [
    "summary",
    "targeted summary",
    "core skills",
    "skills",
    "technical skills",
    "projects",
    "experience",
    "work experience",
    "education",
    "certifications"
  ].includes(normalized);
}

function normalizeSectionHeading(line: string) {
  const normalized = cleanPdfText(line).toLowerCase();
  if (normalized === "targeted summary") return "SUMMARY";
  if (normalized === "core skills") return "TECHNICAL SKILLS";
  if (normalized === "experience") return "WORK EXPERIENCE";
  return cleanPdfText(line).toUpperCase();
}

function estimateTextWidth(text: string, size: number) {
  return cleanPdfText(text)
    .split("")
    .reduce((width, char) => {
      if ("il.,'|:;!".includes(char)) return width + size * 0.24;
      if ("mwMW@#%&".includes(char)) return width + size * 0.82;
      if (char === " ") return width + size * 0.28;
      if (char >= "A" && char <= "Z") return width + size * 0.58;
      return width + size * 0.49;
    }, 0);
}

function centerX(text: string, size: number) {
  return Math.max(marginX, (pageWidth - estimateTextWidth(text, size)) / 2);
}

function wrapText(text: string, size: number, width: number) {
  const words = cleanPdfText(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (estimateTextWidth(next, size) <= width || !current) {
      current = next;
    } else {
      lines.push(current);
      current = word;
    }
  }

  if (current) lines.push(current);
  return lines;
}

function extractHeader(text: string): ResumeHeader {
  const lines = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map(cleanPdfText);
  const first = lines.findIndex(Boolean);

  if (first >= 0) {
    const name = lines[first];
    const contact = lines[first + 1] ?? "";
    if (isNameLine(name) && isContactLine(contact)) {
      return {
        name,
        contact,
        bodyLines: lines.slice(first + 2)
      };
    }
  }

  return {
    name: "Polished Resume",
    contact: "",
    bodyLines: lines.slice(first < 0 ? 0 : first)
  };
}

function renderTextLine(line: PdfLine) {
  const font = line.font === "bold" ? "F2" : "F1";
  const color = line.color ?? "0.08 0.09 0.09";
  return [`BT`, `${color} rg`, `/${font} ${line.size} Tf`, `1 0 0 1 ${line.x.toFixed(2)} ${line.y.toFixed(2)} Tm`, `(${escapePdfString(line.text)}) Tj`, `ET`].join("\n");
}

function renderRule(y: number) {
  return ["0.16 0.16 0.16 RG", "0.65 w", `${marginX} ${y.toFixed(2)} m`, `${pageWidth - marginX} ${y.toFixed(2)} l`, "S"].join("\n");
}

function renderPageNumber(pageNumber: number) {
  const text = String(pageNumber);
  return renderTextLine({
    text,
    font: "regular",
    size: 7.5,
    x: (pageWidth - estimateTextWidth(text, 7.5)) / 2,
    y: 24,
    color: "0.45 0.47 0.46"
  });
}

function buildContentPages(polishedText: string, sourceResumeText?: string) {
  const polished = extractHeader(polishedText);
  const source = sourceResumeText ? extractHeader(sourceResumeText) : null;
  const header = polished.name === "Polished Resume" && source ? source : polished;
  const bodyLines = polished.name === "Polished Resume" ? polished.bodyLines : polished.bodyLines;

  const pages: string[][] = [[]];
  let y = pageHeight - marginTop;
  let content = pages[0];

  function newPage() {
    pages.push([]);
    content = pages[pages.length - 1];
    y = pageHeight - marginTop;
  }

  function ensureSpace(height: number) {
    if (y - height < marginBottom) newPage();
  }

  function addText(text: string, font: PdfFont, size: number, x: number, lineHeight: number, color?: string) {
    ensureSpace(lineHeight);
    content.push(renderTextLine({ text, font, size, x, y, color }));
    y -= lineHeight;
  }

  function addWrapped(text: string, font: PdfFont, size: number, x: number, width: number, lineHeight: number, color?: string) {
    const wrapped = wrapText(text, size, width);
    ensureSpace(wrapped.length * lineHeight);
    for (const line of wrapped) {
      addText(line, font, size, x, lineHeight, color);
    }
  }

  function addSection(text: string) {
    ensureSpace(26);
    y -= y > pageHeight - marginTop - 20 ? 2 : 8;
    const heading = normalizeSectionHeading(text);
    addText(heading, "bold", 10, marginX, 11.5);
    content.push(renderRule(y + 4.5));
    y -= 3.5;
  }

  function addRoleLine(line: string) {
    const parts = line.split("|").map((part) => cleanPdfText(part)).filter(Boolean);
    const final = parts[parts.length - 1] ?? "";
    const hasRightDate = parts.length >= 2 && /\b(20\d{2}|present|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(final);

    ensureSpace(16);
    if (hasRightDate) {
      const left = parts.slice(0, -1).join(" | ");
      const rightWidth = estimateTextWidth(final, 9.6);
      const leftWidth = contentWidth - rightWidth - 16;
      const leftLines = wrapText(left, 9.6, leftWidth);
      for (const [index, wrappedLeft] of leftLines.entries()) {
        addText(wrappedLeft, "bold", 9.6, marginX, 12.6);
        if (index === 0) {
          content.push(
            renderTextLine({
              text: final,
              font: "bold",
              size: 9.6,
              x: pageWidth - marginX - rightWidth,
              y: y + 12.6
            })
          );
        }
      }
      return;
    }

    addWrapped(line, "bold", 9.6, marginX, contentWidth, 12.6);
  }

  addText(header.name, "bold", 18.5, centerX(header.name, 18.5), 22);
  if (header.contact) {
    for (const line of wrapText(header.contact, 8.5, contentWidth)) {
      addText(line, "regular", 8.5, centerX(line, 8.5), 11, "0.26 0.28 0.28");
    }
  }
  y -= 6;

  for (const rawLine of bodyLines) {
    const line = cleanPdfText(rawLine);
    if (!line) {
      y -= 2.5;
      continue;
    }

    if (isSectionHeading(line)) {
      addSection(line);
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const bulletText = line.replace(/^[-*]\s+/, "");
      addWrapped(`- ${bulletText}`, "regular", bodySize, marginX + 12, contentWidth - 12, bodyLineHeight);
      continue;
    }

    const looksLikeRole = line.includes("|") || /\b(20\d{2}|present|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(line);
    if (looksLikeRole) {
      addRoleLine(line);
    } else {
      addWrapped(line, "regular", bodySize, marginX, contentWidth, bodyLineHeight);
    }
  }

  pages.forEach((page, index) => page.push(renderPageNumber(index + 1)));
  return pages.map((page) => page.join("\n"));
}

function buildPdf(contentPages: string[]) {
  const objects: string[] = [];
  const pageRefs: number[] = [];

  const addObject = (body: string) => {
    objects.push(body);
    return objects.length;
  };

  addObject("<< /Type /Catalog /Pages 2 0 R >>");
  addObject("");
  addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");

  for (const stream of contentPages) {
    const contentRef = addObject(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const pageRef = addObject(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentRef} 0 R >>`
    );
    pageRefs.push(pageRef);
  }

  objects[1] = `<< /Type /Pages /Kids [${pageRefs.map((ref) => `${ref} 0 R`).join(" ")}] /Count ${pageRefs.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, body] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return pdf;
}

export function createResumePdfBlob(polishedText: string, sourceResumeText?: string) {
  const pages = buildContentPages(polishedText, sourceResumeText);
  return new Blob([buildPdf(pages)], { type: "application/pdf" });
}
