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

// --- Helvetica / Helvetica-Bold advance widths (AFM, units per 1000 em) ---
// Real Core14 metrics, so wrapping, centering, and right-aligned dates line up
// instead of relying on a coarse character-class estimate.
const HELV: Record<string, number> = {
  " ": 278, "!": 278, '"': 355, "#": 556, $: 556, "%": 889, "&": 667, "'": 191, "(": 333, ")": 333,
  "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278,
  "0": 556, "1": 556, "2": 556, "3": 556, "4": 556, "5": 556, "6": 556, "7": 556, "8": 556, "9": 556,
  ":": 278, ";": 278, "<": 584, "=": 584, ">": 584, "?": 556, "@": 1015,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500, K: 667, L: 556, M: 833,
  N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  "[": 278, "\\": 278, "]": 278, "^": 469, _: 556, "`": 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222, m: 833,
  n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  "{": 334, "|": 260, "}": 334, "~": 584
};
const HELV_BOLD: Record<string, number> = {
  " ": 278, "!": 333, '"': 474, "#": 556, $: 556, "%": 889, "&": 722, "'": 238, "(": 333, ")": 333,
  "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278,
  "0": 556, "1": 556, "2": 556, "3": 556, "4": 556, "5": 556, "6": 556, "7": 556, "8": 556, "9": 556,
  ":": 333, ";": 333, "<": 584, "=": 584, ">": 584, "?": 611, "@": 975,
  A: 722, B: 722, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 556, K: 722, L: 611, M: 833,
  N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  "[": 333, "\\": 278, "]": 333, "^": 584, _: 556, "`": 333,
  a: 556, b: 611, c: 556, d: 611, e: 556, f: 333, g: 611, h: 611, i: 278, j: 278, k: 556, l: 278, m: 889,
  n: 611, o: 611, p: 611, q: 611, r: 389, s: 556, t: 333, u: 611, v: 556, w: 778, x: 556, y: 556, z: 500,
  "{": 389, "|": 280, "}": 389, "~": 584
};

// WinAnsi high bytes (0x80-0xFF): accented letters fold to their base letter
// (per font); symbols/punctuation use fixed Helvetica metrics.
const FOLD_BYTE: Record<number, string> = {
  0x8a: "S", 0x9a: "s", 0x8c: "O", 0x9c: "o", 0x8e: "Z", 0x9e: "z", 0x9f: "Y",
  0xc0: "A", 0xc1: "A", 0xc2: "A", 0xc3: "A", 0xc4: "A", 0xc5: "A", 0xc7: "C",
  0xc8: "E", 0xc9: "E", 0xca: "E", 0xcb: "E", 0xcc: "I", 0xcd: "I", 0xce: "I", 0xcf: "I",
  0xd1: "N", 0xd2: "O", 0xd3: "O", 0xd4: "O", 0xd5: "O", 0xd6: "O", 0xd8: "O",
  0xd9: "U", 0xda: "U", 0xdb: "U", 0xdc: "U", 0xdd: "Y",
  0xe0: "a", 0xe1: "a", 0xe2: "a", 0xe3: "a", 0xe4: "a", 0xe5: "a", 0xe7: "c",
  0xe8: "e", 0xe9: "e", 0xea: "e", 0xeb: "e", 0xec: "i", 0xed: "i", 0xee: "i", 0xef: "i",
  0xf1: "n", 0xf2: "o", 0xf3: "o", 0xf4: "o", 0xf5: "o", 0xf6: "o", 0xf8: "o",
  0xf9: "u", 0xfa: "u", 0xfb: "u", 0xfc: "u", 0xfd: "y", 0xff: "y"
};
const FIXED_BYTE: Record<number, number> = {
  0x80: 556, 0x82: 222, 0x83: 556, 0x84: 333, 0x85: 1000, 0x86: 556, 0x87: 556, 0x88: 333, 0x89: 1000, 0x8b: 333,
  0x91: 222, 0x92: 222, 0x93: 333, 0x94: 333, 0x95: 350, 0x96: 556, 0x97: 1000, 0x98: 333, 0x99: 1000, 0x9b: 333,
  0xa0: 278, 0xa1: 333, 0xa2: 556, 0xa3: 556, 0xa4: 556, 0xa5: 556, 0xa6: 260, 0xa7: 556, 0xa8: 333, 0xa9: 737,
  0xaa: 370, 0xab: 556, 0xac: 584, 0xad: 333, 0xae: 737, 0xaf: 333, 0xb0: 400, 0xb1: 584, 0xb2: 333, 0xb3: 333,
  0xb4: 333, 0xb5: 556, 0xb6: 537, 0xb7: 278, 0xb8: 333, 0xb9: 333, 0xba: 365, 0xbb: 556, 0xbc: 834, 0xbd: 834,
  0xbe: 834, 0xbf: 611, 0xc6: 1000, 0xd0: 722, 0xd7: 584, 0xde: 667, 0xdf: 611, 0xe6: 889, 0xf0: 556, 0xf7: 584,
  0xfe: 556
};

