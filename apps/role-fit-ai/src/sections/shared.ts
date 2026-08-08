// Types + helpers shared across the section components.

// "review" is gone as a tab: the AI recruiter review docks in the Resume tab's
// rail.
// "pipeline" and "calendar" are gone as top-level tabs: they merged into
// "applications" as a Table / Calendar view switcher (TrackerTab).
// Cover letters are a first-class editable document again. Materials remains
// focused on application questions and role-description drafts.
export type OutputTab = "prepare" | "resume" | "cover" | "materials" | "applications" | "analytics";

// Rail groups for the sidebar tab list.
export type OutputTabGroup = "PREPARE" | "DRAFT" | "TRACK";

export type OutputTabDescriptor = {
  id: OutputTab;
  label: string;
  badge?: string | number;
  /** Rail group this tab belongs to ("PREPARE", "DRAFT", or "TRACK").
   *  When absent, StudioPane derives it from the tab id. */
  group?: OutputTabGroup;
};

// Canonical group membership for the sidebar rail.
// PREPARE: job intake; DRAFT: Resume + Cover letter + Materials;
// TRACK: tracker + analytics.
export const TAB_GROUPS: Record<OutputTab, OutputTabGroup> = {
  prepare:      "PREPARE",
  resume:       "DRAFT",
  cover:        "DRAFT",
  materials:    "DRAFT",
  applications: "TRACK",
  analytics:    "TRACK",
};

// Application Questions tab: drafted answers to supplemental application
// questions, plus a short description per work-experience role. Mirrors the
// /api/application-answers response shape.
export type GeneratedAnswer = { question: string; answer: string; needsInput: boolean };
export type GeneratedRoleDescription = { role: string; description: string; needsInput: boolean };
export type ApplicationAnswersResult = {
  answers: GeneratedAnswer[];
  roleDescriptions: GeneratedRoleDescription[];
} | null;

// Before/after fit numbers for the original (base) vs. tailored resume against
// one job. AI Review scores both in one call; there is no local fallback.
export type FitComparison = {
  source: "ai";
  base: number;
  tailored: number;
  reason: string;
};
