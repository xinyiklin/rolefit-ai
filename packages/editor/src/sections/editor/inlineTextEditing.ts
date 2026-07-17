// Pure editing math for the typeset editor (no DOM, no React): the mapping
// between a field's VALUE (inline-marks string, ASCII ligatures, real
// whitespace) and its DISPLAY form (what the engine paints: tags stripped,
// --- → — / -- → – / ' → ’, horizontal whitespace collapsed, and literal
// hard breaks preserved as "\n"). Every edit is expressed in display coordinates
// (where the caret lives) and applied to the value without losing marks,
// ligature sources, or preserved outer whitespace.
//
// The display model mirrors measure.ts exactly: segmentsFromInlineMarks's tag
// grammar (<b>/<i>/<u>, unclosed tolerated) and texLigatures's sequential
// replaces (which a longest-match walker reproduces for any hyphen run).

import type { FieldSrc } from "@typeset/engine/typeset/types.ts";
import type { DocumentFontFamily } from "@typeset/engine/typeset/fontRegistry.ts";
import type { FieldAlignment } from "@typeset/engine/lib/inlineMarksText.ts";
import { automaticLinkHref, decodeLinkHref, encodeLinkHref } from "@typeset/engine/lib/links.ts";

type DisplayChar = {
  // The value substring this display char covers ("---" for "—", a whole
  // whitespace run for " ", one char otherwise).
  raw: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  fontFamily: DocumentFontFamily | null;
  fontSizePt: number | null;
  alignment: FieldAlignment | null;
  linkHref: string | null;
  linkSuppressed: boolean;
};

export type TypingFormat = Pick<
  DisplayChar,
  "bold" | "italic" | "underline" | "fontFamily" | "fontSizePt" | "alignment"
>;

export type DisplayMap = {
  display: string;
  chars: DisplayChar[];
  // Value index where chars[i].raw starts (tags occupy value space too).
  valueStart: number[];
  // Outer whitespace stripped from the display but preserved in the value.
  prefix: string;
  suffix: string;
};

export type TypesetSelection = {
  src: FieldSrc;
  key: string;
  map: DisplayMap;
  value: string;
  dStart: number;
  dEnd: number;
};

const TAG_RE = /^<\/?(b|i|u|nolink)>|^<link=([^>\s]+)>|^<\/link>|^<font=(latin-modern|source-serif|source-sans)>|^<\/font>|^<size=(\d+(?:\.\d+)?)>|^<\/size>|^<align=(left|center|right|justify)>|^<\/align>/i;

// ---- value → display ----

