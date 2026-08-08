import { INLINE_MARK_TAG_PATTERN } from "@typeset/engine/lib/inlineMarksText.ts";

type ScopeBullet = { id: string; text: string };
type ScopeEntry = {
  id: string;
  titleLeft: string;
  titleRight: string;
  subtitleLeft: string;
  subtitleRight: string;
  bullets: ScopeBullet[];
};
type ScopeSection = {
  id: string;
  heading: string;
  type: "skills" | "summary" | "standard";
  entries: ScopeEntry[];
};
export type NormalizedResumeScope = {
  version: number;
  locked: { omittedIdentity: boolean; omittedContact: boolean; omittedSections: string[] };
  sections: ScopeSection[];
  contextSections: ScopeSection[];
};

function trimText(value: unknown, max = 1200): string {
  return String(value ?? "").trim().slice(0, max);
}

const INLINE_MARK_RE = new RegExp(INLINE_MARK_TAG_PATTERN, "gi");

export function stripStructuralInlineMarks(value: unknown): string {
  INLINE_MARK_RE.lastIndex = 0;
  return String(value ?? "").replace(
    INLINE_MARK_RE,
    (tag) => /^<\/?(?:b|i|u)>$/i.test(tag) ? tag : ""
  );
}

function trimScopeText(value: unknown, max = 1200): string {
  return stripStructuralInlineMarks(value).trim().slice(0, max);
}

function normalizeScopeSection(raw: unknown): ScopeSection | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const section = raw as Record<string, unknown>;
  const id = trimText(section.id, 120);
  const heading = trimScopeText(section.heading, 120);
  if (!id || !heading) return null;
  const type = section.type === "skills" ? "skills" : section.type === "summary" ? "summary" : "standard";
  const entries = Array.isArray(section.entries) ? section.entries : [];
  return {
    id,
    heading,
    type,
    entries: entries.flatMap((rawEntry): ScopeEntry[] => {
      if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) return [];
      const entry = rawEntry as Record<string, unknown>;
      const entryId = trimText(entry.id, 120);
      if (!entryId) return [];
      const bullets = Array.isArray(entry.bullets) ? entry.bullets : [];
      return [{
        id: entryId,
        titleLeft: trimScopeText(entry.titleLeft),
        titleRight: trimScopeText(entry.titleRight),
        subtitleLeft: trimScopeText(entry.subtitleLeft),
        subtitleRight: trimScopeText(entry.subtitleRight),
        bullets: bullets.flatMap((rawBullet): ScopeBullet[] => {
          if (!rawBullet || typeof rawBullet !== "object" || Array.isArray(rawBullet)) return [];
          const bullet = rawBullet as Record<string, unknown>;
          const bulletId = trimText(bullet.id, 120);
          return bulletId ? [{ id: bulletId, text: trimScopeText(bullet.text) }] : [];
        }).slice(0, 20)
      }];
    }).slice(0, 20)
  };
}

export function normalizeResumeScope(raw: unknown): NormalizedResumeScope {
  const source = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const sections = (Array.isArray(source.sections) ? source.sections : [])
    .flatMap((section): ScopeSection[] => {
      const normalized = normalizeScopeSection(section);
      return normalized ? [normalized] : [];
    })
    .slice(0, 12);
  const sectionIds = new Set(sections.map((section) => section.id));
  const contextSections = (Array.isArray(source.contextSections) ? source.contextSections : [])
    .flatMap((section): ScopeSection[] => {
      const normalized = normalizeScopeSection(section);
      return normalized ? [normalized] : [];
    })
    .filter((section) => !sectionIds.has(section.id))
    .slice(0, 12);
  const locked = source.locked && typeof source.locked === "object" && !Array.isArray(source.locked)
    ? source.locked as Record<string, unknown>
    : {};
  return {
    version: 1,
    locked: {
      omittedIdentity: true,
      omittedContact: true,
      omittedSections: (Array.isArray(locked.omittedSections) ? locked.omittedSections : [])
        .map((item) => trimScopeText(item, 120))
        .filter(Boolean)
        .slice(0, 20)
    },
    sections,
    contextSections
  };
}

function appendScopeSection(lines: string[], section: ScopeSection): void {
  lines.push(section.heading.toUpperCase());
  for (const entry of section.entries) {
    if (section.type === "skills") {
      const label = entry.titleLeft.trim();
      const skills = entry.subtitleLeft.trim();
      if (label || skills) lines.push(label ? `${label}: ${skills}` : skills);
      continue;
    }
    if (section.type === "summary") {
      for (const bullet of entry.bullets) if (bullet.text.trim()) lines.push(bullet.text.trim());
      continue;
    }
    const title = [entry.titleLeft, entry.titleRight].filter(Boolean).join(" | ");
    const subtitle = [entry.subtitleLeft, entry.subtitleRight].filter(Boolean).join(" | ");
    if (title) lines.push(title);
    if (subtitle) lines.push(subtitle);
    for (const bullet of entry.bullets) if (bullet.text.trim()) lines.push(`- ${bullet.text.trim()}`);
  }
  lines.push("");
}

export function resumeScopeToText(scope: NormalizedResumeScope, editableOnly = false): string {
  const lines: string[] = [];
  for (const section of scope.sections) appendScopeSection(lines, section);
  if (!editableOnly) {
    for (const section of scope.contextSections) appendScopeSection(lines, section);
  }
  return lines.join("\n").trim();
}
