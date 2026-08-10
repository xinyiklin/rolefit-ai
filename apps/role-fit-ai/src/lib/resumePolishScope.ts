import type { ResumeData, ResumeEntry, ResumeSectionData, ResumeSectionType } from "@typeset/engine/lib/resumeData.ts";

export type ResumePolishScopeBullet = {
  id: string;
  text: string;
};

export type ResumePolishScopeEntry = {
  id: string;
  titleLeft: string;
  titleRight: string;
  subtitleLeft: string;
  subtitleRight: string;
  bullets: ResumePolishScopeBullet[];
};

export type ResumePolishScopeSection = {
  id: string;
  heading: string;
  type: ResumeSectionType;
  entries: ResumePolishScopeEntry[];
};

// Per-section Resume Polish choice. POLISH = editable (AI suggests edits). INCLUDE =
// read-only context (sent to the provider as evidence but NEVER an editable
// target). OFF = omitted (heading noted only).
export type ResumePolishScopeMode = "polish" | "include" | "off";

export type ResumePolishScope = {
  version: 1;
  locked: {
    omittedIdentity: true;
    omittedContact: true;
    omittedSections: string[];
  };
  // POLISH sections — the editable targets (this is the ONLY editable set, by
  // construction: the sanitizer builds its target map from `sections` alone).
  sections: ResumePolishScopeSection[];
  // INCLUDE sections — read-only evidence. Disjoint from `sections`; never a
  // suggestion target. Keeping these in a sibling array (not a per-section flag)
  // makes "not editable" the structural default — fail-safe.
  contextSections: ResumePolishScopeSection[];
};

const DEFAULT_EXCLUDED_HEADINGS = /\b(?:education|certifications?|licenses?|awards?|publications?)\b/i;
const DEFAULT_INCLUDED_HEADINGS = /\b(?:experience|projects?|skills?|technical\s+skills|work|employment|summary|objective|profile)\b/i;

// Default state per section: skill/summary and experience/projects-like sections
// are polished; education/certs/awards/publications default to INCLUDE (read-only
// context so they can ground claims without being rewritten); anything else
// stays off.
export function defaultResumePolishScopeMode(section: ResumeSectionData): ResumePolishScopeMode {
  const heading = section.heading.trim();
  if (!heading) return "off";
  if (DEFAULT_EXCLUDED_HEADINGS.test(heading)) return "include";
  if (section.type === "skills" || section.type === "summary") return "polish";
  if (DEFAULT_INCLUDED_HEADINGS.test(heading)) return "polish";
  return "off";
}

export function defaultResumePolishScopeModes(data: ResumeData | null): Record<string, ResumePolishScopeMode> {
  const modes: Record<string, ResumePolishScopeMode> = {};
  for (const section of data?.sections ?? []) {
    const mode = defaultResumePolishScopeMode(section);
    // Off is the implicit default (absent key) — store only polish/include.
    if (mode !== "off") modes[section.id] = mode;
  }
  return modes;
}

function scopeEntry(entry: ResumeEntry): ResumePolishScopeEntry {
  return {
    id: entry.id,
    titleLeft: entry.titleLeft,
    titleRight: entry.titleRight,
    subtitleLeft: entry.subtitleLeft,
    subtitleRight: entry.subtitleRight,
    bullets: entry.bullets.map((bullet) => ({ id: bullet.id, text: bullet.text }))
  };
}

function scopeSection(section: ResumeSectionData): ResumePolishScopeSection {
  return {
    id: section.id,
    heading: section.heading,
    type: section.type,
    entries: section.items.map(scopeEntry)
  };
}

// Partition the resume into three disjoint buckets: polishIds -> editable
// `sections`, contextIds -> read-only `contextSections`, everything else ->
// `omittedSections` (heading only). A section in neither id set is omitted.
export function buildResumePolishScope(
  data: ResumeData,
  polishSectionIds: Iterable<string>,
  contextSectionIds: Iterable<string> = []
): ResumePolishScope {
  const polish = new Set(polishSectionIds);
  const context = new Set(contextSectionIds);
  const sections: ResumePolishScopeSection[] = [];
  const contextSections: ResumePolishScopeSection[] = [];
  const omittedSections: string[] = [];
  for (const section of data.sections) {
    if (polish.has(section.id)) sections.push(scopeSection(section));
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

function appendScopeSectionLines(lines: string[], section: ResumePolishScopeSection): void {
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

// Serializes both editable and read-only context sections for provider evidence.
// `editableOnly` (for the polish-gate length check) limits it to the editable
// Polish sections.
export function resumePolishScopeToText(scope: ResumePolishScope, editableOnly = false): string {
  const lines: string[] = [];
  for (const section of scope.sections) appendScopeSectionLines(lines, section);
  if (!editableOnly) {
    for (const section of scope.contextSections) appendScopeSectionLines(lines, section);
  }
  return lines.join("\n").trim();
}
