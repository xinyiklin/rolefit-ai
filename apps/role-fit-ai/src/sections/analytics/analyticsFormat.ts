import type { RegisterRow } from "../../lib/applicationAnalytics";

export const formatDay = (date: Date) => date.toLocaleDateString([], { month: "short", day: "numeric" });

export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

// [start, end]: "Oct 13", "19", or "Sep 29", "Oct 5" across a month; a month
// reads "Oct 2026" with no end.
export function rowRange(row: RegisterRow): [string, string] {
  if (row.unit === "month") return [row.from.toLocaleDateString([], { month: "short", year: "numeric" }), ""];
  if (row.from.getTime() === row.to.getTime()) return [formatDay(row.from), ""];
  const sameMonth = row.from.getMonth() === row.to.getMonth();
  return [formatDay(row.from), sameMonth ? String(row.to.getDate()) : formatDay(row.to)];
}

export function relativeDay(days: number) {
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  return days > 0 ? `In ${days} d` : `${-days} d overdue`;
}
