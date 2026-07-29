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
  alignmentFromInlineMarks,
  inlineFontSizePt,
  isInlineFontSizePt,
  paragraphIndentFromInlineMarks,
  paragraphIndentPt,
  paragraphLineHeight,
  paragraphSpacingFromInlineMarks,
  paragraphSpacePt,
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
  lineHeight: number | null;
  spaceBeforePt: number | null;
  spaceAfterPt: number | null;
  // Block indentation moves every wrapped line and narrows its measure.
  indentPt: number | null;
  linkHref: string | null;
  linkSuppressed: boolean;
};

export type TypingFormat = Pick<
  DisplayChar,
  "bold" | "italic" | "underline" | "fontFamily" | "fontSizePt" | "alignment"
>;

export type DisplayMap = {
  // Original inline-mark value. Empty fields have no display chars, so the
  // source is the only place their paragraph-level wrappers can survive.
  source: string;
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
  `^<\\/?(b|i|u|nolink)>|^<link=([^>\\s]+)>|^<\\/link>|^<font=(${FONT_FAMILY_ALTERNATION})>|^<\\/font>|^<size=(\\d+(?:\\.\\d+)?)>|^<\\/size>|^<align=(left|center|right|justify)>|^<\\/align>|^<line-height=(\\d+(?:\\.\\d+)?)>|^<\\/line-height>|^<space-before=(\\d+(?:\\.\\d+)?)>|^<\\/space-before>|^<space-after=(\\d+(?:\\.\\d+)?)>|^<\\/space-after>|^<indent=(\\d+(?:\\.\\d+)?)>|^<\\/indent>`,
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
  const lineHeightStack: number[] = [];
  const spaceBeforeStack: number[] = [];
  const spaceAfterStack: number[] = [];
  const indentStack: number[] = [];
  const linkStack: Array<string | null> = [];
  let linkSuppressed = 0;
  let i = 0;
  while (i < value.length) {
    const tag = TAG_RE.exec(value.slice(i));
    if (tag) {
      if (tag[9]) indentStack.push(paragraphIndentPt(Number(tag[9])));
      else if (tag[8]) spaceAfterStack.push(paragraphSpacePt(Number(tag[8])));
      else if (tag[7]) spaceBeforeStack.push(paragraphSpacePt(Number(tag[7])));
      else if (tag[6]) lineHeightStack.push(paragraphLineHeight(Number(tag[6])));
      else if (tag[5]) alignmentStack.push(tag[5].toLowerCase() as FieldAlignment);
      else if (tag[3]) fontStack.push(tag[3] as DocumentFontFamily);
      else if (tag[4]) {
        const size = Number(tag[4]);
        if (isInlineFontSizePt(size)) sizeStack.push(size);
      } else if (tag[2]) linkStack.push(decodeLinkHref(tag[2]));
      else if (tag[0].toLowerCase() === "</font>") fontStack.pop();
      else if (tag[0].toLowerCase() === "</size>") sizeStack.pop();
      else if (tag[0].toLowerCase() === "</align>") alignmentStack.pop();
      else if (tag[0].toLowerCase() === "</line-height>") lineHeightStack.pop();
      else if (tag[0].toLowerCase() === "</space-before>") spaceBeforeStack.pop();
      else if (tag[0].toLowerCase() === "</space-after>") spaceAfterStack.pop();
      else if (tag[0].toLowerCase() === "</indent>") indentStack.pop();
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
      lineHeight: lineHeightStack[lineHeightStack.length - 1] ?? null,
      spaceBeforePt: spaceBeforeStack[spaceBeforeStack.length - 1] ?? null,
      spaceAfterPt: spaceAfterStack[spaceAfterStack.length - 1] ?? null,
      indentPt: indentStack[indentStack.length - 1] ?? null,
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
  return { source: value, display, chars, valueStart, prefix, suffix };
}

// ---- display chars → value (canonical <b><i><u> nesting; flags-driven) ----

function serializeChars(prefix: string, chars: DisplayChar[], suffix: string, boundary: number): { value: string; boundaryIndex: number } {
  let value = prefix;
  let boundaryIndex = -1;
  let open: Pick<DisplayChar, "bold" | "italic" | "underline" | "fontFamily" | "fontSizePt" | "alignment" | "lineHeight" | "spaceBeforePt" | "spaceAfterPt" | "indentPt" | "linkHref" | "linkSuppressed"> = {
    bold: false,
    italic: false,
    underline: false,
    fontFamily: null,
    fontSizePt: null,
    alignment: null,
    lineHeight: null,
    spaceBeforePt: null,
    spaceAfterPt: null,
    indentPt: null,
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
    if (open.lineHeight) value += "</line-height>";
    if (open.spaceBeforePt !== null) value += "</space-before>";
    if (open.spaceAfterPt !== null) value += "</space-after>";
    if (open.indentPt !== null) value += "</indent>";
    open = {
      bold: false,
      italic: false,
      underline: false,
      fontFamily: null,
      fontSizePt: null,
      alignment: null,
      lineHeight: null,
      spaceBeforePt: null,
      spaceAfterPt: null,
      indentPt: null,
      linkHref: null,
      linkSuppressed: false
    };
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
      c.lineHeight !== open.lineHeight ||
      c.spaceBeforePt !== open.spaceBeforePt ||
      c.spaceAfterPt !== open.spaceAfterPt ||
      c.indentPt !== open.indentPt ||
      c.linkHref !== open.linkHref ||
      c.linkSuppressed !== open.linkSuppressed
    ) {
      closeAll();
      if (c.indentPt !== null) value += `<indent=${c.indentPt}>`;
      if (c.spaceAfterPt !== null) value += `<space-after=${c.spaceAfterPt}>`;
      if (c.spaceBeforePt !== null) value += `<space-before=${c.spaceBeforePt}>`;
      if (c.lineHeight) value += `<line-height=${c.lineHeight}>`;
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
        lineHeight: c.lineHeight,
        spaceBeforePt: c.spaceBeforePt,
        spaceAfterPt: c.spaceAfterPt,
        indentPt: c.indentPt,
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

function emptyFieldFormat(map: DisplayMap): DisplayChar {
  const spacing = paragraphSpacingFromInlineMarks(map.source);
  const fontFamily = new RegExp(`<font=(${FONT_FAMILY_ALTERNATION})>`, "i").exec(map.source)?.[1];
  const fontSize = /<size=(\d+(?:\.\d+)?)>/i.exec(map.source)?.[1];
  return {
    raw: "",
    bold: /<b>/i.test(map.source),
    italic: /<i>/i.test(map.source),
    underline: /<u>/i.test(map.source),
    fontFamily: (fontFamily?.toLowerCase() as DocumentFontFamily | undefined) ?? null,
    fontSizePt: fontSize ? inlineFontSizePt(Number(fontSize)) : null,
    alignment: alignmentFromInlineMarks(map.source),
    lineHeight: spacing.lineHeight,
    spaceBeforePt: spacing.spaceBeforePt,
    spaceAfterPt: spacing.spaceAfterPt,
    indentPt: paragraphIndentFromInlineMarks(map.source) || null,
    linkHref: null,
    linkSuppressed: false
  };
}

export function typingFormatForEmptyField(map: DisplayMap): TypingFormat | null {
  if (map.chars.length > 0 || map.source.length === 0) return null;
  const format = emptyFieldFormat(map);
  return {
    bold: format.bold,
    italic: format.italic,
    underline: format.underline,
    fontFamily: format.fontFamily,
    fontSizePt: format.fontSizePt,
    alignment: format.alignment
  };
}

// An empty paragraph has no DisplayChar that can retain a collapsed-caret
// toolbar choice. Persist the choice in a textless carrier so leaving and
// returning to the paragraph recovers the same next-typing format.
export function setEmptyFieldTypingFormat(
  map: DisplayMap,
  format: TypingFormat
): { value: string; caretValueIndex: number } {
  if (map.chars.length > 0) {
    throw new Error("setEmptyFieldTypingFormat requires an empty display map");
  }
  const carrier: DisplayChar = {
    ...emptyFieldFormat(map),
    ...format,
    raw: "",
    linkHref: null,
    linkSuppressed: false
  };
  const value = serializeChars(map.prefix, [carrier], map.suffix, 0).value;
  return { value, caretValueIndex: value.length };
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
  const inherit = map.chars[dStart - 1] ?? map.chars[dStart] ?? emptyFieldFormat(map);
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
    lineHeight: inherit.lineHeight,
    spaceBeforePt: inherit.spaceBeforePt,
    spaceAfterPt: inherit.spaceAfterPt,
    indentPt: inherit.indentPt,
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
        lineHeight: inherit.lineHeight,
        spaceBeforePt: inherit.spaceBeforePt,
        spaceAfterPt: inherit.spaceAfterPt,
        indentPt: inherit.indentPt,
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
  const fragmentChars = singleLine
    ? fragment.chars.map((char) => ({
        ...char,
        raw: char.raw.replace(/\r?\n/g, " ")
      }))
    : fragment.chars;
  const inherit = map.chars[dStart - 1] ?? map.chars[dStart] ?? emptyFieldFormat(map);
  const inserted = map.chars.length === 0
    ? fragmentChars.map((char) => ({
        ...char,
        alignment: char.alignment ?? inherit.alignment,
        lineHeight: char.lineHeight ?? inherit.lineHeight,
        spaceBeforePt: char.spaceBeforePt ?? inherit.spaceBeforePt,
        spaceAfterPt: char.spaceAfterPt ?? inherit.spaceAfterPt,
        indentPt: char.indentPt ?? inherit.indentPt
      }))
    : fragmentChars;
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
        lineHeight: inherit.lineHeight,
        spaceBeforePt: inherit.spaceBeforePt,
        spaceAfterPt: inherit.spaceAfterPt,
        indentPt: inherit.indentPt,
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

// Replace one selection with several logical clipboard paragraphs. The first
// fragment joins the leading boundary and the last joins either the same field
// or an explicitly supplied trailing boundary; middle fragments stay
// independent mark-balanced values for the structural reducer to insert.
export function replaceWithParagraphFragments(
  map: DisplayMap,
  dStart: number,
  dEnd: number,
  fragmentValues: readonly string[],
  tail?: { map: DisplayMap; dEnd: number }
): { values: string[]; lastCaretDisplayIndex: number } {
  if (fragmentValues.length < 2) {
    throw new Error("replaceWithParagraphFragments requires at least two paragraphs");
  }
  const fragments = fragmentValues.map((value) =>
    buildDisplayMap(value, { preserveWhitespace: true })
  );
  const tailMap = tail?.map ?? map;
  const tailEnd = tail?.dEnd ?? dEnd;
  const values = fragments.map((fragment, index) => {
    const first = index === 0;
    const last = index === fragments.length - 1;
    const chars = [
      ...(first ? map.chars.slice(0, dStart) : []),
      ...fragment.chars,
      ...(last ? tailMap.chars.slice(tailEnd) : [])
    ];
    if (chars.length === 0) return fragment.source;
    return serializeChars(
      first ? map.prefix : "",
      chars,
      last ? tailMap.suffix : "",
      chars.length
    ).value;
  });
  return {
    values,
    lastCaretDisplayIndex: fragments[fragments.length - 1].display.length
  };
}

// Authored indentation uses measured spaces that still behave as one tab stop.
function spaceRunBefore(display: string, index: number): number {
  let run = 0;
  while (index - run > 0 && display[index - run - 1] === " ") run += 1;
  return run;
}

function spaceRunAfter(display: string, index: number): number {
  let run = 0;
  while (index + run < display.length && display[index + run] === " ") run += 1;
  return run;
}

// Remove exactly one authored stop; shorter runs remain ordinary typed spaces.
export function indentDeletionRange(
  display: string,
  caret: number,
  direction: "backward" | "forward",
  width: number
): { start: number; end: number } | null {
  if (width < 1) return null;
  if (direction === "backward") {
    return spaceRunBefore(display, caret) < width ? null : { start: caret - width, end: caret };
  }
  return spaceRunAfter(display, caret) < width ? null : { start: caret, end: caret + width };
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
  if (map.chars.length === 0) return setEmptyParagraphProperty(map, "align", alignment);
  const chars = map.chars.map((char) => ({ ...char, alignment }));
  return withBoundary(serializeChars(map.prefix, chars, map.suffix, chars.length));
}

export function setParagraphLineHeight(
  map: DisplayMap,
  lineHeight: number
): { value: string; caretValueIndex: number } {
  return setLineHeightRanges(
    map,
    [{ dStart: 0, dEnd: map.chars.length }],
    lineHeight
  );
}

type EmptyParagraphProperty =
  | "align"
  | "line-height"
  | "space-before"
  | "space-after"
  | "indent";

// A textless paragraph has no DisplayChar to carry block metadata. Keep those
// properties as canonical wrappers around its remaining empty-field marks.
function setEmptyParagraphProperty(
  map: DisplayMap,
  property: EmptyParagraphProperty,
  value: number | FieldAlignment | null
): { value: string; caretValueIndex: number } {
  const pattern = new RegExp(
    `<${property}=(?:\\d+(?:\\.\\d+)?|left|center|right|justify)>|<\\/${property}>`,
    "gi"
  );
  const inner = map.source.replace(pattern, "");
  const next = value === null
    ? inner
    : `<${property}=${value}>${inner}</${property}>`;
  return { value: next, caretValueIndex: next.length };
}

export function setLineHeightRanges(
  map: DisplayMap,
  ranges: ReadonlyArray<{ dStart: number; dEnd: number }>,
  lineHeight: number
): { value: string; caretValueIndex: number } {
  const value = paragraphLineHeight(lineHeight);
  if (
    map.chars.length === 0 &&
    ranges.some((range) => range.dStart === 0 && range.dEnd === 0)
  ) {
    return setEmptyParagraphProperty(map, "line-height", value);
  }
  const chars = map.chars.map((char, index) =>
    ranges.some((range) => index >= range.dStart && index < range.dEnd)
      ? { ...char, lineHeight: value }
      : char
  );
  return withBoundary(serializeChars(map.prefix, chars, map.suffix, chars.length));
}

export function setParagraphSpaceBefore(
  map: DisplayMap,
  spaceBeforePt: number
): { value: string; caretValueIndex: number } {
  const value = paragraphSpacePt(spaceBeforePt);
  if (map.chars.length === 0) return setEmptyParagraphProperty(map, "space-before", value);
  const chars = map.chars.map((char) => ({ ...char, spaceBeforePt: value }));
  return withBoundary(serializeChars(map.prefix, chars, map.suffix, chars.length));
}

// The host measures a half-inch first-line stop; block indentation stores its point value.
export const TAB_STOP_PT = 36;

// Tab climbs first-line then block indentation; Shift+Tab reverses that order.
// Whole-paragraph selections move directly at the block level.
export function indentStep(
  map: DisplayMap,
  dStart: number,
  dEnd: number,
  unit: string,
  direction: "in" | "out"
): { value: string; shift: number } | null {
  const display = map.display;
  const leading = /^ */.exec(display)?.[0].length ?? 0;
  const block = map.chars[0]?.indentPt ?? 0;
  if (direction === "out") {
    if (block > 0) {
      return { value: setParagraphIndent(map, Math.max(0, block - TAB_STOP_PT)).value, shift: 0 };
    }
    if (leading === 0) return null;
    const removed = Math.min(unit.length, leading);
    return { value: applyEdit(map, 0, removed, "").value, shift: -removed };
  }
  const wholeParagraph = dEnd > dStart && dStart <= leading && dEnd >= display.length;
  return wholeParagraph || leading >= unit.length
    ? { value: setParagraphIndent(map, block + TAB_STOP_PT).value, shift: 0 }
    : { value: applyEdit(map, 0, 0, unit).value, shift: unit.length };
}

// Zero removes the whole-field wrapper so unindented values serialize canonically.
export function setParagraphIndent(
  map: DisplayMap,
  indentPt: number
): { value: string; caretValueIndex: number } {
  const value = paragraphIndentPt(indentPt);
  if (map.chars.length === 0) {
    return setEmptyParagraphProperty(map, "indent", value > 0 ? value : null);
  }
  const chars = map.chars.map((char) => ({ ...char, indentPt: value > 0 ? value : null }));
  return withBoundary(serializeChars(map.prefix, chars, map.suffix, chars.length));
}

// The indent every character of the field agrees on, which for a whole-field
// wrapper is simply the paragraph's own.
export function paragraphIndentOf(map: DisplayMap): number {
  return map.chars[0]?.indentPt ?? paragraphIndentPt(
    Number(/<indent=(\d+(?:\.\d+)?)>/i.exec(map.source)?.[1] ?? 0)
  );
}

export function setParagraphSpaceAfter(
  map: DisplayMap,
  spaceAfterPt: number
): { value: string; caretValueIndex: number } {
  const value = paragraphSpacePt(spaceAfterPt);
  if (map.chars.length === 0) return setEmptyParagraphProperty(map, "space-after", value);
  const chars = map.chars.map((char) => ({ ...char, spaceAfterPt: value }));
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
  const inherit = map.chars[dStart - 1] ?? map.chars[dStart] ?? emptyFieldFormat(map);
  const inserted: DisplayChar[] = Array.from(text).map((ch) => ({
    raw: ch,
    bold: inherit.bold,
    italic: inherit.italic,
    underline: inherit.underline,
    fontFamily: inherit.fontFamily,
    fontSizePt: inherit.fontSizePt,
    alignment: inherit.alignment,
    lineHeight: inherit.lineHeight,
    spaceBeforePt: inherit.spaceBeforePt,
    spaceAfterPt: inherit.spaceAfterPt,
    indentPt: inherit.indentPt,
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
  // A boundary split has no DisplayChar on its empty side. Preserve the
  // adjacent character and paragraph formatting in a textless carrier so
  // typing into the new paragraph continues the active style. Links are
  // intentionally excluded: Enter must not extend a hyperlink.
  const emptyParagraph = (format: DisplayChar) =>
    serializeChars(
      "",
      [{ ...format, raw: "", linkHref: null, linkSuppressed: false }],
      "",
      0
    ).value;
  const before = d === 0
    ? emptyParagraph(map.chars[0] ?? emptyFieldFormat(map))
    : serializeChars(map.prefix, map.chars.slice(0, d), "", 0).value;
  const after = d === map.chars.length
    ? emptyParagraph(map.chars[map.chars.length - 1] ?? emptyFieldFormat(map))
    : serializeChars("", map.chars.slice(d), map.suffix, 0).value;
  return { before, after };
}

// Value boundary → display boundary (smallest display index at/after it).
// A display index past the final character maps to the value's end, never zero.
export function valueIndexForDisplayIndex(
  map: DisplayMap,
  value: string,
  index: number
): number {
  const clamped = Math.max(0, Math.min(index, map.display.length));
  return clamped < map.display.length ? map.valueStart[clamped] ?? value.length : value.length;
}

export function displayIndexForValueIndex(map: DisplayMap, valueIndex: number): number {
  for (let i = 0; i < map.valueStart.length; i += 1) {
    if (map.valueStart[i] >= valueIndex) return i;
  }
  return map.chars.length;
}
