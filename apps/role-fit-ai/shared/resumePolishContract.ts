import { INLINE_MARK_TAG_PATTERN } from "@typeset/engine/lib/inlineMarksText.ts";

import { linkProfileBlocks } from "./candidateProfileContract.ts";
import { hasMarkupTag, sanitizeContentWarnings } from "./contentWarnings.ts";
import { FIT_GAP_IDS, sanitizeFitGapStatements, type FitGapStatus } from "./polishFitFindings.ts";
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

// A change carries exactly one operation: a replacement, a bullet removal, or
// an "order-N" target's new bullet order (bullet targetIds).
export type ResumePolishWireChange = {
  targetId: string;
  // The server's own target for targetId; the client rejects a proposal whose
  // echo disagrees with the target it derived, rather than editing the wrong field.
  target?: { sectionId: string; entryId: string; bulletId?: string };
  replacement?: string;
  action?: "remove";
  order?: string[];
  reason?: string;
  // Set when the edit relies on the entry's linked Profile text.
  evidence?: "profile";
  warnings?: string[];
};

// "add-from-profile" suggests a Profile item no resume entry covers; it names
// no entry and quotes the Profile instead.
export const RESUME_POLISH_ADVICE_KINDS = ["emphasis", "order", "space", "missing-evidence", "add-from-profile"] as const;

export type ResumePolishAdvice = {
  kind: (typeof RESUME_POLISH_ADVICE_KINDS)[number];
  sectionId: string;
  entryId: string;
  jobExcerpt: string;
  candidateExcerpt: string;
  profileExcerpt?: string;
  rationale: string;
  warnings?: string[];
};

export function sanitizeResumePolishAdvice(raw: unknown): ResumePolishAdvice[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 3).flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const value = item as Record<string, unknown>;
    if (!(RESUME_POLISH_ADVICE_KINDS as readonly string[]).includes(String(value.kind))) return [];
    if (typeof value.rationale !== "string" || !value.rationale.trim() || value.rationale.length > 500 || hasMarkupTag(value.rationale)) return [];
    for (const key of ["sectionId", "entryId", "jobExcerpt", "candidateExcerpt", "profileExcerpt"]) {
      if (value[key] !== undefined && (typeof value[key] !== "string" || value[key].length > 500)) return [];
    }
    return [{
      kind: value.kind as ResumePolishAdvice["kind"],
      sectionId: (value.sectionId as string) ?? "",
      entryId: (value.entryId as string) ?? "",
      jobExcerpt: (value.jobExcerpt as string) ?? "",
      candidateExcerpt: (value.candidateExcerpt as string) ?? "",
      ...(value.profileExcerpt ? { profileExcerpt: value.profileExcerpt as string } : {}),
      ...(value.warnings !== undefined ? { warnings: sanitizeContentWarnings(value.warnings) } : {}),
      rationale: value.rationale as string
    }];
  });
}

// The opt-in Polish review only keeps or holds back sanitized changes. A held-back
// change stays restorable; UNAVAILABLE means the review failed open.
export const RESUME_POLISH_REVIEW_OUTCOMES = ["REVIEWED", "UNAVAILABLE"] as const;
export const RESUME_POLISH_REVIEW_REASONS = ["LOW_IMPACT", "INCORRECT"] as const;
export const RESUME_POLISH_REVIEW_NOTE_LIMIT = 160;

export type ResumePolishReviewReason = (typeof RESUME_POLISH_REVIEW_REASONS)[number];
export type ResumePolishHeldBackChange = {
  change: ResumePolishWireChange;
  reason: ResumePolishReviewReason;
  note?: string;
};
export type ResumePolishReview = {
  outcome: (typeof RESUME_POLISH_REVIEW_OUTCOMES)[number];
  attempts: number;
  heldBack: ResumePolishHeldBackChange[];
};

export type ResumePolishWireResult = {
  advice?: ResumePolishAdvice[];
  warnings?: string[];
  status: ResumePolishStatus;
  changes: ResumePolishWireChange[];
  summary: string[];
  omittedTargetCount: number;
  withheld: {
    count: number;
    reasons: ResumePolishWithheldReason[];
  };
  review?: ResumePolishReview;
  // Present only when Fit findings with gaps were sent; display-only.
  fitGaps?: Array<{ gap: string; status: FitGapStatus; targetIds: string[] }>;
};

export type ResumePolishEditorTarget = {
  sectionId: string;
  entryId: string;
  bulletId?: string;
  field: "bullet" | "skill";
};

// A "new-bullet" target is an empty slot at the end of an entry whose Profile
// text is linked; its target carries no bulletId until the client assigns one.
// A "bullet-order" target is a standard entry's bullet order, as its bullet targetIds.
export type FlatResumeTarget = {
  targetId: string;
  kind: "bullet" | "skill-list" | "new-bullet" | "bullet-order";
  section: string;
  currentText: string;
  target: ResumePolishEditorTarget;
  sectionType: "skills" | "summary" | "standard";
  entryText: string;
  // The entry's linked Profile text, "" when none links to it.
  profileText: string;
  bulletTargetIds?: string[];
};

