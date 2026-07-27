import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import {
  DOC_STYLE_DEFAULTS,
  TEXT_STYLE_DEFAULTS,
  coerceDocStyle,
  pickDocSpacing,
  toDocumentStyle,
  type DocSpacingPreset,
  type DocStyle,
  type DocStyleFields,
  type DocumentStyle
} from "@typeset/engine/lib/documentStyle.ts";
import { createHistoryClock, type HistoryClock } from "./historyClock.ts";

const STORAGE_KEY = "typeset-resume.docStyle.v1";
// User-saved spacing preset (the point-gap sliders only, like the built-in
// presets). Stored separately so it survives Reset and live edits.
const CUSTOM_STORAGE_KEY = "typeset-resume.docStyle.custom.v1";
const HISTORY_CAP = 100;
const COALESCE_MS = 700;

type HistoryEntry = {
  style: DocStyle;
  sequence: number;
  branch: number;
  generation: number;
};
type StyleState = {
  style: DocStyle;
  past: HistoryEntry[];
  future: HistoryEntry[];
  coalesceKey: string | null;
  coalesceAt: number;
};

type StyleAction =
  | { type: "set"; key: keyof DocStyle; value: DocStyle[keyof DocStyle] }
  | { type: "apply"; partial: Partial<DocStyle> }
  | { type: "replace"; style: DocumentStyle }
  | { type: "undo" }
  | { type: "redo" };

const VIEW_ONLY_KEYS = new Set<keyof DocStyle>(["zoom", "spellCheck", "pageMargins"]);

function sameStyle(a: DocStyle, b: DocStyle): boolean {
  return (Object.keys(a) as Array<keyof DocStyle>).every((key) => a[key] === b[key]);
}

function sameDocumentStyle(a: DocumentStyle, b: DocumentStyle): boolean {
  return (Object.keys(a) as Array<keyof DocumentStyle>).every((key) => a[key] === b[key]);
}

export function documentStyleIsDirty(style: DocStyle, clean: DocumentStyle): boolean {
  return !sameDocumentStyle(toDocumentStyle(style), clean);
}

function withCurrentViewPreferences(style: DocStyle, current: DocStyle): DocStyle {
  return { ...style, zoom: current.zoom, spellCheck: current.spellCheck };
}

export function styleReducer(
  state: StyleState,
  action: StyleAction,
  historyClock: HistoryClock
): StyleState {
  if (action.type === "replace") {
    historyClock.reset();
    return {
      style: coerceDocStyle({
        ...action.style,
        zoom: state.style.zoom,
        spellCheck: state.style.spellCheck
      }),
      past: [],
      future: [],
      coalesceKey: null,
      coalesceAt: 0
    };
  }
  if (action.type === "undo") {
    let index = state.past.length - 1;
    while (
      index >= 0 &&
      !historyClock.isCurrentGeneration(state.past[index]?.generation ?? -1)
    ) {
      index -= 1;
    }
    const entry = state.past[index];
    if (!entry) return state;
    const branch = historyClock.noteUndo(entry.sequence);
    return {
      style: withCurrentViewPreferences(entry.style, state.style),
      past: state.past.filter((_, pastIndex) => pastIndex !== index),
      future: [
        {
          style: state.style,
          sequence: entry.sequence,
          branch,
          generation: historyClock.currentGeneration()
        },
        ...state.future
      ].slice(0, HISTORY_CAP),
      coalesceKey: null,
      coalesceAt: 0
    };
  }
  if (action.type === "redo") {
    const index = state.future.findIndex((entry) =>
      historyClock.isCurrentRedoBranch(entry.branch) &&
      historyClock.isCurrentGeneration(entry.generation)
    );
    if (index < 0) return state;
    const entry = state.future[index];
    if (!entry) return state;
    historyClock.noteRedo(entry.sequence);
    return {
      style: withCurrentViewPreferences(entry.style, state.style),
      past: [
        ...state.past,
        {
          style: state.style,
          sequence: entry.sequence,
          branch: historyClock.currentBranch(),
          generation: historyClock.currentGeneration()
        }
      ].slice(-HISTORY_CAP),
      future: state.future.filter((_, futureIndex) => futureIndex !== index),
      coalesceKey: null,
      coalesceAt: 0
    };
  }

  const next =
    action.type === "set"
      ? ({ ...state.style, [action.key]: action.value } as DocStyle)
      : ({ ...state.style, ...action.partial } as DocStyle);
  if (sameStyle(next, state.style)) return state;

  const changedKeys =
    action.type === "set"
      ? [action.key]
      : (Object.keys(action.partial) as Array<keyof DocStyle>).filter(
          (key) => action.partial[key] !== state.style[key]
        );
  const documentChange = changedKeys.some((key) => !VIEW_ONLY_KEYS.has(key));
  if (!documentChange) return { ...state, style: next };

  const key = action.type === "set" ? `style:${action.key}` : null;
  const now = Date.now();
  // Advance the shared clock before coalescing so content edits still split
  // otherwise-adjacent style transactions.
  const sequence = historyClock.nextSequence();
  const branch = historyClock.currentBranch();
  const generation = historyClock.currentGeneration();
  const previous = state.past[state.past.length - 1];
  const coalesce =
    key !== null &&
    key === state.coalesceKey &&
    now - state.coalesceAt < COALESCE_MS &&
    previous?.generation === generation &&
    previous?.sequence === sequence - 1;
  return {
    style: next,
    past: coalesce
      ? [...state.past.slice(0, -1), { ...previous, sequence, branch, generation }]
      : [
          ...state.past,
          { style: state.style, sequence, branch, generation }
        ].slice(-HISTORY_CAP),
    future: [],
    coalesceKey: key,
    coalesceAt: now
  };
}

