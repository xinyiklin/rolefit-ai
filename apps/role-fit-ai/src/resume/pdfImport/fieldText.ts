// Turns the pieces collected for one document field back into field text.
// Text is only ever re-joined, never edited: whitespace is collapsed, words
// split by a line-end hyphen are joined (and reported), and bold/italic runs
// become the engine's inline marks.

import { needsSpace, slicePiece, type LinePiece } from "./layoutLines.ts";

export type FieldDraft = {
  // One entry per source line, in reading order.
  lines: LinePiece[][];
  marks: boolean;
};

export type RenderedField = { text: string; joinedHyphen: boolean };

function renderLine(pieces: readonly LinePiece[], marks: boolean): string {
  let out = "";
  let bold = false;
  let italic = false;
  pieces.forEach((current, index) => {
    const wantBold = marks && current.span.bold;
    const wantItalic = marks && current.span.italic;
    if (italic && (!wantItalic || bold !== wantBold)) {
      out += "</i>";
      italic = false;
    }
    if (bold && !wantBold) {
      out += "</b>";
      bold = false;
    }
    if (index > 0 && needsSpace(pieces[index - 1], current)) out += " ";
    if (!bold && wantBold) {
      out += "<b>";
      bold = true;
    }
    if (!italic && wantItalic) {
      out += "<i>";
      italic = true;
    }
    out += current.text.replace(/\s+/g, " ");
  });
  if (italic) out += "</i>";
  if (bold) out += "</b>";
  return out.trim();
}

export function renderField(field: FieldDraft): RenderedField {
  let text = "";
  let joinedHyphen = false;
  for (const line of field.lines) {
    const rendered = renderLine(line, field.marks);
    if (!rendered) continue;
    if (!text) {
      text = rendered;
    } else if (/\p{L}-(?:<\/[bi]>)*$/u.test(text)) {
      text += rendered;
      joinedHyphen = true;
    } else {
      text += ` ${rendered}`;
    }
  }
  return { text, joinedHyphen };
}

export function plainField(pieces: readonly LinePiece[]): FieldDraft {
  return { lines: [[...pieces]], marks: false };
}

export function markedField(pieces: readonly LinePiece[]): FieldDraft {
  return { lines: [[...pieces]], marks: true };
}

// Splits pieces wherever a spaced separator glyph (" | ", " • ", " · ") stands
// between items. Separators come back separately so the caller can account for
// every consumed character.
const SEPARATOR_CHARS = "|•·◦▪∙";
const SEPARATOR_RE = new RegExp(`(^|\\s)[${SEPARATOR_CHARS}](?=\\s|$)`, "gu");

function isSeparatorText(text: string): boolean {
  return text.length > 0 && [...text.trim()].every((char) => SEPARATOR_CHARS.includes(char));
}

export function splitOnSeparators(pieces: readonly LinePiece[]): { parts: LinePiece[][]; separators: LinePiece[] } {
  const parts: LinePiece[][] = [[]];
  const separators: LinePiece[] = [];
  for (const current of pieces) {
    if (isSeparatorText(current.text)) {
      separators.push(current);
      if (parts[parts.length - 1].length) parts.push([]);
      continue;
    }
    let cursor = current.start;
    SEPARATOR_RE.lastIndex = 0;
    const local = current.text;
    for (let match = SEPARATOR_RE.exec(local); match; match = SEPARATOR_RE.exec(local)) {
      const glyphStart = current.start + match.index + match[1].length;
      if (glyphStart > cursor) parts[parts.length - 1].push(slicePiece(current.span, cursor, glyphStart));
      separators.push(slicePiece(current.span, glyphStart, glyphStart + 1));
      parts.push([]);
      cursor = glyphStart + 1;
    }
    if (cursor < current.end) parts[parts.length - 1].push(slicePiece(current.span, cursor, current.end));
  }
  return {
    parts: parts
      .map((part) => part.filter((member) => member.text.trim()))
      .filter((part) => part.length),
    separators
  };
}
