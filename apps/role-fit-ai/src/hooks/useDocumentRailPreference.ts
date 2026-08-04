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
