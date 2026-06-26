import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

// Section-heading letter case — one mutually-exclusive choice (small caps, as in
// Jake's \scshape; full ALL CAPS; or plain Title Case), so it's a segmented pick.
export type HeadingCase = "smallcaps" | "uppercase" | "none";

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
  italicSubtitles: boolean; // subtitle + location/date rows
  headingCase: HeadingCase; // section-heading letter case (small caps / uppercase / normal)
  sectionRule: boolean; // the horizontal rule under each section heading
  contactDivider: string; // 1–2 char separator between header contact items
};

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
  // Small caps by default → matches the Jake template's \scshape headings.
  headingCase: "smallcaps",
  sectionRule: true,
  contactDivider: "|"
};

// The non-spacing "style" fields the Typography panel owns. Lifted as a type so
// the "Jake's defaults" reset and applyStyle() stay in sync with the controls.
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

// The authentic upstream Jake's-Resume look for the style fields — applied by the
// Typography panel's "Jake's defaults" reset. Spacing/zoom are left untouched.
export const JAKE_STYLE_DEFAULTS: DocStyleFields = {
  boldTitles: DOC_STYLE_DEFAULTS.boldTitles,
  boldHeadings: DOC_STYLE_DEFAULTS.boldHeadings,
  boldSkillLabels: DOC_STYLE_DEFAULTS.boldSkillLabels,
  italicSubtitles: DOC_STYLE_DEFAULTS.italicSubtitles,
  headingCase: DOC_STYLE_DEFAULTS.headingCase,
  sectionRule: DOC_STYLE_DEFAULTS.sectionRule,
  contactDivider: DOC_STYLE_DEFAULTS.contactDivider
};

// Single source of truth for the spacing fields that make up a preset (the
// sliders, the built-in presets, and the saved Custom snapshot). The key type
// and the runtime list derive from this one array so they can't drift.
export const DOC_SPACING_KEYS = [
  "lineHeight",
  "nameContactGap",
  "contactGap",
  "headerSectionGap",
  "sectionGap",
  "sectionEntryGap",
  "entryGap",
  "titleSubGap",
  "headBulletGap",
  "skillsRowGap",
  "bulletGap"
] as const satisfies readonly (keyof DocStyle)[];

export type DocSpacingKey = (typeof DOC_SPACING_KEYS)[number];

export type DocSpacingPreset = Pick<DocStyle, DocSpacingKey>;

export const DOC_SPACING_PRESETS = {
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
  },
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
  relaxed: {
    label: "Relaxed",
    values: {
      lineHeight: 1.3,
      nameContactGap: 0.06,
      contactGap: 2.1,
      headerSectionGap: 1.5,
      sectionGap: 1.15,
      sectionEntryGap: 0.6,
      entryGap: 0.62,
      titleSubGap: 0.1,
      headBulletGap: 0.62,
      skillsRowGap: 0.1,
      bulletGap: 0.34
    }
  }
} as const satisfies Record<string, { label: string; values: DocSpacingPreset }>;

// Google-Docs-style zoom steps for the Resume tab's page-zoom select.
export const DOC_ZOOM_OPTIONS = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5] as const;

const STORAGE_KEY = "jakeforge.docStyle.v2";
// User-saved spacing preset (the 11 spacing sliders only, like the built-in
// presets). Stored separately so it survives Reset and live edits.
const CUSTOM_STORAGE_KEY = "jakeforge.docStyle.custom.v1";
// v1 had one `entryGap` slider wired to the entry-header -> bullets gap in both
// CSS and LaTeX (and one `sectionGap` that doubled as the header->section gap).
// Migrate that value to `headBulletGap`; the new `entryGap` starts at the
// calibrated entry-to-entry default and `headerSectionGap` from sectionGap+0.34.
const LEGACY_V1_STORAGE_KEY = "jakeforge.docStyle.v1";

const clamp = (value: unknown, fallback: number, min: number, max: number) => {
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
};

