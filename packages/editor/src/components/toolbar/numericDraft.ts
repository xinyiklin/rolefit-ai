// The commit decision for a numeric text draft on blur/Enter. Returns the value
// to commit, or null to revert: an empty draft would otherwise parse as 0 and
// clamp to the minimum, and an unchanged value must not dispatch an edit.
// `normalize` owns each control's units, bounds, and precision.
export function numericDraftCommit(
  draft: string,
  displayed: string,
  current: number | null,
  normalize: (parsed: number) => number
): number | null {
  const trimmed = draft.trim();
  if (trimmed === "" || trimmed === displayed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  const next = normalize(parsed);
  return next === current ? null : next;
}