export function buildDisplayMap(value: string, opts?: { uppercase?: boolean; preserveWhitespace?: boolean }): DisplayMap {
  // Single-line fields render their value verbatim (white-space: pre), so their
  // display keeps every space — the caret can sit between repeated spaces and
  // after a trailing one (word-processor spacing). Wrapping paragraphs (bullets)
  // still collapse to the engine's glue model, so their display collapses too.
  const preserveWhitespace = opts?.preserveWhitespace ?? false;
  const chars: DisplayChar[] = [];
  const valueStart: number[] = [];
  let display = "";
  let prefix = "";
  let bold = 0;
  let italic = 0;
  let underline = 0;
  const fontStack: DocumentFontFamily[] = [];
  const sizeStack: number[] = [];
  const alignmentStack: FieldAlignment[] = [];
  const linkStack: Array<string | null> = [];
  let linkSuppressed = 0;
  let i = 0;
  while (i < value.length) {
    const tag = TAG_RE.exec(value.slice(i));
    if (tag) {
      if (tag[5]) alignmentStack.push(tag[5].toLowerCase() as FieldAlignment);
      else if (tag[3]) fontStack.push(tag[3] as DocumentFontFamily);
      else if (tag[4]) {
        const size = Number(tag[4]);
        if (Number.isFinite(size) && size >= 6 && size <= 48) sizeStack.push(size);
      } else if (tag[2]) linkStack.push(decodeLinkHref(tag[2]));
      else if (tag[0].toLowerCase() === "</font>") fontStack.pop();
      else if (tag[0].toLowerCase() === "</size>") sizeStack.pop();
      else if (tag[0].toLowerCase() === "</align>") alignmentStack.pop();
      else if (tag[0].toLowerCase() === "</link>") linkStack.pop();
      else {
        const name = tag[1].toLowerCase();
        const closing = tag[0][1] === "/";
        const delta = closing ? -1 : 1;
        if (name === "b") bold = Math.max(0, bold + delta);
        else if (name === "i") italic = Math.max(0, italic + delta);
        else if (name === "u") underline = Math.max(0, underline + delta);
        else linkSuppressed = Math.max(0, linkSuppressed + delta);
      }
      i += tag[0].length;
      continue;
    }
    const flags = {
      bold: bold > 0,
      italic: italic > 0,
      underline: underline > 0,
      fontFamily: fontStack[fontStack.length - 1] ?? null,
      fontSizePt: sizeStack[sizeStack.length - 1] ?? null,
      alignment: alignmentStack[alignmentStack.length - 1] ?? null,
      linkHref: linkStack[linkStack.length - 1] ?? null,
      linkSuppressed: linkSuppressed > 0
    };
    const ch = value[i];
    if (ch === "\n" || ch === "\r") {
      // The line breaker preserves every authored newline. Fold horizontal
      // space immediately around it into the newline's raw source because TeX
      // discards that glue at line edges, while serialization must retain it.
      let rawPrefix = "";
      let start = i;
      if (display.endsWith(" ")) {
        rawPrefix = chars[chars.length - 1].raw;
        start = valueStart[valueStart.length - 1];
        chars.pop();
        valueStart.pop();
        display = display.slice(0, -1);
      } else if (!display.length && prefix) {
        rawPrefix = prefix;
        start = 0;
        prefix = "";
      }
      let j = ch === "\r" && value[i + 1] === "\n" ? i + 2 : i + 1;
      while (j < value.length && /[^\S\r\n]/.test(value[j])) j += 1;
      display += "\n";
      chars.push({ raw: rawPrefix + value.slice(i, j), ...flags });
      valueStart.push(start);
      i = j;
      continue;
    }
    if (/[^\S\r\n]/.test(ch)) {
      // Consume one horizontal-whitespace run (tags inside a run would end it).
      let j = i;
      while (j < value.length && /[^\S\r\n]/.test(value[j])) j += 1;
      const raw = value.slice(i, j);
      if (!display.length) {
        // Leading whitespace: display drops it; the value keeps it (prefix).
        prefix += raw;
      } else if (preserveWhitespace) {
        // Word-processor spacing: every whitespace character is its own display
        // position (no collapse), so the caret can sit between repeated spaces.
        for (let k = 0; k < raw.length; k += 1) {
          display += " ";
          chars.push({ raw: raw[k], ...flags });
          valueStart.push(i + k);
        }
      } else if (display[display.length - 1] !== " ") {
        display += " ";
        chars.push({ raw, ...flags });
        valueStart.push(i);
      } else {
        // Extend the previous space's raw so nothing is lost on serialize.
        chars[chars.length - 1] = { ...chars[chars.length - 1], raw: chars[chars.length - 1].raw + raw };
      }
      i = j;
      continue;
    }
    let raw: string;
    let shown: string;
    if (value.startsWith("---", i)) {
      raw = "---";
      shown = "—";
    } else if (value.startsWith("--", i)) {
      raw = "--";
      shown = "–";
    } else if (ch === "'") {
      raw = "'";
      shown = "’";
    } else {
      raw = ch;
      shown = ch;
    }
    if (opts?.uppercase) shown = shown.toUpperCase().slice(0, 1) || shown;
    display += shown;
    chars.push({ raw, ...flags });
    valueStart.push(i);
    i += raw.length;
  }
  // Collapsing fields trim the trailing display space into suffix (leading
  // whitespace already went to prefix). Whitespace-preserving fields keep it —
  // the DOM renders it, so the caret can sit after it.
  let suffix = "";
  if (!preserveWhitespace && chars.length && display[display.length - 1] === " ") {
    suffix = chars[chars.length - 1].raw;
    chars.pop();
    valueStart.pop();
    display = display.slice(0, -1);
  }
  return { display, chars, valueStart, prefix, suffix };
}

