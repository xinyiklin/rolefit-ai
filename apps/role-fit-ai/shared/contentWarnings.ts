const MAX_WARNINGS = 8;
const INVALID_WARNING = "Some warning details could not be read. Review this output before use.";
// Tag-shaped markup only; comparisons such as "<50ms ... >99.9%" stay ordinary text.
const MARKUP_TAG = /<\/?[a-z][^>]*>/gi;

function stripMarkupTags(text: string): string {
  // Repeat so nested fragments such as "<<i>b>" cannot reassemble into a tag.
  for (let previous = ""; previous !== text;) {
    previous = text;
    text = text.replace(MARKUP_TAG, "");
  }
  return text;
}

export function hasMarkupTag(text: string): boolean {
  return new RegExp(MARKUP_TAG.source, "i").test(text);
}

export function sanitizeContentWarnings(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return [INVALID_WARNING];
  const warnings: string[] = [];
  for (const item of value.slice(0, value.length > MAX_WARNINGS ? MAX_WARNINGS - 1 : MAX_WARNINGS)) {
    const text = typeof item === "string"
      ? stripMarkupTags(item).replace(/[\x00-\x1f]+/g, " ").slice(0, 500).trim()
      : "";
    warnings.push(text || INVALID_WARNING);
  }
  if (value.length > MAX_WARNINGS) warnings.push("Additional concerns were omitted. Review the full output before use.");
  return [...new Set(warnings)];
}
