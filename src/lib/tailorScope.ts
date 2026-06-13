import type { ResumeData, ResumeEntry, ResumeSectionData, ResumeSectionType } from "./resumeData";

export type TailorScopeBullet = {
  id: string;
  text: string;
};

export type TailorScopeEntry = {
  id: string;
  titleLeft: string;
  titleRight: string;
  subtitleLeft: string;
  subtitleRight: string;
  bullets: TailorScopeBullet[];
};

export type TailorScopeSection = {
  id: string;
  heading: string;
  type: ResumeSectionType;
  entries: TailorScopeEntry[];
};

export type TailorScope = {
  version: 1;
  locked: {
    omittedIdentity: true;
    omittedContact: true;
    omittedSections: string[];
  };
  sections: TailorScopeSection[];
};

const DEFAULT_EXCLUDED_HEADINGS = /\b(?:education|certifications?|licenses?|awards?|publications?)\b/i;
const DEFAULT_INCLUDED_HEADINGS = /\b(?:experience|projects?|skills?|technical\s+skills|work|employment|summary|objective|profile)\b/i;

export function isDefaultTailorSection(section: ResumeSectionData): boolean {
  const heading = section.heading.trim();
  if (!heading) return false;
  if (DEFAULT_EXCLUDED_HEADINGS.test(heading)) return false;
  // Skill lists and summaries are the prime tailoring surfaces.
  if (section.type === "skills" || section.type === "summary") return true;
  return DEFAULT_INCLUDED_HEADINGS.test(heading);
}

export function defaultTailorSectionIds(data: ResumeData | null): string[] {
  return data?.sections.filter(isDefaultTailorSection).map((section) => section.id) ?? [];
}

function scopeEntry(entry: ResumeEntry): TailorScopeEntry {
  return {
    id: entry.id,
    titleLeft: entry.titleLeft,
    titleRight: entry.titleRight,
    subtitleLeft: entry.subtitleLeft,
    subtitleRight: entry.subtitleRight,
    bullets: entry.bullets.map((bullet) => ({ id: bullet.id, text: bullet.text }))
  };
}

export function buildTailorScope(data: ResumeData, selectedSectionIds: Iterable<string>): TailorScope {
  const selected = new Set(selectedSectionIds);
  const included = data.sections.filter((section) => selected.has(section.id));
  const omittedSections = data.sections
    .filter((section) => !selected.has(section.id))
    .map((section) => section.heading.trim())
    .filter(Boolean);

  return {
    version: 1,
    locked: {
      omittedIdentity: true,
      omittedContact: true,
      omittedSections
    },
    sections: included.map((section) => ({
      id: section.id,
      heading: section.heading,
      type: section.type,
      entries: section.items.map(scopeEntry)
    }))
  };
}

export function tailorScopeToText(scope: TailorScope): string {
  const lines: string[] = [];
  for (const section of scope.sections) {
    lines.push(section.heading.toUpperCase());
    for (const entry of section.entries) {
      if (section.type === "skills") {
        const label = entry.titleLeft.trim();
        const skills = entry.subtitleLeft.trim();
        if (label || skills) lines.push(label ? `${label}: ${skills}` : skills);
        continue;
      }
      if (section.type === "summary") {
        for (const bullet of entry.bullets) {
          if (bullet.text.trim()) lines.push(bullet.text.trim());
        }
        continue;
      }
      const title = [entry.titleLeft, entry.titleRight].filter(Boolean).join(" | ");
      const subtitle = [entry.subtitleLeft, entry.subtitleRight].filter(Boolean).join(" | ");
      if (title) lines.push(title);
      if (subtitle) lines.push(subtitle);
      for (const bullet of entry.bullets) {
        if (bullet.text.trim()) lines.push(`- ${bullet.text.trim()}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}
