import { newBullet } from "@typeset/engine/lib/resumeData.ts";

import { linkProfileBlocks, linkedProfileHeadings } from "../../shared/candidateProfileContract.ts";
import { flattenResumeTargets, type ResumePolishWireResult } from "../../shared/resumePolishContract.ts";
import type { ResumeProposalSuggestion } from "../resume/types.ts";
import { ApiError } from "./failures.ts";
import type { buildResumePolishScope } from "./resumePolishScope.ts";

// Maps a Resume Polish response onto the targets this client derived from the
// exact scope and candidate context it sent. A change whose server target
// disagrees fails the whole proposal rather than editing a different field.
export function proposalSuggestions(
  data: ResumePolishWireResult,
  resumeScope: ReturnType<typeof buildResumePolishScope>,
  candidateContext: string
): ResumeProposalSuggestion[] {
  const targets = new Map(flattenResumeTargets(resumeScope, candidateContext).map((target) => [target.targetId, target]));
  const bulletIds = (targetIds: string[]) => targetIds.map((id) => targets.get(id)?.target.bulletId ?? "");
  // Every heading linked to the entry, qualifiers included: the model cannot
  // say which block it used, so a surprising link must stay visible.
  const sources = linkedProfileHeadings(resumeScope, candidateContext);
  const blocks = linkProfileBlocks(resumeScope, candidateContext);
  return data.changes.map((change) => {
    const target = targets.get(change.targetId);
    const echo = change.target;
    if (
      !target
      || !echo
      || echo.sectionId !== target.target.sectionId
      || echo.entryId !== target.target.entryId
      || (echo.bulletId ?? "") !== (target.target.bulletId ?? "")
    ) {
      throw new ApiError("Resume Polish returned an invalid outcome", 422);
    }
    const common = {
      id: change.targetId,
      sectionHeading: target.section,
      reason: change.reason ?? "",
      warnings: change.warnings,
      ...(target.sectionType === "standard" && blocks.has(target.target.entryId) ? { profileEvidence: blocks.get(target.target.entryId) } : {})
    };
    if (change.action === "remove" || change.order) {
      const entryOrder = [...targets.values()]
        .filter((item) => item.kind === "bullet" && item.target.entryId === target.target.entryId && item.target.sectionId === target.target.sectionId)
        .map((item) => item.target.bulletId ?? "");
      const expected = target.bulletTargetIds ?? [];
      const order = change.order ?? [];
      if (change.action === "remove"
        ? target.kind !== "bullet" || target.sectionType !== "standard"
        : target.kind !== "bullet-order" || order.length !== expected.length || new Set(order).size !== order.length || !order.every((id) => expected.includes(id))) {
        throw new ApiError("Resume Polish returned an invalid outcome", 422);
      }
      return change.action === "remove"
        ? { ...common, kind: "remove" as const, target: target.target, currentText: target.currentText, proposedText: "", originalOrder: entryOrder }
        : { ...common, kind: "reorder" as const, target: target.target, currentText: "", proposedText: "",
            originalOrder: bulletIds(expected), proposedOrder: bulletIds(order) };
    }
    if (change.replacement === undefined || target.kind === "bullet-order") throw new ApiError("Resume Polish returned an invalid outcome", 422);
    const added = target.kind === "new-bullet";
    return {
      ...common,
      // A new bullet gets its id now, so Accept inserts and Undo removes exactly it.
      target: added ? { ...target.target, bulletId: newBullet().id } : target.target,
      ...(added ? { kind: "add" as const } : {}),
      currentText: target.currentText,
      proposedText: change.replacement,
      ...(change.evidence ? { evidence: change.evidence } : {}),
      ...(change.evidence && sources.has(target.target.entryId) ? { profileSource: sources.get(target.target.entryId)!.join("; ") } : {})
    };
  });
}
