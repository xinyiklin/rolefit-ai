// Types + helpers shared across the section components.

import type { PolishedResume, ResumeAnalysis } from "../resumeEngine";

// "review" is gone as a tab: the recruiter review docks in the Resume tab's
// rail, and the local fit analytics live in the header's Fit popover.
// "pipeline" and "calendar" are gone as top-level tabs: they merged into
// "applications" as Table / Board / Calendar view switcher (TrackerTab).
// "cover" and "questions" are gone as separate tabs: they merged into
// "materials" (cover letter + application questions, step 2 of tab IA consolidation).
export type OutputTab = "resume" | "materials" | "applications" | "analytics";

// Rail groups for the numbered table-of-contents sidebar.
export type OutputTabGroup = "DRAFT" | "TRACK";

export type OutputTabDescriptor = {
  id: OutputTab;
  label: string;
  badge?: string | number;
  /** Two-digit index displayed in the numbered rail, e.g. "01".
   *  When absent, StudioPane derives it from the tab's position (1-based). */
  index?: string;
  /** Rail group this tab belongs to ("DRAFT" or "TRACK").
   *  When absent, StudioPane derives it from the tab id. */
  group?: OutputTabGroup;
};

// Canonical group membership for the numbered rail.
// DRAFT: Resume + Materials (cover letter + application questions); TRACK: tracker + analytics.
export const TAB_GROUPS: Record<OutputTab, OutputTabGroup> = {
  resume:       "DRAFT",
  materials:    "DRAFT",
  applications: "TRACK",
  analytics:    "TRACK",
};

// Application Questions tab: drafted answers to supplemental application
// questions, plus a short description per work-experience role. Mirrors the
// /api/application-answers response shape.
export type GeneratedAnswer = { question: string; answer: string; needsInput: boolean };
export type GeneratedRoleDescription = { role: string; description: string };
export type ApplicationAnswersResult = {
  answers: GeneratedAnswer[];
  roleDescriptions: GeneratedRoleDescription[];
} | null;

export type ResumeBlockKind = "contact" | "section" | "bullet" | "text";

export type ResumeBlock = {
  id: string;
  kind: ResumeBlockKind;
  text: string;
};

export type ScoreSource = PolishedResume | ResumeAnalysis | null;

// Before/after fit numbers for the original (base) vs. tailored resume against
// one job. `source` records whether the numbers came from the AI judge (scored
// both in one call) or the deterministic local engine fallback.
export type FitComparison = {
  source: "ai" | "local";
  base: number;
  tailored: number;
  reason: string;
};

export function scoreLabel(score: number) {
  if (score >= 85) return "Strong";
  if (score >= 70) return "Good";
  if (score >= 55) return "Needs polish";
  return "Needs work";
}

export function blockKindLabel(kind: ResumeBlockKind) {
  return (
    {
      contact: "Contact",
      section: "Section",
      bullet: "Bullet",
      text: "Text"
    }[kind] ?? "Text"
  );
}

export function formatShortDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "2-digit" });
  } catch {
    return iso;
  }
}

export function formatRelativeAge(iso: string) {
  if (!iso) return "";
  try {
    const ms = Date.now() - new Date(iso).getTime();
    const days = Math.floor(ms / 86_400_000);
    if (days < 1) return "today";
    if (days === 1) return "1d ago";
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    if (days < 365) return `${Math.floor(days / 30)}mo ago`;
    return `${Math.floor(days / 365)}y ago`;
  } catch {
    return "";
  }
}
