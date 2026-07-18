import type { ResumeData } from "@typeset/engine/lib/resumeData.ts";
import { fieldKey } from "@typeset/engine/typeset/types.ts";
import type { TailorChangeTarget } from "../resume/types.ts";

// Review navigation is a RoleFit concern, but the key uses the engine's
// provenance identity so highlighting and editor selection address the exact
// shared Typeset field. Empty optional fields intentionally keep their real key
// instead of falling back to a nearby visible value.
export function fieldKeyForReviewTarget(data: ResumeData, target: TailorChangeTarget | null): string | null {
  if (!target?.entryId) return null;
  const section = data.sections.find((item) => item.id === target.sectionId);
  const entry = section?.items.find((item) => item.id === target.entryId);
  if (!section || !entry) return null;

  if (target.field === "bullet") {
    const bullet = entry.bullets.find((item) => item.id === target.bulletId);
    return bullet
      ? fieldKey({ kind: "bullet", sectionId: section.id, entryId: entry.id, bulletId: bullet.id })
      : null;
  }
  if (target.field === "skill") {
    return fieldKey({ kind: "skillsRow", sectionId: section.id, entryId: entry.id });
  }
  return fieldKey({ kind: "entry", sectionId: section.id, entryId: entry.id, field: target.field });
}
