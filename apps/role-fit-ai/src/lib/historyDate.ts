/**
 * Relative age of a saved document version, for the Open menus' history rows
 * ("just now", "2h ago", "Mar 4").
 *
 * Shared because the resume and cover-letter Open menus are the same component
 * and must read identically; it was briefly copied into both call sites.
 */
export function formatHistoryDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  const diffMin = Math.floor((Date.now() - parsed.getTime()) / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
