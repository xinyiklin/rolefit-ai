import { useLayoutEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import {
  caretClientX,
  caretToDisplayIndex,
  contentSpansOf,
  lineDivs,
  lineEdgePosition,
  lineOf,
  nearestLineByPoint,
  placeInLine,
  positionFromPoint,
  setCaret,
  spanEndPosition
} from "./domSelection.ts";
import type { TypesetSelection } from "./inlineTextEditing.ts";

export type QueuedIntent =
  | { kind: "insert"; text: string }
  | { kind: "deleteBack" }
  | { kind: "deleteFwd" }
  | { kind: "deleteSelection" }
  | { kind: "splitBullet" }
  | { kind: "toggleMark"; mark: "bold" | "italic" | "underline" }
  | { kind: "clearFormatting" }
  | { kind: "history"; direction: "undo" | "redo" };

type TypesetInputEventsArgs = {
  hostRef: MutableRefObject<HTMLDivElement | null>;
  nonce: number;
  docVersion: number;
  commitPendingRef: MutableRefObject<boolean>;
  replayQueueRef: MutableRefObject<QueuedIntent[]>;
  readSelection: () => TypesetSelection | null;
  commitReplace: (selection: TypesetSelection, start: number, end: number, text: string) => void;
  onEnter: (selection: TypesetSelection) => void;
  commitMergeBullet: (selection: TypesetSelection, direction: "up" | "down") => boolean;
  commitToggleMark: (selection: TypesetSelection, mark: "bold" | "italic" | "underline") => void;
  commitClearFormatting: (selection: TypesetSelection) => void;
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
  onEnter,
  commitMergeBullet,
  commitToggleMark,
  commitClearFormatting,
  commitHistory,
  setNonce
}: TypesetInputEventsArgs) {
  const goalXRef = useRef<number | null>(null);
  const composingRef = useRef(false);
  const compositionSelectionRef = useRef<TypesetSelection | null>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // Fields the user fills in, in document order — one stop per field (first
    // painted span wins). Section headings are structural labels, so they stay
    // out of the Tab cycle; name, contacts, entry header fields, bullets/summary
    // paragraphs, and skill rows are all in it.
    const tabStopFields = (): HTMLElement[] => {
      const seen = new Set<string>();
      const stops: HTMLElement[] = [];
      for (const span of host.querySelectorAll<HTMLElement>("[data-tsdf]:not([data-tsdm])")) {
        if (span.firstChild?.nodeType !== Node.TEXT_NODE) continue;
        const key = span.getAttribute("data-tsdf");
        if (!key || seen.has(key) || key.startsWith("heading|")) continue;
        seen.add(key);
        stops.push(span);
      }
      return stops;
    };
    const moveVertical = (direction: -1 | 1, extend: boolean): boolean => {
      const selection = window.getSelection();
      const current = lineOf(selection?.focusNode ?? null);
      if (!current) return false;
      const lines = lineDivs(host);
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
      const lines = lineDivs(host);
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
        onEnter(selection);
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
      if (mod && !event.altKey && !event.shiftKey && event.key === "\\") {
        event.preventDefault();
        if (commitPendingRef.current) {
          queueIntent({ kind: "clearFormatting" });
          return;
        }
        const selection = readSelection();
        if (selection && selection.dEnd > selection.dStart) commitClearFormatting(selection);
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
        // Tab moves between the fields the user fills in (see tabStopFields):
        // name, contacts, entry header fields, bullets/summary paragraphs, and
        // skill rows. With no clean field selection, or at either boundary of the
        // cycle, Tab is left to the browser so focus can still leave the editor.
        if (!selection) return;
        const stops = tabStopFields();
        const step = event.shiftKey ? -1 : 1;
        const index = stops.findIndex((element) => element.getAttribute("data-tsdf") === selection.key);
        let target: HTMLElement | undefined;
        if (index >= 0) {
          target = stops[index + step];
        } else {
          // The caret sits in a non-stop field (a section heading): move to the
          // nearest stop in the travel direction by document order.
          const focus = window.getSelection()?.focusNode ?? null;
          const ref = (focus instanceof HTMLElement ? focus : focus?.parentElement)?.closest<HTMLElement>(
            "[data-tsdf]:not([data-tsdm])"
          );
          if (ref) {
            target =
              step > 0
                ? stops.find((el) => (ref.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0)
                : [...stops]
                    .reverse()
                    .find((el) => (ref.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING) !== 0);
          }
        }
        if (!target) return;
        event.preventDefault();
        goalXRef.current = null;
        // Select the whole target field so it's obvious where Tab landed, spanning
        // the field's first painted span to its last when it wraps or carries
        // inline formatting across several spans.
        const key = target.getAttribute("data-tsdf");
        const spans = key
          ? Array.from(host.querySelectorAll<HTMLElement>("[data-tsdf]:not([data-tsdm])")).filter(
              (el) => el.getAttribute("data-tsdf") === key && el.firstChild?.nodeType === Node.TEXT_NODE
            )
          : [target];
        const first = spans[0] ?? target;
        const last = spans[spans.length - 1] ?? target;
        if (!first.firstChild) return;
        const selectionApi = window.getSelection();
        if (selectionApi) {
          const range = document.createRange();
          range.setStart(first.firstChild, 0);
          const end = spanEndPosition(last);
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

    const onMouseDown = (event: MouseEvent) => {
      goalXRef.current = null;
      const target = event.target as HTMLElement;
      if (event.button === 2) {
        // Right-click on a line's blank area (between/after fields): the browser
        // would snap the caret to the line start, yanking it away from wherever
        // the user was typing. Suppress that default so the caret stays put; the
        // contextmenu event still fires and resolves the clicked entry itself. A
        // right-click directly on field text keeps the normal caret placement.
        if (!target.closest<HTMLElement>("[data-tsdf]:not([data-tsdm])")) event.preventDefault();
        return;
      }
      if (event.button !== 0) return;
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
        target.closest<HTMLElement>(".tsd-line") ?? nearestLineByPoint(host, event.clientX, event.clientY);
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
    commitClearFormatting,
    commitHistory,
    commitMergeBullet,
    commitPendingRef,
    commitReplace,
    onEnter,
    commitToggleMark,
    docVersion,
    hostRef,
    nonce,
    readSelection,
    replayQueueRef,
    setNonce
  ]);
}
