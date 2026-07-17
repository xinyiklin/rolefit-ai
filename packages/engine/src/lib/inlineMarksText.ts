// Dependency-free text helpers for the resume's lightweight inline formatting
// serialization. Kept separate from the JSX renderer so parsers and offline
// reducer evals can run under Node's native TypeScript loader.

// The single inline-mark tag grammar. Consumers that need their own regex
// flags or statefulness build an instance from this source (measure.ts's
// segment splitter); the one capture group is the <link=…> destination.
// The editor's anchored multi-capture scanner in
// sections/editor/inlineTextEditing.ts is a deliberate second automaton over
// the same grammar — keep the two tag inventories in sync.
export const INLINE_MARK_TAG_PATTERN =
  "<\\/?(?:b|i|u|nolink)>|<link=([^>\\s]+)>|<\\/link>|<font=(?:latin-modern|source-serif|source-sans)>|<\\/font>|<size=\\d+(?:\\.\\d+)?>|<\\/size>|<align=(?:left|center|right|justify)>|<\\/align>";

const INLINE_TAG_RE = new RegExp(INLINE_MARK_TAG_PATTERN, "gi");

// Boolean probe that leaves the shared global regex reset for matchAll users.
export function hasInlineMarkTags(text: string): boolean {
  INLINE_TAG_RE.lastIndex = 0;
  const found = INLINE_TAG_RE.test(text);
  INLINE_TAG_RE.lastIndex = 0;
  return found;
}

export type FieldAlignment = "left" | "center" | "right" | "justify";

export function alignmentFromInlineMarks(text: string): FieldAlignment | null {
  const match = /<align=(left|center|right|justify)>/i.exec(text);
  return (match?.[1].toLowerCase() as FieldAlignment | undefined) ?? null;
}

// One tag-stack walk shared by the whole-field "effective value" helpers:
// resolve the innermost open tag's value (or `fallback`) over each
// non-whitespace text segment and report the value every segment agrees on,
// or null when the field mixes values.
function effectiveTagValue<T>(
  text: string,
  fallback: T,
  parseOpen: (tag: string) => T | null,
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
    include(text.slice(cursor, match.index));
    const tag = match[0];
    const opened = parseOpen(tag);
    if (opened !== null) stack.push(opened);
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
  return text.replace(/<align=(?:left|center|right|justify)>|<\/align>/gi, "");
}

export function stripInlineMarks(text: string): string {
  return text.replace(INLINE_TAG_RE, "");
}

export type InlineOverrideKind = "fontFamily" | "fontSize";

export function clearInlineOverride(text: string, kind: InlineOverrideKind): string {
  return kind === "fontFamily"
    ? text.replace(/<font=(?:latin-modern|source-serif|source-sans)>|<\/font>/gi, "")
    : text.replace(/<size=\d+(?:\.\d+)?>|<\/size>/gi, "");
}

// Whole-field font family, used by the Styles menu's per-field font control.
// Kept parallel to the emphasis (FieldMark) and alignment truth helpers: it
// reports the EFFECTIVE family (resolving to the document font when nothing
// overrides), or null when the field mixes families.
export type FieldFontFamily = "latin-modern" | "source-serif" | "source-sans";
// The resolved family shared by the whole field, or null when it is mixed.
export type FieldFontState = FieldFontFamily | null;

const FONT_OPEN_RE = /^<font=(latin-modern|source-serif|source-sans)>$/i;
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

// Wrap the whole field in one font family (stripping any existing font tags so
// it never nests), or strip the family entirely so the field follows the
// document font. Empty fields are left untouched.
export function setFieldFont(value: string, family: FieldFontFamily | "default"): string {
  const stripped = clearInlineOverride(value, "fontFamily");
  if (family === "default") return stripped;
  if (!stripped.trim()) return value;
  return `<font=${family}>${stripped}</font>`;
}

// The one font size (pt) covering the whole field — resolving to `fallback`
// (the field's default size) where nothing overrides — or null when mixed.
export function effectiveFieldSize(value: string, fallback: number): number | null {
  return effectiveTagValue<number>(
    value,
    fallback,
    (tag) => {
      const opened = SIZE_OPEN_RE.exec(tag);
      return opened ? Number(opened[1]) : null;
    },
    (tag) => /^<\/size>$/i.test(tag)
  );
}

// Wrap the whole field in one size, or strip the size so the field follows its
// role default. Empty fields are left untouched.
export function setFieldSize(value: string, sizePt: number | "default"): string {
  const stripped = clearInlineOverride(value, "fontSize");
  if (sizePt === "default") return stripped;
  if (!stripped.trim()) return value;
  return `<size=${sizePt}>${stripped}</size>`;
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
  const stripped = value.replace(markTagRe(mark), "");
  if (!on) return stripped;
  if (!stripped.trim()) return value;
  const tag = MARK_TAG[mark];
  return `<${tag}>${stripped}</${tag}>`;
}