// ---- display chars → value (canonical <b><i><u> nesting; flags-driven) ----

function serializeChars(prefix: string, chars: DisplayChar[], suffix: string, boundary: number): { value: string; boundaryIndex: number } {
  let value = prefix;
  let boundaryIndex = -1;
  let open: Pick<DisplayChar, "bold" | "italic" | "underline" | "fontFamily" | "fontSizePt" | "alignment" | "linkHref" | "linkSuppressed"> = {
    bold: false,
    italic: false,
    underline: false,
    fontFamily: null,
    fontSizePt: null,
    alignment: null,
    linkHref: null,
    linkSuppressed: false
  };
  const closeAll = () => {
    if (open.underline) value += "</u>";
    if (open.italic) value += "</i>";
    if (open.bold) value += "</b>";
    if (open.fontFamily) value += "</font>";
    if (open.fontSizePt) value += "</size>";
    if (open.linkHref) value += "</link>";
    if (open.linkSuppressed) value += "</nolink>";
    if (open.alignment) value += "</align>";
    open = { bold: false, italic: false, underline: false, fontFamily: null, fontSizePt: null, alignment: null, linkHref: null, linkSuppressed: false };
  };
  chars.forEach((c, idx) => {
    if (idx === boundary) boundaryIndex = value.length;
    if (
      c.bold !== open.bold ||
      c.italic !== open.italic ||
      c.underline !== open.underline ||
      c.fontFamily !== open.fontFamily ||
      c.fontSizePt !== open.fontSizePt ||
      c.alignment !== open.alignment ||
      c.linkHref !== open.linkHref ||
      c.linkSuppressed !== open.linkSuppressed
    ) {
      closeAll();
      if (c.alignment) value += `<align=${c.alignment}>`;
      if (c.linkSuppressed) value += "<nolink>";
      if (c.linkHref) value += `<link=${encodeLinkHref(c.linkHref)}>`;
      if (c.fontSizePt) value += `<size=${c.fontSizePt}>`;
      if (c.fontFamily) value += `<font=${c.fontFamily}>`;
      if (c.bold) value += "<b>";
      if (c.italic) value += "<i>";
      if (c.underline) value += "<u>";
      open = {
        bold: c.bold,
        italic: c.italic,
        underline: c.underline,
        fontFamily: c.fontFamily,
        fontSizePt: c.fontSizePt,
        alignment: c.alignment,
        linkHref: c.linkHref,
        linkSuppressed: c.linkSuppressed
      };
    }
    value += c.raw;
  });
  if (boundary >= chars.length) boundaryIndex = value.length;
  closeAll();
  value += suffix;
  if (boundaryIndex < 0) boundaryIndex = value.length - suffix.length;
  return { value, boundaryIndex };
}

