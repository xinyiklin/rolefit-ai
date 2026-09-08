export type JobConditionIssue = {
  field: "workAuth" | "responsibilities" | "requiredQualifications" | "preferredQualifications";
  sourceExcerpt: string;
  reason: string;
};

export function sanitizeJobConditionIssues(raw: unknown, source: string): JobConditionIssue[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 8).flatMap((item): JobConditionIssue[] => {
    if (!item || typeof item !== "object") return [];
    const { field, sourceExcerpt, reason } = item as Record<string, unknown>;
    if (
      ![
        "workAuth",
        "responsibilities",
        "requiredQualifications",
        "preferredQualifications"
      ].includes(String(field)) ||
      typeof sourceExcerpt !== "string" ||
      !sourceExcerpt ||
      sourceExcerpt.length > 1000 ||
      !source.includes(sourceExcerpt) ||
      typeof reason !== "string" ||
      !reason ||
      reason.length > 240
    )
      return [];
    return [{ field: field as JobConditionIssue["field"], sourceExcerpt, reason }];
  });
}
