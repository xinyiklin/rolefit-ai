import { useCallback, useEffect, useState, type SetStateAction } from "react";

export type DocumentRailPreferenceKey = "resume-review" | "cover-tailoring";

type DocumentRailPreferenceStorage = Pick<Storage, "getItem" | "setItem">;

const DOCUMENT_RAIL_STORAGE_PREFIX = "rolefit:document-rail:";

export function documentRailPreferenceStorageKey(
  preferenceKey: DocumentRailPreferenceKey
): string {
  return `${DOCUMENT_RAIL_STORAGE_PREFIX}${preferenceKey}`;
}

export function readDocumentRailPreference(
  storage: DocumentRailPreferenceStorage | null,
  preferenceKey: DocumentRailPreferenceKey,
  defaultExpanded: boolean
): boolean {
  if (!storage) return defaultExpanded;
  try {
    const stored = storage.getItem(documentRailPreferenceStorageKey(preferenceKey));
    if (stored === "expanded") return true;
    if (stored === "collapsed") return false;
  } catch {
    // Browser privacy controls can disable storage. Disclosure still works for
    // this session from the caller's explicit default.
  }
  return defaultExpanded;
}

export function writeDocumentRailPreference(
  storage: DocumentRailPreferenceStorage | null,
  preferenceKey: DocumentRailPreferenceKey,
  expanded: boolean
): void {
  if (!storage) return;
  try {
    storage.setItem(
      documentRailPreferenceStorageKey(preferenceKey),
      expanded ? "expanded" : "collapsed"
    );
  } catch {
    // A failed preference write must not prevent the disclosure from changing.
  }
}

// Width is one preference for both documents: disclosure is workflow state a
// document owns, but how much screen a rail gets is a workspace decision, and a
// per-document width would move the page every time the tab changed.
const DOCUMENT_RAIL_WIDTH_KEY = `${DOCUMENT_RAIL_STORAGE_PREFIX}width`;
// Bounds stay in rem so they keep following the reader's font size, the same
// reason the rail's own width is rem-based. The dragged value is stored in px
// and re-clamped against the live root size on read.
export const DOCUMENT_RAIL_MIN_REM = 18;
export const DOCUMENT_RAIL_MAX_REM = 28;

export type DocumentRailWidthBounds = { min: number; max: number };

export function documentRailWidthStorageKey(): string {
  return DOCUMENT_RAIL_WIDTH_KEY;
}

export function documentRailWidthBounds(rootFontSizePx: number): DocumentRailWidthBounds {
  const rem = Number.isFinite(rootFontSizePx) && rootFontSizePx > 0 ? rootFontSizePx : 16;
  return { min: DOCUMENT_RAIL_MIN_REM * rem, max: DOCUMENT_RAIL_MAX_REM * rem };
}

export function clampDocumentRailWidth(
  width: number,
  bounds: DocumentRailWidthBounds
): number {
  if (!Number.isFinite(width)) return bounds.min;
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(width)));
}

export function readDocumentRailWidth(
  storage: DocumentRailPreferenceStorage | null,
  bounds: DocumentRailWidthBounds
): number {
  if (!storage) return bounds.min;
  try {
    const stored = storage.getItem(DOCUMENT_RAIL_WIDTH_KEY);
    if (stored === null) return bounds.min;
    // A stored width from a different font size, or a hand-edited value, is
    // clamped rather than rejected — the rail still opens at a usable size.
    return clampDocumentRailWidth(Number.parseFloat(stored), bounds);
  } catch {
    // Browser privacy controls can disable storage; the default width still works.
  }
  return bounds.min;
}

export function writeDocumentRailWidth(
  storage: DocumentRailPreferenceStorage | null,
  width: number
): void {
  if (!storage) return;
  try {
    storage.setItem(DOCUMENT_RAIL_WIDTH_KEY, String(Math.round(width)));
  } catch {
    // A failed preference write must not prevent the resize from taking effect.
  }
}

function browserStorage(): DocumentRailPreferenceStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function useDocumentRailPreference(
  preferenceKey: DocumentRailPreferenceKey,
  defaultExpanded = true
) {
  const [isExpanded, setExpandedState] = useState(() =>
    readDocumentRailPreference(browserStorage(), preferenceKey, defaultExpanded)
  );

  useEffect(() => {
    setExpandedState(
      readDocumentRailPreference(browserStorage(), preferenceKey, defaultExpanded)
    );
  }, [defaultExpanded, preferenceKey]);

  const setIsExpanded = useCallback(
    (next: SetStateAction<boolean>) => {
      setExpandedState((current) => {
        const resolved = typeof next === "function" ? next(current) : next;
        writeDocumentRailPreference(browserStorage(), preferenceKey, resolved);
        return resolved;
      });
    },
    [preferenceKey]
  );

  return { isExpanded, setIsExpanded };
}

function rootFontSizePx(): number {
  if (typeof window === "undefined") return 16;
  return Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

export function useDocumentRailWidth() {
  // Read once at mount: the bounds move only with the reader's font-size setting,
  // and re-deriving them on every drag frame would fight the drag itself.
  const [bounds] = useState(() => documentRailWidthBounds(rootFontSizePx()));
  const [width, setWidthState] = useState(() =>
    readDocumentRailWidth(browserStorage(), bounds)
  );

  const setWidth = useCallback(
    (next: number) => {
      const resolved = clampDocumentRailWidth(next, bounds);
      writeDocumentRailWidth(browserStorage(), resolved);
      setWidthState(resolved);
      return resolved;
    },
    [bounds]
  );

  return { width, setWidth, bounds };
}
