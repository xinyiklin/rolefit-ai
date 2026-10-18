// Dependency-free text helpers for the resume's lightweight inline formatting
// serialization. Kept separate from the JSX renderer so parsers and offline
// reducer evals can run under Node's native TypeScript loader.

import { FONT_FAMILY_ALTERNATION, type FontFamily } from "./fontFamilies.ts";

// The single inline-mark tag grammar. Consumers that need their own regex
// flags or statefulness build an instance from this source (measure.ts's
// segment splitter); the one capture group is the <link=…> destination.
// The editor's anchored multi-capture scanner in
// sections/editor/inlineTextEditing.ts is a deliberate second automaton over
// the same grammar — keep the two tag inventories in sync. Both take the font
// alternation from lib/fontFamilies.ts so a new family cannot parse in one and
// not the other. `<lt>` is the one text token (INLINE_LITERAL_LESS_THAN).
export const INLINE_MARK_TAG_PATTERN =
  `<lt>|<\\/?(?:b|i|u|nolink)>|<link=([^>\\s]+)>|<\\/link>|<font=(?:${FONT_FAMILY_ALTERNATION})>|<\\/font>|<size=\\d+(?:\\.\\d+)?>|<\\/size>|<align=(?:left|center|right|justify)>|<\\/align>|<line-height=\\d+(?:\\.\\d+)?>|<\\/line-height>|<space-before=\\d+(?:\\.\\d+)?>|<\\/space-before>|<space-after=\\d+(?:\\.\\d+)?>|<\\/space-after>|<indent=\\d+(?:\\.\\d+)?>|<\\/indent>`;

export const INLINE_FONT_SIZE_MIN_PT = 1;
export const INLINE_FONT_SIZE_MAX_PT = 200;

export function inlineFontSizePt(value: number): number {
  const finite = Number.isFinite(value) ? value : INLINE_FONT_SIZE_MIN_PT;
  return Math.min(
    INLINE_FONT_SIZE_MAX_PT,
    Math.max(INLINE_FONT_SIZE_MIN_PT, Math.round(finite * 10) / 10)
  );
}

export function isInlineFontSizePt(value: number): boolean {
  return (
    Number.isFinite(value) &&
    value >= INLINE_FONT_SIZE_MIN_PT &&
    value <= INLINE_FONT_SIZE_MAX_PT
  );
}

const INLINE_TAG_RE = new RegExp(INLINE_MARK_TAG_PATTERN, "gi");
const INLINE_TAG_AT_RE = new RegExp(INLINE_MARK_TAG_PATTERN, "iy");

// A literal "<" stored where the raw character would start a tag, so typed or
// pasted "<b>" stays text. Every walker reads it as the text "<".
export const INLINE_LITERAL_LESS_THAN = "<lt>";

export function isInlineLiteralLessThan(token: string): boolean {
  return token.toLowerCase() === INLINE_LITERAL_LESS_THAN;
}

// Encode plain text for the grammar. Escaping every "<" keeps any later
// concatenation from forming a tag; the editor's serializer then keeps `<lt>`
// only where a raw "<" would start one.
export function escapeInlineMarkText(text: string): string {
  return text.replace(/</g, INLINE_LITERAL_LESS_THAN);
}

// True when a grammar token (a tag or `<lt>`) starts at `index`.
export function inlineMarkTagStartsAt(text: string, index: number): boolean {
  INLINE_TAG_AT_RE.lastIndex = index;
  return INLINE_TAG_AT_RE.test(text);
}

// `text` holds every literal "<" as a bare "<" at `literalStarts` (ascending).
// Escape exactly those that start a token, so `<lt>` stays only where needed;
// `index` is carried through. Each decision is independent of the others: an
// escape adds "lt>" after a "<" that already starts a token, and no token that
// starts earlier can end differently because of it.
export function escapeInlineLiteralStarts(
  text: string,
  literalStarts: readonly number[],
  index = text.length
): { value: string; index: number } {
  let value = "";
  let cursor = 0;
  let shifted = index;
  for (const at of literalStarts) {
    if (!inlineMarkTagStartsAt(text, at)) continue;
    value += text.slice(cursor, at) + INLINE_LITERAL_LESS_THAN;
    cursor = at + 1;
    if (at < index) shifted += INLINE_LITERAL_LESS_THAN.length - 1;
  }
  return { value: value + text.slice(cursor), index: shifted };
}

