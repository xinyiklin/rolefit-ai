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
  useState,
  type ReactNode
} from "react";

import type { ResumeData, ResumeSectionType } from "@typeset/engine/lib/resumeData.ts";
import { automaticLinkHref } from "@typeset/engine/lib/links.ts";
import type { FieldEdit, ResumeEditorActions } from "../../hooks/useResumeEditor";
import {
  STYLE_FIELD_MARK_DEFAULTS,
  styleFieldDefaultSizePt,
  styleFieldMarkStates,
  type EntryTextField,
  type StyleTextField
} from "@typeset/engine/lib/styleFieldFormatting.ts";
import { stripInlineMarks } from "@typeset/engine/lib/inlineMarksText.ts";
import type { DocStyleControls } from "../../hooks/useDocStyle";
import {
  nextZoomOption,
  type AlignmentScope,
  type BodyAlign,
  type DocStyle,
  type FontFamily
} from "@typeset/engine/lib/documentStyle.ts";
import { fontSizesFor, nameSizePt } from "@typeset/engine/lib/documentTypography.ts";
import { fieldKey, parseFieldKey, type FieldSrc } from "@typeset/engine/typeset/types.ts";
import { pageGeometry } from "@typeset/engine/typeset/blocks.ts";
import type { LayoutDocument } from "@typeset/engine/typeset/layout.ts";
import { TypesetDomPages } from "@typeset/engine/typeset/render/dom.tsx";
import { toTypesetSchema } from "@typeset/engine/typeset/schema.ts";
import { anchorsFromDoc, type BlockAnchor, type TypesetAnchors } from "./typesetStructure.ts";
import { TypesetStructureOverlay } from "./TypesetStructureOverlay.tsx";
import { TypesetContextMenu } from "./TypesetContextMenu.tsx";
import { TypesetLinkCard } from "./TypesetLinkCard.tsx";
import { useTypesetLinkCard } from "./useTypesetLinkCard.ts";
import { useTypesetStructure, type PendingCaret } from "./useTypesetStructure.ts";
import { useTypesetOverlayAnchors } from "./useTypesetOverlayAnchors.ts";
import { useTypesetContextMenu } from "./useTypesetContextMenu.tsx";
import {
  caretToDisplayIndex,
  displayIndexToCaret,
  keyOfNode,
  selectDisplayRange
} from "./domSelection.ts";
import {
  applyInlineFragment,
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
  suppressedAutoLinkValue,
  clearFormatting,
  hasClearableFormatting,
  toggleMark,
  typingFormatForDeletedRange,
  type DisplayMap,
  type TypingFormat,
  type TypesetSelection
} from "./inlineTextEditing.ts";
import { commitField, fieldEditFor, historyCaretTarget, valueForField, withFieldValue } from "./resumeFieldAdapter.ts";
import {
  formattableRanges,
  markStateAcross,
  orderedFieldKeys,
  readFieldRanges,
  uniformAcross,
  type FieldRange
} from "./multiFieldSelection.ts";
import { useTypesetInputEvents, type QueuedIntent } from "./useTypesetInputEvents.ts";
import {
  clearSelectionHighlights,
  paintSelectionHighlights
} from "./selectionHighlight.ts";
import {
  caretOverlayGeometry,
  type CaretAppearance,
  type CaretOverlayGeometry
} from "./caretOverlay.ts";

// Editor zoom: the zoom select's 100% means the 816px logical page (96dpi);
// engine units are bp (72dpi), hence the 4/3.
const SCREEN_SCALE = 96 / 72;

function editorToolbarOwnsFocus(): boolean {
  const active = document.activeElement;
  return Boolean(
    active instanceof Element &&
    active.closest(".top-toolbar, [data-typeset-toolbar-portal]")
  );
}

function sameCaretGeometry(
  left: CaretOverlayGeometry | null,
  right: CaretOverlayGeometry | null
): boolean {
  if (!left || !right) return left === right;
  return (
    Math.abs(left.left - right.left) < 0.01 &&
    Math.abs(left.top - right.top) < 0.01 &&
    Math.abs(left.height - right.height) < 0.01 &&
    Math.abs(left.baselineOffset - right.baselineOffset) < 0.01 &&
    // Slope must be compared too: an upright and an italic face of one family
    // usually share vertical metrics, so arming italic moves nothing in the
    // box and the caret would keep the previous geometry — and its slope.
    left.slantDeg === right.slantDeg
  );
}

// Where a URL word's auto-link is being visually deferred while it is typed.
// A range, never the field's text: see suppressedAutoLinkValue.
type AutoLinkSuppression = { key: string; dStart: number; dEnd: number };

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
  // A cross-field selection links in place, so its text is not rewritable here.
  linkTextEditable: boolean;
  canLink: boolean;
  canClearFormatting: boolean;
};

// A caret in the document model, not in the DOM: a field key plus an index into
// that field's stored value. Survives a repaint, an unmount, and a host that
// keeps the document while swapping the editor out.
export type TypesetCaret = { key: string; valueIndex: number };

export type TypesetEditorHandle = {
  undo: () => void;
  redo: () => void;
  focusSelection: () => void;
  // Put the caret at the very start of the document and take focus, at the next
  // paint. For the moment a document is OPENED (blank, starter, file, workspace
  // copy) — the point at which a word processor puts you in the document. It
  // yields to a text field outside the editor that already has focus, so an
  // async load can never interrupt someone typing elsewhere.
  focusDocumentStart: () => void;
  toggleMark: (mark: "bold" | "italic" | "underline") => void;
  setFontFamily: (fontFamily: FontFamily) => void;
  setFontSize: (fontSizePt: number) => void;
  setAlignment: (alignment: BodyAlign) => void;
  applyLink: (text: string, href: string) => void;
  removeLink: () => void;
  clearFormatting: () => void;
  addSection: (type: ResumeSectionType, position: "top" | "bottom") => void;
};

// The command surface shared by the toolbar (through the imperative handle) and
// the right-click menu. Both drive the SAME functions, so no command can behave
// one way from a toolbar button and another from a menu item — the class of bug
// that left the menu editing one field at a time after the toolbar had learned
// to span them. The clipboard members are not on the public handle because no
// host needs them; the menu is the only caller.
export type TypesetEditorCommands = TypesetEditorHandle & {
  // Model-derived text of the current selection: one covered slice per field,
  // joined by newlines. The DOM's own `toString` loses paragraph breaks and can
  // leak the empty-paragraph caret placeholder.
  selectionText: () => string;
  deleteSelection: () => void;
  insertText: (text: string) => void;
};

