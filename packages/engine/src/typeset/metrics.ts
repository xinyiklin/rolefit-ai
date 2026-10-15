import {
  PACKED_FONT_METRICS,
  type FaceName,
  type MetricFamilyId,
  type PackedFaceMetrics
} from "./metrics.gen.ts";

export type FaceMetrics = {
  ascent: number;
  descent: number;
  capHeight: number;
  xHeight: number;
  adv: Record<string, number>;
  // Plain pairs are keyed by the two characters; pairs touching a ligature
  // are keyed "left|right".
  kern: Record<string, number>;
  lig: Record<string, number>;
  bbox: Record<string, [number, number]>;
};

const unpacked = new Map<PackedFaceMetrics, FaceMetrics>();

// Unpacks one face on first use, so a document pays only for the faces it
// measures. Aliased faces resolve to, and share, their source face's record.
export function faceMetrics(family: MetricFamilyId, face: FaceName): FaceMetrics {
  const entry = PACKED_FONT_METRICS[family][face];
  const packed = typeof entry === "string" ? PACKED_FONT_METRICS[family][entry] : entry;
  if (typeof packed === "string") {
    throw new Error(`Face ${family}/${face} aliases another alias.`);
  }
  const cached = unpacked.get(packed);
  if (cached) return cached;

  const glyphs = [...packed.glyphs];
  const adv: Record<string, number> = {};
  const bbox: Record<string, [number, number]> = {};
  const kern: Record<string, number> = { ...packed.ligatureKern };
  glyphs.forEach((left, i) => {
    adv[left] = packed.adv[i];
    const bounds = packed.bbox[i];
    if (bounds !== 0) bbox[left] = bounds;
    const row = packed.kernLeft[i] * packed.kernColumns;
    glyphs.forEach((right, j) => {
      const value = packed.kern[row + packed.kernRight[j]];
      if (value !== 0) kern[left + right] = value;
    });
  });
  const metrics: FaceMetrics = {
    ascent: packed.ascent,
    descent: packed.descent,
    capHeight: packed.capHeight,
    xHeight: packed.xHeight,
    adv,
    kern,
    lig: packed.lig,
    bbox
  };
  unpacked.set(packed, metrics);
  return metrics;
}