function loadCustomPreset(): DocSpacingPreset | null {
  try {
    const raw = window.localStorage.getItem(CUSTOM_STORAGE_KEY);
    if (raw) return pickDocSpacing(coerceDocStyle(JSON.parse(raw)));
  } catch {
    // A corrupt saved preset falls back to no custom preset.
  }
  return null;
}

function loadStyle(): DocStyle {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) return coerceDocStyle(JSON.parse(raw));
  } catch {
    // A corrupt saved style falls back to defaults.
  }
  return { ...DOC_STYLE_DEFAULTS };
}

export function useDocStyle(historyClock?: HistoryClock) {
  const localHistoryClockRef = useRef<HistoryClock | null>(null);
  if (!localHistoryClockRef.current) localHistoryClockRef.current = createHistoryClock();
  const documentHistoryClock = historyClock ?? localHistoryClockRef.current;
  const reducer = useMemo(
    () => (state: StyleState, action: StyleAction) =>
      styleReducer(state, action, documentHistoryClock),
    [documentHistoryClock]
  );
  const [state, dispatch] = useReducer(reducer, undefined, () => {
    const style = loadStyle();
    return {
      style,
      past: [],
      future: [],
      coalesceKey: null,
      coalesceAt: 0
    };
  });
  const style = state.style;
  const [cleanDocumentStyle, setCleanDocumentStyle] = useState(() => toDocumentStyle(style));
  const [customPreset, setCustomPreset] = useState<DocSpacingPreset | null>(loadCustomPreset);
  const saveTimer = useRef<number | undefined>(undefined);
  // Read through a ref where a stable callback needs the current style.
  const styleRef = useRef(style);
  styleRef.current = style;

  useEffect(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(style));
      } catch {
        // Storage unavailable; the style still applies for this session.
      }
    }, 250);
    return () => window.clearTimeout(saveTimer.current);
  }, [style]);

  const set = useCallback(<K extends keyof DocStyle>(key: K, value: DocStyle[K]) => {
    dispatch({ type: "set", key, value });
  }, []);

  const applyStyle = useCallback((partial: Partial<DocStyle>) => {
    dispatch({ type: "apply", partial });
  }, []);

  const replaceDocumentStyle = useCallback((documentStyle: DocumentStyle) => {
    setCleanDocumentStyle(toDocumentStyle(coerceDocStyle(documentStyle)));
    dispatch({ type: "replace", style: documentStyle });
  }, []);

  const markClean = useCallback(() => {
    setCleanDocumentStyle(toDocumentStyle(styleRef.current));
  }, []);

  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);

  const saveCustomPreset = useCallback(() => {
    const snapshot = pickDocSpacing(styleRef.current);
    setCustomPreset(snapshot);
    try {
      window.localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      // Storage unavailable; the preset still applies for this session.
    }
  }, []);

  const isStyleDefault = useMemo(
    () =>
      (Object.keys(TEXT_STYLE_DEFAULTS) as Array<keyof DocStyleFields>).every(
        (key) => style[key] === TEXT_STYLE_DEFAULTS[key]
      ),
    [style]
  );

  const dirty = documentStyleIsDirty(style, cleanDocumentStyle);
  const historyBranch = documentHistoryClock.currentBranch();
  const historyGeneration = documentHistoryClock.currentGeneration();
  let undoIndex = state.past.length - 1;
  while (
    undoIndex >= 0 &&
    !documentHistoryClock.isCurrentGeneration(state.past[undoIndex]?.generation ?? -1)
  ) {
    undoIndex -= 1;
  }
  const undoEntry = state.past[undoIndex];
  const redoEntry = state.future.find((entry) =>
    documentHistoryClock.isCurrentRedoBranch(entry.branch) &&
    documentHistoryClock.isCurrentGeneration(entry.generation)
  );

  // Stable identity prevents parent keystrokes from reinstalling consumers'
  // effects when neither style nor saved presets changed.
  return useMemo(
    () => ({
      style,
      dirty,
      set,
      applyStyle,
      replaceDocumentStyle,
      markClean,
      saveCustomPreset,
      customPreset,
      isStyleDefault,
      canUndo: undoEntry !== undefined,
      canRedo: redoEntry !== undefined,
      undoSequence: (undoEntry?.sequence ?? null) as number | null,
      redoSequence: (redoEntry?.sequence ?? null) as number | null,
      undo,
      redo
    }),
    [
      applyStyle,
      customPreset,
      dirty,
      isStyleDefault,
      markClean,
      redo,
      replaceDocumentStyle,
      saveCustomPreset,
      set,
      state.future,
      state.past,
      historyBranch,
      historyGeneration,
      redoEntry,
      undoEntry,
      style,
      undo
    ]
  );
}

export type DocStyleControls = ReturnType<typeof useDocStyle>;