// A value with every literal "<" (escaped or not) written bare, their
// positions, and where `index` lands. Real tags are kept as written.
function literalForm(value: string, index: number): { text: string; starts: number[]; index: number } {
  let text = "";
  const starts: number[] = [];
  let mapped = -1;
  let cursor = 0;
  const addText = (from: number, to: number) => {
    for (let position = from; position < to; position += 1) {
      if (position === index) mapped = text.length;
      if (value[position] === "<") starts.push(text.length);
      text += value[position];
    }
  };
  for (const match of value.matchAll(INLINE_TAG_RE)) {
    addText(cursor, match.index);
    const end = match.index + match[0].length;
    if (mapped < 0 && index >= match.index && index < end) mapped = text.length;
    if (isInlineLiteralLessThan(match[0])) {
      starts.push(text.length);
      text += "<";
    } else {
      text += match[0];
    }
    cursor = end;
  }
  addText(cursor, value.length);
  return { text, starts, index: mapped < 0 ? text.length : mapped };
}

// The canonical spelling of a value: `<lt>` exactly where a raw "<" would
// start a token, and nowhere else. Meaning is unchanged; idempotent.
export function canonicalInlineMarkText(value: string): string {
  const form = literalForm(value, value.length);
  return escapeInlineLiteralStarts(form.text, form.starts).value;
}

// Join two values (a paragraph merge) without letting a literal "<" at the end
// of `a` start a tag with the text of `b`. `aIndex` (default: the end of `a`)
// is returned at its new position in the joined value.
export function joinInlineMarkText(a: string, b: string, aIndex = a.length): { value: string; index: number } {
  const left = literalForm(a, aIndex);
  const right = literalForm(b, b.length);
  return escapeInlineLiteralStarts(
    left.text + right.text,
    [...left.starts, ...right.starts.map((at) => at + left.text.length)],
    left.index
  );
}

// Run a raw-string transform (strip or wrap tags) with every literal "<"
// escaped, so removing a tag can never let a literal complete another one,
// then return the canonical spelling.
export function withInlineLiteralsProtected(value: string, transform: (escaped: string) => string): string {
  const form = literalForm(value, value.length);
  let escaped = "";
  let cursor = 0;
  for (const at of form.starts) {
    escaped += form.text.slice(cursor, at) + INLINE_LITERAL_LESS_THAN;
    cursor = at + 1;
  }
  return canonicalInlineMarkText(transform(escaped + form.text.slice(cursor)));
}

// Boolean probe that leaves the shared global regex reset for matchAll users.
export function hasInlineMarkTags(text: string): boolean {
  INLINE_TAG_RE.lastIndex = 0;
  const found = INLINE_TAG_RE.test(text);
  INLINE_TAG_RE.lastIndex = 0;
  return found;
}

export type FieldAlignment = "left" | "center" | "right" | "justify";

export const PARAGRAPH_LINE_HEIGHT_MIN = 1;
export const PARAGRAPH_LINE_HEIGHT_MAX = 2;
export const PARAGRAPH_SPACE_MAX_PT = 72;
// A paragraph's LEFT indent, in points. Bounded well short of the text column so
// an indented paragraph always keeps a usable measure to break lines in.
export const PARAGRAPH_INDENT_MAX_PT = 216;

const boundedParagraphValue = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(value * 10) / 10));

export function paragraphLineHeight(value: number): number {
  return boundedParagraphValue(value, PARAGRAPH_LINE_HEIGHT_MIN, PARAGRAPH_LINE_HEIGHT_MAX);
}

export function paragraphSpacePt(value: number): number {
  return boundedParagraphValue(value, 0, PARAGRAPH_SPACE_MAX_PT);
}

export function paragraphIndentPt(value: number): number {
  return boundedParagraphValue(value, 0, PARAGRAPH_INDENT_MAX_PT);
}

// Block indentation moves every wrapped line and narrows the paragraph measure.
export function paragraphIndentFromInlineMarks(text: string): number {
  const match = /<indent=(\d+(?:\.\d+)?)>/i.exec(text);
  return match ? paragraphIndentPt(Number(match[1])) : 0;
}