// The geometry/anchor context a host overlay positions itself from — the same
// values the built-in structure overlay uses. `anchor` is the hovered block,
// falling back to the block containing the caret.
export type TypesetEditorOverlayContext = {
  data: ResumeData;
  anchors: TypesetAnchors | null;
  anchor: BlockAnchor | null;
  pageOrigins: { left: number; top: number }[];
  zoom: number;
  geometry: ReturnType<typeof pageGeometry>;
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
  // Host-specific chrome rendered inside the editor wrapper, absolutely
  // positioned from the overlay context (e.g. role-fit-ai's tailor chips).
  overlay?: (context: TypesetEditorOverlayContext) => ReactNode;
  // Transient field highlight (threaded to the engine painter) plus a
  // scroll-into-view after each repaint. Not document state.
  highlightFieldKey?: string | null;
  documentKind?: "resume" | "cover-letter";
  structureEditing?: boolean;
  onPageCount?: (count: number) => void;
  // Where the caret was when this editor last unmounted, so a host that swaps
  // the editor out (RoleFit's studio tabs) can return the user to the line they
  // were editing instead of the top of the document. Applied once, after the
  // first paint. Focus follows it: a stored caret means the user had been
  // editing here.
  initialCaret?: TypesetCaret | null;
  // Reports the caret at unmount so the host can hold it for the next mount.
  // Null when the user never placed one — nothing to come back to.
  onCaretExit?: (caret: TypesetCaret | null) => void;
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
  linkTextEditable: true,
  canLink: false,
  canClearFormatting: false
};

