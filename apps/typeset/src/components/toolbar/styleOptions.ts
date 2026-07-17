import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  type LucideIcon
} from "lucide-react";

import {
  DOC_STYLE_BOUNDS,
  DOC_SPACING_KEYS,
  DOC_SPACING_PRESETS,
  type BodyAlign,
  type DocSpacingKey,
  type DocSpacingPreset,
  type DocStyle,
  type HeadingCase
} from "@typeset/engine/lib/documentStyle";
import type { DocStyleControls } from "../../hooks/useDocStyle";

export type AlignmentOption = {
  value: BodyAlign;
  label: string;
  Icon: LucideIcon;
};

// One icon/label row per alignment, shared by the toolbar's inline alignment
// group and the Paragraph popover's global pickers.
export const ALIGNMENT_OPTIONS: readonly AlignmentOption[] = [
  { value: "left", label: "Left", Icon: AlignLeft },
  { value: "center", label: "Center", Icon: AlignCenter },
  { value: "right", label: "Right", Icon: AlignRight },
  { value: "justify", label: "Justify", Icon: AlignJustify }
];

// Header and heading scopes cannot justify.
export const NON_JUSTIFIED_ALIGNMENT_OPTIONS = ALIGNMENT_OPTIONS.filter(
  (option) => option.value !== "justify"
);

export type SpacingControl = {
  key: DocSpacingKey;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
};

export type SpacingControlGroup = {
  label: string;
  controls: SpacingControl[];
};

function pointControl(key: DocSpacingKey, label: string): SpacingControl {
  return {
    key,
    label,
    min: DOC_STYLE_BOUNDS[key].min,
    max: DOC_STYLE_BOUNDS[key].max,
    step: DOC_STYLE_BOUNDS[key].step,
    unit: " pt"
  };
}

export const SPACING_CONTROL_GROUPS: SpacingControlGroup[] = [
  {
    label: "Header",
    controls: [
      pointControl("nameContactGapPt", "Name to contact"),
      // Horizontal slot width between contact items (not a vertical line gap):
      // the label says so to set it apart from the surrounding vertical gaps.
      pointControl("contactGapPt", "Contact spacing"),
      pointControl("headerSectionGapPt", "Header to section")
    ]
  },
  {
    label: "Sections",
    controls: [
      pointControl("sectionGapPt", "Section gap"),
      pointControl("sectionEntryGapPt", "Heading to entry")
    ]
  },
  {
    label: "Entries",
    controls: [
      pointControl("entryGapPt", "Entry gap"),
      pointControl("titleSubGapPt", "Title to subtitle"),
      pointControl("headBulletGapPt", "Entry to bullets")
    ]
  },
  {
    label: "Lists",
    controls: [
      pointControl("bulletGapPt", "Bullet gap"),
      pointControl("skillsRowGapPt", "Skill row gap")
    ]
  }
];

export const HEADING_CASE_OPTIONS: { value: HeadingCase; label: string }[] = [
  { value: "smallcaps", label: "Small caps" },
  { value: "uppercase", label: "Uppercase" },
  { value: "none", label: "Natural" }
];

export const CONTACT_DIVIDERS = ["|", "•", "·", "–", "/"];

export function spacingMatches(style: DocStyle, values: DocSpacingPreset) {
  return DOC_SPACING_KEYS.every((key) => Math.abs(style[key] - values[key]) < 0.005);
}

export function activeSpacingPresetId(docStyle: DocStyleControls): string | null {
  const builtIn = Object.entries(DOC_SPACING_PRESETS).find(([, preset]) =>
    spacingMatches(docStyle.style, preset.values)
  )?.[0];
  if (builtIn) return builtIn;
  if (docStyle.customPreset && spacingMatches(docStyle.style, docStyle.customPreset)) return "custom";
  return null;
}

export function spacingPresetOptions() {
  return [
    ...Object.entries(DOC_SPACING_PRESETS).map(([value, preset]) => ({ value, label: preset.label })),
    { value: "custom", label: "Custom" }
  ];
}

export function applySpacingPreset(docStyle: DocStyleControls, presetId: string) {
  if (presetId === "custom") {
    if (docStyle.customPreset) docStyle.applyStyle(docStyle.customPreset);
    return;
  }
  const preset = DOC_SPACING_PRESETS[presetId as keyof typeof DOC_SPACING_PRESETS];
  if (preset) docStyle.applyStyle(preset.values);
}