export type ParagraphSpacing = {
  lineHeight: number | null;
  spaceBeforePt: number | null;
  spaceAfterPt: number | null;
};

export function paragraphSpacingFromInlineMarks(text: string): ParagraphSpacing {
  const read = (name: string) => {
    const match = new RegExp(`<${name}=(\\d+(?:\\.\\d+)?)>`, "i").exec(text);
    return match ? Number(match[1]) : null;
  };
  const lineHeight = read("line-height");
  const spaceBeforePt = read("space-before");
  const spaceAfterPt = read("space-after");
  return {
    lineHeight:
      lineHeight === null
        ? null
        : boundedParagraphValue(lineHeight, PARAGRAPH_LINE_HEIGHT_MIN, PARAGRAPH_LINE_HEIGHT_MAX),
    spaceBeforePt:
      spaceBeforePt === null ? null : boundedParagraphValue(spaceBeforePt, 0, PARAGRAPH_SPACE_MAX_PT),
    spaceAfterPt:
      spaceAfterPt === null ? null : boundedParagraphValue(spaceAfterPt, 0, PARAGRAPH_SPACE_MAX_PT)
  };
}

export function alignmentFromInlineMarks(text: string): FieldAlignment | null {
  const match = /<align=(left|center|right|justify)>/i.exec(text);
  return (match?.[1].toLowerCase() as FieldAlignment | undefined) ?? null;
}

// An open tag the grammar matches but whose value is unusable (a <size=0>, a
// <size=999>). It still has a closing tag, so it must occupy a stack slot that
// changes nothing; skipping the push would let its </size> pop an OUTER value.
// Every tag-stack walker over the grammar (this one, measure.ts, the editor's
// display map) applies the same rule.
export const INERT_OPEN_TAG: unique symbol = Symbol("inert inline mark");

// One tag-stack walk shared by the whole-field "effective value" helpers:
// resolve the innermost open tag's value (or `fallback`) over each
// non-whitespace text segment and report the value every segment agrees on,
// or null when the field mixes values.
function effectiveTagValue<T>(
  text: string,
  fallback: T,
  parseOpen: (tag: string) => T | typeof INERT_OPEN_TAG | null,
  isClose: (tag: string) => boolean
): T | null {
  const stack: T[] = [];
  let common: T | null = null;
  let sawText = false;
  let cursor = 0;
  let mixed = false;

  const include = (segment: string) => {
    if (!segment.trim()) return;
    const current = stack.length ? stack[stack.length - 1] : fallback;
    if (!sawText) common = current;
    else if (common !== current) mixed = true;
    sawText = true;
  };

  for (const match of text.matchAll(INLINE_TAG_RE)) {
    // A literal "<" is text: it stays inside the pending text segment.
    if (isInlineLiteralLessThan(match[0])) continue;
    include(text.slice(cursor, match.index));
    const tag = match[0];
    const opened = parseOpen(tag);
    if (opened === INERT_OPEN_TAG) stack.push(stack.length ? stack[stack.length - 1] : fallback);
    else if (opened !== null) stack.push(opened);
    else if (isClose(tag)) stack.pop();
    cursor = match.index + match[0].length;
  }
  include(text.slice(cursor));

  if (mixed) return null;
  return sawText ? common : fallback;
}

export function effectiveFieldAlignment(
  text: string,
  fallback: FieldAlignment
): FieldAlignment | null {
  return effectiveTagValue<FieldAlignment>(
    text,
    fallback,
    (tag) => {
      const opened = /^<align=(left|center|right|justify)>$/i.exec(tag);
      return opened ? (opened[1].toLowerCase() as FieldAlignment) : null;
    },
    (tag) => /^<\/align>$/i.test(tag)
  );
}

export function clearAlignmentOverride(text: string): string {
  return withInlineLiteralsProtected(text, (escaped) =>
    escaped.replace(/<align=(?:left|center|right|justify)>|<\/align>/gi, "")
  );
}

export function stripInlineMarks(text: string): string {
  return text.replace(INLINE_TAG_RE, (token) => isInlineLiteralLessThan(token) ? "<" : "");
}

