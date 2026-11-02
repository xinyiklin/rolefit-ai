export type HistoryClock = Readonly<{
  sequenceFor(state: object, action: object): number;
  group(gesture: () => void): void;
  stamp<A extends object>(action: A): A;
  noteUndo(sequence: number): number;
  noteRedo(sequence: number): void;
  reset(): void;
  currentBranch(): number;
  currentGeneration(): number;
  isCurrentRedoBranch(branch: number): boolean;
  isCurrentGeneration(generation: number): boolean;
  subscribe(listener: () => void): () => void;
}>;

// Recent groups whose members may still be reducing; one gesture needs one entry.
const GROUP_MEMORY = 16;

// A dispatch made inside `group` carries the gesture's group id to its reducer.
export function historyGroupOf(action: object): number | undefined {
  return "historyGroup" in action && typeof action.historyGroup === "number"
    ? action.historyGroup
    : undefined;
}

// Each document owns a clock so content and style share order without coupling editors.
export function createHistoryClock(): HistoryClock {
  let sequence = 0;
  let branch = 0;
  let generation = 0;
  let groupCount = 0;
  let openGroup: number | null = null;
  // Reducers run after the gesture returns, so a group's sequence is allocated
  // by whichever member reduces first and reused by the rest.
  const groupSequences = new Map<number, number>();
  const undoneSequences = new Set<number>();
  let sequenceByState = new WeakMap<object, WeakMap<object, number>>();
  const listeners = new Set<() => void>();
  let notifyQueued = false;
  // Reducers advance the branch mid-render, so the sibling reducer's hook
  // learns of it after that render instead of inside it.
  const advanceBranch = () => {
    branch += 1;
    if (notifyQueued) return;
    notifyQueued = true;
    queueMicrotask(() => {
      notifyQueued = false;
      for (const listener of [...listeners]) listener();
    });
  };
  return Object.freeze({
    sequenceFor(state, action) {
      let sequenceByAction = sequenceByState.get(state);
      const allocated = sequenceByAction?.get(action);
      if (allocated !== undefined) return allocated;
      const group = historyGroupOf(action);
      const grouped = group === undefined ? undefined : groupSequences.get(group);
      if (grouped !== undefined) return grouped;
      if (undoneSequences.size > 0) {
        advanceBranch();
        undoneSequences.clear();
      }
      sequence += 1;
      if (!sequenceByAction) {
        sequenceByAction = new WeakMap<object, number>();
        sequenceByState.set(state, sequenceByAction);
      }
      sequenceByAction.set(action, sequence);
      if (group !== undefined) {
        groupSequences.set(group, sequence);
        if (groupSequences.size > GROUP_MEMORY) groupSequences.delete(groupSequences.keys().next().value!);
      }
      return sequence;
    },
    group(gesture) {
      if (openGroup !== null) {
        gesture();
        return;
      }
      groupCount += 1;
      openGroup = groupCount;
      try {
        gesture();
      } finally {
        openGroup = null;
      }
    },
    stamp(action) {
      return openGroup === null ? action : { ...action, historyGroup: openGroup };
    },
    noteUndo(value) {
      undoneSequences.add(value);
      return branch;
    },
    noteRedo(value) {
      undoneSequences.delete(value);
    },
    reset() {
      advanceBranch();
      generation += 1;
      undoneSequences.clear();
      groupSequences.clear();
      sequenceByState = new WeakMap<object, WeakMap<object, number>>();
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
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  });
}

export function historySourceFor(
  direction: "undo" | "redo",
  contentSequence: number | null,
  styleSequence: number | null
): "content" | "style" | "both" | null {
  if (contentSequence === null) return styleSequence === null ? null : "style";
  if (styleSequence === null) return "content";
  // Only a grouped gesture gives both sources the same sequence.
  if (styleSequence === contentSequence) return "both";
  if (direction === "undo") return styleSequence > contentSequence ? "style" : "content";
  return styleSequence < contentSequence ? "style" : "content";
}
