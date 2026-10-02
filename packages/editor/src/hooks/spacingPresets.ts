import {
  coerceDocStyle,
  pickDocSpacing,
  type DocSpacingPreset
} from "@typeset/engine/lib/documentStyle.ts";

// User-saved document spacing presets. Built-in presets stay fixed in the
// engine; these are local preferences and never enter `.resume` files.
export type SavedSpacingPreset = {
  id: string;
  name: string;
  values: DocSpacingPreset;
};

export const MAX_SAVED_SPACING_PRESETS = 8;
export const MAX_SPACING_PRESET_NAME_LENGTH = 32;

export function normalizeSpacingPresetName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, MAX_SPACING_PRESET_NAME_LENGTH).trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Drops malformed entries and duplicate ids rather than discarding the list.
export function parseSavedSpacingPresets(raw: unknown): SavedSpacingPreset[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const presets: SavedSpacingPreset[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry.id !== "string" || !entry.id) continue;
    if (typeof entry.name !== "string" || !isRecord(entry.values)) continue;
    const name = normalizeSpacingPresetName(entry.name);
    if (!name || seen.has(entry.id)) continue;
    seen.add(entry.id);
    presets.push({ id: entry.id, name, values: pickDocSpacing(coerceDocStyle(entry.values)) });
    if (presets.length === MAX_SAVED_SPACING_PRESETS) break;
  }
  return presets;
}

// The stored list wins whenever its key exists, even empty; otherwise the
// former single "Custom" preset migrates in. Throws on corrupt JSON.
export function loadSavedSpacingPresets(
  storedList: string | null,
  legacyCustom: string | null
): SavedSpacingPreset[] {
  if (storedList !== null) return parseSavedSpacingPresets(JSON.parse(storedList));
  if (!legacyCustom) return [];
  return [{ id: "custom", name: "Custom", values: pickDocSpacing(coerceDocStyle(JSON.parse(legacyCustom))) }];
}

export function nextSpacingPresetName(presets: readonly SavedSpacingPreset[]): string {
  const taken = new Set(presets.map((preset) => preset.name.toLowerCase()));
  let index = 1;
  while (taken.has(`custom ${index}`)) index += 1;
  return `Custom ${index}`;
}

export function addSpacingPreset(
  presets: readonly SavedSpacingPreset[],
  preset: SavedSpacingPreset
): SavedSpacingPreset[] {
  if (presets.length >= MAX_SAVED_SPACING_PRESETS) return [...presets];
  return [...presets, preset];
}

export function updateSpacingPresetValues(
  presets: readonly SavedSpacingPreset[],
  id: string,
  values: DocSpacingPreset
): SavedSpacingPreset[] {
  return presets.map((preset) => (preset.id === id ? { ...preset, values: { ...values } } : preset));
}

// An empty name keeps the existing one.
export function renameSpacingPreset(
  presets: readonly SavedSpacingPreset[],
  id: string,
  name: string
): SavedSpacingPreset[] {
  const next = normalizeSpacingPresetName(name);
  if (!next) return [...presets];
  return presets.map((preset) => (preset.id === id ? { ...preset, name: next } : preset));
}

export function removeSpacingPreset(
  presets: readonly SavedSpacingPreset[],
  id: string
): SavedSpacingPreset[] {
  return presets.filter((preset) => preset.id !== id);
}
