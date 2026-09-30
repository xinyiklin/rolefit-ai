// Settings once stored experience as one row per evidence source. Those facts
// now live as text in the Profile Background; this module converts stored rows
// once, before strict settings validation, and owns nothing else.

const EXPERIENCE_CATEGORY_LABELS = [
  ["professional", "Professional employment"],
  ["internship", "Internship / co-op / apprenticeship"],
  ["freelance", "Freelance / contract / consulting"],
  ["research", "Research / lab"],
  ["academic", "Academic / coursework projects"],
  ["personal", "Personal / independent projects"],
  ["open-source", "Open-source contributions"],
  ["volunteer", "Volunteer / community work"],
  ["military", "Military / public service"]
] as const;

const EXPERIENCE_DETAILS_MAX_LENGTH = 240;
const EXPERIENCE_MAX_YEARS = 80;
const EXPERIENCE_MAX_COUNT = 99;
const EXPERIENCE_MIN_YEAR = 1950;
const EXPERIENCE_MAX_YEAR = 2100;

export const EXPERIENCE_MIGRATION_HEADING = "## Experience by type";

// Applies the same acceptance rules the rows had when they were editable, so
// the text says exactly what the old Settings showed.
function experienceLine(label: string, raw: Record<string, unknown>): string {
  const facts: string[] = [];
  if (typeof raw.years === "number" && Number.isFinite(raw.years) && raw.years >= 0 && raw.years <= EXPERIENCE_MAX_YEARS) {
    const years = Math.round(raw.years * 100) / 100;
    facts.push(`${years} ${years === 1 ? "year" : "years"}`);
  }
  if (typeof raw.count === "number" && Number.isSafeInteger(raw.count) && raw.count >= 1 && raw.count <= EXPERIENCE_MAX_COUNT) {
    facts.push(`${raw.count} ${raw.count === 1 ? "role or project" : "roles or projects"}`);
  }
  if (
    typeof raw.mostRecentYear === "number"
    && Number.isSafeInteger(raw.mostRecentYear)
    && raw.mostRecentYear >= EXPERIENCE_MIN_YEAR
    && raw.mostRecentYear <= EXPERIENCE_MAX_YEAR
  ) {
    facts.push(`most recent in ${raw.mostRecentYear}`);
  }
  if (typeof raw.details === "string") {
    const details = raw.details.trim().slice(0, EXPERIENCE_DETAILS_MAX_LENGTH);
    if (details) facts.push(`scope: ${details}`);
  }
  return `- ${label}: ${facts.length ? facts.join("; ") : "experience declared"}`;
}

export function experienceEvidenceText(rows: unknown): string {
  if (!Array.isArray(rows)) return "";
  const byCategory = new Map<string, Record<string, unknown>>();
  for (const item of rows) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const raw = item as Record<string, unknown>;
    if (typeof raw.category === "string" && !byCategory.has(raw.category)) byCategory.set(raw.category, raw);
  }
  const lines = EXPERIENCE_CATEGORY_LABELS
    .filter(([category]) => byCategory.has(category))
    .map(([category, label]) => experienceLine(label, byCategory.get(category)!));
  return lines.length ? [EXPERIENCE_MIGRATION_HEADING, ...lines].join("\n") : "";
}

export function migrateExperienceEvidence(settings: Record<string, unknown>): Record<string, unknown> {
  if (!Object.prototype.hasOwnProperty.call(settings, "experienceProfile")) return settings;
  const { experienceProfile, ...migrated } = settings;
  const block = experienceEvidenceText(experienceProfile);
  const background = typeof migrated.honestContext === "string" ? migrated.honestContext : "";
  // A stored file keeps its rows until the next save, so a re-read must not
  // append the same block twice.
  if (block && !background.includes(block)) {
    const separator = !background || background.endsWith("\n\n") ? "" : background.endsWith("\n") ? "\n" : "\n\n";
    migrated.honestContext = `${background}${separator}${block}`;
  }
  return migrated;
}
