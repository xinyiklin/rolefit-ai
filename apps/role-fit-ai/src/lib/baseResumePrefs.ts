const KEY = "rolefit:lastBaseResume";
let memoryLastBaseResume = "";

export function loadLastBaseResumeName(): string {
  if (typeof localStorage === "undefined") return memoryLastBaseResume;
  try {
    const stored = localStorage.getItem(KEY)?.trim();
    if (stored !== undefined && stored !== null) memoryLastBaseResume = stored;
    return stored ?? memoryLastBaseResume;
  } catch {
    return memoryLastBaseResume;
  }
}

// Set once by workspacePreferencesSync.ts when it loads (see that file's top comment
// and the matching listener in settings.ts) — same cycle-avoidance shape as
// setSettingsSaveListener.
let lastBaseResumeSaveListener: ((fileName: string) => void) | null = null;
export function setLastBaseResumeSaveListener(listener: ((fileName: string) => void) | null): void {
  lastBaseResumeSaveListener = listener;
}

export function saveLastBaseResumeName(fileName: string): void {
  const value = fileName.trim();
  memoryLastBaseResume = value;
  try {
    if (typeof localStorage !== "undefined") {
      if (value) localStorage.setItem(KEY, value);
      else localStorage.removeItem(KEY);
    }
  } catch {
    // The canonical workspace write below does not depend on this cache.
  }
  lastBaseResumeSaveListener?.(value);
}
