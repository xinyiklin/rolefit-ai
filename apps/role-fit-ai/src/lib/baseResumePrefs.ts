const KEY = "rolefit:lastBaseResume";

export function loadLastBaseResumeName(): string {
  if (typeof localStorage === "undefined") return "";
  try {
    return localStorage.getItem(KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

// Set once by browserPrefsSync.ts when it loads (see that file's top comment
// and the matching listener in settings.ts) — same cycle-avoidance shape as
// setSettingsSaveListener.
let lastBaseResumeSaveListener: (() => void) | null = null;
export function setLastBaseResumeSaveListener(listener: (() => void) | null): void {
  lastBaseResumeSaveListener = listener;
}

export function saveLastBaseResumeName(fileName: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    const value = fileName.trim();
    if (value) localStorage.setItem(KEY, value);
    else localStorage.removeItem(KEY);
    lastBaseResumeSaveListener?.();
  } catch {
    // Storage unavailable or over quota — the workspace still loads normally.
  }
}
