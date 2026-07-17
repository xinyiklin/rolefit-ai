// TYPESET EDITOR (D013 endgame): the engine-painted page IS the editing
// surface. The document is one contenteditable host, so the BROWSER supplies
// what it is uniquely good at — caret from a click, selection, arrow keys —
// on the painter's real text; but it is never allowed to commit an edit.
// Every mutation is intercepted (`beforeinput` → preventDefault), translated
// into a ResumeData action, the engine relayouts (the same layout the PDF
// gets), React repaints the spans, and the caret is restored via the
// display↔value mapping in typesetEditing.ts. WYSIWYG is therefore exact
// while typing: text re-wraps live exactly as the export will.
//
// Text, structure, section scope, undo/redo, and review navigation all live on
// this one surface. Cross-field selections may roam freely but do not mutate.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Bold, ClipboardPaste, Copy, Italic, Redo2, Scissors, Underline, Undo2 } from "lucide-react";

import { toTemplateSchema, type ResumeData } from "../../lib/resumeData";
import type { ResumeEditorActions } from "../../hooks/useResumeEditor";
import type { DocStyleControls } from "../../hooks/useDocStyle";
import type { TailorMode } from "../../lib/tailorScope";
import type { TailorChangeTarget } from "../../resume/types";
import { fieldKey, parseFieldKey, type FieldSrc } from "../../typeset/types.ts";
import { pageGeometry } from "../../typeset/blocks.ts";
import type { LayoutDocument } from "../../typeset/layout.ts";
import { TypesetDomPages } from "../../typeset/render/dom.tsx";
import {
  anchorForField,
  anchorsFromDoc,
  fieldKeyForReviewTarget,
  type BlockAnchor
} from "./typesetStructure.ts";
import { TypesetChrome } from "./TypesetChrome.tsx";
import { TypesetContextMenu, type ContextMenuItem } from "./TypesetContextMenu.tsx";
import { useTypesetStructure, type PendingCaret } from "./useTypesetStructure.ts";
import {
  applyEdit,
  buildDisplayMap,
  caretToDisplayIndex,
  commitField,
  displayIndexForValueIndex,
  displayIndexToCaret,
  historyCaretTarget,
  splitValueAt,
  toggleMark,
  valueForField,
  type DisplayMap,
  type TypesetSelection
} from "./typesetEditing.ts";
import { useTypesetInputEvents, type QueuedIntent } from "./useTypesetInputEvents.ts";

// Editor zoom: the zoom select's 100% means the 816px logical page (96dpi);
// engine units are bp (72dpi), hence the 4/3.
const SCREEN_SCALE = 96 / 72;

// Platform-appropriate shortcut hints for the context menu (display only; the
// keydown handler already accepts both Cmd and Ctrl).
const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
const MOD = IS_MAC ? "⌘" : "Ctrl+";
const REDO_SHORTCUT = IS_MAC ? "⇧⌘Z" : "Ctrl+Y";

function keyOfNode(node: Node | null): { key: string; el: HTMLElement } | null {
  const el = node instanceof HTMLElement ? node : node?.parentElement ?? null;
  const target = el?.closest<HTMLElement>("[data-tsdf]");
  const key = target?.getAttribute("data-tsdf");
  return key && target ? { key, el: target } : null;
}

