// Presets are editor shortcuts only. Portable files and layout persist/consume
// the four physical point values, never this UI selection.
export type PageMargins = "narrow" | "normal" | "custom";

export const PAGE_MARGIN_PRESETS_PT = {
  narrow: 0.5 * 72,
  normal: 1 * 72
} as const;

export const PAGE_MARGIN_BOUNDS_PT = {
  min: 0.25 * 72,
  max: 3 * 72,
  step: 0.05 * 72
} as const;

export type PageMarginValues = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export function presetPageMarginPt(value: unknown): number {
  return value === "narrow"
    ? PAGE_MARGIN_PRESETS_PT[value]
    : PAGE_MARGIN_PRESETS_PT.normal;
}

function boundedMargin(value: unknown, fallback: number) {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(PAGE_MARGIN_BOUNDS_PT.max, Math.max(PAGE_MARGIN_BOUNDS_PT.min, numeric));
}

export function pageMarginValuesFor(
  pageMargins: unknown,
  custom: Partial<PageMarginValues> & { uniform?: unknown } = {}
): PageMarginValues {
  const preset = presetPageMarginPt(pageMargins);
  if (pageMargins !== "custom") return { top: preset, right: preset, bottom: preset, left: preset };
  const uniform = boundedMargin(custom.uniform, PAGE_MARGIN_PRESETS_PT.normal);
  return {
    top: boundedMargin(custom.top, uniform),
    right: boundedMargin(custom.right, uniform),
    bottom: boundedMargin(custom.bottom, uniform),
    left: boundedMargin(custom.left, uniform)
  };
}

export function pageMarginsForValues(values: PageMarginValues): PageMargins {
  const matches = (value: number) =>
    values.top === value
    && values.right === value
    && values.bottom === value
    && values.left === value;
  if (matches(PAGE_MARGIN_PRESETS_PT.narrow)) return "narrow";
  if (matches(PAGE_MARGIN_PRESETS_PT.normal)) return "normal";
  return "custom";
}
