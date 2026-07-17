// TYPESET EDITOR: the engine-painted page IS the editing
// surface. The document is one contenteditable host, so the BROWSER supplies
// what it is uniquely good at — caret from a click, selection, arrow keys —
// on the painter's real text; but it is never allowed to commit an edit.
// Every mutation is intercepted (`beforeinput` → preventDefault), translated
// into a ResumeData action, the engine relayouts (the same layout the PDF
// gets), React repaints the spans, and the caret is restored via the
// display↔value mapping in inlineTextEditing.ts and domSelection.ts. WYSIWYG is therefore exact
// while typing: text re-wraps live exactly as the export will.
//
// Text, structure, section scope, undo/redo, and review navigation all live on
// this one surface. Cross-field selections may roam freely but do not mutate.
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";

import type { ResumeData, ResumeSectionType } from "@typeset/engine/lib/resumeData";
import { automaticLinkHref } from "@typeset/engine/lib/links";
import type { ResumeEditorActions } from "../../hooks/useResumeEditor";
import {
  STYLE_FIELD_MARK_DEFAULTS,
  styleFieldDefaultSizePt,
  styleFieldMarkStates,
  type EntryTextField,
  type StyleTextField
} from "@typeset/engine/lib/styleFieldFormatting";
import { stripInlineMarks } from "@typeset/engine/lib/inlineMarksText";
import type { DocStyleControls } from "../../hooks/useDocStyle";
import type { AlignmentScope, BodyAlign, DocStyle, FontFamily } from "@typeset/engine/lib/documentStyle";
import { fontSizesFor, nameSizePt } from "@typeset/engine/lib/documentTypography";
import { fieldKey, parseFieldKey, type FieldSrc } from "@typeset/engine/typeset/types";
import { pageGeometry } from "@typeset/engine/typeset/blocks";
import type { LayoutDocument } from "@typeset/engine/typeset/layout";
import { TypesetDomPages } from "@typeset/engine/typeset/render/dom";
import { toTypesetSchema } from "@typeset/engine/typeset/schema";
import { anchorsFromDoc } from "./typesetStructure.ts";
import { TypesetStructureOverlay } from "./TypesetStructureOverlay.tsx";
import { TypesetContextMenu } from "./TypesetContextMenu.tsx";
import { useTypesetStructure, type PendingCaret } from "./useTypesetStructure.ts";
import { useTypesetOverlayAnchors } from "./useTypesetOverlayAnchors.ts";
import { useTypesetContextMenu } from "./useTypesetContextMenu.tsx";
import { caretToDisplayIndex, displayIndexToCaret, keyOfNode } from "./domSelection.ts";
import {
  applyEdit,
  buildDisplayMap,
  displayIndexForValueIndex,
  splitValueAt,
  setFontFamily,
  setFontSize,
  setAlignment,
  setLink,
  removeLink,
  replaceWithLink,
  explicitLinkRunAt,
  autoLinkWordAt,
  expandToLinkRun,
  trailingLinkWordAt,
  suppressAutoLink,
  clearFormatting,
  hasClearableFormatting,
  toggleMark,
  typingFormatForDeletedRange,
  type DisplayMap,
  type TypingFormat,
  type TypesetSelection
} from "./inlineTextEditing.ts";
import { commitField, historyCaretTarget, valueForField, withFieldValue } from "./resumeFieldAdapter.ts";
import { useTypesetInputEvents, type QueuedIntent } from "./useTypesetInputEvents.ts";

// Editor zoom: the zoom select's 100% means the 816px logical page (96dpi);
// engine units are bp (72dpi), hence the 4/3.
const SCREEN_SCALE = 96 / 72;

export type InlineFormatState = {
  canFormat: boolean;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  fontFamily: FontFamily | null;
  fontSizePt: number | null;
  alignment: BodyAlign | null;
  alignmentScope: AlignmentScope | null;
  entryField: EntryTextField | null;
  linkHref: string | null;
  linkText: string;
  linkAutomatic: boolean;
  canLink: boolean;
  canClearFormatting: boolean;
};

export type TypesetEditorHandle = {
  undo: () => void;
  redo: () => void;
  toggleMark: (mark: "bold" | "italic" | "underline") => void;
  setFontFamily: (fontFamily: FontFamily) => void;
  setFontSize: (fontSizePt: number) => void;
  setAlignment: (alignment: BodyAlign) => void;
  applyLink: (text: string, href: string) => void;
  removeLink: () => void;
  clearFormatting: () => void;
  addSection: (type: ResumeSectionType, position: "top" | "bottom") => void;
};