// Replace display range [dStart, dEnd) with plain text; returns the new value
// and the caret's VALUE index (convert back to display with a fresh map, so
// newly-formed ligatures — e.g. typing the second "-" of "--" — land right).
export function applyEdit(
  map: DisplayMap,
  dStart: number,
  dEnd: number,
  insert: string,
  typingFormat?: Partial<TypingFormat>
): { value: string; caretValueIndex: number } {
  const inherit = map.chars[dStart - 1] ?? map.chars[dStart] ?? {
    bold: false,
    italic: false,
    underline: false,
    fontFamily: null,
    fontSizePt: null,
    alignment: null,
    linkHref: null,
    linkSuppressed: false
  };
  const inserted: DisplayChar[] = Array.from(insert).map((ch) => ({
    raw: ch,
    bold: inherit.bold,
    italic: inherit.italic,
    underline: inherit.underline,
    fontFamily: inherit.fontFamily,
    fontSizePt: inherit.fontSizePt,
    alignment: inherit.alignment,
    linkHref: inherit.linkHref,
    linkSuppressed: inherit.linkSuppressed,
    ...typingFormat
  }));
  // buildDisplayMap trims one trailing display space into `suffix`, so inserting
  // at the field end otherwise drops the text BEFORE that space (…END + " " + Z
  // → "ENDZ"). When we insert at the end and a trailing-space suffix exists,
  // revive it as a real space ahead of the new text so it survives ("END Z").
  const reviveSuffix =
    insert.length > 0 && dStart === map.chars.length && dEnd === map.chars.length && map.suffix.length > 0;
  const leading: DisplayChar[] = reviveSuffix
    ? [{
        raw: map.suffix,
        bold: inherit.bold,
        italic: inherit.italic,
        underline: inherit.underline,
        fontFamily: inherit.fontFamily,
        fontSizePt: inherit.fontSizePt,
        alignment: inherit.alignment,
        linkHref: null,
        linkSuppressed: false
      }]
    : [];
  const suffix = reviveSuffix ? "" : map.suffix;
  const chars = [...map.chars.slice(0, dStart), ...leading, ...inserted, ...map.chars.slice(dEnd)];
  return withBoundary(serializeChars(map.prefix, chars, suffix, dStart + leading.length + inserted.length));
}

// Deleting text leaves the caret with the typography of the final removed
// character. This mirrors a word processor: deleting the last styled glyph in
// a run must not also delete the style that the next typed glyph should use.
export function typingFormatForDeletedRange(
  map: DisplayMap,
  dStart: number,
  dEnd: number
): TypingFormat | null {
  if (dEnd <= dStart) return null;
  const char = map.chars[Math.min(dEnd, map.chars.length) - 1];
  if (!char) return null;
  return {
    bold: char.bold,
    italic: char.italic,
    underline: char.underline,
    fontFamily: char.fontFamily,
    fontSizePt: char.fontSizePt,
    alignment: char.alignment
  };
}

export function toggleMark(map: DisplayMap, dStart: number, dEnd: number, mark: "bold" | "italic" | "underline"): { value: string; caretValueIndex: number } {
  const range = map.chars.slice(dStart, dEnd);
  const allSet = range.length > 0 && range.every((c) => c[mark]);
  const chars = map.chars.map((c, i) => (i >= dStart && i < dEnd ? { ...c, [mark]: !allSet } : c));
  return withBoundary(serializeChars(map.prefix, chars, map.suffix, dEnd));
}

export function setFontFamily(
  map: DisplayMap,
  dStart: number,
  dEnd: number,
  fontFamily: DocumentFontFamily
): { value: string; caretValueIndex: number } {
  const chars = map.chars.map((char, index) =>
    index >= dStart && index < dEnd ? { ...char, fontFamily } : char
  );
  return withBoundary(serializeChars(map.prefix, chars, map.suffix, dEnd));
}

export function setFontSize(
  map: DisplayMap,
  dStart: number,
  dEnd: number,
  fontSizePt: number
): { value: string; caretValueIndex: number } {
  const size = Math.min(48, Math.max(6, Math.round(fontSizePt * 10) / 10));
  const chars = map.chars.map((char, index) =>
    index >= dStart && index < dEnd ? { ...char, fontSizePt: size } : char
  );
  return withBoundary(serializeChars(map.prefix, chars, map.suffix, dEnd));
}

export function setAlignment(
  map: DisplayMap,
  alignment: FieldAlignment
): { value: string; caretValueIndex: number } {
  const chars = map.chars.map((char) => ({ ...char, alignment }));
  return withBoundary(serializeChars(map.prefix, chars, map.suffix, chars.length));
}

export function setLink(
  map: DisplayMap,
  dStart: number,
  dEnd: number,
  href: string
): { value: string; caretValueIndex: number } {
  const chars = map.chars.map((char, index) =>
    index >= dStart && index < dEnd ? { ...char, linkHref: href, linkSuppressed: false } : char
  );
  return withBoundary(serializeChars(map.prefix, chars, map.suffix, dEnd));
}

