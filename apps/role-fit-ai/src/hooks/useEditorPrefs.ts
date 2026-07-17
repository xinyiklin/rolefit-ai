import { useEffect, useState } from "react";

// Editor-only display preferences: settings that change how the editing surface
// behaves but never touch the resume output (the PDF). Kept apart from
// useDocStyle (typography that feeds the engine, and that "Reset to defaults"
// owns) and from the AI settings blob (provider config), so toggling one can't
// reset or leak into the others.
export type EditorPrefs = {
  // Browser-native spellcheck on the contenteditable page. On by default (the
  // long-standing behavior); the toolbar toggle lets a user silence the red
  // underlines that proper nouns, tech, and acronyms trigger all over a resume.
  spellCheck: boolean;
};

export const EDITOR_PREFS_DEFAULTS: EditorPrefs = {
  spellCheck: true
};

const STORAGE_KEY = "rolefit.editorPrefs.v1";

// Defensive parse (repo convention: coerce at model/storage boundaries, never
// throw on shape). Anything but an explicit `false` keeps the default-on state.
function load(): EditorPrefs {
  if (typeof localStorage === "undefined") return { ...EDITOR_PREFS_DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EDITOR_PREFS_DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Record<keyof EditorPrefs, unknown>>;
    return { spellCheck: parsed?.spellCheck !== false };
  } catch {
    return { ...EDITOR_PREFS_DEFAULTS };
  }
}

export function useEditorPrefs() {
  const [prefs, setPrefs] = useState<EditorPrefs>(load);

  // A toggle isn't a slider burst, so persist immediately (no debounce).
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      // Storage unavailable (private mode); the pref still applies this session.
    }
  }, [prefs]);

  function set<K extends keyof EditorPrefs>(key: K, value: EditorPrefs[K]) {
    setPrefs((current) => ({ ...current, [key]: value }));
  }

  return { prefs, set };
}

export type EditorPrefsControls = ReturnType<typeof useEditorPrefs>;
