import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  DOC_STYLE_DEFAULTS,
  TEXT_STYLE_DEFAULTS,
  coerceDocStyle,
  pickDocSpacing,
  type DocSpacingPreset,
  type DocStyle,
  type DocStyleFields,
  type DocumentStyle
} from "@typeset/engine/lib/documentStyle.ts";

const STORAGE_KEY = "typeset-resume.docStyle.v1";
// User-saved spacing preset (the point-gap sliders only, like the built-in
// presets). Stored separately so it survives Reset and live edits.
const CUSTOM_STORAGE_KEY = "typeset-resume.docStyle.custom.v1";

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

// Browser persistence and React state adapter for the pure document-style
// contract in lib/documentStyle.ts.
export function useDocStyle() {
  const [style, setStyle] = useState<DocStyle>(loadStyle);
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
    setStyle((current) => ({ ...current, [key]: value }));
  }, []);

  const applyStyle = useCallback((partial: Partial<DocStyle>) => {
    setStyle((current) => ({ ...current, ...partial }));
  }, []);

  const replaceDocumentStyle = useCallback((documentStyle: DocumentStyle) => {
    setStyle((current) =>
      coerceDocStyle({ ...documentStyle, zoom: current.zoom, spellCheck: current.spellCheck })
    );
  }, []);

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

  // A stable controls object: consumers re-render only when the style or the
  // saved custom preset actually change, not on every parent render (App
  // re-renders per keystroke, and effects like the keyboard-shortcut listener
  // key off this identity).
  return useMemo(
    () => ({
      style,
      set,
      applyStyle,
      replaceDocumentStyle,
      saveCustomPreset,
      customPreset,
      isStyleDefault
    }),
    [applyStyle, customPreset, isStyleDefault, replaceDocumentStyle, saveCustomPreset, set, style]
  );
}

export type DocStyleControls = ReturnType<typeof useDocStyle>;
