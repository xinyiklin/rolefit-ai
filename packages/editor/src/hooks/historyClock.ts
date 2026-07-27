export type HistoryClock = Readonly<{
  nextSequence(): number;
  noteUndo(sequence: number): number;
  noteRedo(sequence: number): void;
  reset(): void;
  currentBranch(): number;
  currentGeneration(): number;
  isCurrentRedoBranch(branch: number): boolean;
  isCurrentGeneration(generation: number): boolean;
}>;

// Each document owns a clock so content and style share order without coupling editors.
export function createHistoryClock(): HistoryClock {
  let sequence = 0;
  let branch = 0;
  let generation = 0;
  const undoneSequences = new Set<number>();
  return Object.freeze({
    nextSequence() {
      if (undoneSequences.size > 0) {
        branch += 1;
        undoneSequences.clear();
      }
      sequence += 1;
      return sequence;
    },
    noteUndo(value) {
      undoneSequences.add(value);
      return branch;
    },
    noteRedo(value) {
      undoneSequences.delete(value);
    },
    reset() {
      branch += 1;
      generation += 1;
      undoneSequences.clear();
    },
    currentBranch() {
      return branch;
    },
    currentGeneration() {
      return generation;
    },
    isCurrentRedoBranch(value) {
      return value === branch;
    },
    isCurrentGeneration(value) {
      return value === generation;
    }
  });
}

export function historySourceFor(
  direction: "undo" | "redo",
  contentSequence: number | null,
  styleSequence: number | null
): "content" | "style" | null {
  if (contentSequence === null) return styleSequence === null ? null : "style";
  if (styleSequence === null) return "content";
  if (direction === "undo") return styleSequence > contentSequence ? "style" : "content";
  return styleSequence < contentSequence ? "style" : "content";
}