export const NEW_BULLETS_PER_ENTRY = 2;

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

const STRUCTURAL_MARK_RE = new RegExp(INLINE_MARK_TAG_PATTERN, "gi");

// The server strips structural (non b/i/u) marks from the scope before
// polishing, so every inclusion, lock, and id decision here uses the same view.
export function stripStructuralInlineMarks(value: unknown): string {
  STRUCTURAL_MARK_RE.lastIndex = 0;
  return String(value ?? "").replace(
    STRUCTURAL_MARK_RE,
    (tag) => /^<\/?(?:b|i|u)>$/i.test(tag) ? tag : ""
  );
}

function structuralClean(value: unknown, max = 20_000): string {
  return typeof value === "string" ? clean(stripStructuralInlineMarks(value), max) : "";
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
  // Any inline mark, even bold, must not hide an Education or contact heading.
  const normalized = clean(String(heading ?? "").replace(/<\/?[a-z][^>]*>/gi, ""), 120).toLowerCase();
  return isEducationHeading(normalized)
    || ["contact", "contact information", "personal information", "personal details"].includes(normalized);
}

function credentialTitle(entry: ScopeEntry): boolean {
  const degree = /^(?:(?:bachelor|master|associate)(?:[’']s)?\s+(?:of|in)\b|(?:doctoral|undergraduate|graduate|bachelor[’']?s?|master[’']?s?|associate[’']?s?)\s+degree\b|doctor\s+of\b|doctorate\b|ph\.?d\.?(?:\s|$)|[bm]\.?[as]\.?(?:c\.?)?(?:\s|$)|mba(?:\s|$))/i;
  return [entry.titleLeft, entry.subtitleLeft].some((value) => degree.test(structuralClean(value)));
}

// Server and client must call this with the same scope and candidate context:
// both derive the positional target ids the proposal refers to.
export function flattenResumeTargets(scope: ScopeLike, candidateContext = ""): FlatResumeTarget[] {
  const sections = Array.isArray(scope?.sections) ? scope.sections as ScopeSection[] : [];
  const linked = linkProfileBlocks(scope, candidateContext);
  const targets: Omit<FlatResumeTarget, "targetId">[] = [];
  const additions: Omit<FlatResumeTarget, "targetId">[] = [];
  const orders: Array<Omit<FlatResumeTarget, "targetId"> & { bulletIndexes: number[] }> = [];
  for (const section of sections) {
    const sectionId = clean(section?.id, 120);
    const heading = structuralClean(section?.heading, 120);
    const type = sectionType(section?.type);
    const entries = Array.isArray(section?.entries) ? section.entries as ScopeEntry[] : [];
    // Durable identity/contact/education locks override stale saved scope preferences.
    if (!sectionId || !heading || resumePolishSectionIsLocked(heading)) continue;
    for (const entry of entries) {
      const entryId = clean(entry?.id, 120);
      if (!entryId || (type === "standard" && credentialTitle(entry))) continue;
      const grounding = entryText(entry);
      const profileText = type === "standard" ? linked.get(entryId) ?? "" : "";
      if (type === "skills") {
        const text = clean(entry.subtitleLeft);
        if (structuralClean(entry.subtitleLeft)) {
          targets.push({
            kind: "skill-list",
            section: heading,
            currentText: text,
            target: { sectionId, entryId, field: "skill" },
            sectionType: type,
            entryText: grounding,
            profileText
          });
        }
      }
      const bullets = Array.isArray(entry.bullets) ? entry.bullets as ScopeBullet[] : [];
      const bulletIndexes: number[] = [];
      for (const bullet of bullets) {
        const bulletId = clean(bullet?.id, 120);
        const text = clean(bullet?.text);
        if (!bulletId || !structuralClean(bullet?.text)) continue;
        bulletIndexes.push(targets.length);
        targets.push({
          kind: "bullet",
          section: heading,
          currentText: text,
          target: { sectionId, entryId, bulletId, field: "bullet" },
          sectionType: type,
          entryText: grounding,
          profileText
        });
      }
      if (type === "standard" && bulletIndexes.length >= 2) {
        orders.push({
          kind: "bullet-order",
          section: heading,
          currentText: "",
          target: { sectionId, entryId, field: "bullet" },
          sectionType: type,
          entryText: grounding,
          profileText,
          bulletIndexes
        });
      }
      if (profileText) {
        for (let slot = 0; slot < NEW_BULLETS_PER_ENTRY; slot += 1) {
          additions.push({
            kind: "new-bullet",
            section: heading,
            currentText: "",
            target: { sectionId, entryId, field: "bullet" },
            sectionType: type,
            entryText: grounding,
            profileText
          });
        }
      }
    }
  }
  return [
    ...targets.map((target, index) => ({ targetId: `target-${index + 1}`, ...target })),
    ...orders.map(({ bulletIndexes, ...target }, index) => ({
      targetId: `order-${index + 1}`,
      ...target,
      bulletTargetIds: bulletIndexes.map((bulletIndex) => `target-${bulletIndex + 1}`)
    })),
    ...additions.map((target, index) => ({ targetId: `add-${index + 1}`, ...target }))
  ];
}

