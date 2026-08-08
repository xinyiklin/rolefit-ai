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

export type ResumePolishWireResult = {
  status: ResumePolishStatus;
  changes: ResumePolishWireChange[];
  summary: string[];
  remainingGaps: string[];
  withheld: {
    count: number;
    reasons: ResumePolishWithheldReason[];
  };
};

export type ResumePolishEditorTarget = {
  sectionId: string;
  entryId: string;
  bulletId?: string;
  field: "bullet" | "skill" | "titleLeft" | "titleRight" | "subtitleLeft" | "subtitleRight";
};

export type FlatResumeTarget = {
  targetId: string;
  kind: "bullet" | "skills" | "field";
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

function clean(value: unknown, max = 1200): string {
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

function looksLikeDate(value: string): boolean {
  return /\b(?:(?:19|20)\d{2}|present|current|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i.test(value);
}

export function resumePolishSectionIsLocked(heading: string): boolean {
  const normalized = clean(heading, 120).toLowerCase();
  return /\b(?:education|academic)\b/.test(normalized)
    || ["contact", "contact information", "personal information", "personal details"].includes(normalized);
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
      if (!entryId) continue;
      const grounding = entryText(entry);
      const addField = (
        field: ResumePolishEditorTarget["field"],
        currentText: unknown,
        kind: FlatResumeTarget["kind"] = "field"
      ) => {
        const text = clean(currentText);
        if (!text || looksLikeDate(text)) return;
        targets.push({
          kind,
          section: heading,
          currentText: text,
          target: { sectionId, entryId, field },
          sectionType: type,
          entryText: grounding
        });
      };
      if (type === "skills") {
        addField("skill", entry.subtitleLeft, "skills");
        addField("titleLeft", entry.titleLeft);
      } else if (type === "standard") {
        addField("titleLeft", entry.titleLeft);
        addField("titleRight", entry.titleRight);
        addField("subtitleLeft", entry.subtitleLeft);
        addField("subtitleRight", entry.subtitleRight);
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
  return targets.slice(0, 160).map((target, index) => ({
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

  return {
    status: status as ResumePolishStatus,
    changes,
    summary: list(source.summary, 260),
    remainingGaps: list(source.remainingGaps, 260),
    withheld: { count, reasons }
  };
}
