import { hasMarkupTag } from "./contentWarnings.ts";

// What Resume and Cover Polish are told about the current Fit Assessment: posting
// excerpts only. Fit's candidate excerpts and notes are model output, so they
// never travel here and can never be read as evidence.
export const POLISH_FIT_FINDINGS_ITEM_LIMIT = 3;
export const POLISH_FIT_FINDINGS_EXCERPT_LIMIT = 500;
export const FIT_GAP_STATUSES = ["ADDRESSED", "NO_EVIDENCE"] as const;
export const FIT_GAP_IDS = Array.from({ length: POLISH_FIT_FINDINGS_ITEM_LIMIT }, (_, index) => `gap-${index + 1}`);

export type PolishFitFindings = {
  // The resume or Background changed since the assessment, or a saved
  // assessment whose inputs cannot be confirmed.
  earlierVersion: boolean;
  matches: Array<{ jobExcerpt: string; relationship?: "direct" | "transferable" }>;
  gaps: Array<{ id: string; jobExcerpt: string }>;
};

export type FitGapStatus = (typeof FIT_GAP_STATUSES)[number];
// What a rail shows per gap; Not reported covers a missing statement and one
// whose cited edits no longer stand.
export type FitGapDisplayStatus = FitGapStatus | "NOT_REPORTED";
export type FitGapStatement<Ref extends string | number> = { gap: string; status: FitGapStatus; refs: Ref[] };

// Control, bidi, and invisible characters, and the fullwidth bracket, which could
// hide a fence-shaped tag from neutralization.
const UNSAFE_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f­​-‏‪-‮⁦-⁩﻿＜]/;

export function isPolishFitExcerpt(value: unknown): value is string {
  return typeof value === "string"
    && Boolean(value.trim())
    && value.length <= POLISH_FIT_FINDINGS_EXCERPT_LIMIT
    && !UNSAFE_CHARACTERS.test(value)
    && !hasMarkupTag(value);
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

// Absent is null. Anything the client should never send is "invalid": the route
// answers 400 rather than guessing which part of a malformed block to trust.
export function parsePolishFitFindings(raw: unknown): PolishFitFindings | null | "invalid" {
  if (raw === undefined) return null;
  if (!plainObject(raw) || !onlyKeys(raw, ["earlierVersion", "matches", "gaps"])) return "invalid";
  const { earlierVersion, matches, gaps } = raw;
  if (typeof earlierVersion !== "boolean" || !Array.isArray(matches) || !Array.isArray(gaps)) return "invalid";
  if (matches.length > POLISH_FIT_FINDINGS_ITEM_LIMIT || gaps.length > POLISH_FIT_FINDINGS_ITEM_LIMIT) return "invalid";
  if (!matches.length && !gaps.length) return "invalid";
  const parsedMatches: PolishFitFindings["matches"] = [];
  for (const item of matches) {
    if (!plainObject(item) || !onlyKeys(item, ["jobExcerpt", "relationship"]) || !isPolishFitExcerpt(item.jobExcerpt)) return "invalid";
    if (item.relationship !== undefined && item.relationship !== "direct" && item.relationship !== "transferable") return "invalid";
    parsedMatches.push({ jobExcerpt: item.jobExcerpt, ...(item.relationship ? { relationship: item.relationship } : {}) });
  }
  const parsedGaps: PolishFitFindings["gaps"] = [];
  for (const [index, item] of gaps.entries()) {
    if (!plainObject(item) || !onlyKeys(item, ["id", "jobExcerpt"]) || item.id !== `gap-${index + 1}` || !isPolishFitExcerpt(item.jobExcerpt)) return "invalid";
    parsedGaps.push({ id: item.id, jobExcerpt: item.jobExcerpt });
  }
  return { earlierVersion, matches: parsedMatches, gaps: parsedGaps };
}

// The model's per-gap statements are optional, display-only feedback: anything
// unusable is dropped, never an error. ADDRESSED must cite at least one valid
// reference, so a statement whose changes were withheld reads as Not reported.
export function sanitizeFitGapStatements<Ref extends string | number>(
  raw: unknown,
  gapIds: readonly string[],
  refField: string,
  isValidRef: (value: unknown) => value is Ref
): FitGapStatement<Ref>[] {
  if (!Array.isArray(raw) || !gapIds.length) return [];
  const seen = new Set<string>();
  const statements: FitGapStatement<Ref>[] = [];
  for (const item of raw.slice(0, 10)) {
    if (!plainObject(item) || typeof item.gap !== "string" || !gapIds.includes(item.gap) || seen.has(item.gap)) continue;
    const status = typeof item.status === "string" ? item.status.trim().toUpperCase() : "";
    if (!(FIT_GAP_STATUSES as readonly string[]).includes(status)) continue;
    const refs = status === "ADDRESSED" && Array.isArray(item[refField])
      ? [...new Set((item[refField] as unknown[]).filter(isValidRef))]
      : [];
    if (status === "ADDRESSED" && !refs.length) continue;
    seen.add(item.gap);
    statements.push({ gap: item.gap, status: status as FitGapStatus, refs });
  }
  return statements;
}

// Cover statements, read by the server and again by the client: only gaps the
// run sent, and only paragraphs this letter has.
export function coverFitGapStatements(raw: unknown, findings: PolishFitFindings, paragraphCount: number) {
  return sanitizeFitGapStatements(raw, findings.gaps.map((gap) => gap.id), "paragraphs",
    (value): value is number => Number.isInteger(value) && (value as number) >= 1 && (value as number) <= paragraphCount)
    .map(({ gap, status, refs }) => ({ gap, status, paragraphs: refs }));
}

export function fitFindingsPromptBlock(findings: PolishFitFindings): string {
  return JSON.stringify({
    assessment: findings.earlierVersion ? "earlier resume or Background version" : "current resume and Background",
    matches: findings.matches,
    gaps: findings.gaps
  });
}
