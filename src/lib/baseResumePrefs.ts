const KEY = "rolefit:lastBaseResume";

export function loadLastBaseResumeName(): string {
  if (typeof localStorage === "undefined") return "";
  try {
    return localStorage.getItem(KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function saveLastBaseResumeName(fileName: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    const value = fileName.trim();
    if (value) localStorage.setItem(KEY, value);
    else localStorage.removeItem(KEY);
  } catch {
    // Storage unavailable or over quota — the workspace still loads normally.
  }
}
