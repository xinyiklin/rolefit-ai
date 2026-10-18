import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  type LucideIcon
} from "lucide-react";

import {
  DOC_STYLE_BOUNDS,
  DOC_SPACING_PRESETS,
  type BodyAlign,
  type DocSpacingKey,
  type DocSpacingPreset,
  type DocStyle,
  type HeadingCase
} from "@typeset/engine/lib/documentStyle.ts";

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

function spacingControl(key: DocSpacingKey, label: string, unit = "pt"): SpacingControl {
  return {
    key,
    label,
    min: DOC_STYLE_BOUNDS[key].min,
    max: DOC_STYLE_BOUNDS[key].max,
    step: DOC_STYLE_BOUNDS[key].step,
    unit
  };
}

const LINE_SPACING_GROUP: SpacingControlGroup = {
  label: "Lines",
  controls: [spacingControl("lineHeight", "Line spacing", "")]
};

// The header's own gaps, shared by the resume and letter Spacing menus; each
// names the last gap for what follows the header in that document.
const headerSpacingGroup = (headerToBodyLabel: string): SpacingControlGroup => ({
  label: "Header",
  controls: [
    spacingControl("nameContactGapPt", "Name to contact"),
    // Horizontal slot width between contact items (not a vertical line gap):
    // the label says so to set it apart from the surrounding vertical gaps.
    spacingControl("contactGapPt", "Contact spacing"),
    spacingControl("headerSectionGapPt", headerToBodyLabel)
  ]
});

// Shared so every popover prints a value the same way.
export const formatSpacingValue = (value: number, unit: string) =>
  `${value.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")}${unit}`;

// A letter has a header and prose only, so its Spacing menu offers the line
// spacing and header gaps its layout reads. Its line spacing is the default
// under the selection-scoped Line spacing menu, which overrides it per line.
export const LETTER_SPACING_CONTROL_GROUPS: SpacingControlGroup[] = [
  { label: "Lines", controls: [spacingControl("lineHeight", "Default line spacing", "")] },
  headerSpacingGroup("Header to body")
];

export const SPACING_CONTROL_GROUPS: SpacingControlGroup[] = [
  LINE_SPACING_GROUP,
  headerSpacingGroup("Header to section"),
  {
    label: "Sections",
    controls: [
      spacingControl("sectionGapPt", "Section gap"),
      spacingControl("sectionEntryGapPt", "Heading to entry")
    ]
  },
  {
    label: "Entries",
    controls: [
      spacingControl("entryGapPt", "Entry gap"),
      spacingControl("titleSubGapPt", "Title to subtitle"),
      spacingControl("headBulletGapPt", "Entry to bullets")
    ]
  },
  {
    label: "Lists",
    controls: [
      spacingControl("bulletGapPt", "Bullet gap"),
      spacingControl("skillsRowGapPt", "Skill row gap")
    ]
  }
];

export const HEADING_CASE_OPTIONS: { value: HeadingCase; label: string }[] = [
  { value: "smallcaps", label: "Small caps" },
  { value: "uppercase", label: "Uppercase" },
  { value: "none", label: "Natural" }
];

export const CONTACT_DIVIDERS = ["|", "•", "·", "–", "/"];

export const spacingKeysOf = (groups: readonly SpacingControlGroup[]): DocSpacingKey[] =>
  groups.flatMap((group) => group.controls.map((control) => control.key));

// A preset is matched and applied only over the keys a menu shows, so a letter
// takes a preset's line spacing and header gaps and nothing a letter ignores.
export function spacingMatches(style: DocStyle, values: DocSpacingPreset, keys: readonly DocSpacingKey[]) {
  return keys.every((key) => Math.abs(style[key] - values[key]) < 0.005);
}

export const pickSpacing = (values: DocSpacingPreset, keys: readonly DocSpacingKey[]): Partial<DocStyle> =>
  Object.fromEntries(keys.map((key) => [key, values[key]]));

export type BuiltInSpacingPresetId = keyof typeof DOC_SPACING_PRESETS;

export const BUILT_IN_SPACING_PRESET_OPTIONS = (
  Object.entries(DOC_SPACING_PRESETS) as [BuiltInSpacingPresetId, { label: string }][]
).map(([value, preset]) => ({ value, label: preset.label }));