function parseWireChange(item: unknown): ResumePolishWireChange | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const change = item as Record<string, unknown>;
  const targetId = clean(change.targetId, 40);
  const remove = change.action === "remove";
  const order = Array.isArray(change.order) ? change.order.map((id) => clean(id, 40)) : null;
  const replacement = clean(change.replacement, 1400);
  const operations = [change.replacement, change.action, change.order].filter((value) => value !== undefined).length;
  if (!targetId || operations !== 1 || (change.action !== undefined && !remove)) return null;
  if (order ? !order.length || order.length > 40 || order.some((id) => !id) : !remove && !replacement) return null;
  const reason = clean(change.reason, 240);
  const echo = change.target && typeof change.target === "object" && !Array.isArray(change.target)
    ? change.target as Record<string, unknown>
    : null;
  return {
    targetId,
    ...(echo ? {
      target: {
        sectionId: clean(echo.sectionId, 120),
        entryId: clean(echo.entryId, 120),
        ...(echo.bulletId ? { bulletId: clean(echo.bulletId, 120) } : {})
      }
    } : {}),
    ...(order ? { order } : remove ? { action: "remove" as const } : { replacement }),
    ...(reason ? { reason } : {}),
    ...(change.evidence === "profile" ? { evidence: "profile" as const } : {}),
    ...(change.warnings !== undefined ? { warnings: sanitizeContentWarnings(change.warnings) } : {})
  };
}

// Held-back changes pass the same checks as kept ones, never share a target with
// them, and exist only beside a review the server actually ran.
function parseWireReview(raw: unknown, status: ResumePolishStatus, changes: ResumePolishWireChange[]): ResumePolishReview | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const outcome = source.outcome;
  if (!(RESUME_POLISH_REVIEW_OUTCOMES as readonly unknown[]).includes(outcome)) return null;
  if (typeof source.attempts !== "number" || !Number.isInteger(source.attempts) || source.attempts < 0 || source.attempts > 10) return null;
  if (!Array.isArray(source.heldBack) || changes.length + source.heldBack.length > 12) return null;
  const targetIds = new Set(changes.map((change) => change.targetId));
  const heldBack: ResumePolishHeldBackChange[] = [];
  for (const item of source.heldBack) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const entry = item as Record<string, unknown>;
    const change = parseWireChange(entry.change);
    if (!change || targetIds.has(change.targetId)) return null;
    if (!(RESUME_POLISH_REVIEW_REASONS as readonly unknown[]).includes(entry.reason)) return null;
    if (entry.note !== undefined && (typeof entry.note !== "string" || !entry.note.trim()
      || entry.note.length > RESUME_POLISH_REVIEW_NOTE_LIMIT || hasMarkupTag(entry.note))) return null;
    targetIds.add(change.targetId);
    heldBack.push({ change, reason: entry.reason as ResumePolishReviewReason, ...(entry.note ? { note: entry.note as string } : {}) });
  }
  if (status === "WITHHELD" || changes.length + heldBack.length === 0) return null;
  if (outcome === "UNAVAILABLE" && (heldBack.length || status !== "PROPOSAL")) return null;
  if (outcome === "REVIEWED" && !changes.length && (status !== "NO_CHANGES" || !heldBack.length)) return null;
  return { outcome: outcome as ResumePolishReview["outcome"], attempts: source.attempts, heldBack };
}

export function sanitizeResumePolishWireResult(raw: unknown): ResumePolishWireResult | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const status = clean(source.status, 20).toUpperCase();
  if (!(RESUME_POLISH_STATUSES as readonly string[]).includes(status)) return null;

  const changes: ResumePolishWireChange[] = [];
  if (!Array.isArray(source.changes)) return null;
  for (const item of source.changes) {
    const change = parseWireChange(item);
    if (!change) return null;
    changes.push(change);
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

  const review = source.review === undefined ? undefined : parseWireReview(source.review, status as ResumePolishStatus, changes);
  if (review === null) return null;
  // Optional display-only statements; a held-back change stays citable because
  // Restore can bring it back.
  const citable = new Set([...changes, ...(review?.heldBack ?? []).map((item) => item.change)].map((change) => change.targetId));
  const fitGaps = sanitizeFitGapStatements(source.fitGaps, FIT_GAP_IDS, "targetIds",
    (value): value is string => typeof value === "string" && citable.has(value))
    .map(({ gap, status: gapStatus, refs }) => ({ gap, status: gapStatus, targetIds: refs }));

  return {
    advice: sanitizeResumePolishAdvice(source.advice),
    ...(source.warnings !== undefined ? { warnings: sanitizeContentWarnings(source.warnings) } : {}),
    status: status as ResumePolishStatus,
    changes,
    summary: list(source.summary, 260),
    omittedTargetCount,
    withheld: { count, reasons },
    ...(review ? { review } : {}),
    ...(fitGaps.length ? { fitGaps } : {})
  };
}
