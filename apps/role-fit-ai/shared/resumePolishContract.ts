import { isEducationHeading } from "../src/resume/sections.ts";
export const RESUME_POLISH_STATUSES = ["PROPOSAL", "NO_CHANGES", "WITHHELD"] as const;
export const RESUME_POLISH_WITHHELD_REASONS = [
  "UNSUPPORTED",
  "INVALID_TARGET",
  "UNCHANGED",
  "MALFORMED"
] as const;

export type ResumePolishStatus = (typeof RESUME_POLISH_STATUSES)[number];
export type ResumePolishWithheldReason = (typeof RESUME_POLISH_WITHHELD_REASONS)[number];

export type ResumePolishWireChange = {
  targetId: string;
  replacement: string;
  reason?: string;
};

export type ResumePolishAdvice = {
  kind: "emphasis" | "order" | "space" | "missing-evidence";
  sectionId: string;
  entryId: string;
  jobExcerpt: string;
  candidateExcerpt: string;
  rationale: string;
};

export function sanitizeResumePolishAdvice(raw: unknown): ResumePolishAdvice[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 3).flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const value = item as Record<string, unknown>;
    if (!["emphasis", "order", "space", "missing-evidence"].includes(String(value.kind))) return [];
    for (const key of ["sectionId", "entryId", "jobExcerpt", "candidateExcerpt", "rationale"]) {
      if (typeof value[key] !== "string" || !value[key].trim() || value[key].length > 500) return [];
    }
    return [{
      kind: value.kind as ResumePolishAdvice["kind"],
      sectionId: value.sectionId as string,
      entryId: value.entryId as string,
      jobExcerpt: value.jobExcerpt as string,
      candidateExcerpt: value.candidateExcerpt as string,
      rationale: value.rationale as string
    }];
  });
}

export type ResumePolishWireResult = {
  advice?: ResumePolishAdvice[];
  status: ResumePolishStatus;
  changes: ResumePolishWireChange[];
  summary: string[];
  omittedTargetCount: number;
  withheld: {
    count: number;
    reasons: ResumePolishWithheldReason[];
  };
};

export type ResumePolishEditorTarget = {
  sectionId: string;
  entryId: string;
  bulletId?: string;
  field: "bullet" | "skill";
};

export type FlatResumeTarget = {
  targetId: string;
  kind: "bullet" | "skill-list";
  section: string;
  currentText: string;
  target: ResumePolishEditorTarget;
  sectionType: "skills" | "summary" | "standard";
  entryText: string;
};

type ScopeBullet = { id?: unknown; text?: unknown };
type ScopeEntry = {
  id?: unknown;
  titleLeft?: unknown;
  titleRight?: unknown;
  subtitleLeft?: unknown;
  subtitleRight?: unknown;
  bullets?: unknown;
};
type ScopeSection = { id?: unknown; heading?: unknown; type?: unknown; entries?: unknown };
type ScopeLike = { sections?: unknown; contextSections?: unknown } | null | undefined;

function clean(value: unknown, max = 20_000): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function sectionType(value: unknown): FlatResumeTarget["sectionType"] {
  return value === "skills" ? "skills" : value === "summary" ? "summary" : "standard";
}

function entryText(entry: ScopeEntry): string {
  const bullets = Array.isArray(entry.bullets) ? entry.bullets as ScopeBullet[] : [];
  return [
    entry.titleLeft,
    entry.titleRight,
    entry.subtitleLeft,
    entry.subtitleRight,
    ...bullets.map((bullet) => bullet?.text)
  ].map((value) => clean(value)).filter(Boolean).join("\n");
}

export function resumePolishSectionIsLocked(heading: string): boolean {
  const normalized = clean(heading, 120).toLowerCase();
  return isEducationHeading(normalized)
    || ["contact", "contact information", "personal information", "personal details"].includes(normalized);
}

function credentialTitle(entry: ScopeEntry): boolean {
  const degree = /^(?:(?:bachelor|master|associate)(?:[’']s)?\s+(?:of|in)\b|(?:doctoral|undergraduate|graduate|bachelor[’']?s?|master[’']?s?|associate[’']?s?)\s+degree\b|doctor\s+of\b|doctorate\b|ph\.?d\.?(?:\s|$)|[bm]\.?[as]\.?(?:c\.?)?(?:\s|$)|mba(?:\s|$))/i;
  return [entry.titleLeft, entry.subtitleLeft].some((value) => degree.test(clean(value)));
}