type TypesetEditorProps = {
  data: ResumeData;
  actions: ResumeEditorActions;
  canUndo: boolean;
  canRedo: boolean;
  docStyle: DocStyleControls;
  onInlineFormatStateChange?: (state: InlineFormatState) => void;
  // Opens the toolbar link editor (used by the right-click "Add/Edit link"
  // items, which have no URL field of their own).
  onRequestLinkEditor?: () => void;
};

const EMPTY_FORMAT_STATE: InlineFormatState = {
  canFormat: false,
  bold: false,
  italic: false,
  underline: false,
  fontFamily: null,
  fontSizePt: null,
  alignment: null,
  alignmentScope: null,
  entryField: null,
  linkHref: null,
  linkText: "",
  linkAutomatic: false,
  canLink: false,
  canClearFormatting: false
};

function alignmentScopeForField(src: FieldSrc): AlignmentScope | null {
  if (src.kind === "name" || src.kind === "contact") return "header";
  if (src.kind === "heading") return "heading";
  if (src.kind === "bullet" || src.kind === "skillsRow") return "body";
  return null;
}

function entryFieldForField(src: FieldSrc): EntryTextField | null {
  return src.kind === "entry" ? src.field : null;
}

// Resolve through the shared role-size truth: the name via the document's
// nameSize scale, every styleable field via styleFieldDefaultSizePt, and
// bullets (which have no style-field role) at the body size.
function defaultFontSizeForField(src: FieldSrc, style: DocStyle): number {
  if (src.kind === "name") return nameSizePt(fontSizesFor(style.baseFontSizePt), style.nameSize);
  const field = styleFieldForSrc(src);
  return field
    ? styleFieldDefaultSizePt(field, style.baseFontSizePt)
    : fontSizesFor(style.baseFontSizePt).small;
}

function defaultAlignmentForField(src: FieldSrc, style: DocStyle): BodyAlign {
  if (src.kind === "name" || src.kind === "contact") return style.headerAlign;
  if (src.kind === "heading") return style.headingAlign;
  if (src.kind === "entry") return "left";
  return style.bodyAlign;
}

function typingTargetFor(selection: TypesetSelection) {
  return `${selection.key}:${selection.dStart}`;
}

// The style field a caret's src contributes to, for document-wide emphasis
// (bold titles, italic subtitles, bold skill labels). Name and bullets have no
// document emphasis convention.
function styleFieldForSrc(src: FieldSrc): StyleTextField | null {
  if (src.kind === "entry") return src.field;
  if (src.kind === "skillsRow") return "skillLabel";
  if (src.kind === "heading") return "sectionHeading";
  if (src.kind === "contact") return "contact";
  return null;
}

// Emphasis a newly-typed EMPTY field should inherit: the document's prevailing
// bold/italic/underline for that field kind when it is uniform ("not mixed"),
// else the field's built-in default. Returns null for fields with no convention.
// This seeds the typing format so a fresh entry title / subtitle / skills label
// comes out matching the rest of the document instead of unformatted.
function emphasisSeedForField(data: ResumeData, src: FieldSrc): TypingFormat | null {
  const field = styleFieldForSrc(src);
  if (!field) return null;
  const states = styleFieldMarkStates(data)[field];
  const resolve = (mark: "bold" | "italic" | "underline") =>
    states[mark] === null ? STYLE_FIELD_MARK_DEFAULTS[field][mark] : states[mark]!;
  return {
    bold: resolve("bold"),
    italic: resolve("italic"),
    underline: resolve("underline"),
    fontFamily: null,
    fontSizePt: null,
    alignment: null
  };
}

