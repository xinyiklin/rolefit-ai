// Dependency-free text helpers for the resume's lightweight <b>/<i>/<u>
// serialization. Kept separate from the JSX renderer so parsers and offline
// reducer evals can run under Node's native TypeScript loader.
const INLINE_TAG_RE = /<\/?(?:b|i|u)>/gi;

export function stripInlineMarks(text: string): string {
  return text.replace(INLINE_TAG_RE, "");
}

// Whole-field emphasis helpers, used by the Style menu's bulk "bold all titles"
// / "italic all subtitles" actions. `bold` → <b>, `italic` → <i>.
export type FieldMark = "bold" | "italic";
const MARK_TAG: Record<FieldMark, string> = { bold: "b", italic: "i" };
const markTagRe = (mark: FieldMark) => new RegExp(`</?${MARK_TAG[mark]}>`, "gi");

// True when every non-whitespace character of the field is inside the mark (so
// the whole field renders bold / italic). Empty fields report false.
export function isFieldFullyMarked(value: string, mark: FieldMark): boolean {
  const tag = MARK_TAG[mark];
  let depth = 0;
  let cursor = 0;
  let sawText = false;
  const check = (end: number) => {
    if (value.slice(cursor, end).trim()) {
      sawText = true;
      if (depth <= 0) return false;
    }
    return true;
  };
  let ok = true;
  for (const match of value.matchAll(INLINE_TAG_RE)) {
    if (!check(match.index)) ok = false;
    const t = match[0].toLowerCase();
    if (t === `<${tag}>`) depth += 1;
    else if (t === `</${tag}>`) depth = Math.max(0, depth - 1);
    cursor = match.index + match[0].length;
  }
  if (!check(value.length)) ok = false;
  return sawText && ok;
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
