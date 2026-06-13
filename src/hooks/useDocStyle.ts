import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

// User-adjustable typography for the HTML resume page (the editor, its read-only
// print mirror, and therefore the "PDF · clean" export). The same values are
// also sent to the LaTeX renderer so `.tex`, PDF preview, and PDF · LaTeX use the
// same rhythm.
export type DocStyle = {
  // Page zoom, Google-Docs style: 1 (= "100%") is the comfortable default page
  // (75% of the pane); width and font scale by the same factor.
  zoom: number;
  lineHeight: number; // body leading
  sectionGap: number; // em between sections
  entryGap: number; // em between entries in a section
  bulletGap: number; // em between bullets
  boldTitles: boolean; // entry title (role / project / school)
  boldHeadings: boolean; // section headings
  boldSkillLabels: boolean; // "Languages:" style labels
  italicSubtitles: boolean; // subtitle + location row
  italicDates: boolean; // the right-aligned date / link slot
};

export const DOC_STYLE_DEFAULTS: DocStyle = {
  zoom: 1,
  lineHeight: 1.18,
  sectionGap: 0.85,
  entryGap: 0.42,
  bulletGap: 0.2,
  boldTitles: true,
  boldHeadings: false,
  boldSkillLabels: true,
  italicSubtitles: true,
  italicDates: false
};

type DocSpacingPreset = Pick<DocStyle, "lineHeight" | "sectionGap" | "entryGap" | "bulletGap">;

export const DOC_SPACING_PRESETS = {
  normal: {
    label: "Normal",
    values: {
      lineHeight: DOC_STYLE_DEFAULTS.lineHeight,
      sectionGap: DOC_STYLE_DEFAULTS.sectionGap,
      entryGap: DOC_STYLE_DEFAULTS.entryGap,
      bulletGap: DOC_STYLE_DEFAULTS.bulletGap
    }
  },
  compact: {
    label: "Compact",
    values: {
      lineHeight: 1.16,
      sectionGap: 0.48,
      entryGap: 0.24,
      bulletGap: 0.08
    }
  }
} as const satisfies Record<string, { label: string; values: DocSpacingPreset }>;

// Google-Docs-style zoom steps for the Resume tab's page-zoom select.
export const DOC_ZOOM_OPTIONS = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5] as const;

const STORAGE_KEY = "rolefit.docStyle.v2";
// v1 stored zoom as a fraction of the pane (default 0.75); v2 re-bases so 1
// (= "100%") IS that comfortable size. Migrate by dividing out the old base.
const LEGACY_STORAGE_KEY = "rolefit.docStyle.v1";
const LEGACY_ZOOM_BASE = 0.75;

const clamp = (value: unknown, fallback: number, min: number, max: number) => {
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
};

function coerce(raw: unknown): DocStyle {
  const r = (raw ?? {}) as Partial<Record<keyof DocStyle, unknown>>;
  return {
    zoom: clamp(r.zoom, DOC_STYLE_DEFAULTS.zoom, 0.4, 2),
    lineHeight: clamp(r.lineHeight, DOC_STYLE_DEFAULTS.lineHeight, 1, 1.8),
    sectionGap: clamp(r.sectionGap, DOC_STYLE_DEFAULTS.sectionGap, 0, 2),
    entryGap: clamp(r.entryGap, DOC_STYLE_DEFAULTS.entryGap, 0, 1.6),
    bulletGap: clamp(r.bulletGap, DOC_STYLE_DEFAULTS.bulletGap, 0, 1.2),
    boldTitles: r.boldTitles !== false,
    boldHeadings: r.boldHeadings === true,
    boldSkillLabels: r.boldSkillLabels !== false,
    italicSubtitles: r.italicSubtitles !== false,
    italicDates: r.italicDates === true
  };
}

function load(): DocStyle {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) return coerce(JSON.parse(raw));
    const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy) as { zoom?: unknown };
      const oldZoom = typeof parsed.zoom === "number" && Number.isFinite(parsed.zoom) ? parsed.zoom : LEGACY_ZOOM_BASE;
      const migrated = coerce({ ...parsed, zoom: oldZoom / LEGACY_ZOOM_BASE });
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
      return migrated;
    }
    return { ...DOC_STYLE_DEFAULTS };
  } catch {
    return { ...DOC_STYLE_DEFAULTS };
  }
}

export function useDocStyle() {
  const [style, setStyle] = useState<DocStyle>(load);
  const saveTimer = useRef<number | undefined>(undefined);

  // Persist (debounced — sliders emit a burst of changes per drag).
  useEffect(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(style));
      } catch {
        // Storage unavailable (private mode); the style still applies this session.
      }
    }, 250);
    return () => window.clearTimeout(saveTimer.current);
  }, [style]);

  const cssVars = useMemo(
    () =>
      ({
        "--doc-zoom": String(style.zoom),
        "--doc-line": String(style.lineHeight),
        "--doc-section-gap": `${style.sectionGap}em`,
        "--doc-entry-gap": `${style.entryGap}em`,
        "--doc-bullet-gap": `${style.bulletGap}em`,
        "--doc-title-weight": style.boldTitles ? "700" : "400",
        "--doc-heading-weight": style.boldHeadings ? "700" : "400",
        "--doc-skill-label-weight": style.boldSkillLabels ? "700" : "400",
        "--doc-subtitle-style": style.italicSubtitles ? "italic" : "normal",
        "--doc-date-style": style.italicDates ? "italic" : "normal"
      }) as CSSProperties,
    [style]
  );

  function set<K extends keyof DocStyle>(key: K, value: DocStyle[K]) {
    setStyle((current) => ({ ...current, [key]: value }));
  }

  function reset() {
    setStyle({ ...DOC_STYLE_DEFAULTS });
  }

  function applySpacingPreset(preset: DocSpacingPreset) {
    setStyle((current) => ({ ...current, ...preset }));
  }

  const isDefault = useMemo(
    () => JSON.stringify(style) === JSON.stringify(DOC_STYLE_DEFAULTS),
    [style]
  );

  return { style, set, reset, applySpacingPreset, isDefault, cssVars };
}

export type DocStyleControls = ReturnType<typeof useDocStyle>;