function buildWidths(ascii: Record<string, number>): number[] {
  const widths = new Array<number>(256).fill(556);
  for (const [ch, value] of Object.entries(ascii)) widths[ch.charCodeAt(0)] = value;
  for (let code = 0x80; code <= 0xff; code += 1) {
    if (FOLD_BYTE[code]) widths[code] = ascii[FOLD_BYTE[code]] ?? 556;
    else if (FIXED_BYTE[code] != null) widths[code] = FIXED_BYTE[code];
  }
  return widths;
}
const HELV_W = buildWidths(HELV);
const HELV_BOLD_W = buildWidths(HELV_BOLD);

// Unicode -> WinAnsi byte for the 0x80-0x9F range (where WinAnsi != Latin-1).
const TO_WINANSI: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
  0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91,
  0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98,
  0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f
};

// Map arbitrary Unicode text to a WinAnsi byte string (each char code <= 0xFF),
// so accented names like "José" survive instead of being stripped. Characters
// outside WinAnsi are transliterated to ASCII (NFKD) when possible, else dropped.
function toWinAnsi(text: string): string {
  let out = "";
  for (const ch of String(text).normalize("NFC")) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0x20 && cp <= 0x7e) out += ch;
    else if (cp >= 0xa0 && cp <= 0xff) out += String.fromCharCode(cp);
    else if (TO_WINANSI[cp] != null) out += String.fromCharCode(TO_WINANSI[cp]);
    else {
      const ascii = ch.normalize("NFKD").replace(/[̀-ͯ]/g, "");
      for (const a of ascii) {
        const code = a.charCodeAt(0);
        if (code >= 0x20 && code <= 0x7e) out += a;
      }
    }
  }
  return out;
}

function widthOfWinAnsi(winansi: string, size: number, font: PdfFont): number {
  const widths = font === "bold" ? HELV_BOLD_W : HELV_W;
  let total = 0;
  for (let i = 0; i < winansi.length; i += 1) total += widths[winansi.charCodeAt(i) & 0xff];
  return (total * size) / 1000;
}

function cleanPdfText(text: string) {
  return text
    .replace(/[•]/g, "-")
    .replace(/[–—]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapePdfString(text: string) {
  return toWinAnsi(cleanPdfText(text))
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function isContactLine(line: string) {
  return /@|https?:\/\/|github\.com|linkedin\.com|\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/i.test(line);
}

function isNameLine(line: string) {
  return (
    /^[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ' .-]+$/.test(line) &&
    line.split(/\s+/).length <= 4 &&
    !isSectionHeading(line)
  );
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

function estimateTextWidth(text: string, size: number, font: PdfFont = "regular") {
  return widthOfWinAnsi(toWinAnsi(cleanPdfText(text)), size, font);
}

function centerX(text: string, size: number, font: PdfFont = "regular") {
  return Math.max(marginX, (pageWidth - estimateTextWidth(text, size, font)) / 2);
}

function wrapText(text: string, size: number, width: number, font: PdfFont = "regular") {
  const words = cleanPdfText(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (estimateTextWidth(next, size, font) <= width || !current) {
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
  const bodyLines = polished.bodyLines;

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
    const wrapped = wrapText(text, size, width, font);
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
      const rightWidth = estimateTextWidth(final, 9.6, "bold");
      const leftWidth = contentWidth - rightWidth - 16;
      const leftLines = wrapText(left, 9.6, leftWidth, "bold");
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

  addText(header.name, "bold", 18.5, centerX(header.name, 18.5, "bold"), 22);
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
  addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");

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
  const pdf = buildPdf(pages);
  // The PDF body holds WinAnsi (single-byte) text, so emit each char code as one
  // byte. Letting Blob UTF-8 encode it would corrupt high bytes (accents) and
  // shift every xref offset, producing an invalid file.
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i += 1) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return new Blob([bytes], { type: "application/pdf" });
}
