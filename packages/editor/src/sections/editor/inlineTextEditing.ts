// Pure editing math for the typeset editor (no DOM, no React): the mapping
// between a field's VALUE (inline-marks string, ASCII ligatures, real
// whitespace) and its DISPLAY form (what the engine paints: tags stripped,
// --- → — / -- → – / ' → ’, authored horizontal whitespace preserved, and
// literal hard breaks preserved as "\n"). Every edit is expressed in display coordinates
// (where the caret lives) and applied to the value without losing marks,
// ligature sources, or preserved outer whitespace.
//
// The display model mirrors measure.ts exactly: segmentsFromInlineMarks's tag
// grammar (<b>/<i>/<u>, unclosed tolerated) and texLigatures's sequential
// replaces (which a longest-match walker reproduces for any hyphen run).

import type { FieldSrc } from "@typeset/engine/typeset/types.ts";
import type { DocumentFontFamily } from "@typeset/engine/typeset/fontRegistry.ts";
import { FONT_FAMILY_ALTERNATION } from "@typeset/engine/lib/fontFamilies.ts";
import {
  inlineFontSizePt,
  isInlineFontSizePt,
  type FieldAlignment
} from "@typeset/engine/lib/inlineMarksText.ts";
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

// The anchored counterpart of INLINE_MARK_TAG_PATTERN: same grammar, but with
// capture groups this walker needs and ^-anchored so it can step the value one
// tag at a time. The font alternation comes from the shared family list, so a
// new family parses in both automata or in neither — it used to be spelled out
// here as well, which meant a family could serialize into a value that the
// editor's own display map then failed to recognise.
const TAG_RE = new RegExp(
  `^<\\/?(b|i|u|nolink)>|^<link=([^>\\s]+)>|^<\\/link>|^<font=(${FONT_FAMILY_ALTERNATION})>|^<\\/font>|^<size=(\\d+(?:\\.\\d+)?)>|^<\\/size>|^<align=(left|center|right|justify)>|^<\\/align>`,
  "i"
);

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
        if (isInlineFontSizePt(size)) sizeStack.push(size);
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
      // The line breaker preserves every authored newline. Legacy collapsing
      // callers fold horizontal space around it into the newline's raw source;
      // word-processor callers keep those spaces as caret-bearing characters.
      let rawPrefix = "";
      let start = i;
      if (!preserveWhitespace && display.endsWith(" ")) {
        rawPrefix = chars[chars.length - 1].raw;
        start = valueStart[valueStart.length - 1];
        chars.pop();
        valueStart.pop();
        display = display.slice(0, -1);
      } else if (!preserveWhitespace && !display.length && prefix) {
        rawPrefix = prefix;
        start = 0;
        prefix = "";
      }
      let j = ch === "\r" && value[i + 1] === "\n" ? i + 2 : i + 1;
      if (!preserveWhitespace) {
        while (j < value.length && /[^\S\r\n]/.test(value[j])) j += 1;
      }
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
      if (!display.length && !preserveWhitespace) {
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
  // Character formatting is inherited from the LEFT, the way typing works. Link
  // state is not: a word processor does not extend a hyperlink when you type at
  // its edge. So the link is inherited only when the insertion point is strictly
  // INSIDE one run — the characters on both sides of the edit agree.
  //
  // Inheriting from the left alone meant typing right after a link swallowed the
  // rest of the sentence into it, and a <nolink> suppression leaked into
  // everything typed after a de-linked URL, permanently killing auto-linking
  // from that point on.
  const after = map.chars[dEnd] ?? null;
  const inside = Boolean(after && map.chars[dStart - 1]);
  const linkHref = inside && inherit.linkHref === after!.linkHref ? inherit.linkHref : null;
  const linkSuppressed = Boolean(inside && inherit.linkSuppressed && after!.linkSuppressed);
  const inserted: DisplayChar[] = Array.from(insert).map((ch) => ({
    raw: ch,
    bold: inherit.bold,
    italic: inherit.italic,
    underline: inherit.underline,
    fontFamily: inherit.fontFamily,
    fontSizePt: inherit.fontSizePt,
    alignment: inherit.alignment,
    linkHref,
    linkSuppressed,
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

// A mark-balanced fragment for the selected display range. The custom
// clipboard transport stores this value alongside text/plain so paste inside
// either host can restore supported font, size, emphasis, link, and alignment
// runs without trusting browser-generated editing markup.
export function inlineFragmentForRange(
  map: DisplayMap,
  dStart: number,
  dEnd: number
): string {
  return serializeChars("", map.chars.slice(dStart, dEnd), "", 0).value;
}

// Replace a display range with a mark-balanced fragment created above (or
// sanitized from clipboard HTML). Unlike applyEdit, the fragment keeps its own
// per-character formatting instead of inheriting one typing format.
export function applyInlineFragment(
  map: DisplayMap,
  dStart: number,
  dEnd: number,
  fragmentValue: string,
  singleLine = false
): { value: string; caretValueIndex: number } {
  const fragment = buildDisplayMap(fragmentValue, { preserveWhitespace: true });
  const inserted = singleLine
    ? fragment.chars.map((char) => ({
        ...char,
        raw: char.raw.replace(/\r?\n/g, " ")
      }))
    : fragment.chars;
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
  const reviveSuffix =
    inserted.length > 0 &&
    dStart === map.chars.length &&
    dEnd === map.chars.length &&
    map.suffix.length > 0;
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
  const chars = [
    ...map.chars.slice(0, dStart),
    ...leading,
    ...inserted,
    ...map.chars.slice(dEnd)
  ];
  return withBoundary(
    serializeChars(
      map.prefix,
      chars,
      suffix,
      dStart + leading.length + inserted.length
    )
  );
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

// `on` forces the resulting state. A selection that crosses fields decides the
// direction once for the whole selection, so partially-marked fields cannot
// each flip a different way.
export function toggleMark(
  map: DisplayMap,
  dStart: number,
  dEnd: number,
  mark: "bold" | "italic" | "underline",
  on?: boolean
): { value: string; caretValueIndex: number } {
  const range = map.chars.slice(dStart, dEnd);
  const next = on ?? !(range.length > 0 && range.every((c) => c[mark]));
  const chars = map.chars.map((c, i) => (i >= dStart && i < dEnd ? { ...c, [mark]: next } : c));
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
  const size = inlineFontSizePt(fontSizePt);
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
    // Anchor on a character that actually carries this href, then expand across
    // its CONTIGUOUS run only. Expanding from the selection's own bounds let a
    // selection touching two different links return a range labelled with the
    // first link's href but reaching into the second, so Remove and Apply
    // rewrote the neighbouring link's text. A selection spanning two links now
    // resolves to the first of them rather than to a span of both.
    let anchor = dStart;
    while (anchor < chars.length && chars[anchor]?.linkHref !== href) anchor += 1;
    if (anchor >= chars.length) anchor = dStart - 1;
    if (anchor < 0 || chars[anchor]?.linkHref !== href) return null;
    let start = anchor;
    let end = anchor + 1;
    while (start > 0 && chars[start - 1]?.linkHref === href) start -= 1;
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
  const word = map.chars.slice(start, index);
  if (word.some((c) => c.linkSuppressed)) return null;
  // Only an AUTOMATIC link is deferred. A word carrying an explicit <link=…> is
  // already a hyperlink the user asked for, and suppressing it made a real link
  // visibly lose its anchor for as long as the caret rested at its end.
  if (word.some((c) => c.linkHref !== null)) return null;
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

// The render-only value for a remembered suppression, derived from the field's
// CURRENT map. Null when the range no longer covers anything, so the caller
// paints the stored value untouched.
//
// The caller must remember a RANGE and call this every render — never cache the
// returned value. A cached value is stale for the repaint that follows the very
// next keystroke: the paint would still hold the pre-edit text, one character
// short, while the caret restore targets an index in the NEW value. The restore
// then walks off the end of the painted text and clamps to it, so every
// keystroke inside a URL left the caret one position back — which moved it off
// the word's trailing edge and let the link fire while it was still being typed.
// Deriving from the current map makes that impossible by construction.
export function suppressedAutoLinkValue(
  map: DisplayMap,
  range: { dStart: number; dEnd: number }
): string | null {
  const dEnd = Math.min(range.dEnd, map.chars.length);
  const dStart = Math.max(0, Math.min(range.dStart, dEnd));
  if (dEnd <= dStart) return null;
  return suppressAutoLink(map, dStart, dEnd);
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