export function flattenResumeTargets(scope: ScopeLike): FlatResumeTarget[] {
  const sections = Array.isArray(scope?.sections) ? scope.sections as ScopeSection[] : [];
  const targets: Omit<FlatResumeTarget, "targetId">[] = [];
  for (const section of sections) {
    const sectionId = clean(section?.id, 120);
    const heading = clean(section?.heading, 120);
    const type = sectionType(section?.type);
    const entries = Array.isArray(section?.entries) ? section.entries as ScopeEntry[] : [];
    // Durable identity/contact/education locks override stale saved scope preferences.
    if (!sectionId || !heading || resumePolishSectionIsLocked(heading)) continue;
    for (const entry of entries) {
      const entryId = clean(entry?.id, 120);
      if (!entryId || (type === "standard" && credentialTitle(entry))) continue;
      const grounding = entryText(entry);
      if (type === "skills") {
        const text = clean(entry.subtitleLeft);
        if (text) {
          targets.push({
            kind: "skill-list",
            section: heading,
            currentText: text,
            target: { sectionId, entryId, field: "skill" },
            sectionType: type,
            entryText: grounding
          });
        }
      }
      const bullets = Array.isArray(entry.bullets) ? entry.bullets as ScopeBullet[] : [];
      for (const bullet of bullets) {
        const bulletId = clean(bullet?.id, 120);
        const text = clean(bullet?.text);
        if (!bulletId || !text) continue;
        targets.push({
          kind: "bullet",
          section: heading,
          currentText: text,
          target: { sectionId, entryId, bulletId, field: "bullet" },
          sectionType: type,
          entryText: grounding
        });
      }
    }
  }
  return targets.map((target, index) => ({
    targetId: `target-${index + 1}`,
    ...target
  }));
}

export function sanitizeResumePolishWireResult(raw: unknown): ResumePolishWireResult | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const status = clean(source.status, 20).toUpperCase();
  if (!(RESUME_POLISH_STATUSES as readonly string[]).includes(status)) return null;

  const changes: ResumePolishWireChange[] = [];
  if (!Array.isArray(source.changes)) return null;
  for (const item of source.changes) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const change = item as Record<string, unknown>;
    const targetId = clean(change.targetId, 40);
    const replacement = clean(change.replacement, 1400);
    if (!targetId || !replacement) return null;
    const reason = clean(change.reason, 240);
    changes.push({ targetId, replacement, ...(reason ? { reason } : {}) });
    if (changes.length === 12) break;
  }
  if ((status === "PROPOSAL") !== (changes.length > 0)) return null;

  const list = (value: unknown, max: number): string[] => {
    if (!Array.isArray(value)) return [];
    return value.map((item) => clean(item, max)).filter(Boolean).slice(0, 3);
  };
  const rawWithheld = source.withheld;
  if (!rawWithheld || typeof rawWithheld !== "object" || Array.isArray(rawWithheld)) return null;
  const withheldSource = rawWithheld as Record<string, unknown>;
  const count = typeof withheldSource.count === "number" && Number.isInteger(withheldSource.count)
    ? Math.max(0, Math.min(40, withheldSource.count))
    : 0;
  const reasons = Array.isArray(withheldSource.reasons)
    ? [...new Set(withheldSource.reasons
        .map((reason) => clean(reason, 24).toUpperCase())
        .filter((reason): reason is ResumePolishWithheldReason =>
          (RESUME_POLISH_WITHHELD_REASONS as readonly string[]).includes(reason)
        ))]
    : [];
  const omittedTargetCount = typeof source.omittedTargetCount === "number"
    && Number.isInteger(source.omittedTargetCount)
    ? Math.max(0, Math.min(1_000_000, source.omittedTargetCount))
    : 0;

  return {
    advice: sanitizeResumePolishAdvice(source.advice),
    status: status as ResumePolishStatus,
    changes,
    summary: list(source.summary, 260),
    omittedTargetCount,
    withheld: { count, reasons }
  };
}