export const TypesetEditor = forwardRef<TypesetEditorHandle, TypesetEditorProps>(function TypesetEditor({
  data,
  actions,
  canUndo,
  canRedo,
  docStyle,
  onInlineFormatStateChange,
  onRequestLinkEditor
}, ref) {
  // Defer visual auto-linking: while a URL word is being typed (its trailing edge
  // is the caret), suppress ITS auto-link in the render only — { field key, the
  // field value with that word wrapped in <nolink> }. The stored data is intact,
  // so the display map used for caret math still sees the real value.
  const [autoLinkSuppress, setAutoLinkSuppress] = useState<{ key: string; value: string } | null>(null);
  const autoLinkSuppressRef = useRef<{ key: string; value: string } | null>(null);
  const renderData = useMemo(() => {
    if (!autoLinkSuppress) return data;
    const src = parseFieldKey(autoLinkSuppress.key);
    return src ? withFieldValue(data, src, autoLinkSuppress.value) : data;
  }, [data, autoLinkSuppress]);
  const schema = useMemo(() => toTypesetSchema(renderData), [renderData]);
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
    return buildDisplayMap(value, {
      uppercase: src.kind === "heading" && uppercaseRef.current,
      // Every field now keeps its spaces (word-processor spacing): single-line
      // fields render verbatim, and wrapping paragraphs emit literal space
      // glyphs plus one break glue per run (see measure.ts paragraphItems), so
      // the caret map and the painted DOM agree on every space.
      preserveWhitespace: true
    });
  }, []);

  // ---- structure overlay: anchors, hover, and drag controls ----

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const anchors = useMemo(() => (layoutDoc ? anchorsFromDoc(layoutDoc) : null), [layoutDoc]);
  const { pageOrigins, hovered, activeAnchor, updateHover, clearHover } = useTypesetOverlayAnchors({
    wrapRef,
    hostRef,
    anchors,
    zoom,
    docVersion,
    nonce
  });

  const {
    removeBulletAt,
    addBulletToEntry,
    removeEntryAt,
    addSection,
    addEntryRelative,
    addBulletRelative,
    addSectionRelative,
    removeSectionAt,
    drag,
    dragRef,
    canDrag,
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

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (dragRef.current) return; // hover frozen while dragging
      updateHover(e);
    },
    [dragRef, updateHover]
  );

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

  // The toolbar sits outside the contenteditable page. Preserve the last valid
  // single-field range so a toolbar click can apply formatting without asking
  // the browser to rediscover a selection after focus moves to application
  // overlay. Toolbar formatting buttons prevent mousedown focus transfer, which
  // keeps the selected text visible while the command commits.
  const lastRangeRef = useRef<TypesetSelection | null>(null);
  const typingFormatRef = useRef<TypingFormat | null>(null);
  const typingTargetRef = useRef<string | null>(null);
  const [inlineFormatState, setInlineFormatState] = useState<InlineFormatState>(EMPTY_FORMAT_STATE);

  useEffect(() => {
    const sync = () => {
      const selection = readSelection();
      // Deferred auto-linking: suppress the render link of the URL word whose
      // trailing edge is the caret (it is being typed); it links once a space
      // follows or the caret leaves it. Computed before the toolbar-focus early
      // return so leaving the field to the toolbar also completes the word.
      const suppressWord =
        selection && selection.dStart === selection.dEnd
          ? trailingLinkWordAt(selection.map, selection.dStart)
          : null;
      const nextSuppress =
        selection && suppressWord
          ? { key: selection.key, value: suppressAutoLink(selection.map, suppressWord.start, suppressWord.end) }
          : null;
      const prevSuppress = autoLinkSuppressRef.current;
      if ((prevSuppress?.key ?? null) !== (nextSuppress?.key ?? null) || (prevSuppress?.value ?? null) !== (nextSuppress?.value ?? null)) {
        // Toggling the word's <a>/<span> relayouts and drops the DOM caret, so
        // restore it (by value index) after the repaint, like a commit does.
        if (selection) {
          const key = selection.key;
          const vStart = selection.map.valueStart[selection.dStart] ?? selection.value.length;
          const vEnd =
            selection.dEnd > selection.dStart ? (selection.map.valueStart[selection.dEnd] ?? selection.value.length) : undefined;
          pendingCaretRef.current = () => ({ key, valueIndex: vStart, valueEndIndex: vEnd });
        }
        autoLinkSuppressRef.current = nextSuppress;
        setAutoLinkSuppress(nextSuppress);
      }
      const hasRange = Boolean(selection && selection.dEnd > selection.dStart);
      if (selection) lastRangeRef.current = selection;
      // Editable toolbar controls (notably the custom font-size input) must
      // temporarily take focus without discarding the page range they target.
      // Outside the toolbar, a lost editor selection really does clear it.
      else if (!selection && document.activeElement?.closest(".top-toolbar")) return;
      else if (!selection) lastRangeRef.current = null;

      const chars = selection
        ? hasRange
          ? selection.map.chars.slice(selection.dStart, selection.dEnd)
          : selection.map.chars.length
            ? [selection.map.chars[Math.max(0, Math.min(selection.dStart - 1, selection.map.chars.length - 1))]]
            : []
        : [];
      if (
        selection &&
        !hasRange &&
        typingTargetRef.current &&
        typingTargetRef.current !== typingTargetFor(selection)
      ) {
        typingFormatRef.current = null;
        typingTargetRef.current = null;
      }
      // Seed the typing format when the caret enters an EMPTY field so the first
      // characters inherit the document's prevailing emphasis for that field kind
      // (bold title, italic subtitle, bold skills label) instead of coming out
      // unformatted. Whole-field marks can't be pre-baked onto an empty value, so
      // this is the hook that carries the convention into new entries/skill rows.
      if (selection && !hasRange && selection.map.chars.length === 0 && !typingFormatRef.current) {
        const seed = emphasisSeedForField(dataRef.current, selection.src);
        if (seed && (seed.bold || seed.italic || seed.underline)) {
          typingFormatRef.current = seed;
          typingTargetRef.current = typingTargetFor(selection);
        }
      }
      const fallbackSize = selection ? defaultFontSizeForField(selection.src, docStyle.style) : docStyle.style.baseFontSizePt;
      const effectiveSizes = chars.map((char) => char.fontSizePt ?? fallbackSize);
      const effectiveFamilies = chars.map((char) => char.fontFamily ?? docStyle.style.fontFamily);
      const effectiveAlignments = chars.map(
        (char) => char.alignment ?? (selection ? defaultAlignmentForField(selection.src, docStyle.style) : docStyle.style.bodyAlign)
      );
      const typingFormat = selection && !hasRange ? typingFormatRef.current : null;
      const selectedText = selection && hasRange
        ? selection.map.display.slice(selection.dStart, selection.dEnd).trim()
        : "";
      const hasSuppressedLink = chars.some((char) => char.linkSuppressed);
      // The link the selection is within, always resolved to the WHOLE link:
      // an explicit run at a caret, an auto-word at a caret (deferred at the
      // trailing edge — still being typed), or the full link a RANGE overlaps.
      const caretLinkRun = selection && !hasRange ? explicitLinkRunAt(selection.map, selection.dStart) : null;
      const caretAutoLink =
        selection && !hasRange && !caretLinkRun ? autoLinkWordAt(selection.map, selection.dStart) : null;
      const rangeLinkRun =
        selection && hasRange ? expandToLinkRun(selection.map, selection.dStart, selection.dEnd) : null;
      const linkRun = caretLinkRun ?? caretAutoLink ?? rangeLinkRun ?? null;
      const linkRunIsExplicit = Boolean(
        linkRun && selection && selection.map.chars[linkRun.start]?.linkHref === linkRun.href
      );
      // A plain range that itself reads as a URL offers to become a new link.
      const plainAutoHref = !linkRun && !hasSuppressedLink ? automaticLinkHref(selectedText) : null;
      const detectedHref = linkRun?.href ?? plainAutoHref ?? null;
      const detectedLinkText = linkRun && selection
        ? selection.map.display.slice(linkRun.start, linkRun.end)
        : hasRange
          ? selection!.map.display.slice(selection!.dStart, selection!.dEnd)
          : "";
      const next: InlineFormatState = {
        canFormat: Boolean(selection),
        bold: typingFormat?.bold ?? (chars.length > 0 && chars.every((char) => char.bold)),
        italic: typingFormat?.italic ?? (chars.length > 0 && chars.every((char) => char.italic)),
        underline: typingFormat?.underline ?? (chars.length > 0 && chars.every((char) => char.underline)),
        fontFamily:
          typingFormat?.fontFamily ?? (effectiveFamilies.length === 0
            ? docStyle.style.fontFamily
            : effectiveFamilies.every((family) => family === effectiveFamilies[0])
              ? effectiveFamilies[0]
              : null),
        fontSizePt:
          typingFormat?.fontSizePt ?? (effectiveSizes.length > 0 && effectiveSizes.every((size) => size === effectiveSizes[0])
            ? Math.round((effectiveSizes[0] ?? 0) * 10) / 10
            : fallbackSize),
        alignment:
          effectiveAlignments.length === 0
            ? docStyle.style.bodyAlign
            : effectiveAlignments.every((alignment) => alignment === effectiveAlignments[0])
              ? effectiveAlignments[0]
              : null,
        alignmentScope: selection ? alignmentScopeForField(selection.src) : null,
        entryField: selection ? entryFieldForField(selection.src) : null,
        linkHref: detectedHref,
        // The display text the link editor pre-fills: the WHOLE link when the
        // selection is within one, else the selected text, else empty (insert).
        linkText: detectedLinkText,
        linkAutomatic: Boolean(detectedHref && !linkRunIsExplicit),
        // Enabled wherever a clean single-field caret exists — a range or link
        // edits in place, a bare caret inserts new linked text (Google-Docs-style).
        canLink: Boolean(selection),
        canClearFormatting: Boolean(selection && hasRange && hasClearableFormatting(selection.map, selection.dStart, selection.dEnd))
      };
      setInlineFormatState((current) =>
        current.canFormat === next.canFormat &&
        current.bold === next.bold &&
        current.italic === next.italic &&
        current.underline === next.underline &&
        current.fontFamily === next.fontFamily &&
        current.fontSizePt === next.fontSizePt &&
        current.alignment === next.alignment &&
        current.alignmentScope === next.alignmentScope &&
        current.entryField === next.entryField &&
        current.linkHref === next.linkHref &&
        current.linkText === next.linkText &&
        current.linkAutomatic === next.linkAutomatic &&
        current.canLink === next.canLink &&
        current.canClearFormatting === next.canClearFormatting
          ? current
          : next
      );
    };

    document.addEventListener("selectionchange", sync);
    sync();
    return () => document.removeEventListener("selectionchange", sync);
  }, [docStyle.style, docVersion, nonce, readSelection]);

  useEffect(() => {
    onInlineFormatStateChange?.(inlineFormatState);
  }, [inlineFormatState, onInlineFormatStateChange]);

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
      const typingFormat = dStart === dEnd ? typingFormatRef.current ?? undefined : undefined;
      const deletedTypingFormat = text.length === 0 ? typingFormatForDeletedRange(sel.map, dStart, dEnd) : null;
      if (deletedTypingFormat) {
        typingFormatRef.current = deletedTypingFormat;
        typingTargetRef.current = `${sel.key}:${dStart}`;
      }
      const { value, caretValueIndex } = applyEdit(sel.map, dStart, dEnd, text, typingFormat);
      recordPreEditSelection(sel);
      markPending();
      commitField(actions, sel.src, value);
      const key = sel.key;
      if (sel.src.kind === "skillsRow") {
        // Typing the colon crosses from the label into the skills: drop the seeded
        // label emphasis (see emphasisSeedForField) so the skills come out plain
        // even when the label is bold. Skills then inherit from the plain injected
        // ": " separator.
        if (text.includes(":")) {
          typingFormatRef.current = null;
          typingTargetRef.current = null;
        }
        // A skills row stores label + skills separately and reconstructs its
        // editable text with one canonical space after the colon. A bold label
        // can also move its </b> across that colon between the typed value and the
        // reconstructed one. Map the caret through DISPLAY space so either
        // normalization remains invisible to the user.
        const src = sel.src;
        const typedMap = mapFor(src, value);
        const caretDisplay = displayIndexForValueIndex(typedMap, caretValueIndex);
        pendingCaretRef.current = (fresh) => {
          const freshValue = valueForField(fresh, src);
          const freshMap = mapFor(src, freshValue);
          const target = Math.max(
            0,
            Math.min(caretDisplay + (freshMap.display.length - typedMap.display.length), freshMap.display.length)
          );
          const valueIndex = target < freshMap.display.length ? freshMap.valueStart[target] ?? freshValue.length : freshValue.length;
          return { key, valueIndex };
        };
      } else {
        pendingCaretRef.current = () => ({ key, valueIndex: caretValueIndex });
      }
    },
    [actions, mapFor, markPending, recordPreEditSelection]
  );

  // The shared "re-highlight this display range after the repaint" closure
  // used by every range-formatting commit (marks, font, size, link, clear).
  const restoreRangeAfterRepaint = useCallback(
    (sel: TypesetSelection, dStart: number, dEnd: number) => {
      const key = sel.key;
      const src = sel.src;
      pendingCaretRef.current = (fresh) => {
        const freshValue = valueForField(fresh, src);
        const nextMap = mapFor(src, freshValue);
        return {
          key,
          valueIndex: nextMap.valueStart[dStart] ?? 0,
          valueEndIndex: nextMap.valueStart[dEnd] ?? freshValue.length
        };
      };
    },
    [mapFor]
  );

  const commitToggleMark = useCallback(
    (sel: TypesetSelection, mark: "bold" | "italic" | "underline") => {
      if (sel.dStart === sel.dEnd) return;
      if (sel.src.kind === "heading" && docStyle.style.headingCase === "smallcaps") return;
      const { value } = toggleMark(sel.map, sel.dStart, sel.dEnd, mark);
      recordPreEditSelection(sel);
      markPending();
      commitField(actions, sel.src, value);
      restoreRangeAfterRepaint(sel, sel.dStart, sel.dEnd);
    },
    [actions, docStyle.style.headingCase, markPending, recordPreEditSelection, restoreRangeAfterRepaint]
  );

  const commitFontFamily = useCallback(
    (sel: TypesetSelection, fontFamily: FontFamily) => {
      if (sel.dStart === sel.dEnd) return;
      const { value } = setFontFamily(sel.map, sel.dStart, sel.dEnd, fontFamily);
      recordPreEditSelection(sel);
      markPending();
      commitField(actions, sel.src, value);
      restoreRangeAfterRepaint(sel, sel.dStart, sel.dEnd);
    },
    [actions, markPending, recordPreEditSelection, restoreRangeAfterRepaint]
  );

  const commitFontSize = useCallback(
    (sel: TypesetSelection, fontSizePt: number) => {
      if (sel.dStart === sel.dEnd) return;
      const { value } = setFontSize(sel.map, sel.dStart, sel.dEnd, fontSizePt);
      recordPreEditSelection(sel);
      markPending();
      commitField(actions, sel.src, value);
      restoreRangeAfterRepaint(sel, sel.dStart, sel.dEnd);
    },
    [actions, markPending, recordPreEditSelection, restoreRangeAfterRepaint]
  );

  const commitAlignment = useCallback(
    (sel: TypesetSelection, alignment: BodyAlign) => {
      const { value } = setAlignment(sel.map, alignment);
      const nextMap = mapFor(sel.src, value);
      recordPreEditSelection(sel);
      markPending();
      commitField(actions, sel.src, value);
      const key = sel.key;
      pendingCaretRef.current = () => ({
        key,
        valueIndex: nextMap.valueStart[sel.dStart] ?? 0,
        valueEndIndex: nextMap.valueStart[sel.dEnd] ?? value.length
      });
    },
    [actions, mapFor, markPending, recordPreEditSelection]
  );

  const commitLink = useCallback(
    (sel: TypesetSelection, dStart: number, dEnd: number, href: string | null) => {
      if (dStart === dEnd) return;
      const { value } = href
        ? setLink(sel.map, dStart, dEnd, href)
        : removeLink(sel.map, dStart, dEnd);
      recordPreEditSelection({ ...sel, dStart, dEnd });
      markPending();
      commitField(actions, sel.src, value);
      restoreRangeAfterRepaint(sel, dStart, dEnd);
    },
    [actions, markPending, recordPreEditSelection, restoreRangeAfterRepaint]
  );

  const commitClearFormatting = useCallback(
    (sel: TypesetSelection) => {
      if (sel.dStart === sel.dEnd) return;
      const { value } = clearFormatting(sel.map, sel.dStart, sel.dEnd);
      recordPreEditSelection(sel);
      markPending();
      commitField(actions, sel.src, value);
      restoreRangeAfterRepaint(sel, sel.dStart, sel.dEnd);
    },
    [actions, markPending, recordPreEditSelection, restoreRangeAfterRepaint]
  );

  // Replace a display range with linked text (two-field editor: the visible text
  // may differ from the URL, or a bare caret inserts a brand-new link).
  const commitReplaceWithLink = useCallback(
    (sel: TypesetSelection, dStart: number, dEnd: number, text: string, href: string) => {
      const { value, caretValueIndex } = replaceWithLink(sel.map, dStart, dEnd, text, href);
      recordPreEditSelection({ ...sel, dStart, dEnd });
      markPending();
      commitField(actions, sel.src, value);
      const key = sel.key;
      pendingCaretRef.current = () => ({ key, valueIndex: caretValueIndex });
    },
    [actions, markPending, recordPreEditSelection]
  );

  // The display range a link command should act on: the selection when ranged,
  // else the explicit-link run under a collapsed caret. Null when a bare caret
  // isn't inside a link (nothing to edit or remove).
  const resolveLinkTarget = useCallback(
    (selection: TypesetSelection): { dStart: number; dEnd: number } | null => {
      // A selection or caret anywhere inside a link resolves to the WHOLE link,
      // so edit/remove act on all of it — not just the part selected.
      const run = expandToLinkRun(selection.map, selection.dStart, selection.dEnd);
      return run ? { dStart: run.start, dEnd: run.end } : null;
    },
    []
  );

  useImperativeHandle(
    ref,
    () => ({
      undo: () => commitHistory("undo"),
      redo: () => commitHistory("redo"),
      toggleMark: (mark) => {
        const selection = readSelection() ?? lastRangeRef.current;
        if (!selection) return;
        if (selection.src.kind === "heading" && docStyle.style.headingCase === "smallcaps") return;
        if (selection.dEnd > selection.dStart) commitToggleMark(selection, mark);
        else {
          const char = selection.map.chars[Math.max(0, Math.min(selection.dStart - 1, selection.map.chars.length - 1))];
          const base: TypingFormat = typingFormatRef.current ?? {
            bold: char?.bold ?? false,
            italic: char?.italic ?? false,
            underline: char?.underline ?? false,
            fontFamily: char?.fontFamily ?? docStyle.style.fontFamily,
            fontSizePt: char?.fontSizePt ?? defaultFontSizeForField(selection.src, docStyle.style),
            alignment: char?.alignment ?? defaultAlignmentForField(selection.src, docStyle.style)
          };
          typingFormatRef.current = { ...base, [mark]: !base[mark] };
          typingTargetRef.current = typingTargetFor(selection);
          setInlineFormatState((state) => ({ ...state, [mark]: !base[mark] }));
        }
      },
      setFontFamily: (fontFamily) => {
        const selection = readSelection() ?? lastRangeRef.current;
        if (!selection) return;
        if (selection.dEnd > selection.dStart) commitFontFamily(selection, fontFamily);
        else {
          const char = selection.map.chars[Math.max(0, Math.min(selection.dStart - 1, selection.map.chars.length - 1))];
          typingFormatRef.current = {
            bold: typingFormatRef.current?.bold ?? char?.bold ?? false,
            italic: typingFormatRef.current?.italic ?? char?.italic ?? false,
            underline: typingFormatRef.current?.underline ?? char?.underline ?? false,
            fontFamily,
            fontSizePt: typingFormatRef.current?.fontSizePt ?? char?.fontSizePt ?? defaultFontSizeForField(selection.src, docStyle.style),
            alignment: typingFormatRef.current?.alignment ?? char?.alignment ?? defaultAlignmentForField(selection.src, docStyle.style)
          };
          typingTargetRef.current = typingTargetFor(selection);
          setInlineFormatState((state) => ({ ...state, fontFamily }));
        }
      },
      setFontSize: (fontSizePt) => {
        const selection = readSelection() ?? lastRangeRef.current;
        if (!selection) return;
        if (selection.dEnd > selection.dStart) commitFontSize(selection, fontSizePt);
        else {
          const char = selection.map.chars[Math.max(0, Math.min(selection.dStart - 1, selection.map.chars.length - 1))];
          typingFormatRef.current = {
            bold: typingFormatRef.current?.bold ?? char?.bold ?? false,
            italic: typingFormatRef.current?.italic ?? char?.italic ?? false,
            underline: typingFormatRef.current?.underline ?? char?.underline ?? false,
            fontFamily: typingFormatRef.current?.fontFamily ?? char?.fontFamily ?? docStyle.style.fontFamily,
            fontSizePt,
            alignment: typingFormatRef.current?.alignment ?? char?.alignment ?? defaultAlignmentForField(selection.src, docStyle.style)
          };
          typingTargetRef.current = typingTargetFor(selection);
          setInlineFormatState((state) => ({ ...state, fontSizePt }));
        }
      },
      setAlignment: (alignment) => {
        const selection = readSelection() ?? lastRangeRef.current;
        if (selection) commitAlignment(selection, alignment);
      },
      applyLink: (text, href) => {
        const selection = readSelection() ?? lastRangeRef.current;
        if (!selection) return;
        const singleLine = selection.src.kind !== "bullet";
        const display = (singleLine ? text.replace(/\s*\n+\s*/g, " ") : text).replace(/\r/g, "");
        // Target the selection, else the link run under a collapsed caret, else
        // the caret itself (insertion point).
        // Editing an existing link acts on the whole link, even from a partial
        // selection or a caret inside it.
        let dStart = selection.dStart;
        let dEnd = selection.dEnd;
        const run = expandToLinkRun(selection.map, dStart, dEnd);
        if (run) {
          dStart = run.start;
          dEnd = run.end;
        }
        const currentText = selection.map.display.slice(dStart, dEnd);
        if (dStart !== dEnd && display === currentText) {
          // Text unchanged over an existing range: just (re)apply the link and
          // keep the run's own per-character formatting.
          commitLink(selection, dStart, dEnd, href);
        } else if (display) {
          commitReplaceWithLink(selection, dStart, dEnd, display, href);
        }
      },
      removeLink: () => {
        const selection = readSelection() ?? lastRangeRef.current;
        if (!selection) return;
        const target = resolveLinkTarget(selection);
        if (target) commitLink(selection, target.dStart, target.dEnd, null);
      },
      clearFormatting: () => {
        const selection = readSelection() ?? lastRangeRef.current;
        if (selection && selection.dEnd > selection.dStart) commitClearFormatting(selection);
      },
      // Add a section from the toolbar and jump the caret to its heading, so the
      // new section is scrolled into view rather than left off-screen.
      addSection: (type, position) => addSection(type, position)
    }),
    [addSection, commitAlignment, commitClearFormatting, commitFontFamily, commitFontSize, commitHistory, commitLink, commitReplaceWithLink, commitToggleMark, docStyle.style, readSelection, resolveLinkTarget]
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

  // Enter: grow the list the caret sits in. A non-empty bullet splits (at the end
  // this appends a fresh bullet); a non-empty skills row spawns a sibling row
  // below with the caret in it. Enter in an empty bullet/skills row is ignored so
  // it never piles up blank rows, and Enter elsewhere (titles, headings) is a
  // no-op — those are not lists.
  const commitEnter = useCallback(
    (sel: TypesetSelection) => {
      if (sel.src.kind === "bullet") {
        if (stripInlineMarks(valueForField(dataRef.current, sel.src)).trim()) commitSplitBullet(sel);
        return;
      }
      if (sel.src.kind === "skillsRow") {
        if (stripInlineMarks(valueForField(dataRef.current, sel.src)).trim()) {
          addEntryRelative(sel.src.sectionId, sel.src.entryId, "below");
        }
      }
    },
    [addEntryRelative, commitSplitBullet]
  );

  const commitMergeBullet = useCallback(
    (sel: TypesetSelection, direction: "up" | "down"): boolean => {
      if (sel.src.kind === "skillsRow") {
        // Backspace at the start (or Delete at the end) of an EMPTY skills row
        // removes the row, mirroring an empty bullet — but never the last row, so a
        // skills section always keeps one editable line. removeEntryAt drops the
        // caret into the previous row.
        const rowSrc = sel.src;
        if (stripInlineMarks(valueForField(dataRef.current, rowSrc)).trim()) return false;
        const skillsSection = dataRef.current.sections.find((item) => item.id === rowSrc.sectionId);
        if (!skillsSection || skillsSection.items.length <= 1) return false;
        removeEntryAt(rowSrc.sectionId, rowSrc.entryId);
        return true;
      }
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
    [actions, markPending, recordPreEditSelection, removeEntryAt]
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
        commitEnter(sel);
      } else if (intent.kind === "toggleMark") {
        commitToggleMark(sel, intent.mark);
      } else if (intent.kind === "clearFormatting") {
        if (sel.dStart !== sel.dEnd) commitClearFormatting(sel);
      } else {
        commitHistory(intent.direction);
      }
    }
  }, [
    commitClearFormatting,
    commitEnter,
    commitHistory,
    commitMergeBullet,
    commitReplace,
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
    onEnter: commitEnter,
    commitMergeBullet,
    commitToggleMark,
    commitClearFormatting,
    commitHistory,
    setNonce
  });
  const overlayAnchor = hovered ?? activeAnchor;
  const { contextMenu, menuItems, openContextMenu, closeContextMenu } = useTypesetContextMenu({
    data,
    hostRef,
    mapFor,
    readSelection,
    addSectionRelative,
    removeSectionAt,
    addEntryRelative,
    removeEntryAt,
    addBulletToEntry,
    addBulletRelative,
    removeBulletAt,
    commitReplace,
    commitToggleMark,
    commitClearFormatting,
    commitLink,
    commitHistory,
    canUndo,
    canRedo,
    onRequestLinkEditor
  });

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
        spellCheck={docStyle.style.spellCheck}
        hostRef={hostRef}
        onDoc={onDoc}
      />
      <TypesetStructureOverlay
        data={data}
        anchor={overlayAnchor}
        pageOrigins={pageOrigins}
        zoom={zoom}
        geometry={geo}
        drag={drag}
        canDrag={canDrag}
        onBeginDrag={beginDrag}
        onMoveByKeyboard={moveByKeyboard}
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
});