export function removeLink(
  map: DisplayMap,
  dStart: number,
  dEnd: number
): { value: string; caretValueIndex: number } {
  const chars = map.chars.map((char, index) =>
    index >= dStart && index < dEnd ? { ...char, linkHref: null, linkSuppressed: true } : char
  );
  return withBoundary(serializeChars(map.prefix, chars, map.suffix, dEnd));
}

// Replace display range [dStart, dEnd) with `text`, wrapping the inserted run in
// a link so the visible text can differ from the URL (the two-field editor). The
// inserted chars inherit typography from the insertion boundary, like typing.
export function replaceWithLink(
  map: DisplayMap,
  dStart: number,
  dEnd: number,
  text: string,
  href: string
): { value: string; caretValueIndex: number } {
  const inherit = map.chars[dStart - 1] ?? map.chars[dStart] ?? {
    bold: false,
    italic: false,
    underline: false,
    fontFamily: null,
    fontSizePt: null,
    alignment: null
  };
  const inserted: DisplayChar[] = Array.from(text).map((ch) => ({
    raw: ch,
    bold: inherit.bold,
    italic: inherit.italic,
    underline: inherit.underline,
    fontFamily: inherit.fontFamily,
    fontSizePt: inherit.fontSizePt,
    alignment: inherit.alignment,
    linkHref: href,
    linkSuppressed: false
  }));
  const chars = [...map.chars.slice(0, dStart), ...inserted, ...map.chars.slice(dEnd)];
  return withBoundary(serializeChars(map.prefix, chars, map.suffix, dStart + inserted.length));
}

// The contiguous run of an EXPLICIT link under a collapsed caret, if any. The
// char to the LEFT wins (so a caret at a link's trailing edge still targets it),
// falling back to the char to the right (caret at the leading edge). Lets the
// editor edit/remove an existing link without first selecting its whole span.
export function explicitLinkRunAt(
  map: DisplayMap,
  index: number
): { start: number; end: number; href: string } | null {
  const chars = map.chars;
  const leftHref = index > 0 ? chars[index - 1]?.linkHref ?? null : null;
  const rightHref = index < chars.length ? chars[index]?.linkHref ?? null : null;
  const href = leftHref ?? rightHref;
  if (!href) return null;
  let start = leftHref === href ? index - 1 : index;
  let end = start + 1;
  while (start > 0 && chars[start - 1]?.linkHref === href) start -= 1;
  while (end < chars.length && chars[end]?.linkHref === href) end += 1;
  return { start, end, href };
}

// The auto-detected (URL/email) word around a collapsed caret. Returns the
// word's display range and href only when the caret sits INSIDE the word but not
// at its trailing edge — a caret at the trailing edge means the word is still
// being typed, so it should not yet resolve to a link (deferred auto-linking).
export function autoLinkWordAt(map: DisplayMap, index: number): { start: number; end: number; href: string } | null {
  const isBoundary = (i: number) => {
    const c = map.display[i];
    return c === undefined || c === " " || c === "\n";
  };
  let start = index;
  let end = index;
  while (start > 0 && !isBoundary(start - 1)) start -= 1;
  while (end < map.chars.length && !isBoundary(end)) end += 1;
  if (end <= start || index >= end) return null;
  if (map.chars.slice(start, end).some((c) => c.linkSuppressed)) return null;
  const href = automaticLinkHref(map.display.slice(start, end));
  return href ? { start, end, href } : null;
}

const isDisplayBoundary = (display: string, i: number) => {
  const c = display[i];
  return c === undefined || c === " " || c === "\n";
};