// The toolbar re-renders from this state on every selection change, so publish a
// new object only when something a control shows actually changed.
function sameFormatState(a: InlineFormatState, b: InlineFormatState): boolean {
  return (
    a.canFormat === b.canFormat &&
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.fontFamily === b.fontFamily &&
    a.fontSizePt === b.fontSizePt &&
    a.alignment === b.alignment &&
    a.alignmentScope === b.alignmentScope &&
    a.entryField === b.entryField &&
    a.linkHref === b.linkHref &&
    a.linkText === b.linkText &&
    a.linkAutomatic === b.linkAutomatic &&
    a.linkTextEditable === b.linkTextEditable &&
    a.canLink === b.canLink &&
    a.canClearFormatting === b.canClearFormatting
  );
}

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
  onRequestLinkEditor,
  overlay,
  highlightFieldKey = null,
  documentKind = "resume",
  structureEditing = true,
  onPageCount,
  initialCaret = null,
  onCaretExit
}, ref) {
  // Defer visual auto-linking: while a URL word is being typed (its trailing edge
  // is the caret), suppress ITS auto-link in the render only. The stored data is
  // intact, so the display map used for caret math still sees the real value.
  //
  // State is the field key plus the DISPLAY RANGE to suppress — never a copy of
  // the field's text. A cached value is stale for the repaint that follows the
  // next keystroke, and the caret restore then clamps to the end of that shorter
  // text; see suppressedAutoLinkValue for the full failure it caused.
  const [autoLinkSuppress, setAutoLinkSuppress] = useState<AutoLinkSuppression | null>(null);
  const autoLinkSuppressRef = useRef<AutoLinkSuppression | null>(null);
  const renderData = useMemo(() => {
    if (!autoLinkSuppress) return data;
    const src = parseFieldKey(autoLinkSuppress.key);
    if (!src) return data;
    // Derived from the CURRENT value on every render, so the paint can never lag
    // the data. buildDisplayMap is called directly rather than through mapFor,
    // which is declared below this memo.
    const value = valueForField(data, src);
    const suppressed = suppressedAutoLinkValue(
      buildDisplayMap(value, {
        uppercase: src.kind === "heading" && docStyle.style.headingCase === "uppercase",
        preserveWhitespace: true
      }),
      autoLinkSuppress
    );
    return suppressed === null ? data : withFieldValue(data, src, suppressed);
  }, [autoLinkSuppress, data, docStyle.style.headingCase]);
  const schema = useMemo(() => toTypesetSchema(renderData), [renderData]);
  const zoom = docStyle.style.zoom * SCREEN_SCALE;
  const geo = useMemo(() => pageGeometry(docStyle.style), [docStyle.style]);
  const hostRef = useRef<HTMLDivElement | null>(null);
  // The positioned wrapper every overlay is placed inside. Declared up here
  // because the link card hook needs it; the structure overlay below shares it.
  const wrapRef = useRef<HTMLDivElement | null>(null);
  // The link card's target, resolved from the SELECTION (never from hover) by the
  // selection-change effect below. Destructured because each member is a stable
  // callback while the returned object is not: depending on the object would make
  // the reposition effect re-run on every render.
  const {
    target: linkCardTarget,
    sync: syncLinkCard,
    hide: hideLinkCard,
    dismiss: dismissLinkCard,
    reposition: repositionLinkCardTo
  } = useTypesetLinkCard({ hostRef, wrapRef });
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

  // Caret placement across a document open or an editor remount. Both are
  // consumed by the post-paint restore effect below, because a caret can only
  // be placed once the field it names has been painted.
  //
  // Mounting with no stored caret IS an open from the user's side: they have
  // just arrived at a page whose entire purpose is the document. The cover
  // letter reaches its first mount that way — its blank letter is initial state
  // rather than a load — so nothing else would ever ask for a caret there.
  const pendingDocumentStartRef = useRef(initialCaret === null);
  const pendingInitialCaretRef = useRef<TypesetCaret | null>(initialCaret);
  // The last caret the user actually had here, reported to the host at unmount.
  const lastCaretRef = useRef<TypesetCaret | null>(null);
  const onCaretExitRef = useRef(onCaretExit);
  onCaretExitRef.current = onCaretExit;

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

  const resolveFieldRange = useCallback(
    (src: FieldSrc) => {
      const value = valueForField(dataRef.current, src);
      return { value, map: mapFor(src, value) };
    },
    [mapFor]
  );

  const readRanges = useCallback(
    (maxFields?: number): FieldRange[] | null => {
      const host = hostRef.current;
      return host ? readFieldRanges(host, resolveFieldRange, maxFields) : null;
    },
    [resolveFieldRange]
  );

  // Current selection in display coordinates; null when it isn't a clean
  // single-field selection (caret may roam anywhere, edits may not).
  //
  // Endpoint resolution alone is engine-dependent: Gecko puts a select-all
  // range's boundaries on the editing HOST with child offsets, so neither
  // endpoint names a field even when the selection covers exactly one. Falling
  // back to the covered-field resolution keeps a one-field selection a
  // single-field selection in every browser — otherwise commands that need one
  // run of text (links) would be unavailable in one engine and not the other.
  const readSelection = useCallback((): TypesetSelection | null => {
    const host = hostRef.current;
    const sel = window.getSelection();
    if (!host || !sel || sel.rangeCount === 0) return null;
    const anchor = keyOfNode(sel.anchorNode);
    const focus = keyOfNode(sel.focusNode);
    if (!anchor || !focus || anchor.key !== focus.key || !host.contains(anchor.el)) {
      const ranges = readRanges(1);
      if (!ranges || ranges.length !== 1) return null;
      const [only] = ranges;
      return {
        src: only.src,
        key: only.key,
        map: only.map,
        value: only.value,
        dStart: only.dStart,
        dEnd: only.dEnd
      };
    }
    const src = parseFieldKey(anchor.key);
    if (!src) return null;
    const value = valueForField(dataRef.current, src);
    const map = mapFor(src, value);
    const a = caretToDisplayIndex(host, anchor.key, map.display, sel.anchorNode!, sel.anchorOffset);
    const f = caretToDisplayIndex(host, anchor.key, map.display, sel.focusNode!, sel.focusOffset);
    if (a === null || f === null) return null;
    return { src, key: anchor.key, map, value, dStart: Math.min(a, f), dEnd: Math.max(a, f) };
  }, [mapFor, readRanges]);

  // The toolbar sits outside the contenteditable page. Preserve the last valid
  // single-field range so a toolbar click can apply formatting without asking
  // the browser to rediscover a selection after focus moves to application
  // overlay. Toolbar formatting buttons prevent mousedown focus transfer, which
  // keeps the selected text visible while the command commits.
  const lastRangeRef = useRef<TypesetSelection | null>(null);
  const lastRangesRef = useRef<FieldRange[] | null>(null);
  const typingFormatRef = useRef<TypingFormat | null>(null);
  const typingTargetRef = useRef<string | null>(null);
  // Focusing the page fires `focusin` BEFORE the saved range is re-applied, and
  // the browser reports its own default caret (the document's first field) in
  // that gap. Read as a real caret move, it would look like the caret left the
  // field and discard the pending next-typing format a toolbar commit just set.
  // Restores always re-apply the range in the same task, so the sync that
  // follows sees the true caret.
  const restoringSelectionRef = useRef(false);
  const [inlineFormatState, setInlineFormatState] = useState<InlineFormatState>(EMPTY_FORMAT_STATE);
  const [caretOverlay, setCaretOverlay] = useState<CaretOverlayGeometry | null>(null);

  // A host calls this the moment it OPENS a document, which is one tick before
  // the new data has been painted — placing the caret now would place it in the
  // outgoing document. So it only records the request and forces a paint; the
  // restore effect consumes it against the document that actually lands.
  const focusDocumentStart = useCallback(() => {
    pendingDocumentStartRef.current = true;
    pendingInitialCaretRef.current = null;
    setNonce((current) => current + 1);
  }, []);

  // Hand the caret back to the host as this editor goes away, so the next mount
  // can resume where the user stopped. Empty deps: unmount only.
  useEffect(() => () => onCaretExitRef.current?.(lastCaretRef.current), []);

  const focusSelection = useCallback(() => {
    const host = hostRef.current;
    const selection = readSelection() ?? lastRangeRef.current;
    if (!host || !selection) return;
    const value = valueForField(dataRef.current, selection.src);
    const map = mapFor(selection.src, value);
    const start = displayIndexToCaret(host, selection.key, map.display, selection.dStart);
    const end = displayIndexToCaret(host, selection.key, map.display, selection.dEnd);
    if (!start || !end) return;
    restoringSelectionRef.current = true;
    try {
      host.focus({ preventScroll: true });
      const browserSelection = window.getSelection();
      if (!browserSelection) return;
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      browserSelection.removeAllRanges();
      browserSelection.addRange(range);
    } finally {
      restoringSelectionRef.current = false;
    }
  }, [mapFor, readSelection]);

  const syncCaretOverlay = useCallback(
    (selection: TypesetSelection | null, appearance: CaretAppearance) => {
      const host = hostRef.current;
      const wrapper = wrapRef.current;
      const ownsFocus = Boolean(
        host?.contains(document.activeElement) || editorToolbarOwnsFocus()
      );
      const next =
        host && wrapper && selection && selection.dStart === selection.dEnd && ownsFocus
          ? caretOverlayGeometry(host, wrapper, selection, appearance, zoom)
          : null;
      setCaretOverlay((current) => sameCaretGeometry(current, next) ? current : next);
    },
    [zoom]
  );

  useEffect(() => {
    const host = hostRef.current;
    const sync = () => {
      // Mid-restore the browser's caret is its own invention, not the user's.
      // Ignore it entirely: focusSelection re-applies the saved range in the
      // same task, and the selection change that follows syncs the real caret.
      if (restoringSelectionRef.current) return;
      // Toolbar inputs temporarily own focus while still targeting the last
      // editor range. Preserve the painted range in that case; otherwise keep
      // the line-wide highlight synchronized with the browser selection.
      if (host && !editorToolbarOwnsFocus()) {
        paintSelectionHighlights(host);
      }
      const selection = readSelection();
      // Deferred auto-linking: suppress the render link of the URL word whose
      // trailing edge is the caret (it is being typed); it links once a space
      // follows or the caret leaves it. Computed before the toolbar-focus early
      // return so leaving the field to the toolbar also completes the word.
      const suppressWord =
        selection && selection.dStart === selection.dEnd
          ? trailingLinkWordAt(selection.map, selection.dStart)
          : null;
      const nextSuppress: AutoLinkSuppression | null =
        selection && suppressWord
          ? { key: selection.key, dStart: suppressWord.start, dEnd: suppressWord.end }
          : null;
      const prevSuppress = autoLinkSuppressRef.current;
      if (
        (prevSuppress?.key ?? null) !== (nextSuppress?.key ?? null) ||
        (prevSuppress?.dStart ?? -1) !== (nextSuppress?.dStart ?? -1) ||
        (prevSuppress?.dEnd ?? -1) !== (nextSuppress?.dEnd ?? -1)
      ) {
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
      // The link card follows the selection. The field whose URL is still being
      // typed is excluded: the stored value has no <nolink> yet, so the half-typed
      // word would otherwise resolve as a link and pop the card up mid-word.
      syncLinkCard(selection, nextSuppress?.key ?? null);
      const hasRange = Boolean(selection && selection.dEnd > selection.dStart);
      if (selection) {
        lastRangeRef.current = selection;
        lastRangesRef.current = null;
        // Kept in VALUE indexes, not display indexes: this outlives the painted
        // DOM it was read from, and a remount re-paints from the value.
        lastCaretRef.current = {
          key: selection.key,
          valueIndex: selection.map.valueStart[selection.dStart] ?? selection.value.length
        };
      }
      // Editable toolbar controls (notably the custom font-size input) must
      // temporarily take focus without discarding the page range they target.
      // Outside the toolbar, a lost editor selection really does clear it.
      else if (!selection && editorToolbarOwnsFocus()) return;
      else if (!selection) {
        // No single mapped field, but the selection may legitimately cover
        // several — Select All, or a drag across paragraphs. Report the state of
        // the whole covered range so the toolbar stays live instead of greying
        // out on the largest selection a user can make.
        const ranges = readRanges();
        lastRangesRef.current = ranges;
        lastRangeRef.current = null;
        setCaretOverlay(null);
        if (ranges) {
          typingFormatRef.current = null;
          typingTargetRef.current = null;
          const covered = formattableRanges(ranges);
          const scopes = new Set(ranges.map((range) => alignmentScopeForField(range.src)));
          const crossFieldState: InlineFormatState = {
            canFormat: true,
            bold: markStateAcross(covered, "bold"),
            italic: markStateAcross(covered, "italic"),
            underline: markStateAcross(covered, "underline"),
            fontFamily: uniformAcross(covered, (char) => char.fontFamily, () => docStyle.style.fontFamily),
            fontSizePt: uniformAcross(
              covered,
              (char) => char.fontSizePt,
              (range) => defaultFontSizeForField(range.src, docStyle.style)
            ),
            alignment: uniformAcross(
              covered,
              (char) => char.alignment,
              (range) => defaultAlignmentForField(range.src, docStyle.style)
            ),
            alignmentScope: scopes.size === 1 ? [...scopes][0] : null,
            entryField: null,
            // A selection spanning paragraphs links every covered range in place
            // (Word does the same). It has no single existing destination to
            // report, and one string cannot rewrite multi-paragraph text.
            linkHref: uniformAcross(covered, (char) => char.linkHref, () => null),
            // Informational only, and a single-line input strips newlines, so the
            // covered text reads as one run rather than words jammed together.
            linkText: covered
              .map((range) => range.map.display.slice(range.dStart, range.dEnd))
              .join(" "),
            linkAutomatic: false,
            linkTextEditable: false,
            canLink: covered.length > 0,
            canClearFormatting: covered.some((range) =>
              hasClearableFormatting(range.map, range.dStart, range.dEnd)
            )
          };
          setInlineFormatState((current) =>
            sameFormatState(current, crossFieldState) ? current : crossFieldState
          );
          return;
        }
      }

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
          typingFormat?.fontSizePt ?? (effectiveSizes.length === 0
            ? fallbackSize
            : effectiveSizes.every((size) => size === effectiveSizes[0])
              ? Math.round((effectiveSizes[0] ?? 0) * 10) / 10
              : null),
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
        linkTextEditable: true,
        // Enabled wherever a clean single-field caret exists — a range or link
        // edits in place, a bare caret inserts new linked text (Google-Docs-style).
        canLink: Boolean(selection),
        canClearFormatting: Boolean(selection && hasRange && hasClearableFormatting(selection.map, selection.dStart, selection.dEnd))
      };
      setInlineFormatState((current) => (sameFormatState(current, next) ? current : next));
      syncCaretOverlay(selection, {
        fontFamily: next.fontFamily ?? docStyle.style.fontFamily,
        fontSizePt: next.fontSizePt ?? fallbackSize,
        bold: next.bold,
        italic: next.italic
      });
    };

    document.addEventListener("selectionchange", sync);
    document.addEventListener("focusin", sync);
    sync();
    return () => {
      document.removeEventListener("selectionchange", sync);
      document.removeEventListener("focusin", sync);
      if (host) clearSelectionHighlights(host);
    };
  }, [docStyle.style, docVersion, nonce, readRanges, readSelection, syncCaretOverlay]);

  useLayoutEffect(() => {
    const selection =
      readSelection() ??
      (editorToolbarOwnsFocus() ? lastRangeRef.current : null);
    syncCaretOverlay(selection, {
      fontFamily: inlineFormatState.fontFamily ?? docStyle.style.fontFamily,
      fontSizePt: inlineFormatState.fontSizePt ?? docStyle.style.baseFontSizePt,
      bold: inlineFormatState.bold,
      italic: inlineFormatState.italic
    });
  }, [
    docStyle.style.baseFontSizePt,
    docStyle.style.fontFamily,
    docVersion,
    inlineFormatState.bold,
    inlineFormatState.fontFamily,
    inlineFormatState.fontSizePt,
    inlineFormatState.italic,
    nonce,
    readSelection,
    syncCaretOverlay
  ]);

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

  const scheduleCaretAfterFieldCommit = useCallback(
    (sel: TypesetSelection, value: string, caretValueIndex: number) => {
      const key = sel.key;
      if (sel.src.kind !== "skillsRow") {
        pendingCaretRef.current = () => ({ key, valueIndex: caretValueIndex });
        return;
      }
      // A skills row is persisted as label + skills but edited as one string.
      // Map its canonical reconstruction through display space so colon/spacing
      // normalization cannot make the caret jump after typing or rich paste.
      const src = sel.src;
      const typedMap = mapFor(src, value);
      const caretDisplay = displayIndexForValueIndex(typedMap, caretValueIndex);
      pendingCaretRef.current = (fresh) => {
        const freshValue = valueForField(fresh, src);
        const freshMap = mapFor(src, freshValue);
        const target = Math.max(
          0,
          Math.min(
            caretDisplay + (freshMap.display.length - typedMap.display.length),
            freshMap.display.length
          )
        );
        const valueIndex =
          target < freshMap.display.length
            ? freshMap.valueStart[target] ?? freshValue.length
            : freshValue.length;
        return { key, valueIndex };
      };
    },
    [mapFor]
  );

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
      if (sel.src.kind === "skillsRow") {
        // Typing the colon crosses from the label into the skills: drop the seeded
        // label emphasis (see emphasisSeedForField) so the skills come out plain
        // even when the label is bold. Skills then inherit from the plain injected
        // ": " separator.
        if (text.includes(":")) {
          typingFormatRef.current = null;
          typingTargetRef.current = null;
        }
      }
      scheduleCaretAfterFieldCommit(sel, value, caretValueIndex);
    },
    [actions, markPending, recordPreEditSelection, scheduleCaretAfterFieldCommit]
  );

  const commitPaste = useCallback(
    (
      sel: TypesetSelection,
      dStart: number,
      dEnd: number,
      fragment: string
    ) => {
      const { value, caretValueIndex } = applyInlineFragment(
        sel.map,
        dStart,
        dEnd,
        fragment,
        sel.src.kind !== "bullet"
      );
      recordPreEditSelection(sel);
      markPending();
      commitField(actions, sel.src, value);
      if (sel.src.kind === "skillsRow" && fragment.includes(":")) {
        typingFormatRef.current = null;
        typingTargetRef.current = null;
      }
      scheduleCaretAfterFieldCommit(sel, value, caretValueIndex);
    },
    [actions, markPending, recordPreEditSelection, scheduleCaretAfterFieldCommit]
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

  // ---- selections that cross fields ----
  //
  // Select All, or a drag from one paragraph into the next, covers several
  // fields. Each still commits its own value, but the whole edit must land as
  // ONE undo step and the selection must survive the repaint, so these go
  // through the batched field-edit action instead of per-field commits.

  const restoreRangesAfterRepaint = useCallback(
    (ranges: FieldRange[]) => {
      const first = ranges[0];
      const last = ranges[ranges.length - 1];
      pendingCaretRef.current = (fresh) => {
        const startMap = mapFor(first.src, valueForField(fresh, first.src));
        const endValue = valueForField(fresh, last.src);
        const endMap = mapFor(last.src, endValue);
        return {
          key: first.key,
          valueIndex: startMap.valueStart[first.dStart] ?? 0,
          endKey: last.key,
          valueEndIndex: endMap.valueStart[last.dEnd] ?? endValue.length
        };
      };
    },
    [mapFor]
  );

  // Small-caps headings render through a caps face with no bold/italic sibling,
  // so a mark written there could never be painted.
  const marksAllowedIn = useCallback(
    (src: FieldSrc) => !(src.kind === "heading" && docStyle.style.headingCase === "smallcaps"),
    [docStyle.style.headingCase]
  );

  const commitRangesFormatting = useCallback(
    (ranges: FieldRange[], transform: (range: FieldRange) => string): boolean => {
      const edits: FieldEdit[] = [];
      for (const range of formattableRanges(ranges)) {
        const value = transform(range);
        if (value !== range.value) edits.push(fieldEditFor(range.src, value));
      }
      if (!edits.length) return false;
      markPending();
      actions.applyFieldEdits(edits);
      restoreRangesAfterRepaint(ranges);
      return true;
    },
    [actions, markPending, restoreRangesAfterRepaint]
  );

  // Delete (or replace) everything a cross-field selection covers.
  //
  // Prose paragraphs and bullet rows are list content: rows the selection
  // emptied are removed, and when it began and ended in the same list the two
  // remainders join into the first row — the word-processor result. A name,
  // contact, heading, entry head, or skills slot is structure: it loses the
  // covered text but the slot stays, because those are removed through the
  // structure controls, not by typing. A summary section always keeps one
  // paragraph so the document remains editable.
  const commitRangesDelete = useCallback(
    (ranges: FieldRange[], insert = "", fragment?: string): boolean => {
      const listOf = (src: FieldSrc): string | null => {
        if (src.kind !== "bullet") return null;
        const section = dataRef.current.sections.find((item) => item.id === src.sectionId);
        return section?.type === "summary" ? `summary:${src.sectionId}` : `bullets:${src.sectionId}:${src.entryId}`;
      };
      const remainderOf = (range: FieldRange, text: string) =>
        applyEdit(range.map, range.dStart, range.dEnd, text);

      const first = ranges[0];
      const last = ranges[ranges.length - 1];
      // A pasted fragment carries its own formatting, so it replaces the covered
      // text in the same edit rather than after a second commit — one undo step,
      // as a word processor gives for paste-over-selection.
      const head =
        fragment === undefined
          ? remainderOf(first, insert)
          : applyInlineFragment(
              first.map,
              first.dStart,
              first.dEnd,
              fragment,
              first.src.kind !== "bullet"
            );
      const firstList = listOf(first.src);
      const joinsTail =
        ranges.length > 1 && firstList !== null && firstList === listOf(last.src);

      // Each list keeps its FIRST covered row, so a fully selected list ends as
      // one empty row instead of vanishing.
      const survivorOfList = new Map<string, string>();
      for (const range of ranges) {
        const list = listOf(range.src);
        if (list && !survivorOfList.has(list)) survivorOfList.set(list, range.key);
      }

      const edits: FieldEdit[] = [
        fieldEditFor(first.src, joinsTail ? head.value + remainderOf(last, "").value : head.value)
      ];
      for (const range of ranges.slice(1)) {
        const src = range.src;
        const list = listOf(src);
        const folded = range === last && joinsTail;
        const remainder = folded ? "" : remainderOf(range, "").value;
        if (
          src.kind === "bullet" &&
          list !== null &&
          (folded || remainder === "") &&
          survivorOfList.get(list) !== range.key
        ) {
          edits.push(
            list.startsWith("summary:")
              ? { kind: "removeEntry", sectionId: src.sectionId, entryId: src.entryId }
              : {
                  kind: "removeBullet",
                  sectionId: src.sectionId,
                  entryId: src.entryId,
                  bulletId: src.bulletId
                }
          );
        } else {
          edits.push(fieldEditFor(src, remainder));
        }
      }

      markPending();
      actions.applyFieldEdits(edits);
      typingFormatRef.current = null;
      typingTargetRef.current = null;
      const caretKey = first.key;
      const caretSrc = first.src;
      const caretValueIndex = head.caretValueIndex;
      pendingCaretRef.current = (fresh) => ({
        key: caretKey,
        valueIndex: Math.min(caretValueIndex, valueForField(fresh, caretSrc).length)
      });
      return true;
    },
    [actions, markPending]
  );

  const applyMarkAcross = useCallback(
    (ranges: FieldRange[], mark: "bold" | "italic" | "underline"): boolean => {
      const markable = formattableRanges(ranges).filter((range) => marksAllowedIn(range.src));
      if (!markable.length) return false;
      const on = !markStateAcross(markable, mark);
      return commitRangesFormatting(ranges, (range) =>
        marksAllowedIn(range.src)
          ? toggleMark(range.map, range.dStart, range.dEnd, mark, on).value
          : range.value
      );
    },
    [commitRangesFormatting, marksAllowedIn]
  );

  // The same intents the input hook builds, applied to a cross-field selection.
  // Returns false when there is no such selection, so every caller can fall
  // through to its single-field path unchanged.
  const commitCrossFieldIntent = useCallback(
    (intent: QueuedIntent): boolean => {
      const ranges = readRanges();
      if (!ranges) return false;
      switch (intent.kind) {
        case "insert":
          return commitRangesDelete(ranges, intent.text);
        case "deleteBack":
        case "deleteFwd":
        case "deleteSelection":
          return commitRangesDelete(ranges);
        case "paste":
          return commitRangesDelete(ranges, "", intent.fragment);
        case "splitBullet":
          // Drop the selection first, then let the queue replay the split into the
          // collapsed caret that leaves behind.
          if (!commitRangesDelete(ranges)) return false;
          replayQueueRef.current.push(intent);
          return true;
        case "toggleMark":
          return applyMarkAcross(ranges, intent.mark);
        case "clearFormatting":
          return commitRangesFormatting(
            ranges,
            (range) => clearFormatting(range.map, range.dStart, range.dEnd).value
          );
        case "history":
          return false;
      }
    },
    [applyMarkAcross, commitRangesDelete, commitRangesFormatting, readRanges]
  );

  const crossFieldPlainText = useCallback((): string | null => {
    const ranges = readRanges();
    if (!ranges) return null;
    return ranges
      .map((range) => range.map.display.slice(range.dStart, range.dEnd))
      .join("\n");
  }, [readRanges]);

  // Clipboard primitives for the right-click menu. Each tries the cross-field
  // path first and falls back to the single-field one, exactly as the keyboard
  // equivalents in useTypesetInputEvents do — the menu must not be a second,
  // weaker implementation of Cut/Copy/Paste.
  const selectionText = useCallback((): string => {
    const cross = crossFieldPlainText();
    if (cross !== null) return cross;
    const selection = readSelection();
    return selection ? selection.map.display.slice(selection.dStart, selection.dEnd) : "";
  }, [crossFieldPlainText, readSelection]);

  const deleteSelection = useCallback(() => {
    if (commitCrossFieldIntent({ kind: "deleteSelection" })) return;
    const selection = readSelection();
    if (selection && selection.dEnd > selection.dStart) {
      commitReplace(selection, selection.dStart, selection.dEnd, "");
    }
  }, [commitCrossFieldIntent, commitReplace, readSelection]);

  const insertText = useCallback(
    (text: string) => {
      if (commitCrossFieldIntent({ kind: "insert", text })) return;
      const selection = readSelection();
      if (selection) commitReplace(selection, selection.dStart, selection.dEnd, text);
    },
    [commitCrossFieldIntent, commitReplace, readSelection]
  );

  const commitToggleMark = useCallback(
    (sel: TypesetSelection, mark: "bold" | "italic" | "underline") => {
      if (sel.dStart === sel.dEnd || !marksAllowedIn(sel.src)) return;
      const { value } = toggleMark(sel.map, sel.dStart, sel.dEnd, mark);
      recordPreEditSelection(sel);
      markPending();
      commitField(actions, sel.src, value);
      restoreRangeAfterRepaint(sel, sel.dStart, sel.dEnd);
    },
    [actions, markPending, marksAllowedIn, recordPreEditSelection, restoreRangeAfterRepaint]
  );

  // Bold/italic/underline with a COLLAPSED caret arms the next-typing format
  // instead of doing nothing, the way every word processor treats ⌘B before you
  // start typing. Ranged selections still rewrite the marks in place. Every
  // entry point — toolbar button, keyboard shortcut, and the browser's own
  // formatBold/Italic/Underline beforeinput — routes through here so they cannot
  // drift apart.
  const applyMark = useCallback(
    (sel: TypesetSelection, mark: "bold" | "italic" | "underline") => {
      if (!marksAllowedIn(sel.src)) return;
      if (sel.dEnd > sel.dStart) {
        commitToggleMark(sel, mark);
        return;
      }
      const char = sel.map.chars[Math.max(0, Math.min(sel.dStart - 1, sel.map.chars.length - 1))];
      const base: TypingFormat = typingFormatRef.current ?? {
        bold: char?.bold ?? false,
        italic: char?.italic ?? false,
        underline: char?.underline ?? false,
        fontFamily: char?.fontFamily ?? docStyle.style.fontFamily,
        fontSizePt: char?.fontSizePt ?? defaultFontSizeForField(sel.src, docStyle.style),
        alignment: char?.alignment ?? defaultAlignmentForField(sel.src, docStyle.style)
      };
      typingFormatRef.current = { ...base, [mark]: !base[mark] };
      typingTargetRef.current = typingTargetFor(sel);
      setInlineFormatState((state) => ({ ...state, [mark]: !base[mark] }));
    },
    [commitToggleMark, docStyle.style, marksAllowedIn]
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

  // What a toolbar command should act on. A control that takes focus (the custom
  // font-size input) loses the DOM selection, so fall back to the range the page
  // last held — cross-field before single-field, or a stale single field would
  // silently swallow an edit meant for the whole selection.
  const commandTarget = useCallback(():
    | { kind: "single"; selection: TypesetSelection }
    | { kind: "cross"; ranges: FieldRange[] }
    | null => {
    const selection = readSelection();
    if (selection) return { kind: "single", selection };
    const ranges = readRanges() ?? lastRangesRef.current;
    if (ranges) return { kind: "cross", ranges };
    return lastRangeRef.current ? { kind: "single", selection: lastRangeRef.current } : null;
  }, [readRanges, readSelection]);

  const commands = useMemo<TypesetEditorCommands>(
    () => ({
      selectionText,
      deleteSelection,
      insertText,
      undo: () => commitHistory("undo"),
      redo: () => commitHistory("redo"),
      focusSelection,
      focusDocumentStart,
      toggleMark: (mark) => {
        const target = commandTarget();
        if (!target) return;
        if (target.kind === "cross") applyMarkAcross(target.ranges, mark);
        else applyMark(target.selection, mark);
      },
      setFontFamily: (fontFamily) => {
        const target = commandTarget();
        if (!target) return;
        if (target.kind === "cross") {
          commitRangesFormatting(
            target.ranges,
            (range) => setFontFamily(range.map, range.dStart, range.dEnd, fontFamily).value
          );
          return;
        }
        const selection = target.selection;
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
        const target = commandTarget();
        if (!target) return;
        if (target.kind === "cross") {
          commitRangesFormatting(
            target.ranges,
            (range) => setFontSize(range.map, range.dStart, range.dEnd, fontSizePt).value
          );
          return;
        }
        const selection = target.selection;
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
        const target = commandTarget();
        if (!target) return;
        // Alignment is a paragraph property, so it applies to every covered
        // field rather than to the selected characters.
        if (target.kind === "cross") {
          commitRangesFormatting(target.ranges, (range) => setAlignment(range.map, alignment).value);
        } else commitAlignment(target.selection, alignment);
      },
      applyLink: (text, href) => {
        const target = commandTarget();
        if (!target) return;
        // Spanning several fields: link each covered range where it stands. The
        // requested display text is ignored — it could only describe one field.
        if (target.kind === "cross") {
          commitRangesFormatting(
            target.ranges,
            (range) => setLink(range.map, range.dStart, range.dEnd, href).value
          );
          return;
        }
        const selection = target.selection;
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
        const command = commandTarget();
        if (!command) return;
        if (command.kind === "cross") {
          commitRangesFormatting(
            command.ranges,
            (range) => removeLink(range.map, range.dStart, range.dEnd).value
          );
          return;
        }
        const target = resolveLinkTarget(command.selection);
        if (target) commitLink(command.selection, target.dStart, target.dEnd, null);
      },
      clearFormatting: () => {
        const target = commandTarget();
        if (!target) return;
        if (target.kind === "cross") {
          commitRangesFormatting(
            target.ranges,
            (range) => clearFormatting(range.map, range.dStart, range.dEnd).value
          );
        } else if (target.selection.dEnd > target.selection.dStart) {
          commitClearFormatting(target.selection);
        }
      },
      // Add a section from the toolbar and jump the caret to its heading, so the
      // new section is scrolled into view rather than left off-screen.
      addSection: (type, position) => addSection(type, position)
    }),
    [
      addSection,
      applyMark,
      applyMarkAcross,
      commandTarget,
      commitAlignment,
      commitClearFormatting,
      commitFontFamily,
      commitFontSize,
      commitHistory,
      commitLink,
      commitRangesFormatting,
      commitReplaceWithLink,
      deleteSelection,
      docStyle.style,
      focusDocumentStart,
      focusSelection,
      insertText,
      resolveLinkTarget,
      selectionText
    ]
  );

  useImperativeHandle(ref, () => commands, [commands]);

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
  //
  // PROSE paragraphs (summary sections, which is how a cover letter is modelled)
  // are not a list, so they follow the word processor instead: Enter always
  // starts a new paragraph, including from an empty one. Swallowing it there left
  // the author unable to open a blank line between blocks.
  const commitEnter = useCallback(
    (sel: TypesetSelection) => {
      if (sel.src.kind === "bullet") {
        const src = sel.src;
        const isProse =
          dataRef.current.sections.find((section) => section.id === src.sectionId)?.type ===
          "summary";
        if (isProse || stripInlineMarks(valueForField(dataRef.current, src)).trim()) {
          commitSplitBullet(sel);
        }
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

  // Place a model caret in the painted document. Returns false when the field it
  // names is no longer painted — a stored caret whose document has since been
  // replaced resolves to nothing rather than to an arbitrary position.
  const placeCaret = useCallback(
    (host: HTMLElement, target: TypesetCaret, takeFocus: boolean): boolean => {
      const src = parseFieldKey(target.key);
      if (!src) return false;
      const value = valueForField(dataRef.current, src);
      const map = mapFor(src, value);
      const d = displayIndexForValueIndex(map, Math.min(target.valueIndex, value.length));
      const pos = displayIndexToCaret(host, target.key, map.display, d);
      if (!pos) return false;
      if (takeFocus) host.focus({ preventScroll: true });
      const sel = window.getSelection();
      if (sel) {
        const range = document.createRange();
        range.setStart(pos.node, pos.offset);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      // Only chase the caret into view when we are also taking focus. Yielding
      // to a text field elsewhere and THEN scrolling the document under the
      // user would be the same interruption in a quieter form.
      if (takeFocus) (pos.node.parentElement ?? undefined)?.scrollIntoView({ block: "nearest" });
      return true;
    },
    [mapFor]
  );

  // Opening a document must not interrupt someone typing somewhere else: a
  // workspace load resolves whenever the server answers, which can land while
  // the user is filling in the job description. Buttons and the page background
  // are fair game — the user just asked for this document.
  const focusIsInAnotherTextField = useCallback((host: HTMLElement): boolean => {
    const active = document.activeElement as HTMLElement | null;
    if (!active || active === document.body || host.contains(active)) return false;
    return active.isContentEditable || /^(?:input|textarea|select)$/i.test(active.tagName);
  }, []);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // 0) A freshly opened document starts at its first painted field, and a
    // remounted one resumes where the host says the caret was. Both are one-shot
    // and both lose to the caret an in-flight edit is restoring, which is the
    // user's own live position. Placement never returns early: step 2 below
    // reopens the commit gate, and skipping it would strand queued input.
    const placeDocumentStart = () => {
      const key = orderedFieldKeys(host)[0];
      return Boolean(key) && placeCaret(host, { key, valueIndex: 0 }, !focusIsInAnotherTextField(host));
    };
    let placed = false;
    if (pendingDocumentStartRef.current && !pendingCaretRef.current) {
      placed = placeDocumentStart();
      // Spent once the document has fields to aim at, even if placement failed:
      // an unconsumed request would sit here and fire on some later repaint the
      // user never connected to opening anything.
      if (placed || orderedFieldKeys(host).length > 0) pendingDocumentStartRef.current = false;
    }
    const initial = pendingInitialCaretRef.current;
    if (!placed && initial && !pendingCaretRef.current) {
      pendingInitialCaretRef.current = null;
      // A stored caret means the user had been editing here, so focus follows it.
      // If its field is gone — the document was replaced while this editor was
      // away — fall back to the start rather than leaving the page caretless.
      placed = placeCaret(host, initial, !focusIsInAnotherTextField(host)) || placeDocumentStart();
    }
    // 1) Restore the caret the last commit asked for.
    const pending = pendingCaretRef.current;
    pendingCaretRef.current = null;
    if (pending && !placed) {
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
              const endKey = target.endKey ?? target.key;
              const endSrc = target.endKey ? parseFieldKey(target.endKey) : src;
              const endValue = endSrc ? valueForField(dataRef.current, endSrc) : value;
              const endMap = endSrc ? mapFor(endSrc, endValue) : map;
              const dEnd = displayIndexForValueIndex(
                endMap,
                Math.min(target.valueEndIndex, endValue.length)
              );
              const end = displayIndexToCaret(host, endKey, endMap.display, dEnd);
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
        // The queued intent may have been aimed at a selection crossing fields.
        // Drop the queue only when nothing can apply it.
        if (!commitCrossFieldIntent(intent)) replayQueueRef.current = [];
        return;
      }
      if (intent.kind === "insert") {
        commitReplace(sel, sel.dStart, sel.dEnd, intent.text);
      } else if (intent.kind === "paste") {
        commitPaste(sel, sel.dStart, sel.dEnd, intent.fragment);
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
        applyMark(sel, intent.mark);
      } else if (intent.kind === "clearFormatting") {
        if (sel.dStart !== sel.dEnd) commitClearFormatting(sel);
      } else {
        commitHistory(intent.direction);
      }
    }
  }, [
    focusIsInAnotherTextField,
    placeCaret,
    commitClearFormatting,
    commitEnter,
    commitHistory,
    commitMergeBullet,
    applyMark,
    commitCrossFieldIntent,
    commitPaste,
    commitReplace,
    docVersion,
    mapFor,
    nonce,
    readSelection
  ]);

  const handleZoomShortcut = useCallback(
    (command: -1 | 0 | 1) => {
      const next =
        command === 0
          ? 1
          : nextZoomOption(docStyle.style.zoom, command);
      docStyle.set("zoom", next);
    },
    [docStyle.set, docStyle.style.zoom]
  );

  useTypesetInputEvents({
    hostRef,
    nonce,
    docVersion,
    commitPendingRef,
    replayQueueRef,
    readSelection,
    commitReplace,
    commitPaste,
    onEnter: commitEnter,
    commitMergeBullet,
    commitToggleMark: applyMark,
    commitCrossFieldIntent,
    crossFieldPlainText,
    commitClearFormatting,
    commitHistory,
    onZoomShortcut: handleZoomShortcut,
    setNonce
  });
  // Bring the highlighted field into view after every repaint that carries it
  // (a repaint can move the field to another page).
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || !highlightFieldKey) return;
    host
      .querySelector<HTMLElement>(`[data-tsdf="${CSS.escape(highlightFieldKey)}"]:not([data-tsdm])`)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [docVersion, highlightFieldKey]);

  const overlayAnchor = hovered ?? activeAnchor;
  const { contextMenu, menuItems, openContextMenu, closeContextMenu } = useTypesetContextMenu({
    data,
    hostRef,
    structureEditing,
    commands,
    inlineFormat: inlineFormatState,
    addSectionRelative,
    removeSectionAt,
    addEntryRelative,
    removeEntryAt,
    addBulletToEntry,
    addBulletRelative,
    removeBulletAt,
    canUndo,
    canRedo,
    onRequestLinkEditor
  });

  // The card follows the SELECTION (see useTypesetLinkCard): it is synced from the
  // selection-change effect above, repositioned when the page moves under it, and
  // suppressed while the right-click menu owns the screen.
  useEffect(() => {
    if (contextMenu) hideLinkCard();
  }, [contextMenu, hideLinkCard]);

  // Scroll and repaint move the painted text; re-measure rather than drop the card.
  const repositionLinkCard = useCallback(() => {
    repositionLinkCardTo((key) => {
      const src = parseFieldKey(key);
      if (!src) return null;
      return mapFor(src, valueForField(dataRef.current, src)).display;
    });
  }, [mapFor, repositionLinkCardTo]);
  // Only a repaint can move the link relative to the wrapper; scrolling cannot,
  // because both the card and the text it annotates live inside the same
  // scrolling box. So there is no scroll listener to get wrong.
  useEffect(() => {
    repositionLinkCard();
  }, [docVersion, repositionLinkCard]);

  // A card action runs the editor's ordinary link command over the card's own run,
  // selecting it first so the command has something to act on and the change is
  // visible where it happened.
  const onCardLink = useCallback(
    (run: () => void) => () => {
      const card = linkCardTarget;
      const host = hostRef.current;
      if (!card || !host) return;
      const display = mapFor(card.src, valueForField(dataRef.current, card.src)).display;
      if (selectDisplayRange(host, card.key, display, card.dStart, card.dEnd)) run();
    },
    [linkCardTarget, mapFor]
  );

  return (
    <div
      className={`typeset-editor${drag ? " is-dragging" : ""}${caretOverlay ? " has-typeset-caret" : ""}`}
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
        highlightFieldKey={highlightFieldKey}
        documentKind={documentKind}
        onPageCount={onPageCount}
      />
      {caretOverlay ? (
        <span
          className="typeset-caret"
          aria-hidden="true"
          style={{
            left: caretOverlay.left,
            top: caretOverlay.top,
            height: caretOverlay.height,
            // Italic text is entered on a slope, so the caret leans with it.
            transform: caretOverlay.slantDeg ? `skewX(${caretOverlay.slantDeg}deg)` : undefined,
            transformOrigin: `0 ${caretOverlay.baselineOffset}px`
          }}
        />
      ) : null}
      {structureEditing ? (
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
      ) : null}
      {overlay
        ? overlay({ data, anchors, anchor: overlayAnchor, pageOrigins, zoom, geometry: geo })
        : null}
      {contextMenu ? (
        <TypesetContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={menuItems}
          onClose={closeContextMenu}
        />
      ) : null}
      {linkCardTarget ? (
        <TypesetLinkCard
          href={linkCardTarget.href}
          anchorRect={linkCardTarget.anchorRect}
          onOpen={() => window.open(linkCardTarget.href, "_blank", "noopener,noreferrer")}
          onCopy={() => void navigator.clipboard?.writeText(linkCardTarget.href).catch(() => {})}
          onEdit={onCardLink(() => onRequestLinkEditor?.())}
          onRemove={onCardLink(() => commands.removeLink())}
          onDismiss={dismissLinkCard}
        />
      ) : null}
    </div>
  );
});
