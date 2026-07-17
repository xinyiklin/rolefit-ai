import { useLayoutEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import { caretToDisplayIndex, type TypesetSelection } from "./typesetEditing.ts";

export type QueuedIntent =
  | { kind: "insert"; text: string }
  | { kind: "deleteBack" }
  | { kind: "deleteFwd" }
  | { kind: "deleteSelection" }
  | { kind: "splitBullet" }
  | { kind: "toggleMark"; mark: "bold" | "italic" | "underline" }
  | { kind: "history"; direction: "undo" | "redo" };

type TypesetInputEventsArgs = {
  hostRef: MutableRefObject<HTMLDivElement | null>;
  nonce: number;
  docVersion: number;
  commitPendingRef: MutableRefObject<boolean>;
  replayQueueRef: MutableRefObject<QueuedIntent[]>;
  readSelection: () => TypesetSelection | null;
  commitReplace: (selection: TypesetSelection, start: number, end: number, text: string) => void;
  commitSplitBullet: (selection: TypesetSelection) => void;
  commitMergeBullet: (selection: TypesetSelection, direction: "up" | "down") => boolean;
  commitToggleMark: (selection: TypesetSelection, mark: "bold" | "italic" | "underline") => void;
  commitHistory: (direction: "undo" | "redo") => void;
  setNonce: Dispatch<SetStateAction<number>>;
};

export function useTypesetInputEvents({
  hostRef,
  nonce,
  docVersion,
  commitPendingRef,
  replayQueueRef,
  readSelection,
  commitReplace,
  commitSplitBullet,
  commitMergeBullet,
  commitToggleMark,
  commitHistory,
  setNonce
}: TypesetInputEventsArgs) {
  const goalXRef = useRef<number | null>(null);
  const composingRef = useRef(false);
  const compositionSelectionRef = useRef<TypesetSelection | null>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const lineDivs = (): HTMLElement[] => Array.from(host.querySelectorAll<HTMLElement>(".tsd-line"));
    const lineOf = (node: Node | null): HTMLElement | null => {
      const element = node instanceof HTMLElement ? node : node?.parentElement ?? null;
      return element?.closest<HTMLElement>(".tsd-line") ?? null;
    };
    const lineEdgePosition = (
      line: HTMLElement,
      edge: "start" | "end"
    ): { node: Node; offset: number } | null => {
      const spans = Array.from(line.children).filter(
        (element): element is HTMLElement =>
          element instanceof HTMLElement &&
          !element.hasAttribute("data-tsdm") &&
          element.firstChild?.nodeType === Node.TEXT_NODE
      );
      if (!spans.length) return null;
      if (edge === "start") return { node: spans[0].firstChild!, offset: 0 };
      const last = spans[spans.length - 1].firstChild as Text;
      const text = last.textContent ?? "";
      let end = text.length;
      while (end > 0 && /\s/.test(text[end - 1])) end -= 1;
      return { node: last, offset: end };
    };
    const setCaret = (position: { node: Node; offset: number }, extend: boolean) => {
      const selection = window.getSelection();
      if (!selection) return;
      if (extend && selection.rangeCount) {
        selection.extend(position.node, position.offset);
      } else {
        const range = document.createRange();
        range.setStart(position.node, position.offset);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      (position.node.parentElement ?? undefined)?.scrollIntoView({ block: "nearest" });
    };
    const caretClientX = (): number | null => {
      const selection = window.getSelection();
      if (!selection?.focusNode) return null;
      try {
        const range = document.createRange();
        range.setStart(selection.focusNode, selection.focusOffset);
        range.collapse(true);
        const rects = range.getClientRects();
        if (rects.length) return rects[0].left;
      } catch {
        // Fall through to the containing span's left edge.
      }
      const element =
        selection.focusNode instanceof HTMLElement ? selection.focusNode : selection.focusNode.parentElement;
      return element ? element.getBoundingClientRect().left : null;
    };
    const positionFromPoint = (x: number, y: number): { node: Node; offset: number } | null => {
      const caretDocument = document as Document & {
        caretPositionFromPoint?: (clientX: number, clientY: number) => {
          offsetNode: Node;
          offset: number;
        } | null;
        caretRangeFromPoint?: (clientX: number, clientY: number) => Range | null;
      };
      if (caretDocument.caretPositionFromPoint) {
        const position = caretDocument.caretPositionFromPoint(x, y);
        return position ? { node: position.offsetNode, offset: position.offset } : null;
      }
      const range = caretDocument.caretRangeFromPoint?.(x, y);
      return range ? { node: range.startContainer, offset: range.startOffset } : null;
    };
    const moveVertical = (direction: -1 | 1, extend: boolean): boolean => {
      const selection = window.getSelection();
      const current = lineOf(selection?.focusNode ?? null);
      if (!current) return false;
      const lines = lineDivs();
      const index = lines.indexOf(current);
      const target = index >= 0 ? lines[index + direction] : undefined;
      if (!target) return false;
      const x = goalXRef.current ?? caretClientX();
      if (x === null) return false;
      goalXRef.current = x;
      const rect = target.getBoundingClientRect();
      const clampedX = Math.min(Math.max(x, rect.left + 1), rect.right - 1);
      let position = positionFromPoint(clampedX, rect.top + rect.height / 2);
      if (!position || position.node.nodeType !== Node.TEXT_NODE || lineOf(position.node) !== target) {
        position = lineEdgePosition(target, x <= rect.left + 2 ? "start" : "end");
      }
      if (!position) return false;
      setCaret(position, extend);
      return true;
    };
    const moveLineEdge = (edge: "start" | "end", extend: boolean) => {
      const current = lineOf(window.getSelection()?.focusNode ?? null);
      if (!current) return;
      const position = lineEdgePosition(current, edge);
      if (position) setCaret(position, extend);
    };
    const moveDocumentEdge = (edge: "start" | "end", extend: boolean) => {
      const lines = lineDivs();
      const line = edge === "start" ? lines[0] : lines[lines.length - 1];
      if (!line) return;
      const position = lineEdgePosition(line, edge);
      if (position) setCaret(position, extend);
    };
    const queueIntent = (intent: QueuedIntent) => {
      const queue = replayQueueRef.current;
      const last = queue[queue.length - 1];
      // Coalesce key-repeat/text bursts rather than imposing a small cap that
      // can silently discard input on a slow layout.
      if (intent.kind === "insert" && last?.kind === "insert") {
        last.text += intent.text;
      } else {
        queue.push(intent);
      }
    };

    const onBeforeInput = (event: InputEvent) => {
      if (composingRef.current) return;
      const type = event.inputType;
      if (type === "insertCompositionText" || type === "deleteCompositionText") return;
      event.preventDefault();
      goalXRef.current = null;
      if (commitPendingRef.current) {
        const inserted =
          type === "insertLineBreak"
            ? "\n"
            : event.data ?? event.dataTransfer?.getData("text/plain") ?? "";
        if (["insertText", "insertReplacementText", "insertLineBreak", "insertFromPaste"].includes(type) && inserted) {
          queueIntent({ kind: "insert", text: inserted });
        } else if (type === "insertParagraph") {
          queueIntent({ kind: "splitBullet" });
        } else if (type === "deleteContentBackward") {
          queueIntent({ kind: "deleteBack" });
        } else if (type === "deleteContentForward") {
          queueIntent({ kind: "deleteFwd" });
        } else if (type.startsWith("delete")) {
          queueIntent({ kind: "deleteSelection" });
        } else if (type === "formatBold" || type === "formatItalic" || type === "formatUnderline") {
          queueIntent({
            kind: "toggleMark",
            mark: type === "formatBold" ? "bold" : type === "formatItalic" ? "italic" : "underline"
          });
        } else if (type === "historyUndo" || type === "historyRedo") {
          queueIntent({ kind: "history", direction: type === "historyUndo" ? "undo" : "redo" });
        }
        return;
      }

      if (type === "historyUndo") return commitHistory("undo");
      if (type === "historyRedo") return commitHistory("redo");

      const selection = readSelection();
      if (!selection) return;

      if (type === "insertParagraph") {
        if (selection.src.kind === "bullet") commitSplitBullet(selection);
        return;
      }
      if (
        type === "insertText" ||
        type === "insertReplacementText" ||
        type === "insertLineBreak" ||
        type === "insertFromPaste"
      ) {
        const ranges = event.getTargetRanges?.() ?? [];
        let { dStart, dEnd } = selection;
        if (ranges[0]) {
          const start = caretToDisplayIndex(
            host,
            selection.key,
            selection.map.display,
            ranges[0].startContainer,
            ranges[0].startOffset
          );
          const end = caretToDisplayIndex(
            host,
            selection.key,
            selection.map.display,
            ranges[0].endContainer,
            ranges[0].endOffset
          );
          if (start !== null && end !== null) {
            dStart = Math.min(start, end);
            dEnd = Math.max(start, end);
          }
        }
        const text =
          type === "insertLineBreak"
            ? "\n"
            : event.data ?? event.dataTransfer?.getData("text/plain") ?? "";
        commitReplace(selection, dStart, dEnd, text);
        return;
      }
      if (type.startsWith("delete")) {
        const backward = type.endsWith("Backward");
        if (selection.dStart === selection.dEnd) {
          if (backward && selection.dStart === 0 && commitMergeBullet(selection, "up")) return;
          if (
            !backward &&
            selection.dStart === selection.map.chars.length &&
            commitMergeBullet(selection, "down")
          ) {
            return;
          }
          const ranges = event.getTargetRanges?.() ?? [];
          let start = backward ? selection.dStart - 1 : selection.dStart;
          let end = backward ? selection.dStart : selection.dStart + 1;
          if (ranges[0]) {
            const intendedStart = caretToDisplayIndex(
              host,
              selection.key,
              selection.map.display,
              ranges[0].startContainer,
              ranges[0].startOffset
            );
            const intendedEnd = caretToDisplayIndex(
              host,
              selection.key,
              selection.map.display,
              ranges[0].endContainer,
              ranges[0].endOffset
            );
            if (intendedStart !== null && intendedEnd !== null && intendedStart !== intendedEnd) {
              start = Math.min(intendedStart, intendedEnd);
              end = Math.max(intendedStart, intendedEnd);
            }
          }
          if (start < 0 || end > selection.map.chars.length || start === end) return;
          commitReplace(selection, start, end, "");
        } else {
          commitReplace(selection, selection.dStart, selection.dEnd, "");
        }
        return;
      }
      if (type === "formatBold") return commitToggleMark(selection, "bold");
      if (type === "formatItalic") return commitToggleMark(selection, "italic");
      if (type === "formatUnderline") return commitToggleMark(selection, "underline");
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      const vertical = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
      if (vertical !== 0 && !event.altKey) {
        event.preventDefault();
        if (mod) moveDocumentEdge(vertical < 0 ? "start" : "end", event.shiftKey);
        else moveVertical(vertical as -1 | 1, event.shiftKey);
        return;
      }
      if (event.key === "Home" || (event.metaKey && event.key === "ArrowLeft")) {
        event.preventDefault();
        goalXRef.current = null;
        moveLineEdge("start", event.shiftKey);
        return;
      }
      if (event.key === "End" || (event.metaKey && event.key === "ArrowRight")) {
        event.preventDefault();
        goalXRef.current = null;
        moveLineEdge("end", event.shiftKey);
        return;
      }
      if (
        mod &&
        !event.altKey &&
        !event.shiftKey &&
        ["b", "i", "u"].includes(event.key.toLowerCase())
      ) {
        event.preventDefault();
        const key = event.key.toLowerCase();
        const mark = key === "b" ? "bold" : key === "i" ? "italic" : "underline";
        if (commitPendingRef.current) {
          queueIntent({ kind: "toggleMark", mark });
          return;
        }
        const selection = readSelection();
        if (selection) {
          commitToggleMark(selection, mark);
        }
        return;
      }
      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        goalXRef.current = null;
        const direction = event.shiftKey ? "redo" : "undo";
        if (commitPendingRef.current) queueIntent({ kind: "history", direction });
        else commitHistory(direction);
        return;
      }
      if (mod && event.key.toLowerCase() === "y") {
        event.preventDefault();
        goalXRef.current = null;
        if (commitPendingRef.current) queueIntent({ kind: "history", direction: "redo" });
        else commitHistory("redo");
        return;
      }
      if (event.key === "Tab") {
        const selection = readSelection();
        // Walk every painted editable field in document order — name, contact
        // lines, entry header fields (title / date / subtitle / location),
        // bullets (including a summary section's single-paragraph bullet), and
        // skill rows — one stop per field even when it wraps across lines.
        // Section headings are intentionally skipped (structural titles, edited
        // by click). Only fields with painted text are addressable; empty ones
        // are edited from the entry-details panel. At the document ends (or from
        // a heading, which is not a stop) Tab falls through to the browser so
        // focus can still leave the editor.
        if (!selection) return;
        const seen = new Set<string>();
        const stops = Array.from(
          host.querySelectorAll<HTMLElement>("[data-tsdf]:not([data-tsdm])")
        ).filter((element) => {
          if (element.firstChild?.nodeType !== Node.TEXT_NODE) return false;
          const key = element.getAttribute("data-tsdf");
          if (!key || key.startsWith("heading|") || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        const index = stops.findIndex((element) => element.getAttribute("data-tsdf") === selection.key);
        const target = index >= 0 ? stops[index + (event.shiftKey ? -1 : 1)] : undefined;
        if (!target?.firstChild) return; // document end / heading — let Tab leave the editor
        event.preventDefault();
        goalXRef.current = null;
        const selectionApi = window.getSelection();
        if (selectionApi) {
          // Select the whole target field (across every wrapped span) so it's
          // obvious where Tab landed and typing replaces the field's text.
          const key = target.getAttribute("data-tsdf")!;
          const keySpans = Array.from(
            host.querySelectorAll<HTMLElement>(`[data-tsdf="${CSS.escape(key)}"]:not([data-tsdm])`)
          ).filter((element) => element.firstChild?.nodeType === Node.TEXT_NODE);
          const end = spanEndPosition(keySpans[keySpans.length - 1] ?? target);
          const range = document.createRange();
          range.setStart(target.firstChild, 0);
          range.setEnd(end.node, end.offset);
          selectionApi.removeAllRanges();
          selectionApi.addRange(range);
          target.scrollIntoView({ block: "nearest" });
        }
        return;
      }
      if (event.key === "Escape") (document.activeElement as HTMLElement | null)?.blur();
      goalXRef.current = null;
    };

    const nearestLineByPoint = (clientX: number, clientY: number): HTMLElement | null => {
      let best: HTMLElement | null = null;
      let distance = Infinity;
      for (const line of lineDivs()) {
        const rect = line.getBoundingClientRect();
        if (clientX < rect.left - 4 || clientX > rect.right + 4) continue;
        const nextDistance =
          clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0;
        if (nextDistance < distance) {
          distance = nextDistance;
          best = line;
        }
      }
      return distance <= 200 ? best : null;
    };
    const contentSpansOf = (line: HTMLElement): HTMLElement[] =>
      Array.from(line.querySelectorAll<HTMLElement>("[data-tsdf]:not([data-tsdm])")).filter(
        (element) => element.firstChild?.nodeType === Node.TEXT_NODE
      );
    const spanEndPosition = (span: HTMLElement): { node: Node; offset: number } => {
      const textNode = span.firstChild as Text;
      const text = textNode.textContent ?? "";
      let end = text.length;
      while (end > 0 && /\s/.test(text[end - 1])) end -= 1;
      return { node: textNode, offset: end };
    };
    const placeInLine = (line: HTMLElement, clientX: number): { node: Node; offset: number } | null => {
      const spans = contentSpansOf(line);
      if (!spans.length) return lineEdgePosition(line, "start");
      const firstRect = spans[0].getBoundingClientRect();
      if (clientX <= firstRect.left) return { node: spans[0].firstChild!, offset: 0 };
      let prev: HTMLElement | null = null;
      for (const span of spans) {
        const rect = span.getBoundingClientRect();
        if (clientX < rect.left) {
          // In the empty space before this span. Between two fields on one row
          // (title | date, subtitle | location) snap to whichever side is
          // nearer, instead of always jumping into the right-hand field.
          if (prev) {
            const midpoint = (prev.getBoundingClientRect().right + rect.left) / 2;
            if (clientX < midpoint) return spanEndPosition(prev);
          }
          return { node: span.firstChild!, offset: 0 };
        }
        if (clientX <= rect.right) {
          const position = positionFromPoint(clientX, rect.top + rect.height / 2);
          if (position && position.node.nodeType === Node.TEXT_NODE && lineOf(position.node) === line) {
            return position;
          }
          return { node: span.firstChild!, offset: 0 };
        }
        prev = span;
      }
      return lineEdgePosition(line, "end");
    };

    const onMouseDown = (event: MouseEvent) => {
      goalXRef.current = null;
      if (event.button !== 0) return;
      const target = event.target as HTMLElement;
      const marker = target.closest<HTMLElement>("[data-tsdm]");
      if (marker) {
        const line = marker.closest<HTMLElement>(".tsd-line");
        const content = line
          ? contentSpansOf(line).find(
              (element) => element.getAttribute("data-tsdf") === marker.getAttribute("data-tsdf")
            )
          : null;
        if (content) {
          event.preventDefault();
          host.focus({ preventScroll: true });
          setCaret({ node: content.firstChild!, offset: 0 }, event.shiftKey);
        }
        return;
      }
      if (target.closest("[data-tsdf]")) return;
      const line =
        target.closest<HTMLElement>(".tsd-line") ?? nearestLineByPoint(event.clientX, event.clientY);
      if (!line) return;
      const position = placeInLine(line, event.clientX);
      if (!position) return;
      event.preventDefault();
      host.focus({ preventScroll: true });
      setCaret(position, event.shiftKey);
    };

    const onPaste = (event: ClipboardEvent) => {
      event.preventDefault();
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (commitPendingRef.current) {
        if (text) queueIntent({ kind: "insert", text });
        return;
      }
      const selection = readSelection();
      if (!selection) return;
      commitReplace(selection, selection.dStart, selection.dEnd, text);
    };
    const onCut = (event: ClipboardEvent) => {
      event.preventDefault();
      if (commitPendingRef.current) {
        const selectedText = window.getSelection()?.toString() ?? "";
        if (selectedText) {
          event.clipboardData?.setData("text/plain", selectedText);
          queueIntent({ kind: "deleteSelection" });
        }
        return;
      }
      const selection = readSelection();
      if (!selection || selection.dStart === selection.dEnd) return;
      event.clipboardData?.setData(
        "text/plain",
        selection.map.display.slice(selection.dStart, selection.dEnd)
      );
      commitReplace(selection, selection.dStart, selection.dEnd, "");
    };
    const blockDrag = (event: Event) => event.preventDefault();
    const onCompositionStart = () => {
      composingRef.current = true;
      compositionSelectionRef.current = readSelection();
    };
    const onCompositionEnd = (event: CompositionEvent) => {
      composingRef.current = false;
      const selection = compositionSelectionRef.current;
      compositionSelectionRef.current = null;
      setNonce((current) => current + 1);
      if (commitPendingRef.current) {
        if (event.data) queueIntent({ kind: "insert", text: event.data });
      } else if (selection) {
        commitReplace(selection, selection.dStart, selection.dEnd, event.data ?? "");
      }
    };

    host.addEventListener("beforeinput", onBeforeInput);
    host.addEventListener("keydown", onKeyDown);
    host.addEventListener("mousedown", onMouseDown);
    host.addEventListener("paste", onPaste);
    host.addEventListener("cut", onCut);
    host.addEventListener("dragstart", blockDrag);
    host.addEventListener("drop", blockDrag);
    host.addEventListener("compositionstart", onCompositionStart);
    host.addEventListener("compositionend", onCompositionEnd);
    return () => {
      host.removeEventListener("beforeinput", onBeforeInput);
      host.removeEventListener("keydown", onKeyDown);
      host.removeEventListener("mousedown", onMouseDown);
      host.removeEventListener("paste", onPaste);
      host.removeEventListener("cut", onCut);
      host.removeEventListener("dragstart", blockDrag);
      host.removeEventListener("drop", blockDrag);
      host.removeEventListener("compositionstart", onCompositionStart);
      host.removeEventListener("compositionend", onCompositionEnd);
    };
  }, [
    commitHistory,
    commitMergeBullet,
    commitPendingRef,
    commitReplace,
    commitSplitBullet,
    commitToggleMark,
    docVersion,
    hostRef,
    nonce,
    readSelection,
    replayQueueRef,
    setNonce
  ]);
}