// The FULL link run (explicit or auto-detected) that a selection/caret falls
// within, so link edits act on the whole link even from a partial selection.
// An explicit link expands across every char sharing its href; an auto link
// expands to the whole URL/email word. Null when the range isn't inside a link.
export function expandToLinkRun(
  map: DisplayMap,
  dStart: number,
  dEnd: number
): { start: number; end: number; href: string } | null {
  const chars = map.chars;
  let href: string | null = null;
  for (let i = dStart; i < dEnd && !href; i += 1) href = chars[i]?.linkHref ?? null;
  if (!href) href = (dStart < chars.length ? chars[dStart]?.linkHref : null) ?? (dStart > 0 ? chars[dStart - 1]?.linkHref : null) ?? null;
  if (href) {
    let start = dStart;
    let end = Math.max(dEnd, dStart);
    while (start > 0 && chars[start - 1]?.linkHref === href) start -= 1;
    while (start < chars.length && chars[start]?.linkHref !== href) start += 1;
    while (end < chars.length && chars[end]?.linkHref === href) end += 1;
    return start < end ? { start, end, href } : null;
  }
  // Auto-detected: expand to the single word spanning the selection.
  let start = dStart;
  let end = Math.max(dEnd, dStart);
  while (start > 0 && !isDisplayBoundary(map.display, start - 1)) start -= 1;
  while (end < chars.length && !isDisplayBoundary(map.display, end)) end += 1;
  if (end <= start) return null;
  if (chars.slice(start, end).some((c) => c.linkSuppressed)) return null;
  const auto = automaticLinkHref(map.display.slice(start, end));
  return auto ? { start, end, href: auto } : null;
}

// The auto-detectable URL/email word whose TRAILING edge is exactly the caret —
// i.e. the word currently being typed. Used to suppress its auto-link in the
// render until the word is completed (a space follows or the caret leaves).
export function trailingLinkWordAt(map: DisplayMap, index: number): { start: number; end: number } | null {
  if (index < map.chars.length && !isDisplayBoundary(map.display, index)) return null;
  let start = index;
  while (start > 0 && !isDisplayBoundary(map.display, start - 1)) start -= 1;
  if (start >= index) return null;
  if (map.chars.slice(start, index).some((c) => c.linkSuppressed)) return null;
  return automaticLinkHref(map.display.slice(start, index)) ? { start, end: index } : null;
}

// A copy of the field value with [dStart, dEnd) marked <nolink>, so the render
// suppresses its auto-link without touching the stored data.
export function suppressAutoLink(map: DisplayMap, dStart: number, dEnd: number): string {
  const chars = map.chars.map((char, index) =>
    index >= dStart && index < dEnd ? { ...char, linkSuppressed: true } : char
  );
  return serializeChars(map.prefix, chars, map.suffix, dEnd).value;
}

// Strip character formatting (bold/italic/underline, font family, and size)
// from the range, matching a word processor's "Clear formatting". Links and
// paragraph alignment are intentionally preserved.
export function clearFormatting(
  map: DisplayMap,
  dStart: number,
  dEnd: number
): { value: string; caretValueIndex: number } {
  const chars = map.chars.map((char, index) =>
    index >= dStart && index < dEnd
      ? { ...char, bold: false, italic: false, underline: false, fontFamily: null, fontSizePt: null }
      : char
  );
  return withBoundary(serializeChars(map.prefix, chars, map.suffix, dEnd));
}

// True when any character in the range carries strippable formatting, so the UI
// can disable "Clear formatting" when there is nothing to clear.
export function hasClearableFormatting(map: DisplayMap, dStart: number, dEnd: number): boolean {
  for (let index = dStart; index < dEnd; index += 1) {
    const char = map.chars[index];
    if (char && (char.bold || char.italic || char.underline || char.fontFamily !== null || char.fontSizePt !== null)) {
      return true;
    }
  }
  return false;
}

function withBoundary(res: { value: string; boundaryIndex: number }): { value: string; caretValueIndex: number } {
  return { value: res.value, caretValueIndex: res.boundaryIndex };
}

// Split a display boundary into two mark-balanced value halves (Enter).
export function splitValueAt(map: DisplayMap, d: number): { before: string; after: string } {
  const before = serializeChars(map.prefix, map.chars.slice(0, d), "", 0).value;
  const after = serializeChars("", map.chars.slice(d), map.suffix, 0).value;
  return { before, after };
}

// Value boundary → display boundary (smallest display index at/after it).
export function displayIndexForValueIndex(map: DisplayMap, valueIndex: number): number {
  for (let i = 0; i < map.valueStart.length; i += 1) {
    if (map.valueStart[i] >= valueIndex) return i;
  }
  return map.chars.length;
}
