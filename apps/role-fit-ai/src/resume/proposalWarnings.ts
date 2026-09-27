import type { FlatResumeTarget } from "../../shared/resumePolishContract.ts";
import type { PolishedResume, ResumeProposalTarget } from "./types.ts";

export type ResumeSourceConcern = { target: ResumeProposalTarget; originalText: string; warnings: string[] };
export function sameProposalTarget(a: ResumeProposalTarget, b: ResumeProposalTarget): boolean {
  return a.sectionId === b.sectionId && a.entryId === b.entryId && a.bulletId === b.bulletId && a.field === b.field;
}

export function currentResumeConcerns(previous: PolishedResume | null, targets: FlatResumeTarget[], generation: number): ResumeSourceConcern[] {
  if (!previous || previous.documentGeneration !== generation) return [];
  const candidates = [
    ...(previous.sourceConcerns ?? []),
    ...(previous.suggestedChanges ?? []).filter((suggestion) => suggestion.warnings?.length)
      .map((suggestion) => ({ target: suggestion.target, originalText: suggestion.currentText, warnings: suggestion.warnings! }))
  ];
  const concerns: ResumeSourceConcern[] = [];
  for (const concern of candidates) {
    const current = targets.find((target) => sameProposalTarget(target.target, concern.target));
    if (!current || current.currentText === concern.originalText || concerns.some((item) => sameProposalTarget(item.target, concern.target))) continue;
    concerns.push(concern);
  }
  return concerns;
}