export function TypesetEditor({
  data,
  actions,
  canUndo,
  canRedo,
  docStyle,
  spellCheck = true,
  tailorModes,
  onSetTailorMode,
  highlightTarget = null
}: {
  data: ResumeData;
  actions: ResumeEditorActions;
  canUndo: boolean;
  canRedo: boolean;
  docStyle: DocStyleControls;
  // Browser typo underlines on the editable page (useEditorPrefs). Forwarded to
  // the host; never touches layout/export.
  spellCheck?: boolean;
  tailorModes?: Record<string, TailorMode>;
  onSetTailorMode?: (sectionId: string, mode: TailorMode) => void;
  highlightTarget?: TailorChangeTarget | null;
}) {
  const schema = useMemo(() => toTemplateSchema(data), [data]);
  const highlightedFieldKey = useMemo(() => fieldKeyForReviewTarget(data, highlightTarget), [data, highlightTarget]);
  const zoom = docStyle.style.zoom * SCREEN_SCALE;
  const geo = useMemo(() => pageGeometry(docStyle.style), [docStyle.style]);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  // Read through refs so commitHistory's identity stays stable (see its note).
  const canUndoRef = useRef(canUndo);
  canUndoRef.current = canUndo;
  const canRedoRef = useRef(canRedo);
  canRedoRef.current = canRedo;
  // Pre-edit selection per history snapshot, so undo re-highlights ONLY when the
  // edit was made over a real selection. Keyed by the exact ResumeData object the
  // reducer pushes to `past`; a WeakMap so superseded snapshots are collected.
  const selectionByDataRef = useRef(new WeakMap<ResumeData, { key: string; start: number; end: number }>());
  const headingUppercase = docStyle.style.headingCase === "uppercase";
  const uppercaseRef = useRef(headingUppercase);
  uppercaseRef.current = headingUppercase;

  const [nonce, setNonce] = useState(0);

  const [docVersion, setDocVersion] = useState(0);
  const [layoutDoc, setLayoutDoc] = useState<LayoutDocument | null>(null);
  const onDoc = useCallback((doc: LayoutDocument) => {
    setLayoutDoc(doc);
    setDocVersion((v) => v + 1);
  }, []);
  const pendingCaretRef = useRef<PendingCaret | null>(null);

  // COMMIT GATE (review finding): between dispatching an edit and the engine
  // repaint, the painted spans are one generation older than the data — an
  // input arriving in that window would map new offsets against the old DOM
  // (transposed or lost characters under key-repeat). While a commit is in
  // flight, mutation intents queue and replay one per repaint. A safety timer
  // forces a fresh paint when a dispatch is a no-op, so queued input is never
  // discarded or left stranded behind a gate that cannot settle.
  const commitPendingRef = useRef(false);
  const replayQueueRef = useRef<QueuedIntent[]>([]);
  const pendingTimerRef = useRef<number | null>(null);
  const markPending = useCallback(() => {
    commitPendingRef.current = true;
    if (pendingTimerRef.current !== null) window.clearTimeout(pendingTimerRef.current);
    pendingTimerRef.current = window.setTimeout(() => {
      pendingTimerRef.current = null;
      setNonce((current) => current + 1);
    }, 500);
  }, []);

  const mapFor = useCallback((src: FieldSrc, value: string): DisplayMap => {
    return buildDisplayMap(value, { uppercase: src.kind === "heading" && uppercaseRef.current });
  }, []);

  // ---- structural chrome (phase A): anchors, hover, margin controls ----

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [pageOrigins, setPageOrigins] = useState<Array<{ left: number; top: number }>>([]);
  const anchors = useMemo(() => (layoutDoc ? anchorsFromDoc(layoutDoc) : null), [layoutDoc]);
  const [activeFieldKey, setActiveFieldKey] = useState<string | null>(null);
  const activeAnchor = useMemo(() => anchorForField(anchors, activeFieldKey), [activeFieldKey, anchors]);

  // Page positions inside the wrapper (the chrome is a sibling overlay of the
  // contenteditable host — controls must never live INSIDE the editable DOM).
  // Measured from LIVE rects relative to the wrapper. offsetLeft/offsetTop can't
  // be trusted: they go stale when the editor pane changes width (review rail
  // dock/undock, window resize) or when the page-centering CSS applies after the
  // first paint, floating every margin control (grips, tailor chips, drop
  // indicator) off the sheet. A ResizeObserver alone is not enough either — it
  // is paint-gated and silently never fires in an occluded/background tab — so
  // the pointer path (onMouseMove) re-measures too. The compare skips the state
  // update when nothing moved, so hovering doesn't thrash renders.
  const measurePageOrigins = useCallback((): Array<{ left: number; top: number }> => {
    const wrap = wrapRef.current;
    if (!wrap) return [];
    const wrapRect = wrap.getBoundingClientRect();
    const next: Array<{ left: number; top: number }> = [];
    for (const page of wrap.querySelectorAll<HTMLElement>(".tsd-page")) {
      const rect = page.getBoundingClientRect();
      if (rect.width === 0) continue; // skip transient 0-size remount ghosts
      next.push({ left: rect.left - wrapRect.left, top: rect.top - wrapRect.top });
    }
    setPageOrigins((prev) =>
      prev.length === next.length && prev.every((p, i) => p.left === next[i].left && p.top === next[i].top)
        ? prev
        : next
    );
    return next;
  }, []);

  useLayoutEffect(() => {
    measurePageOrigins();
    // Fresh layout = stale hover: the anchor under the pointer may have moved
    // (or its contact INDEX may now mean a different item). Hide the chrome
    // until the pointer moves again rather than act on old geometry.
    setHovered(null);
    const onResize = () => measurePageOrigins();
    window.addEventListener("resize", onResize);
    const wrap = wrapRef.current;
    const observer =
      wrap && typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => measurePageOrigins()) : null;
    if (wrap && observer) {
      observer.observe(wrap);
      for (const page of wrap.querySelectorAll<HTMLElement>(".tsd-page")) observer.observe(page);
    }
    return () => {
      window.removeEventListener("resize", onResize);
      observer?.disconnect();
    };
  }, [docVersion, nonce, measurePageOrigins]);

  const [hovered, setHovered] = useState<BlockAnchor | null>(null);
  // Timestamp throttle, NOT requestAnimationFrame: the block lookup is ~30
  // array checks (cheap enough to run inline), and an rAF-gated hover wedges
  // permanently anywhere frames are starved (occluded/background tabs) — the
  // scheduled callback never runs and its guard blocks every later mousemove.
  const lastHoverAtRef = useRef(0);
  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (dragRef.current) return; // hover frozen while dragging
      // Freeze while the pointer is over the kit: reaching down the gutter stack
      // for a lower button moves the pointer's y into the next block, which would
      // otherwise re-target the hover and make the kit run away from the cursor.
      if ((e.target as HTMLElement | null)?.closest?.(".ts-chrome")) return;
      const now = performance.now();
      if (now - lastHoverAtRef.current < 40) return;
      lastHoverAtRef.current = now;
      const wrap = wrapRef.current;
      if (!wrap || !anchors) return;
      // Re-measure on the pointer path: this is the surface where the chrome
      // shows, so it stays glued to the sheet even if a resize slipped past the
      // observers (e.g. an occluded tab where ResizeObserver never fired).
      const origins = measurePageOrigins();
      const rect = wrap.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      let next: BlockAnchor | null = null;
      for (let pi = 0; pi < origins.length; pi += 1) {
        const o = origins[pi];
        if (x < o.left || x > o.left + 612 * zoom || y < o.top || y > o.top + 792 * zoom) continue;
        const yBp = (y - o.top) / zoom;
        const xBp = (x - o.left) / zoom;
        // Adjacent block ranges can OVERLAP by a couple of bp (a block's
        // descender allowance reaches past the next block's ascender line), so
        // first-match would target the PREVIOUS block near a top edge — pick
        // the candidate whose center is nearest instead. QA caught this as a
        // delete landing on the wrong bullet. Contact items also discriminate
        // by x (they share one line): x-matched contact wins over its line.
        let best: BlockAnchor | null = null;
        let bestDist = Infinity;
        let bestContact: BlockAnchor | null = null;
        let bestContactDist = Infinity;
        for (const b of anchors.blocks) {
          if (b.page !== pi || yBp < b.top - 1 || yBp > b.bottom + 1) continue;
          if (b.kind === "contact") {
            if (xBp < (b.x0 ?? 0) - 3 || xBp > (b.x1 ?? 0) + 3) continue;
            const dx = Math.abs(xBp - ((b.x0 ?? 0) + (b.x1 ?? 0)) / 2);
            if (dx < bestContactDist) {
              bestContactDist = dx;
              bestContact = b;
            }
            continue;
          }
          const dist = Math.abs(yBp - (b.top + b.bottom) / 2);
          if (dist < bestDist) {
            bestDist = dist;
            best = b;
          }
        }
        next = bestContact ?? best;
        break;
      }
      setHovered((prev) => {
        if (prev === next) return prev;
        if (
          prev &&
          next &&
          prev.kind === next.kind &&
          prev.sectionId === next.sectionId &&
          prev.entryId === next.entryId &&
          prev.bulletId === next.bulletId &&
          // contactIndex is part of a contact anchor's identity — omitting it
          // froze hover on the FIRST contact item ever hovered (QA caught a
          // delete landing on the wrong contact item).
          prev.contactIndex === next.contactIndex
        ) {
          return prev; // same block — keep the identity, skip the re-render
        }
        return next;
      });
    },
    [anchors, measurePageOrigins, zoom]
  );
  const clearHover = useCallback(() => setHovered(null), []);

  // Keep the structural controls tied to the caret as well as the pointer.
  // This makes the controls reachable after Tab leaves the single editable
  // host, instead of making keyboard users depend on a prior mouse hover.
  useEffect(() => {
    const host = hostRef.current;
    const wrap = wrapRef.current;
    if (!host || !wrap) return;
    const syncActiveField = () => {
      const selection = window.getSelection();
      const keyed = keyOfNode(selection?.focusNode ?? null);
      if (keyed && host.contains(keyed.el)) {
        setActiveFieldKey((current) => (current === keyed.key ? current : keyed.key));
      }
    };
    const clearOutside = (event: PointerEvent) => {
      if (!wrap.contains(event.target as Node)) setActiveFieldKey(null);
    };
    document.addEventListener("selectionchange", syncActiveField);
    document.addEventListener("pointerdown", clearOutside);
    syncActiveField();
    return () => {
      document.removeEventListener("selectionchange", syncActiveField);
      document.removeEventListener("pointerdown", clearOutside);
    };
  }, [docVersion, nonce]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || !highlightedFieldKey) return;
    host
      .querySelector<HTMLElement>(`[data-tsdf="${CSS.escape(highlightedFieldKey)}"]:not([data-tsdm])`)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [docVersion, highlightedFieldKey]);

  const {
    addBulletAfter,
    removeBulletAt,
    addEntryAfter,
    addItemToSection,
    addBulletToEntry,
    removeEntryAt,
    addSection,
    removeSectionAt,
    addContactItem,
    removeContactItem,
    drag,
    dragRef,
    beginDrag,
    moveByKeyboard
  } = useTypesetStructure({
    actions,
    dataRef,
    wrapRef,
    pendingCaretRef,
    markPending,
    anchors,
    pageOrigins,
    zoom
  });
  // Current selection in display coordinates; null when it isn't a clean
  // single-field selection (caret may roam anywhere, edits may not).
  const readSelection = useCallback((): TypesetSelection | null => {
    const host = hostRef.current;
    const sel = window.getSelection();
    if (!host || !sel || sel.rangeCount === 0) return null;
    const anchor = keyOfNode(sel.anchorNode);
    const focus = keyOfNode(sel.focusNode);
    if (!anchor || !focus || anchor.key !== focus.key) return null;
    if (!host.contains(anchor.el)) return null;
    const src = parseFieldKey(anchor.key);
    if (!src) return null;
    const value = valueForField(dataRef.current, src);
    const map = mapFor(src, value);
    const a = caretToDisplayIndex(host, anchor.key, map.display, sel.anchorNode!, sel.anchorOffset);
    const f = caretToDisplayIndex(host, anchor.key, map.display, sel.focusNode!, sel.focusOffset);
    if (a === null || f === null) return null;
    return { src, key: anchor.key, map, value, dStart: Math.min(a, f), dEnd: Math.max(a, f) };
  }, [mapFor]);

  // Remember the pre-edit selection before a text edit dispatches, keyed by the
  // snapshot the reducer is about to push. A ranged selection is recorded; a
  // collapsed caret clears the entry. Undo consults this so it re-highlights
  // ONLY the text that was actually selected. Coalesced runs keep the FIRST
  // edit's entry (later keystrokes key intermediate snapshots not kept in past).
  const recordPreEditSelection = useCallback((sel: TypesetSelection) => {
    if (sel.dEnd <= sel.dStart) {
      selectionByDataRef.current.delete(dataRef.current);
      return;
    }
    selectionByDataRef.current.set(dataRef.current, {
      key: sel.key,
      start: sel.map.valueStart[sel.dStart] ?? sel.value.length,
      end: sel.map.valueStart[sel.dEnd] ?? sel.value.length
    });
  }, []);

  // History spans every mutation source. A no-op undo/redo must NOT run the
  // commit pipeline: markPending()'s safety timer would bump the nonce and
  // repaint the whole surface — a visible flicker with nothing to restore.
  // On undo, if the undone edit was made over a real selection, that selection
  // comes back HIGHLIGHTED; otherwise (and on every redo) the caret collapses at
  // the end of what changed — "the typer at the last character". Structural
  // undo/redo (add/remove/reorder) diffs to nothing and fails closed.
  const commitHistory = useCallback(
    (direction: "undo" | "redo") => {
      if (direction === "undo" ? !canUndoRef.current : !canRedoRef.current) return;
      const before = dataRef.current;
      pendingCaretRef.current = (after) => {
        if (direction === "undo") {
          const highlighted = selectionByDataRef.current.get(after);
          if (highlighted) {
            return { key: highlighted.key, valueIndex: highlighted.start, valueEndIndex: highlighted.end };
          }
        }
        const span = historyCaretTarget(before, after);
        return span ? { key: span.key, valueIndex: span.valueEndIndex ?? span.valueIndex } : null;
      };
      markPending();
      if (direction === "undo") actions.undo();
      else actions.redo();
    },
    // canUndo/canRedo are read from refs so this callback's identity stays
    // stable. It's a dependency of the caret-restore effect: if it changed on
    // every undo/redo, that effect would fire on the pre-repaint render and
    // consume the pending caret against stale DOM (the selection restore failed).
    [actions, dataRef, markPending]
  );

  // ---- edit primitives (each sets the pending caret, then dispatches) ----

  const commitReplace = useCallback(
    (sel: TypesetSelection, dStart: number, dEnd: number, insert: string) => {
      const singleLine = sel.src.kind !== "bullet";
      const normalized = insert.replace(/\r/g, "");
      const text = singleLine ? normalized.replace(/\s*\n+\s*/g, " ") : normalized;
      const { value, caretValueIndex } = applyEdit(sel.map, dStart, dEnd, text);
      recordPreEditSelection(sel);
      markPending();
      commitField(actions, sel.src, value);
      const key = sel.key;
      pendingCaretRef.current = () => ({ key, valueIndex: caretValueIndex });
    },
    [actions, markPending, recordPreEditSelection]
  );

  const commitToggleMark = useCallback(
    (sel: TypesetSelection, mark: "bold" | "italic" | "underline") => {
      if (sel.dStart === sel.dEnd) return;
      const { value, caretValueIndex } = toggleMark(sel.map, sel.dStart, sel.dEnd, mark);
      recordPreEditSelection(sel);
      markPending();
      commitField(actions, sel.src, value);
      const key = sel.key;
      pendingCaretRef.current = () => ({ key, valueIndex: caretValueIndex });
    },
    [actions, markPending, recordPreEditSelection]
  );

  const commitSplitBullet = useCallback(
    (sel: TypesetSelection) => {
      if (sel.src.kind !== "bullet") return;
      const { sectionId, entryId, bulletId } = sel.src;
      // A ranged Enter deletes the range first; the split then happens at the
      // range start — computed on the post-deletion value, one dispatch.
      const base = sel.dStart === sel.dEnd ? sel : null;
      const afterDelete = base ? sel.value : applyEdit(sel.map, sel.dStart, sel.dEnd, "").value;
      const map = base ? sel.map : mapFor(sel.src, afterDelete);
      const { before, after } = splitValueAt(map, sel.dStart);
      const isSummary = dataRef.current.sections.find((section) => section.id === sectionId)?.type === "summary";
      recordPreEditSelection(sel);
      markPending();
      if (isSummary) actions.splitSummaryParagraph(sectionId, entryId, bulletId, before, after);
      else actions.splitBullet(sectionId, entryId, bulletId, before, after);
      pendingCaretRef.current = (fresh) => {
        const section = fresh.sections.find((item) => item.id === sectionId);
        const entry = section?.items.find((item) => item.id === entryId);
        if (isSummary) {
          const entryIndex = section?.items.findIndex((item) => item.id === entryId) ?? -1;
          const nextEntry = entryIndex >= 0 ? section?.items[entryIndex + 1] : undefined;
          const nextParagraph = nextEntry?.bullets[0];
          return nextParagraph && nextEntry
            ? {
                key: fieldKey({ kind: "bullet", sectionId, entryId: nextEntry.id, bulletId: nextParagraph.id }),
                valueIndex: 0
              }
            : null;
        }
        const index = entry?.bullets.findIndex((b) => b.id === bulletId) ?? -1;
        const next = index >= 0 ? entry?.bullets[index + 1] : undefined;
        return next ? { key: fieldKey({ kind: "bullet", sectionId, entryId, bulletId: next.id }), valueIndex: 0 } : null;
      };
    },
    [actions, mapFor, markPending, recordPreEditSelection]
  );

  const commitMergeBullet = useCallback(
    (sel: TypesetSelection, direction: "up" | "down"): boolean => {
      if (sel.src.kind !== "bullet") return false;
      const { sectionId, entryId, bulletId } = sel.src;
      const section = dataRef.current.sections.find((item) => item.id === sectionId);
      const entry = section?.items.find((item) => item.id === entryId);
      if (!entry) return false;
      recordPreEditSelection(sel); // collapsed at a boundary → clears any range
      if (section?.type === "summary") {
        const entryIndex = section.items.findIndex((item) => item.id === entryId);
        const lowerIndex = direction === "up" ? entryIndex : entryIndex + 1;
        if (lowerIndex <= 0 || lowerIndex >= section.items.length) return false;
        const upperEntry = section.items[lowerIndex - 1];
        const lowerEntry = section.items[lowerIndex];
        const upper = upperEntry.bullets[0];
        const lower = lowerEntry.bullets[0];
        if (!upper || !lower) return false;
        markPending();
        actions.mergeSummaryParagraphUp(sectionId, lowerEntry.id, upper.text + lower.text);
        pendingCaretRef.current = () => ({
          key: fieldKey({ kind: "bullet", sectionId, entryId: upperEntry.id, bulletId: upper.id }),
          valueIndex: upper.text.length
        });
        return true;
      }
      const index = entry.bullets.findIndex((b) => b.id === bulletId);
      if (index < 0) return false;
      const mergeId = direction === "up" ? bulletId : entry.bullets[index + 1]?.id;
      const upperId = direction === "up" ? entry.bullets[index - 1]?.id : bulletId;
      if (!mergeId || !upperId) return false;
      const upper = entry.bullets.find((b) => b.id === upperId)!;
      const lower = entry.bullets.find((b) => b.id === mergeId)!;
      const joined = upper.text + lower.text;
      markPending();
      actions.mergeBulletUp(sectionId, entryId, mergeId, joined);
      const caretValue = upper.text.length;
      pendingCaretRef.current = () => ({
        key: fieldKey({ kind: "bullet", sectionId, entryId, bulletId: upperId }),
        valueIndex: caretValue
      });
      return true;
    },
    [actions, markPending, recordPreEditSelection]
  );

  // ---- caret restore + gate settle (after the repaint an edit triggered) ----

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // 1) Restore the caret the last commit asked for.
    const pending = pendingCaretRef.current;
    pendingCaretRef.current = null;
    if (pending) {
      const target = pending(dataRef.current);
      const src = target ? parseFieldKey(target.key) : null;
      if (target && src) {
        const value = valueForField(dataRef.current, src);
        const map = mapFor(src, value);
        const d = displayIndexForValueIndex(map, Math.min(target.valueIndex, value.length));
        const pos = displayIndexToCaret(host, target.key, map.display, d);
        if (pos) {
          host.focus({ preventScroll: true });
          const sel = window.getSelection();
          if (sel) {
            const range = document.createRange();
            range.setStart(pos.node, pos.offset);
            if (target.valueEndIndex !== undefined) {
              const dEnd = displayIndexForValueIndex(map, Math.min(target.valueEndIndex, value.length));
              const end = displayIndexToCaret(host, target.key, map.display, dEnd);
              if (end) range.setEnd(end.node, end.offset);
              else range.collapse(true);
            } else {
              range.collapse(true);
            }
            sel.removeAllRanges();
            sel.addRange(range);
          }
          (pos.node.parentElement ?? undefined)?.scrollIntoView({ block: "nearest" });
        }
      }
    }
    // 2) Paint and data are the same generation again: open the gate and
    // replay ONE queued intent (its own commit re-closes the gate; the next
    // repaint drains the next intent).
    commitPendingRef.current = false;
    if (pendingTimerRef.current !== null) {
      window.clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
    const intent = replayQueueRef.current.shift();
    if (intent) {
      const sel = readSelection();
      if (!sel) {
        replayQueueRef.current = [];
        return;
      }
      if (intent.kind === "insert") {
        commitReplace(sel, sel.dStart, sel.dEnd, intent.text);
      } else if (intent.kind === "deleteBack") {
        if (sel.dStart === sel.dEnd && sel.dStart === 0) commitMergeBullet(sel, "up");
        else if (sel.dStart === sel.dEnd) commitReplace(sel, sel.dStart - 1, sel.dStart, "");
        else commitReplace(sel, sel.dStart, sel.dEnd, "");
      } else if (intent.kind === "deleteFwd") {
        if (sel.dStart === sel.dEnd && sel.dEnd === sel.map.chars.length) commitMergeBullet(sel, "down");
        else if (sel.dStart === sel.dEnd) commitReplace(sel, sel.dStart, sel.dStart + 1, "");
        else commitReplace(sel, sel.dStart, sel.dEnd, "");
      } else if (intent.kind === "deleteSelection") {
        if (sel.dStart !== sel.dEnd) commitReplace(sel, sel.dStart, sel.dEnd, "");
      } else if (intent.kind === "splitBullet") {
        commitSplitBullet(sel);
      } else if (intent.kind === "toggleMark") {
        commitToggleMark(sel, intent.mark);
      } else {
        commitHistory(intent.direction);
      }
    }
  }, [
    commitHistory,
    commitMergeBullet,
    commitReplace,
    commitSplitBullet,
    commitToggleMark,
    docVersion,
    mapFor,
    nonce,
    readSelection
  ]);

  useTypesetInputEvents({
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
  });
  const chromeAnchor = hovered ?? activeAnchor;
  const addBlock = useCallback(
    (block: BlockAnchor) => {
      const section = dataRef.current.sections.find((item) => item.id === block.sectionId);
      if ((block.kind === "bullet" && section?.type === "summary") || block.kind === "skillsRow") {
        addEntryAfter(block.sectionId, block.entryId!);
      } else if (block.kind === "bullet") {
        addBulletAfter(block.sectionId, block.entryId!, block.bulletId!);
      } else if (block.kind === "entry") {
        addBulletToEntry(block.sectionId, block.entryId!);
      }
    },
    [addBulletAfter, addBulletToEntry, addEntryAfter]
  );
  const removeBlock = useCallback(
    (block: BlockAnchor) => {
      const section = dataRef.current.sections.find((item) => item.id === block.sectionId);
      if (block.kind === "bullet" && section?.type !== "summary") {
        removeBulletAt(block.sectionId, block.entryId!, block.bulletId!);
      } else {
        removeEntryAt(block.sectionId, block.entryId!);
      }
    },
    [removeBulletAt, removeEntryAt]
  );

  // ---- self-owned right-click menu ----
  // Captures the selection at open time so acting on an item (which the buttons
  // preventDefault to keep the caret) operates on the same range the user
  // right-clicked, even though a menu click would otherwise move focus.
  const [contextMenu, setContextMenu] = useState<
    { x: number; y: number; sel: TypesetSelection | null; selText: string } | null
  >(null);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const openContextMenu = useCallback(
    (event: React.MouseEvent) => {
      // Replace the native menu only inside the editable page; the margin chrome
      // (grips, chips) keeps the browser's menu.
      if (!hostRef.current?.contains(event.target as Node)) return;
      event.preventDefault();
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        sel: readSelection(),
        selText: window.getSelection()?.toString() ?? ""
      });
    },
    [readSelection]
  );
  const writeClipboard = useCallback((text: string) => {
    if (text) void navigator.clipboard?.writeText(text).catch(() => {});
  }, []);
  const menuItems = useMemo<Array<ContextMenuItem | "divider">>(() => {
    if (!contextMenu) return [];
    const { sel, selText } = contextMenu;
    const hasRange = !!sel && sel.dStart !== sel.dEnd;
    // Paste needs a caret in one field AND readable clipboard (Firefox web
    // content can't read the clipboard from script, so it stays disabled there).
    const canPaste = !!sel && typeof navigator !== "undefined" && !!navigator.clipboard?.readText;
    return [
      {
        id: "cut",
        label: "Cut",
        shortcut: `${MOD}X`,
        icon: <Scissors size={14} />,
        disabled: !hasRange,
        onSelect: () => {
          if (!sel) return;
          writeClipboard(selText);
          commitReplace(sel, sel.dStart, sel.dEnd, "");
        }
      },
      {
        id: "copy",
        label: "Copy",
        shortcut: `${MOD}C`,
        icon: <Copy size={14} />,
        disabled: !selText,
        onSelect: () => writeClipboard(selText)
      },
      {
        id: "paste",
        label: "Paste",
        shortcut: `${MOD}V`,
        icon: <ClipboardPaste size={14} />,
        disabled: !canPaste,
        onSelect: () => {
          if (!sel) return;
          void navigator.clipboard
            ?.readText()
            .then((text) => {
              if (text) commitReplace(sel, sel.dStart, sel.dEnd, text);
            })
            .catch(() => {});
        }
      },
      "divider",
      {
        id: "bold",
        label: "Bold",
        shortcut: `${MOD}B`,
        icon: <Bold size={14} />,
        disabled: !hasRange,
        onSelect: () => {
          if (sel) commitToggleMark(sel, "bold");
        }
      },
      {
        id: "italic",
        label: "Italic",
        shortcut: `${MOD}I`,
        icon: <Italic size={14} />,
        disabled: !hasRange,
        onSelect: () => {
          if (sel) commitToggleMark(sel, "italic");
        }
      },
      {
        id: "underline",
        label: "Underline",
        shortcut: `${MOD}U`,
        icon: <Underline size={14} />,
        disabled: !hasRange,
        onSelect: () => {
          if (sel) commitToggleMark(sel, "underline");
        }
      },
      "divider",
      {
        id: "undo",
        label: "Undo",
        shortcut: `${MOD}Z`,
        icon: <Undo2 size={14} />,
        disabled: !canUndo,
        onSelect: () => commitHistory("undo")
      },
      {
        id: "redo",
        label: "Redo",
        shortcut: REDO_SHORTCUT,
        icon: <Redo2 size={14} />,
        disabled: !canRedo,
        onSelect: () => commitHistory("redo")
      }
    ];
  }, [canRedo, canUndo, commitHistory, commitReplace, commitToggleMark, contextMenu, writeClipboard]);

  return (
    <div
      className={`typeset-editor${drag ? " is-dragging" : ""}`}
      ref={wrapRef}
      onMouseMove={onMouseMove}
      onMouseLeave={clearHover}
      onContextMenu={openContextMenu}
    >
      <TypesetDomPages
        key={nonce}
        schema={schema}
        docStyle={docStyle.style}
        zoom={zoom}
        variant="screen"
        editable
        spellCheck={spellCheck}
        hostRef={hostRef}
        onDoc={onDoc}
        highlightFieldKey={highlightedFieldKey}
      />
      <TypesetChrome
        data={data}
        anchor={chromeAnchor}
        anchors={anchors}
        pageOrigins={pageOrigins}
        zoom={zoom}
        geometry={geo}
        tailorModes={tailorModes}
        onSetTailorMode={onSetTailorMode}
        highlightTarget={highlightTarget}
        drag={drag}
        onBeginDrag={beginDrag}
        onMoveByKeyboard={moveByKeyboard}
        onAddBlock={addBlock}
        onRemoveBlock={removeBlock}
        onSetName={actions.setName}
        onUpdateContact={actions.updateContact}
        onUpdateEntry={actions.updateEntry}
        onAddSectionItem={addItemToSection}
        onRemoveSection={removeSectionAt}
        onAddContact={addContactItem}
        onRemoveContact={removeContactItem}
        onAddSection={addSection}
      />
      {contextMenu ? (
        <TypesetContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={menuItems}
          onClose={closeContextMenu}
        />
      ) : null}
    </div>
  );
}
