// Canonical, structured resume model. The editor owns this shape directly;
// ids exist only for in-session React keys and edit targeting and are never part
// of the portable `.resume` document format.

export type ResumeBullet = { id: string; text: string };

export type ResumeSectionType = "standard" | "skills" | "summary";

// UI-facing names for the section shapes, beside the model that defines them
// (the same pattern as FONT_FAMILY_OPTIONS in documentStyle.ts). Shared by the
// toolbar's Add-section popover and the editor's context menu.
export const SECTION_TYPE_OPTIONS = [
  { type: "standard", label: "Bulleted entries", description: "Roles, projects, or education" },
  { type: "summary", label: "Summary", description: "Short paragraphs" },
  { type: "skills", label: "Skill list", description: "Label and inline skills" }
] as const satisfies readonly { type: ResumeSectionType; label: string; description: string }[];

export type ResumeEntry = {
  id: string;
  titleLeft: string;
  titleRight: string;
  subtitleLeft: string;
  subtitleRight: string;
  bullets: ResumeBullet[];
};

export type ResumeSectionData = {
  id: string;
  heading: string;
  type: ResumeSectionType;
  items: ResumeEntry[];
};

export type ResumeData = {
  name: string;
  contact: string[];
  sections: ResumeSectionData[];
};

// Session-unique ids are deliberately opaque and disposable. Opening a file
// creates a fresh set rather than trusting user-controlled ids from disk.
let uidCounter = 0;

function uid(prefix: "bullet" | "entry" | "section"): string {
  uidCounter += 1;
  return `${prefix}-${uidCounter}`;
}

export function newBullet(text = ""): ResumeBullet {
  return { id: uid("bullet"), text };
}

export function newEntry(partial: Partial<Omit<ResumeEntry, "id" | "bullets">> = {}): ResumeEntry {
  return {
    id: uid("entry"),
    titleLeft: partial.titleLeft ?? "",
    titleRight: partial.titleRight ?? "",
    subtitleLeft: partial.subtitleLeft ?? "",
    subtitleRight: partial.subtitleRight ?? "",
    bullets: [newBullet()]
  };
}

export function newSkillEntry(label = "", skills = ""): ResumeEntry {
  return {
    id: uid("entry"),
    titleLeft: label,
    titleRight: "",
    subtitleLeft: skills,
    subtitleRight: "",
    bullets: []
  };
}

export function newSummaryEntry(text = ""): ResumeEntry {
  return {
    id: uid("entry"),
    titleLeft: "",
    titleRight: "",
    subtitleLeft: "",
    subtitleRight: "",
    bullets: [newBullet(text)]
  };
}

export function newSection(type: ResumeSectionType = "standard", heading?: string): ResumeSectionData {
  const resolvedHeading =
    heading ?? (type === "skills" ? "Skills" : type === "summary" ? "Summary" : "New Section");

  return {
    id: uid("section"),
    heading: resolvedHeading,
    type,
    items: [type === "skills" ? newSkillEntry() : type === "summary" ? newSummaryEntry() : newEntry()]
  };
}
