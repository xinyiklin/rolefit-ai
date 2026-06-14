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

// Per-section tailoring choice. TAILOR = editable (AI suggests edits). INCLUDE =
// read-only context (sent to the AI as evidence, counts for fit, appears in the
// cover letter — but NEVER an editable target). OFF = omitted (heading noted only).
export type TailorMode = "tailor" | "include" | "off";

export type TailorScope = {
  version: 1;
  locked: {
    omittedIdentity: true;
    omittedContact: true;
    omittedSections: string[];
  };
  // TAILOR sections — the editable targets (this is the ONLY editable set, by
  // construction: the sanitizer builds its target map from `sections` alone).
  sections: TailorScopeSection[];
  // INCLUDE sections — read-only evidence. Disjoint from `sections`; never a
  // suggestion target. Keeping these in a sibling array (not a per-section flag)
  // makes "not editable" the structural default — fail-safe.
  contextSections: TailorScopeSection[];
};

const DEFAULT_EXCLUDED_HEADINGS = /\b(?:education|certifications?|licenses?|awards?|publications?)\b/i;
const DEFAULT_INCLUDED_HEADINGS = /\b(?:experience|projects?|skills?|technical\s+skills|work|employment|summary|objective|profile)\b/i;

// Default state per section: skill/summary and experience/projects-like sections
// tailor; education/certs/awards/publications default to INCLUDE (read-only
// context — kept in the picture so they count toward fit and can ground claims,
// without being rewritten); anything else stays off.
export function defaultTailorMode(section: ResumeSectionData): TailorMode {
  const heading = section.heading.trim();
  if (!heading) return "off";
  if (DEFAULT_EXCLUDED_HEADINGS.test(heading)) return "include";
  if (section.type === "skills" || section.type === "summary") return "tailor";
  if (DEFAULT_INCLUDED_HEADINGS.test(heading)) return "tailor";
  return "off";
}

export function defaultTailorModes(data: ResumeData | null): Record<string, TailorMode> {
  const modes: Record<string, TailorMode> = {};
  for (const section of data?.sections ?? []) {
    const mode = defaultTailorMode(section);
    // Off is the implicit default (absent key) — store only tailor/include.
    if (mode !== "off") modes[section.id] = mode;
  }
  return modes;
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

function scopeSection(section: ResumeSectionData): TailorScopeSection {
  return {
    id: section.id,
    heading: section.heading,
    type: section.type,
    entries: section.items.map(scopeEntry)
  };
}

// Partition the resume into three disjoint buckets: tailorIds -> editable
// `sections`, contextIds -> read-only `contextSections`, everything else ->
// `omittedSections` (heading only). A section in neither id set is omitted.
export function buildTailorScope(
  data: ResumeData,
  tailorSectionIds: Iterable<string>,
  contextSectionIds: Iterable<string> = []
): TailorScope {
  const tailor = new Set(tailorSectionIds);
  const context = new Set(contextSectionIds);
  const sections: TailorScopeSection[] = [];
  const contextSections: TailorScopeSection[] = [];
  const omittedSections: string[] = [];
  for (const section of data.sections) {
    if (tailor.has(section.id)) sections.push(scopeSection(section));
    else if (context.has(section.id)) contextSections.push(scopeSection(section));
    else {
      const heading = section.heading.trim();
      if (heading) omittedSections.push(heading);
    }
  }

  return {
    version: 1,
    locked: { omittedIdentity: true, omittedContact: true, omittedSections },
    sections,
    contextSections
  };
}

function appendScopeSectionLines(lines: string[], section: TailorScopeSection): void {
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

// Serializes BOTH editable and read-only context sections so the base fit score
// reflects the whole resume the user is keeping (e.g. Education counts), matching
// what the server scores. `editableOnly` (for the polish-gate length check)
// limits it to the tailored sections.
export function tailorScopeToText(scope: TailorScope, editableOnly = false): string {
  const lines: string[] = [];
  for (const section of scope.sections) appendScopeSectionLines(lines, section);
  if (!editableOnly) {
    for (const section of scope.contextSections) appendScopeSectionLines(lines, section);
  }
  return lines.join("\n").trim();
}
