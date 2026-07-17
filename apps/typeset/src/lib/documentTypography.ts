// Shared document type scale. This is domain math used by formatting controls
// and the deterministic engine, so it lives below both UI and rendering layers.

import type { NameSize } from "./documentStyle.ts";

const FONT_SIZE_RATIOS = {
  tiny: 0.59992,
  small: 1,
  normalsize: 1.094951,
  large: 1.19994,
  Large: 1.727893,
  LARGE: 2.073974,
  Huge: 2.487905
} as const;

export type FontSizeScale = { [K in keyof typeof FONT_SIZE_RATIOS]: number };

// `small` is the user-selected body size. Display roles round to whole points
// so controls show stable 11/12/25-style values instead of ratio artifacts.
export function fontSizesFor(baseFontSizePt: number): FontSizeScale {
  return Object.fromEntries(
    Object.entries(FONT_SIZE_RATIOS).map(([key, ratio]) => {
      const size = baseFontSizePt * ratio;
      return [key, key === "small" ? size : Math.round(size)];
    })
  ) as FontSizeScale;
}

// The display size the resume name renders at for a nameSize style. One truth
// shared by the layout engine and the editor's caret-format fallbacks.
export function nameSizePt(sizes: FontSizeScale, nameSize: NameSize): number {
  return nameSize === "large" ? sizes.Large : nameSize === "xlarge" ? sizes.LARGE : sizes.Huge;
}
