const KEY = "rolefit:lastCoverLetter";

export function resolveCoverLetterStartup(
  availableFileNames: string[],
  rememberedFileName: string
): { fileName: string; stale: boolean } {
  const remembered = rememberedFileName.trim();
  const rememberedExists =
    Boolean(remembered) && availableFileNames.includes(remembered);
  return {
    fileName: rememberedExists ? remembered : availableFileNames[0] ?? "",
    stale: Boolean(remembered) && !rememberedExists
  };
}

export function coverLetterStartupIsCurrent(
  startupFingerprint: string,
  currentFingerprint: string,
  cancelled: boolean
): boolean {
  return !cancelled && startupFingerprint === currentFingerprint;
}

export function loadLastCoverLetterName(): string {
  if (typeof localStorage === "undefined") return "";
  try {
    return localStorage.getItem(KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function saveLastCoverLetterName(fileName: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    const value = fileName.trim();
    if (value) localStorage.setItem(KEY, value);
    else localStorage.removeItem(KEY);
  } catch {
    // Storage unavailable or over quota — saved variants still open normally.
  }
}