// Uppercase the TEXT of an inline-marked value and leave its tags alone. Running
// toUpperCase over the whole string also uppercased every tag payload, which
// the case-insensitive grammar still parsed: a <link=…> destination came back
// with its path uppercased, a different URL. Literals are escaped first, so an
// uppercase mapping such as "ı" → "I" cannot complete a tag ("<ı>" → "<I>").
export function uppercaseInlineMarkedText(text: string): string {
  return withInlineLiteralsProtected(text, (escaped) => {
    let out = "";
    let cursor = 0;
    for (const match of escaped.matchAll(INLINE_TAG_RE)) {
      out += escaped.slice(cursor, match.index).toUpperCase() + match[0];
      cursor = match.index + match[0].length;
    }
    return out + escaped.slice(cursor).toUpperCase();
  });
}

export type InlineOverrideKind = "fontFamily" | "fontSize";

const FONT_OVERRIDE_RE = new RegExp(`<font=(?:${FONT_FAMILY_ALTERNATION})>|<\\/font>`, "gi");
const SIZE_OVERRIDE_RE = /<size=\d+(?:\.\d+)?>|<\/size>/gi;

export function clearInlineOverride(text: string, kind: InlineOverrideKind): string {
  return withInlineLiteralsProtected(text, (escaped) =>
    escaped.replace(kind === "fontFamily" ? FONT_OVERRIDE_RE : SIZE_OVERRIDE_RE, "")
  );
}

// Whole-field font family, used by the Styles menu's per-field font control.
// Kept parallel to the emphasis (FieldMark) and alignment truth helpers: it
// reports the EFFECTIVE family (resolving to the document font when nothing
// overrides), or null when the field mixes families.
export type FieldFontFamily = FontFamily;
// The resolved family shared by the whole field, or null when it is mixed.
export type FieldFontState = FieldFontFamily | null;

const FONT_OPEN_RE = new RegExp(`^<font=(${FONT_FAMILY_ALTERNATION})>$`, "i");
const SIZE_OPEN_RE = /^<size=(\d+(?:\.\d+)?)>$/i;

// The one font family covering every non-whitespace character of the field —
// resolving to `fallback` (the document font) wherever nothing overrides it —
// or null when the field mixes families (or overrides only part of its text).
export function effectiveFieldFont(value: string, fallback: FieldFontFamily): FieldFontState {
  return effectiveTagValue<FieldFontFamily>(
    value,
    fallback,
    (tag) => {
      const opened = FONT_OPEN_RE.exec(tag);
      return opened ? (opened[1].toLowerCase() as FieldFontFamily) : null;
    },
    (tag) => /^<\/font>$/i.test(tag)
  );
}

// Remove only override pairs that wrap all of the field's visible text, so a
// whole-field change keeps the sizes or fonts set on words inside it.
function stripWholeFieldPairs(escaped: string, overrideRe: RegExp): string {
  for (;;) {
    const stack: RegExpExecArray[] = [];
    let next: string | null = null;
    for (const tag of escaped.matchAll(new RegExp(overrideRe.source, "gi"))) {
      if (!tag[0].startsWith("</")) {
        stack.push(tag as RegExpExecArray);
        continue;
      }
      const open = stack.pop();
      if (!open) continue;
      const before = escaped.slice(0, open.index);
      const after = escaped.slice(tag.index + tag[0].length);
      if (!stripInlineMarks(before + after).trim()) {
        next = before + escaped.slice(open.index + open[0].length, tag.index) + after;
        break;
      }
    }
    if (next === null) return escaped;
    escaped = next;
  }
}

// The value of the innermost override pair that wraps all of the field's
// visible text (the size or font the field is set at), or null.
function wholeFieldPairValue(value: string, overrideRe: RegExp): string | null {
  const stack: RegExpExecArray[] = [];
  let found: string | null = null;
  let foundDepth = -1;
  for (const tag of value.matchAll(new RegExp(overrideRe.source, "gi"))) {
    if (!tag[0].startsWith("</")) {
      stack.push(tag as RegExpExecArray);
      continue;
    }
    const open = stack.pop();
    if (!open) continue;
    const inner = value.slice(open.index + open[0].length, tag.index);
    const outside = value.slice(0, open.index) + value.slice(tag.index + tag[0].length);
    if (stack.length > foundDepth && stripInlineMarks(inner).trim() && !stripInlineMarks(outside).trim()) {
      found = /=([^>]+)>/.exec(open[0])?.[1] ?? null;
      foundDepth = stack.length;
    }
  }
  return found;
}

