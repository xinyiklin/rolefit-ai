import { useCallback, useEffect, useState } from "react";

// The studio rail's width and collapse are view preferences of this browser,
// like zoom; they never enter workspace preferences. At narrow widths the rail
// is always the icon strip and cannot be toggled or resized.
const SIDEBAR_KEY = "rolefit:sidebar";
const SIDEBAR_WIDTH_KEY = "rolefit:sidebar-width";
const NARROW_QUERY = "(max-width: 1080px)";

export const STUDIO_RAIL_BOUNDS = { min: 168, max: 200, initial: 200, collapsed: 52 } as const;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) storage()?.removeItem(key);
    else storage()?.setItem(key, value);
  } catch {
    // Storage can be unavailable; the choice still applies for this page.
  }
}

function readCollapsed(): boolean {
  try {
    return storage()?.getItem(SIDEBAR_KEY) === "collapsed";
  } catch {
    return false;
  }
}

export function clampRailWidth(width: number): number {
  return Math.round(Math.min(STUDIO_RAIL_BOUNDS.max, Math.max(STUDIO_RAIL_BOUNDS.min, width)));
}

function readWidth(): number {
  try {
    const stored = Number(storage()?.getItem(SIDEBAR_WIDTH_KEY));
    return Number.isFinite(stored) && stored > 0 ? clampRailWidth(stored) : STUDIO_RAIL_BOUNDS.initial;
  } catch {
    return STUDIO_RAIL_BOUNDS.initial;
  }
}

function readNarrow(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(NARROW_QUERY).matches;
}

export function useStudioRail() {
  const [userCollapsed, setUserCollapsed] = useState(readCollapsed);
  const [width, setWidthState] = useState(readWidth);
  const [narrow, setNarrow] = useState(readNarrow);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(NARROW_QUERY);
    const onChange = () => setNarrow(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const setCollapsed = useCallback((next: boolean) => {
    setUserCollapsed(next);
    writeStorage(SIDEBAR_KEY, next ? "collapsed" : null);
  }, []);

  const toggle = useCallback(() => setCollapsed(!userCollapsed), [setCollapsed, userCollapsed]);

  const setWidth = useCallback((next: number) => {
    const clamped = clampRailWidth(next);
    setWidthState(clamped);
    writeStorage(SIDEBAR_WIDTH_KEY, clamped === STUDIO_RAIL_BOUNDS.initial ? null : String(clamped));
  }, []);

  return {
    collapsed: narrow || userCollapsed,
    canToggle: !narrow,
    toggle,
    setCollapsed,
    width,
    setWidth
  };
}
