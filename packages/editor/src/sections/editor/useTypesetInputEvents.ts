import { useLayoutEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import {
  caretClientX,
  caretToDisplayIndex,
  contentSpansOf,
  fieldEdgeAnchors,
  lineDivs,
  lineEdgePosition,
  lineOf,
  nearestLineByPoint,
  placeInLine,
  setCaret,
  spanEndPosition
} from "./domSelection.ts";
import {
  indentDeletionRange,
  inlineFragmentForRange,
  type TypesetSelection
} from "./inlineTextEditing.ts";
import {
  decodeInlineClipboard,
  encodeInlineClipboard,
  inlineFragmentFromHtml,
  TYPESET_INLINE_CLIPBOARD_MIME
} from "./clipboardFormatting.ts";

export type QueuedIntent =
  | { kind: "insert"; text: string }
  | { kind: "paste"; fragment: string }
  | { kind: "deleteBack" }
  | { kind: "deleteFwd" }
  | { kind: "deleteSelection" }
  | { kind: "indent" }
  | { kind: "outdent" }
  | { kind: "splitBullet" }
  | { kind: "toggleMark"; mark: "bold" | "italic" | "underline" }
  | { kind: "clearFormatting" }
  | { kind: "history"; direction: "undo" | "redo" };

// Normalize beforeinput so deferred and cross-field paths replay the same intent.
function intentForInput(event: InputEvent, type: string): QueuedIntent | null {
  if (type === "insertParagraph") return { kind: "splitBullet" };
  if (type === "deleteContentBackward") return { kind: "deleteBack" };
  if (type === "deleteContentForward") return { kind: "deleteFwd" };
  if (type.startsWith("delete")) return { kind: "deleteSelection" };
  if (type === "historyUndo") return { kind: "history", direction: "undo" };
  if (type === "historyRedo") return { kind: "history", direction: "redo" };
  if (type === "formatBold") return { kind: "toggleMark", mark: "bold" };
  if (type === "formatItalic") return { kind: "toggleMark", mark: "italic" };
  if (type === "formatUnderline") return { kind: "toggleMark", mark: "underline" };
  if (["insertText", "insertReplacementText", "insertLineBreak", "insertFromPaste"].includes(type)) {
    const text =
      type === "insertLineBreak"
        ? "\n"
        : event.data ?? event.dataTransfer?.getData("text/plain") ?? "";
    return text ? { kind: "insert", text } : null;
  }
  return null;
}

type TypesetInputEventsArgs = {
  hostRef: MutableRefObject<HTMLDivElement | null>;
  structuredTabScope: "document" | "header";
  nonce: number;
  docVersion: number;
  commitPendingRef: MutableRefObject<boolean>;
  replayQueueRef: MutableRefObject<QueuedIntent[]>;
  readSelection: () => TypesetSelection | null;
  commitReplace: (selection: TypesetSelection, start: number, end: number, text: string) => void;
  // The host measures tab width and owns the document-dependent indent ladder.
  commitIndent: (selection: TypesetSelection, direction: "in" | "out") => void;
  // Return false when no block indent exists so normal deletion can proceed.
  commitParagraphOutdent: (selection: TypesetSelection) => boolean;
  // Measured width lets deletion remove exactly the spaces one Tab authored.
  indentWidthAt: (selection: TypesetSelection) => number;
  commitPaste: (selection: TypesetSelection, start: number, end: number, fragment: string) => void;
  onEnter: (selection: TypesetSelection) => void;
  commitMergeBullet: (selection: TypesetSelection, direction: "up" | "down") => boolean;
  commitToggleMark: (selection: TypesetSelection, mark: "bold" | "italic" | "underline") => void;
  commitClearFormatting: (selection: TypesetSelection) => void;
  commitHistory: (direction: "undo" | "redo") => void;
  // A selection crossing field boundaries (Select All, a drag across
  // paragraphs) has no single mapped field. The host applies these as one
  // batched edit and returns true when it consumed the intent.
  commitCrossFieldIntent: (intent: QueuedIntent) => boolean;
  // Plain text for a selection crossing fields, read from the model; null when
  // the selection does not cross fields.
  crossFieldPlainText: () => string | null;
  onZoomShortcut: (command: -1 | 0 | 1) => void;
  setNonce: Dispatch<SetStateAction<number>>;
};

export function useTypesetInputEvents({
  hostRef,
  structuredTabScope,
  nonce,
  docVersion,
  commitPendingRef,
  replayQueueRef,
  readSelection,
  commitReplace,
  commitIndent,
  commitParagraphOutdent,
  indentWidthAt,
  commitPaste,
  onEnter,
  commitMergeBullet,
  commitToggleMark,
  commitClearFormatting,
  commitHistory,
  commitCrossFieldIntent,
  crossFieldPlainText,
  onZoomShortcut,
  setNonce
}: TypesetInputEventsArgs) {
  const goalXRef = useRef<number | null>(null);
  const composingRef = useRef(false);
  const compositionSelectionRef = useRef<TypesetSelection | null>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;

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
      // Reuse line-aware pointer placement to keep blank lines on their own row.
      const position = placeInLine(target, clampedX);
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
    // Keyboard stops follow model fields, skipping structural headings and painted fragments.
    const isHeaderField = (key: string): boolean =>
      key === "name" || key.startsWith("contact|");
    const tabStopFields = (): HTMLElement[] => {
      const seen = new Set<string>();
      const stops: HTMLElement[] = [];
      for (const span of host.querySelectorAll<HTMLElement>("[data-tsdf]:not([data-tsdm])")) {
        if (span.firstChild?.nodeType !== Node.TEXT_NODE) continue;
        const key = span.getAttribute("data-tsdf");
        if (
          !key ||
          seen.has(key) ||
          key.startsWith("heading|") ||
          (structuredTabScope === "header" && !isHeaderField(key))
        ) {
          continue;
        }
        seen.add(key);
        stops.push(span);
      }
      return stops;
    };

    const onBeforeInput = (event: InputEvent) => {
      if (composingRef.current) return;
      const type = event.inputType;
      if (type === "insertCompositionText" || type === "deleteCompositionText") return;
      event.preventDefault();
      goalXRef.current = null;
      if (commitPendingRef.current) {
        const queued = intentForInput(event, type);
        if (queued) queueIntent(queued);
        return;
      }

      if (type === "historyUndo") return commitHistory("undo");
      if (type === "historyRedo") return commitHistory("redo");

      const selection = readSelection();
      if (!selection) {
        const intent = intentForInput(event, type);
        if (intent) commitCrossFieldIntent(intent);
        return;
      }

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
          if (backward && selection.dStart === 0) {
            // A paragraph indent is the one thing Tab adds that no other
            // keystroke removes, so it comes off before the paragraph merges.
            if (commitParagraphOutdent(selection)) return;
            if (commitMergeBullet(selection, "up")) return;
          }
          if (
            !backward &&
            selection.dStart === selection.map.chars.length &&
            commitMergeBullet(selection, "down")
          ) {
            return;
          }
          // Only plain character deletion collapses authored indentation as one stop.
          if (type === "deleteContentBackward" || type === "deleteContentForward") {
            const indent = indentDeletionRange(
              selection.map.display,
              selection.dStart,
              backward ? "backward" : "forward",
              indentWidthAt(selection)
            );
            if (indent) {
              commitReplace(selection, indent.start, indent.end, "");
              return;
            }
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
      if (mod && !event.altKey) {
        const command =
          event.code === "Digit0" || event.code === "Numpad0" || event.key === "0"
            ? 0
            : event.code === "Minus" || event.code === "NumpadSubtract" || event.key === "-"
              ? -1
              : event.code === "Equal" ||
                  event.code === "NumpadAdd" ||
                  event.key === "+" ||
                  event.key === "="
                ? 1
                : null;
        if (command !== null) {
          event.preventDefault();
          onZoomShortcut(command);
          return;
        }
      }
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
        if (selection) commitToggleMark(selection, mark);
        else commitCrossFieldIntent({ kind: "toggleMark", mark });
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
        // A resume is entirely structured; a cover letter is structured only in
        // its optional header, and prose everywhere else.
        const prose =
          structuredTabScope === "header" && !(selection && isHeaderField(selection.key));
        if (prose) {
          // Prose Tab stays in the document; the host decides text versus block indentation.
          event.preventDefault();
          goalXRef.current = null;
          const intent: QueuedIntent = event.shiftKey ? { kind: "outdent" } : { kind: "indent" };
          if (commitPendingRef.current) queueIntent(intent);
          else if (selection) commitIndent(selection, event.shiftKey ? "out" : "in");
          else commitCrossFieldIntent(intent);
          return;
        }
        // Unmapped structured selections leave Tab available for browser focus traversal.
        if (!selection) return;
        const stops = tabStopFields();
        const step = event.shiftKey ? -1 : 1;
        const index = stops.findIndex(
          (element) => element.getAttribute("data-tsdf") === selection.key
        );
        let target: HTMLElement | undefined;
        if (index >= 0) {
          target = stops[index + step];
        } else {
          // A caret in a structural heading moves to the nearest real field in
          // the requested direction.
          const focus = window.getSelection()?.focusNode ?? null;
          const ref = (
            focus instanceof HTMLElement ? focus : focus?.parentElement
          )?.closest<HTMLElement>("[data-tsdf]:not([data-tsdm])");
          if (ref) {
            target =
              step > 0
                ? stops.find(
                    (element) =>
                      (ref.compareDocumentPosition(element) &
                        Node.DOCUMENT_POSITION_FOLLOWING) !==
                      0
                  )
                : [...stops]
                    .reverse()
                    .find(
                      (element) =>
                        (ref.compareDocumentPosition(element) &
                          Node.DOCUMENT_POSITION_PRECEDING) !==
                        0
                    );
          }
        }
        if (!target) return;
        event.preventDefault();
        goalXRef.current = null;
        const key = target.getAttribute("data-tsdf");
        const spans = key
          ? Array.from(
              host.querySelectorAll<HTMLElement>("[data-tsdf]:not([data-tsdm])")
            ).filter(
              (element) =>
                element.getAttribute("data-tsdf") === key &&
                element.firstChild?.nodeType === Node.TEXT_NODE
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

    const EDGE_SNAP_PX = 14;
    let dragEdgeStart: {
      x: number;
      y: number;
      position: { node: Node; offset: number };
      armed: boolean;
    } | null = null;

    const edgeDragAnchor = (
      line: HTMLElement,
      clientX: number,
      key?: string
    ): { node: Node; offset: number } | null => {
      let closest:
        | { distance: number; position: { node: Node; offset: number } }
        | null = null;
      for (const anchor of fieldEdgeAnchors(line, key)) {
        const distance = Math.abs(clientX - anchor.x);
        if (!closest || distance < closest.distance) {
          closest = { distance, position: anchor.position };
        }
      }
      return closest && closest.distance <= EDGE_SNAP_PX ? closest.position : null;
    };

    // Prevented mousedown events arm synthetic drag immediately.
    const beginPointerDrag = (
      event: MouseEvent,
      position: { node: Node; offset: number },
      armed: boolean
    ) => {
      dragEdgeStart = { x: event.clientX, y: event.clientY, position, armed };
    };

    const onMouseDown = (event: MouseEvent) => {
      goalXRef.current = null;
      dragEdgeStart = null;
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
          const position = { node: content.firstChild!, offset: 0 };
          setCaret(position, event.shiftKey);
          beginPointerDrag(event, position, true);
        }
        return;
      }
      const directField = target.closest<HTMLElement>("[data-tsdf]:not([data-tsdm])");
      if (directField) {
        // Edge drags snap only after movement so nearby clicks remain native.
        const line = directField.closest<HTMLElement>(".tsd-line");
        const key = directField.getAttribute("data-tsdf");
        const position = line && key ? edgeDragAnchor(line, event.clientX, key) : null;
        if (position) beginPointerDrag(event, position, false);
        return;
      }
      // Off-text starts require synthetic drag because manual caret placement prevents native drag.
      const line =
        target.closest<HTMLElement>(".tsd-line") ?? nearestLineByPoint(host, event.clientX, event.clientY);
      if (!line) return;
      const position = edgeDragAnchor(line, event.clientX) ?? placeInLine(line, event.clientX);
      if (!position) return;
      event.preventDefault();
      host.focus({ preventScroll: true });
      setCaret(position, event.shiftKey);
      beginPointerDrag(event, position, true);
    };

    const onMouseMove = (event: MouseEvent) => {
      if (!dragEdgeStart) return;
      if ((event.buttons & 1) === 0) {
        dragEdgeStart = null;
        return;
      }
      if (!dragEdgeStart.armed) {
        if (Math.hypot(event.clientX - dragEdgeStart.x, event.clientY - dragEdgeStart.y) < 3) return;
        host.focus({ preventScroll: true });
        setCaret(dragEdgeStart.position, false);
        dragEdgeStart.armed = true;
      }
      const target = event.target;
      const overLine =
        target instanceof Element ? target.closest<HTMLElement>(".tsd-line") : null;
      // The pointer is allowed to leave the sheet entirely while the button is
      // down; the drag keeps resolving against the vertically nearest line.
      const line =
        overLine && host.contains(overLine)
          ? overLine
          : nearestLineByPoint(host, event.clientX, event.clientY, "anywhere");
      if (!line) return;
      const position = placeInLine(line, event.clientX);
      if (!position) return;
      event.preventDefault();
      setCaret(position, true);
    };

    const onMouseUp = () => {
      dragEdgeStart = null;
    };

    const onPaste = (event: ClipboardEvent) => {
      event.preventDefault();
      const clipboard = event.clipboardData;
      const ownFragment = decodeInlineClipboard(
        clipboard?.getData(TYPESET_INLINE_CLIPBOARD_MIME) ?? ""
      );
      const htmlFragment = ownFragment
        ? null
        : inlineFragmentFromHtml(clipboard?.getData("text/html") ?? "");
      const fragment = ownFragment ?? htmlFragment;
      const text = clipboard?.getData("text/plain") ?? "";
      if (commitPendingRef.current) {
        if (fragment) queueIntent({ kind: "paste", fragment });
        else if (text) queueIntent({ kind: "insert", text });
        return;
      }
      const selection = readSelection();
      if (!selection) {
        // Spanning several fields: drop the selection, then land the payload in
        // the collapsed caret that leaves behind.
        if (fragment) commitCrossFieldIntent({ kind: "paste", fragment });
        else if (text) commitCrossFieldIntent({ kind: "insert", text });
        return;
      }
      if (fragment) commitPaste(selection, selection.dStart, selection.dEnd, fragment);
      else commitReplace(selection, selection.dStart, selection.dEnd, text);
    };

    const writeSelectionToClipboard = (
      event: ClipboardEvent,
      selection: TypesetSelection
    ) => {
      const clipboard = event.clipboardData;
      if (!clipboard || selection.dStart === selection.dEnd) return false;
      const plain = selection.map.display.slice(selection.dStart, selection.dEnd);
      const fragment = inlineFragmentForRange(
        selection.map,
        selection.dStart,
        selection.dEnd
      );
      clipboard.setData("text/plain", plain);
      clipboard.setData(TYPESET_INLINE_CLIPBOARD_MIME, encodeInlineClipboard(fragment));
      const nativeSelection = window.getSelection();
      if (nativeSelection?.rangeCount) {
        const wrapper = document.createElement("div");
        wrapper.append(nativeSelection.getRangeAt(0).cloneContents());
        clipboard.setData("text/html", wrapper.innerHTML);
      }
      return true;
    };

    const onCopy = (event: ClipboardEvent) => {
      const selection = readSelection();
      if (selection && selection.dStart !== selection.dEnd) {
        event.preventDefault();
        writeSelectionToClipboard(event, selection);
        return;
      }
      // Cross-field copy uses model slices, avoiding painter spans and caret placeholders.
      const nativeSelection = window.getSelection();
      if (!event.clipboardData || !nativeSelection?.rangeCount) return;
      const plain = crossFieldPlainText();
      if (plain === null) return;
      const wrapper = document.createElement("div");
      wrapper.append(nativeSelection.getRangeAt(0).cloneContents());
      wrapper.querySelectorAll<HTMLElement>("[data-tsde]").forEach((span) => {
        span.textContent = "";
      });
      event.preventDefault();
      event.clipboardData.setData("text/plain", plain);
      event.clipboardData.setData("text/html", wrapper.innerHTML);
    };

    const onCut = (event: ClipboardEvent) => {
      const selection = readSelection();
      if (!selection || selection.dStart === selection.dEnd) {
        // Spanning several fields: write the model's text, then delete the whole
        // selection as one edit. Without this, cut was a silent no-op.
        const plain = crossFieldPlainText();
        if (plain === null || !event.clipboardData) return;
        event.preventDefault();
        event.clipboardData.setData("text/plain", plain);
        if (commitPendingRef.current) queueIntent({ kind: "deleteSelection" });
        else commitCrossFieldIntent({ kind: "deleteSelection" });
        return;
      }
      event.preventDefault();
      writeSelectionToClipboard(event, selection);
      if (commitPendingRef.current) {
        queueIntent({ kind: "deleteSelection" });
        return;
      }
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

    // Document-level listeners finish drags that leave the page surface.
    const ownerDocument = host.ownerDocument ?? document;
    host.addEventListener("beforeinput", onBeforeInput);
    host.addEventListener("keydown", onKeyDown);
    host.addEventListener("mousedown", onMouseDown);
    ownerDocument.addEventListener("mousemove", onMouseMove);
    ownerDocument.addEventListener("mouseup", onMouseUp);
    host.addEventListener("paste", onPaste);
    host.addEventListener("copy", onCopy);
    host.addEventListener("cut", onCut);
    host.addEventListener("dragstart", blockDrag);
    host.addEventListener("drop", blockDrag);
    host.addEventListener("compositionstart", onCompositionStart);
    host.addEventListener("compositionend", onCompositionEnd);
    return () => {
      host.removeEventListener("beforeinput", onBeforeInput);
      host.removeEventListener("keydown", onKeyDown);
      host.removeEventListener("mousedown", onMouseDown);
      ownerDocument.removeEventListener("mousemove", onMouseMove);
      ownerDocument.removeEventListener("mouseup", onMouseUp);
      host.removeEventListener("paste", onPaste);
      host.removeEventListener("copy", onCopy);
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
    commitIndent,
    commitParagraphOutdent,
    commitPaste,
    commitReplace,
    indentWidthAt,
    onEnter,
    commitToggleMark,
    docVersion,
    hostRef,
    nonce,
    onZoomShortcut,
    readSelection,
    replayQueueRef,
    setNonce,
    structuredTabScope
  ]);
}
