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
  nameContactGap: number; // name -> contact row
  contactGap: number; // horizontal space between contact items
  headerSectionGap: number; // contact/header block -> first section
  sectionGap: number; // em between sections
  sectionEntryGap: number; // section heading -> first entry/row
  entryGap: number; // em between entries in a section
  titleSubGap: number; // title row -> subtitle row
  headBulletGap: number; // entry header -> first bullet
  skillsRowGap: number; // skills row -> skills row
  bulletGap: number; // em between bullets
  boldTitles: boolean; // entry title (role / project / school)
  boldHeadings: boolean; // section headings
  boldSkillLabels: boolean; // "Languages:" style labels
  italicSubtitles: boolean; // subtitle + location row
  // Section-heading letter case: small caps (Jake default), full UPPERCASE, or
  // plain Title Case ("none"). The name keeps its own small-caps styling.
  headingCase: HeadingCase;
  sectionRule: boolean; // horizontal rule under each section heading
  contactDivider: string; // 1–2 char separator between header contact items
};

export type HeadingCase = "smallcaps" | "uppercase" | "none";

export const DOC_STYLE_DEFAULTS: DocStyle = {
  zoom: 1,
  lineHeight: 1.18,
  nameContactGap: 0.04,
  contactGap: 1.82,
  headerSectionGap: 1.19,
  sectionGap: 0.85,
  sectionEntryGap: 0.42,
  entryGap: 0.42,
  titleSubGap: 0.06,
  headBulletGap: 0.42,
  skillsRowGap: 0,
  bulletGap: 0.2,
  boldTitles: true,
  boldHeadings: false,
  boldSkillLabels: true,
  italicSubtitles: true,
  headingCase: "smallcaps",
  sectionRule: true,
  contactDivider: "|"
};

// The non-spacing "style" fields (everything the Style menu owns). Lifted as a
// type so the "Jake's defaults" button and applyStyle() stay in sync.
export type DocStyleFields = Pick<
  DocStyle,
  | "boldTitles"
  | "boldHeadings"
  | "boldSkillLabels"
  | "italicSubtitles"
  | "headingCase"
  | "sectionRule"
  | "contactDivider"
>;

// The authentic upstream Jake's-Resume look for the style fields — set by the
// Style menu's "Jake's defaults" button. The name renders in natural case
// regardless (not a style field).
export const JAKE_STYLE_DEFAULTS: DocStyleFields = {
  boldTitles: true,
  boldHeadings: false,
  boldSkillLabels: true,
  italicSubtitles: true,
  headingCase: "smallcaps",
  sectionRule: true,
  contactDivider: "|"
};

export type DocSpacingKey =
  | "lineHeight"
  | "nameContactGap"
  | "contactGap"
  | "headerSectionGap"
  | "sectionGap"
  | "sectionEntryGap"
  | "entryGap"
  | "titleSubGap"
  | "headBulletGap"
  | "skillsRowGap"
  | "bulletGap";

export type DocSpacingPreset = Pick<DocStyle, DocSpacingKey>;

export const DOC_SPACING_PRESETS = {
  normal: {
    label: "Normal",
    values: {
      lineHeight: DOC_STYLE_DEFAULTS.lineHeight,
      nameContactGap: DOC_STYLE_DEFAULTS.nameContactGap,
      contactGap: DOC_STYLE_DEFAULTS.contactGap,
      headerSectionGap: DOC_STYLE_DEFAULTS.headerSectionGap,
      sectionGap: DOC_STYLE_DEFAULTS.sectionGap,
      sectionEntryGap: DOC_STYLE_DEFAULTS.sectionEntryGap,
      entryGap: DOC_STYLE_DEFAULTS.entryGap,
      titleSubGap: DOC_STYLE_DEFAULTS.titleSubGap,
      headBulletGap: DOC_STYLE_DEFAULTS.headBulletGap,
      skillsRowGap: DOC_STYLE_DEFAULTS.skillsRowGap,
      bulletGap: DOC_STYLE_DEFAULTS.bulletGap
    }
  },
  compact: {
    label: "Compact",
    values: {
      lineHeight: 1.16,
      nameContactGap: 0.02,
      contactGap: 1.6,
      headerSectionGap: 0.82,
      sectionGap: 0.48,
      sectionEntryGap: 0.3,
      entryGap: 0.24,
      titleSubGap: 0.03,
      headBulletGap: 0.24,
      skillsRowGap: 0,
      bulletGap: 0.08
    }
  }
} as const satisfies Record<string, { label: string; values: DocSpacingPreset }>;

// Google-Docs-style zoom steps for the Resume tab's page-zoom select.
export const DOC_ZOOM_OPTIONS = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5] as const;