export function wholeFieldSizePt(value: string): number | null {
  const raw = wholeFieldPairValue(value, SIZE_OVERRIDE_RE);
  const size = raw === null ? NaN : Number(raw);
  return isInlineFontSizePt(size) ? size : null;
}

export type WholeFieldFormat = { sizePt: number | null; fontFamily: FieldFontFamily | null };

export function wholeFieldFormat(value: string): WholeFieldFormat {
  return {
    sizePt: wholeFieldSizePt(value),
    fontFamily: wholeFieldPairValue(value, FONT_OVERRIDE_RE) as FieldFontFamily | null
  };
}

// The whole-field size and font every non-empty value agrees on.
export function sharedWholeFieldFormat(values: readonly string[]): WholeFieldFormat {
  const formats = values.filter((value) => stripInlineMarks(value).trim()).map(wholeFieldFormat);
  const agreed = <K extends keyof WholeFieldFormat>(key: K): WholeFieldFormat[K] | null =>
    formats.length && formats.every((format) => format[key] === formats[0][key]) ? formats[0][key] : null;
  return { sizePt: agreed("sizePt"), fontFamily: agreed("fontFamily") };
}

// Give replacement text the whole-field size and font its field had, unless it
// sets its own, so an accepted rewrite keeps the field's look.
export function withWholeFieldFormat(value: string, format: WholeFieldFormat): string {
  let next = value;
  if (format.fontFamily !== null && wholeFieldPairValue(next, FONT_OVERRIDE_RE) === null) {
    next = setFieldOuterFont(next, format.fontFamily);
  }
  if (format.sizePt !== null && wholeFieldSizePt(next) === null) next = setFieldOuterSize(next, format.sizePt);
  return next;
}

// Whole-field size and font that keep word-level overrides, for body text.
export function setFieldOuterSize(value: string, sizePt: number | "default"): string {
  return withInlineLiteralsProtected(value, (escaped) => {
    const stripped = stripWholeFieldPairs(escaped, SIZE_OVERRIDE_RE);
    if (sizePt === "default") return stripped;
    if (!stripped.trim()) return escaped;
    return `<size=${inlineFontSizePt(sizePt)}>${stripped}</size>`;
  });
}

export function setFieldOuterFont(value: string, family: FieldFontFamily | "default"): string {
  return withInlineLiteralsProtected(value, (escaped) => {
    const stripped = stripWholeFieldPairs(escaped, FONT_OVERRIDE_RE);
    if (family === "default") return stripped;
    if (!stripped.trim()) return escaped;
    return `<font=${family}>${stripped}</font>`;
  });
}

// Wrap the whole field in one font family (stripping any existing font tags so
// it never nests), or strip the family entirely so the field follows the
// document font. Empty fields are left untouched.
export function setFieldFont(value: string, family: FieldFontFamily | "default"): string {
  return withInlineLiteralsProtected(value, (escaped) => {
    const stripped = escaped.replace(FONT_OVERRIDE_RE, "");
    if (family === "default") return stripped;
    if (!stripped.trim()) return escaped;
    return `<font=${family}>${stripped}</font>`;
  });
}

// The one font size (pt) covering the whole field — resolving to `fallback`
// (the field's default size) where nothing overrides — or null when mixed.
export function effectiveFieldSize(value: string, fallback: number): number | null {
  return effectiveTagValue<number>(
    value,
    fallback,
    (tag) => {
      const opened = SIZE_OPEN_RE.exec(tag);
      if (!opened) return null;
      const size = Number(opened[1]);
      return isInlineFontSizePt(size) ? size : INERT_OPEN_TAG;
    },
    (tag) => /^<\/size>$/i.test(tag)
  );
}

// Wrap the whole field in one size, or strip the size so the field follows its
// role default. Empty fields are left untouched.
export function setFieldSize(value: string, sizePt: number | "default"): string {
  return withInlineLiteralsProtected(value, (escaped) => {
    const stripped = escaped.replace(SIZE_OVERRIDE_RE, "");
    if (sizePt === "default") return stripped;
    if (!stripped.trim()) return escaped;
    return `<size=${inlineFontSizePt(sizePt)}>${stripped}</size>`;
  });
}

