import type { Application } from "../hooks/useApplications";

/**
 * Display identity shared by tracker UI and provenance-safe analytics. Without
 * a company, the title's lead segment stands in; a hyphen separates only with
 * spaces around it, so a hyphenated word ("Front-End") is never cut.
 */
export function displayCompany(app: Application) {
  return app.company?.trim() || app.title.split(/[|·]|\s+-\s+/)[0]?.trim() || "Unknown company";
}

export function parseDate(value?: string) {
  if (!value) return null;
  const trimmed = value.trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}
