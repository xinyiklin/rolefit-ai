import {
  PACKED_FONT_METRICS_LOADERS,
  type FaceName,
  type MetricFamilyId,
  type PackedFaceMetrics,
  type PackedFamilyMetrics
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
  // Characters the face draws but leaves unmeasured (mark-class glyphs).
  unmeasured: string;
};

// Families whose packed tables have arrived; each family is one lazy module.
const packedFamilies = new Map<MetricFamilyId, PackedFamilyMetrics>();
const familyLoads = new Map<MetricFamilyId, Promise<void>>();
const unpacked = new Map<PackedFaceMetrics, FaceMetrics>();

export function fontMetricsLoaded(family: MetricFamilyId): boolean {
  return packedFamilies.has(family);
}

// Fetches each family's tables once; a failed fetch is retried on the next call.
export function loadFontMetrics(families: Iterable<MetricFamilyId>): Promise<void> {
  const loads: Promise<void>[] = [];
  for (const family of new Set(families)) {
    if (packedFamilies.has(family)) continue;
    let load = familyLoads.get(family);
    if (!load) {
      load = PACKED_FONT_METRICS_LOADERS[family]()
        .then((module) => {
          packedFamilies.set(family, module.PACKED_FAMILY_METRICS);
        })
        .catch((cause: unknown) => {
          // The raw import failure names a chunk URL; users see the family.
          throw Object.assign(new Error(`The ${family} font metrics could not be loaded.`), { cause });
        })
        .finally(() => {
          familyLoads.delete(family);
        });
      familyLoads.set(family, load);
    }
    loads.push(load);
  }
  return Promise.all(loads).then(() => undefined);
}

// Unpacks one face on first use, so a document pays only for the faces it
// measures. Aliased faces resolve to, and share, their source face's record.
export function faceMetrics(family: MetricFamilyId, face: FaceName): FaceMetrics {
  const packedFamily = packedFamilies.get(family);
  if (!packedFamily) {
    throw new Error(`The ${family} font metrics are not loaded; await ensureFontMetrics before measuring.`);
  }
  const entry = packedFamily[face];
  const packed = typeof entry === "string" ? packedFamily[entry] : entry;
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
    bbox,
    unmeasured: packed.unmeasured ?? ""
  };
  unpacked.set(packed, metrics);
  return metrics;
}
