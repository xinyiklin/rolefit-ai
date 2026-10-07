// Types + helpers shared across the section components.

// "review" is gone as a tab: the Resume proposal
// live in the Resume tab's rail.
// "pipeline" and "calendar" are gone as top-level tabs: they merged into
// "applications" as a Table / Calendar view switcher (TrackerTab).
// Cover letters are a first-class editable document. The retained materials
// tab id now hosts Answers; it keeps existing tab-selection preferences valid.
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
// PREPARE: job intake; DRAFT: Resume + Cover letter + Answers;
// TRACK: tracker + analytics.
export const TAB_GROUPS: Record<OutputTab, OutputTabGroup> = {
  prepare:      "PREPARE",
  resume:       "DRAFT",
  cover:        "DRAFT",
  materials:    "DRAFT",
  applications: "TRACK",
  analytics:    "TRACK",
};