// Whole-field emphasis helpers used by the Styles menu's entry-field matrix.
export type FieldMark = "bold" | "italic" | "underline";
const MARK_TAG: Record<FieldMark, string> = { bold: "b", italic: "i", underline: "u" };
const markTagRe = (mark: FieldMark) => new RegExp(`</?${MARK_TAG[mark]}>`, "gi");

// True when every non-whitespace character of the field is inside the mark (so
// the whole field renders bold / italic). Empty fields report false.
export function fieldMarkState(value: string, mark: FieldMark): boolean | null {
  const tag = MARK_TAG[mark];
  let depth = 0;
  let cursor = 0;
  let sawText = false;
  let sawMarked = false;
  let sawUnmarked = false;
  const check = (end: number) => {
    if (value.slice(cursor, end).trim()) {
      sawText = true;
      if (depth > 0) sawMarked = true;
      else sawUnmarked = true;
    }
  };
  for (const match of value.matchAll(INLINE_TAG_RE)) {
    if (isInlineLiteralLessThan(match[0])) continue;
    check(match.index);
    const t = match[0].toLowerCase();
    if (t === `<${tag}>`) depth += 1;
    else if (t === `</${tag}>`) depth = Math.max(0, depth - 1);
    cursor = match.index + match[0].length;
  }
  check(value.length);
  if (!sawText || sawUnmarked && !sawMarked) return false;
  if (sawMarked && !sawUnmarked) return true;
  return null;
}

// Wrap the whole field in the mark (stripping any existing tags of that mark
// first so it never nests), or strip the mark entirely. Empty fields untouched.
export function setFieldMark(value: string, mark: FieldMark, on: boolean): string {
  return withInlineLiteralsProtected(value, (escaped) => {
    const stripped = escaped.replace(markTagRe(mark), "");
    if (!on) return stripped;
    if (!stripped.trim()) return escaped;
    const tag = MARK_TAG[mark];
    return `<${tag}>${stripped}</${tag}>`;
  });
}

// A skills row's one painted and editable value, joined from its two stored
// columns. The ": " separator belongs to neither column, so it is written as its
// own run carrying the alignment, size, family, and emphasis EVERY character of
// both columns shares — what a whole-row command applied — instead of the
// default format. It reads meaning, not tag spelling: the editor writes a row
// back as several runs whenever one skill differs. Links never extend onto it.
// Both columns need text: a label alone would hand its bold to skills typed
// after the separator.
export function skillsRowText(label: string, skills: string): string {
  if (!label) return skills;
  if (!stripInlineMarks(label).trim() || !stripInlineMarks(skills).trim()) return `${label}: ${skills}`;
  const row = joinInlineMarkText(label, skills).value;
  // `undefined` is "nothing overrides it"; null is a mix.
  const shared = <T>(parseOpen: (tag: string) => T | typeof INERT_OPEN_TAG | null, close: RegExp) =>
    effectiveTagValue<T | undefined>(row, undefined, parseOpen, (tag) => close.test(tag)) ?? undefined;
  const alignment = shared((tag) => /^<align=(left|center|right|justify)>$/i.exec(tag)?.[1].toLowerCase() as FieldAlignment ?? null, /^<\/align>$/i);
  const sizePt = shared((tag) => {
    const opened = SIZE_OPEN_RE.exec(tag);
    if (!opened) return null;
    return isInlineFontSizePt(Number(opened[1])) ? Number(opened[1]) : INERT_OPEN_TAG;
  }, /^<\/size>$/i);
  const family = shared((tag) => FONT_OPEN_RE.exec(tag)?.[1].toLowerCase() as FieldFontFamily ?? null, /^<\/font>$/i);
  const tags = [
    alignment ? `align=${alignment}` : "",
    sizePt ? `size=${sizePt}` : "",
    family ? `font=${family}` : "",
    ...(["bold", "italic", "underline"] as const).map((mark) => (fieldMarkState(row, mark) === true ? MARK_TAG[mark] : ""))
  ].filter(Boolean);
  const opens = tags.map((tag) => `<${tag}>`).join("");
  const closes = tags.map((tag) => `</${tag.split("=")[0]}>`).reverse().join("");
  return joinInlineMarkText(joinInlineMarkText(label, `${opens}: ${closes}`).value, skills).value;
}
