import type { ResumeData } from "@typeset/engine/lib/resumeData.ts";
import { stripInlineMarks } from "@typeset/engine/lib/inlineMarksText.ts";

export type ApplicationRoleEvidenceInput = {
  label: string;
  bullets: string[];
};

// Role-description drafts are for employment history, not every STANDARD
// section (projects and education share that mechanical editor shape). Keep the
// heading classifier deliberately narrow; an unusual heading can still use the
// question-answer flow, while claiming a project is a past employer would be a
// much worse failure.
const WORK_EXPERIENCE_HEADING = /\b(?:experience|employment|work history|professional background|career history)\b/i;

// Build the structured, per-role evidence boundary sent to the server. The
// server revalidates and assigns request-local ids; client session ids never
// enter the prompt or response contract.
export function buildApplicationRoleEvidence(data: ResumeData | null): ApplicationRoleEvidenceInput[] {
  if (!data) return [];
  const roles: ApplicationRoleEvidenceInput[] = [];
  for (const section of data.sections) {
    if (section.type !== "standard" || !WORK_EXPERIENCE_HEADING.test(section.heading)) continue;
    for (const entry of section.items) {
      // The AI request's serialized resume is plain text. Strip the editor's
      // legal <b>/<i>/<u> marks here too so the server's exact role-evidence
      // check compares the same representation instead of rejecting formatted
      // but otherwise identical labels/bullets.
      const label = [entry.titleLeft, entry.subtitleLeft, entry.titleRight, entry.subtitleRight]
        .map((value) => stripInlineMarks(value).trim())
        .filter(Boolean)
        .join(" | ");
      const bullets = entry.bullets.map((bullet) => stripInlineMarks(bullet.text).trim()).filter(Boolean);
      if (!label || !bullets.length) continue;
      roles.push({ label, bullets });
      if (roles.length >= 20) return roles;
    }
  }
  return roles;
}
