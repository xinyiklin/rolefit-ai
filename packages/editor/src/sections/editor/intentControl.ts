// Pure control decisions for keyboard and queued-replay intents, kept free of
// React and the DOM so the eval can drive them directly.
import type { QueuedIntent } from "./useTypesetInputEvents.ts";

// Past the first glyph Tab replaces the selection with a tab stop of spaces;
// Shift+Tab always outdents the paragraph instead.
export function indentReplacesSelection(
  display: string,
  dStart: number,
  direction: "in" | "out"
): boolean {
  if (direction !== "in") return false;
  // Authored indentation is one non-addressable unit before the first glyph.
  const leading = /^ */.exec(display)?.[0].length ?? 0;
  return dStart > leading;
}

export type ReplayHandlers<S> = {
  gateClosed: () => boolean;
  readSelection: () => S | null;
  history: (direction: "undo" | "redo") => void;
  // False when no cross-field selection exists or the intent changed nothing.
  crossField: (intent: QueuedIntent) => boolean;
  single: (selection: S, intent: Exclude<QueuedIntent, { kind: "history" }>) => void;
};

// Replays queued intents until one closes the commit gate for a repaint.
export function drainReplayQueue<S>(
  queue: { current: QueuedIntent[] },
  handlers: ReplayHandlers<S>
): void {
  while (!handlers.gateClosed() && queue.current.length > 0) {
    const intent = queue.current.shift()!;
    // History is document-level, so it needs no single-field selection.
    if (intent.kind === "history") {
      handlers.history(intent.direction);
      continue;
    }
    const selection = handlers.readSelection();
    if (selection) handlers.single(selection, intent);
    // A no-op cross-field intent must not strand the input queued behind it.
    else if (handlers.crossField(intent)) return;
  }
}
