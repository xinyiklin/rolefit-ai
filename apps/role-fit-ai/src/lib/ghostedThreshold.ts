// The No response threshold. Dependency-free because settings validation, which
// the server imports, checks it without pulling in the tracker model.
export const DEFAULT_GHOSTED_AFTER_DAYS = 21;
export const MIN_GHOSTED_AFTER_DAYS = 7;
export const MAX_GHOSTED_AFTER_DAYS = 180;

export function normalizeGhostedAfterDays(value: unknown): number | null {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= MIN_GHOSTED_AFTER_DAYS
    && value <= MAX_GHOSTED_AFTER_DAYS
    ? value
    : null;
}
