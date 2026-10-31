import { historySourceFor } from "@typeset/editor/hooks/historyClock.ts";

export type HistorySource = {
  undoSequence: number | null;
  redoSequence: number | null;
  undo: () => void;
  redo: () => void;
};

// Undo or redo while the Typeset editor is unmounted (a narrow window), by the
// editor's own rule: a grouped gesture moves content and style together, and
// otherwise the newer source moves first.
export function commitDetachedHistory(direction: "undo" | "redo", content: HistorySource, style: HistorySource): void {
  const source = direction === "undo"
    ? historySourceFor("undo", content.undoSequence, style.undoSequence)
    : historySourceFor("redo", content.redoSequence, style.redoSequence);
  if (source === "style" || source === "both") style[direction]();
  if (source === "content" || source === "both") content[direction]();
}