const STORAGE_KEY = "rolefit.docStyle.v3";
// User-saved spacing preset (the 11 spacing sliders only, like the built-in
// presets). Stored separately so it survives Reset and live edits.
const CUSTOM_STORAGE_KEY = "rolefit.docStyle.custom.v1";
// v2 had one `entryGap` slider, but it was wired to the entry-header -> bullets
// gap in both CSS and LaTeX. Migrate that value to `headBulletGap`; the new
// `entryGap` starts at the calibrated entry-to-entry default.
const LEGACY_V2_STORAGE_KEY = "rolefit.docStyle.v2";
// v1 stored zoom as a fraction of the pane (default 0.75); v2 re-bases so 1
// (= "100%") IS that comfortable size. Migrate by dividing out the old base.
const LEGACY_V1_STORAGE_KEY = "rolefit.docStyle.v1";
const LEGACY_ZOOM_BASE = 0.75;

const clamp = (value: unknown, fallback: number, min: number, max: number) => {
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
};

// Contact divider is a short glyph (UI offers | • · – /, plus a free 2-char
// input). Clamp to 2 chars so it can't blow out the header; empty falls back to
// the default "|".
const coerceDivider = (value: unknown): string => {
  if (typeof value !== "string") return DOC_STYLE_DEFAULTS.contactDivider;
  const trimmed = value.slice(0, 2);
  return trimmed.length ? trimmed : DOC_STYLE_DEFAULTS.contactDivider;
};

function coerce(raw: unknown, legacyMode: "current" | "v2" = "current"): DocStyle {
  const r = (raw ?? {}) as Partial<Record<keyof DocStyle, unknown>>;
  const legacySectionGap = clamp(r.sectionGap, DOC_STYLE_DEFAULTS.sectionGap, 0, 2);
  const legacyEntryGap = clamp(r.entryGap, DOC_STYLE_DEFAULTS.entryGap, 0, 1.6);
  return {
    zoom: clamp(r.zoom, DOC_STYLE_DEFAULTS.zoom, 0.4, 2),
    lineHeight: clamp(r.lineHeight, DOC_STYLE_DEFAULTS.lineHeight, 1, 1.8),
    nameContactGap: clamp(r.nameContactGap, DOC_STYLE_DEFAULTS.nameContactGap, 0, 0.8),
    contactGap: clamp(r.contactGap, DOC_STYLE_DEFAULTS.contactGap, 0.4, 3),
    headerSectionGap: clamp(
      r.headerSectionGap,
      legacyMode === "v2" ? legacySectionGap + 0.34 : DOC_STYLE_DEFAULTS.headerSectionGap,
      0,
      2.4
    ),
    sectionGap: legacySectionGap,
    sectionEntryGap: clamp(r.sectionEntryGap, DOC_STYLE_DEFAULTS.sectionEntryGap, 0, 1.2),
    entryGap: legacyMode === "v2" ? DOC_STYLE_DEFAULTS.entryGap : legacyEntryGap,
    titleSubGap: clamp(r.titleSubGap, DOC_STYLE_DEFAULTS.titleSubGap, 0, 0.6),
    headBulletGap: clamp(
      r.headBulletGap,
      legacyMode === "v2" ? legacyEntryGap : DOC_STYLE_DEFAULTS.headBulletGap,
      0,
      1.4
    ),
    skillsRowGap: clamp(r.skillsRowGap, DOC_STYLE_DEFAULTS.skillsRowGap, 0, 0.8),
    bulletGap: clamp(r.bulletGap, DOC_STYLE_DEFAULTS.bulletGap, 0, 1.2),
    boldTitles: r.boldTitles !== false,
    boldHeadings: r.boldHeadings === true,
    boldSkillLabels: r.boldSkillLabels !== false,
    italicSubtitles: r.italicSubtitles !== false,
    headingCase:
      r.headingCase === "uppercase" || r.headingCase === "none"
        ? r.headingCase
        : DOC_STYLE_DEFAULTS.headingCase,
    sectionRule: r.sectionRule !== false,
    contactDivider: coerceDivider(r.contactDivider)
  };
}

// The 11 spacing fields that make up a preset, lifted off a full DocStyle.
function pickSpacing(style: DocStyle): DocSpacingPreset {
  return {
    lineHeight: style.lineHeight,
    nameContactGap: style.nameContactGap,
    contactGap: style.contactGap,
    headerSectionGap: style.headerSectionGap,
    sectionGap: style.sectionGap,
    sectionEntryGap: style.sectionEntryGap,
    entryGap: style.entryGap,
    titleSubGap: style.titleSubGap,
    headBulletGap: style.headBulletGap,
    skillsRowGap: style.skillsRowGap,
    bulletGap: style.bulletGap
  };
}

