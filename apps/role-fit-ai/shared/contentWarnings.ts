const MAX_WARNINGS = 8;
const INVALID_WARNING = "Some warning details could not be read. Review this output before use.";

export function sanitizeContentWarnings(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return [INVALID_WARNING];
  const warnings: string[] = [];
  for (const item of value.slice(0, value.length > MAX_WARNINGS ? MAX_WARNINGS - 1 : MAX_WARNINGS)) {
    const text = typeof item === "string"
      ? item.replace(/<[^>]*>/g, "").replace(/[\x00-\x1f]+/g, " ").trim().slice(0, 500)
      : "";
    warnings.push(text || INVALID_WARNING);
  }
  if (value.length > MAX_WARNINGS) warnings.push("Additional concerns were omitted. Review the full output before use.");
  return [...new Set(warnings)];
}