function coerce(raw: unknown, legacyMode: "current" | "v1" = "current"): DocStyle {
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
      legacyMode === "v1" ? legacySectionGap + 0.34 : DOC_STYLE_DEFAULTS.headerSectionGap,
      0,
      2.4
    ),
    sectionGap: legacySectionGap,
    sectionEntryGap: clamp(r.sectionEntryGap, DOC_STYLE_DEFAULTS.sectionEntryGap, 0, 1.2),
    entryGap: legacyMode === "v1" ? DOC_STYLE_DEFAULTS.entryGap : legacyEntryGap,
    titleSubGap: clamp(r.titleSubGap, DOC_STYLE_DEFAULTS.titleSubGap, 0, 0.6),
    headBulletGap: clamp(
      r.headBulletGap,
      legacyMode === "v1" ? legacyEntryGap : DOC_STYLE_DEFAULTS.headBulletGap,
      0,
      1.4
    ),
    skillsRowGap: clamp(r.skillsRowGap, DOC_STYLE_DEFAULTS.skillsRowGap, 0, 0.8),
    bulletGap: clamp(r.bulletGap, DOC_STYLE_DEFAULTS.bulletGap, 0, 1.2),
    boldTitles: r.boldTitles !== false,
    boldHeadings: r.boldHeadings === true,
    boldSkillLabels: r.boldSkillLabels !== false,
    italicSubtitles: r.italicSubtitles !== false,
    // headingCase replaced the old `uppercaseHeadings` boolean: a stored `true`
    // migrates to "uppercase"; anything else (including the old `false`) falls to
    // the small-caps default.
    headingCase:
      r.headingCase === "uppercase" || r.headingCase === "none"
        ? r.headingCase
        : (r as Record<string, unknown>).uppercaseHeadings === true
          ? "uppercase"
          : DOC_STYLE_DEFAULTS.headingCase,
    sectionRule: r.sectionRule !== false,
    // Cap at 2 chars; fall back to "|" when missing (not when intentionally blank).
    contactDivider: typeof r.contactDivider === "string" ? r.contactDivider.slice(0, 2) : DOC_STYLE_DEFAULTS.contactDivider
  };
}

// The spacing fields that make up a preset, lifted off a full DocStyle.
function pickSpacing(style: DocStyle): DocSpacingPreset {
  return Object.fromEntries(DOC_SPACING_KEYS.map((k) => [k, style[k]])) as DocSpacingPreset;
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
    const legacy = window.localStorage.getItem(LEGACY_V1_STORAGE_KEY);
    if (legacy) {
      const migrated = coerce(JSON.parse(legacy), "v1");
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
        // Heading case: small-caps via font-variant, ALL CAPS via text-transform,
        // "none" leaves the stored Title Case untouched.
        "--doc-heading-variant": style.headingCase === "smallcaps" ? "small-caps" : "normal",
        "--doc-heading-transform": style.headingCase === "uppercase" ? "uppercase" : "none",
        "--doc-rule-width": style.sectionRule ? "1px" : "0",
        // Quoted so it's a valid CSS `content` <string> token.
        "--doc-contact-divider": JSON.stringify(style.contactDivider)
      }) as CSSProperties,
    [style]
  );

  function set<K extends keyof DocStyle>(key: K, value: DocStyle[K]) {
    setStyle((current) => ({ ...current, [key]: value }));
  }

  // Apply a partial set of style fields at once (e.g. the Typography panel's
  // "Jake's defaults" reset), leaving spacing and zoom untouched.
  function applyStyle(partial: Partial<DocStyle>) {
    setStyle((current) => ({ ...current, ...partial }));
  }

  function applySpacingPreset(preset: DocSpacingPreset) {
    setStyle((current) => ({ ...current, ...preset }));
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

  const isStyleDefault = useMemo(
    () => (Object.keys(JAKE_STYLE_DEFAULTS) as (keyof DocStyleFields)[]).every((k) => style[k] === JAKE_STYLE_DEFAULTS[k]),
    [style]
  );

  return {
    style,
    set,
    applyStyle,
    applySpacingPreset,
    saveCustomPreset,
    customPreset,
    isStyleDefault,
    cssVars
  };
}

export type DocStyleControls = ReturnType<typeof useDocStyle>;