function loadCustom(): DocSpacingPreset | null {
  try {
    const raw = window.localStorage.getItem(CUSTOM_STORAGE_KEY);
    if (!raw) return null;
    // Reuse coerce() so a partial/corrupt blob is clamped and back-filled before
    // we lift the spacing fields off it.
    return pickSpacing(coerce(JSON.parse(raw)));
  } catch {
    return null;
  }
}

function load(): DocStyle {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) return coerce(JSON.parse(raw));
    const legacyV2 = window.localStorage.getItem(LEGACY_V2_STORAGE_KEY);
    if (legacyV2) {
      const migrated = coerce(JSON.parse(legacyV2), "v2");
      window.localStorage.removeItem(LEGACY_V2_STORAGE_KEY);
      return migrated;
    }
    const legacy = window.localStorage.getItem(LEGACY_V1_STORAGE_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy) as { zoom?: unknown };
      const oldZoom = typeof parsed.zoom === "number" && Number.isFinite(parsed.zoom) ? parsed.zoom : LEGACY_ZOOM_BASE;
      const migrated = coerce({ ...parsed, zoom: oldZoom / LEGACY_ZOOM_BASE }, "v2");
      window.localStorage.removeItem(LEGACY_V1_STORAGE_KEY);
      return migrated;
    }
    return { ...DOC_STYLE_DEFAULTS };
  } catch {
    return { ...DOC_STYLE_DEFAULTS };
  }
}

export function useDocStyle() {
  const [style, setStyle] = useState<DocStyle>(load);
  const [customPreset, setCustomPreset] = useState<DocSpacingPreset | null>(loadCustom);
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
        "--doc-name-contact-gap": `${style.nameContactGap}em`,
        "--doc-contact-gap": `${style.contactGap}em`,
        "--doc-header-section-gap": `${style.headerSectionGap}em`,
        "--doc-section-gap": `${style.sectionGap}em`,
        "--doc-section-entry-gap": `${style.sectionEntryGap}em`,
        "--doc-entry-gap": `${style.entryGap}em`,
        "--doc-title-sub-gap": `${style.titleSubGap}em`,
        "--doc-head-bullet-gap": `${style.headBulletGap}em`,
        "--doc-skills-row-gap": `${style.skillsRowGap}em`,
        "--doc-bullet-gap": `${style.bulletGap}em`,
        "--doc-title-weight": style.boldTitles ? "700" : "400",
        "--doc-heading-weight": style.boldHeadings ? "700" : "400",
        "--doc-skill-label-weight": style.boldSkillLabels ? "700" : "400",
        "--doc-subtitle-style": style.italicSubtitles ? "italic" : "normal",
        "--doc-heading-variant": style.headingCase === "smallcaps" ? "small-caps" : "normal",
        "--doc-heading-transform": style.headingCase === "uppercase" ? "uppercase" : "none",
        "--doc-rule-width": style.sectionRule ? "1px" : "0",
        // Quoted so it drops straight into CSS `content`; JSON.stringify escapes
        // any stray quote in a custom divider. An emptied custom field falls back
        // to "|" so the live preview and the PDF export stay in agreement.
        "--doc-contact-divider": JSON.stringify(style.contactDivider || "|")
      }) as CSSProperties,
    [style]
  );

  function set<K extends keyof DocStyle>(key: K, value: DocStyle[K]) {
    setStyle((current) => ({ ...current, [key]: value }));
  }

  function reset() {
    setStyle({ ...DOC_STYLE_DEFAULTS });
  }

  // Single merge-into-state helper so the two typed entry points below can't
  // drift in merge semantics (e.g. if coercion is added later).
  function merge(partial: Partial<DocStyle>) {
    setStyle((current) => ({ ...current, ...partial }));
  }

  // Apply a full spacing preset (the Format menu's Normal/Compact/Custom buttons).
  function applySpacingPreset(preset: DocSpacingPreset) {
    merge(preset);
  }

  // Apply a partial set of fields at once (e.g. the Style menu's "Jake's
  // defaults" button), leaving everything else — including spacing — untouched.
  function applyStyle(partial: Partial<DocStyle>) {
    merge(partial);
  }

  // Snapshot the current spacing as the user's Custom preset (persisted).
  function saveCustomPreset() {
    const snapshot = pickSpacing(style);
    setCustomPreset(snapshot);
    try {
      window.localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      // Storage unavailable (private mode); the preset still applies this session.
    }
  }

  const isDefault = useMemo(
    () => JSON.stringify(style) === JSON.stringify(DOC_STYLE_DEFAULTS),
    [style]
  );

  return { style, set, reset, applySpacingPreset, applyStyle, saveCustomPreset, customPreset, isDefault, cssVars };
}

export type DocStyleControls = ReturnType<typeof useDocStyle>;
