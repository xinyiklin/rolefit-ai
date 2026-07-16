export type PageMargins = "narrow" | "normal" | "wide" | "custom";

export const PAGE_MARGIN_PRESETS_PT = {
  narrow: 0.4 * 72,
  normal: 0.5 * 72,
  wide: 0.75 * 72
} as const;

export const PAGE_MARGIN_BOUNDS_PT = {
  min: 0.25 * 72,
  max: 1.5 * 72,
  step: 0.05 * 72
} as const;

export type PageMarginValues = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export function presetPageMarginPt(value: unknown): number {
  return value === "narrow" || value === "wide"
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
