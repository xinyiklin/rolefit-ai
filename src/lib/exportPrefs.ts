// The three resume export destinations, shared by the export menu and the
// post-Apply download prompt. "pdf-latex" compiles via Tectonic, "pdf-clean"
// routes through the browser's Save-as-PDF, "tex" downloads LaTeX source.
export type ExportFormat = "pdf-latex" | "pdf-clean" | "tex";

const VALID_FORMATS: ReadonlySet<string> = new Set<ExportFormat>(["pdf-latex", "pdf-clean", "tex"]);

const KEY = "rolefit:defaultExportFormat";

// The user's remembered "download this format when I Apply" choice. Stored under
// its own key (not the AI-settings blob) since it is an output preference, not a
// provider setting. Absent until the user opts in from the Apply download prompt.
export function loadDefaultExportFormat(): ExportFormat | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    return raw && VALID_FORMATS.has(raw) ? (raw as ExportFormat) : null;
  } catch {
    return null;
  }
}

export function saveDefaultExportFormat(format: ExportFormat): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, format);
  } catch {
    // Storage unavailable or over quota — the choice just won't persist.
  }
}

export function clearDefaultExportFormat(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Ignore — nothing to clear if storage is unavailable.
  }
}