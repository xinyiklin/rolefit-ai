// Pure change detection and rebase for workspace preference writes.

import { normalizeSettings, type PersistedSettings } from "./settings.ts";
import { materializeAiSettings } from "./aiSettingsPersistence.ts";

// Per-stage instructions change entry by entry ("stageCustomInstructions.<stage>"),
// so one stage's edit never carries a stale copy of another stage's text.
const ENTRY_SETTINGS = ["stageCustomInstructions"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function splitKey(key: string): [string, string | null] {
  const dot = key.indexOf(".");
  return dot > 0 && ENTRY_SETTINGS.includes(key.slice(0, dot)) ? [key.slice(0, dot), key.slice(dot + 1)] : [key, null];
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

// Settings compare with the hook's defaults filled in, so an absent key and its
// default value are the same setting.
function withDefaults(settings: PersistedSettings): Record<string, unknown> {
  return { ...settings, ...materializeAiSettings(settings) };
}

function settingKeys(record: Record<string, unknown>): string[] {
  return Object.keys(record).flatMap((key) => ENTRY_SETTINGS.includes(key) && isRecord(record[key])
    ? Object.keys(record[key]).map((entry) => `${key}.${entry}`)
    : [key]);
}

export function readSetting(settings: PersistedSettings, key: string): { present: boolean; value: unknown } {
  const record = settings as Record<string, unknown>;
  const [field, entry] = splitKey(key);
  const container = entry === null ? record : record[field];
  const name = entry ?? field;
  return isRecord(container) && Object.prototype.hasOwnProperty.call(container, name)
    ? { present: true, value: container[name] }
    : { present: false, value: undefined };
}

export function changedSettingKeys(before: PersistedSettings, after: PersistedSettings): string[] {
  const left = withDefaults(before);
  const right = withDefaults(after);
  return [...new Set([...settingKeys(left), ...settingKeys(right)])]
    .filter((key) => !sameSetting(left, right, key));
}

export function sameSetting(left: PersistedSettings, right: PersistedSettings, key: string): boolean {
  return stableJson(readSetting(withDefaults(left), key).value) === stableJson(readSetting(withDefaults(right), key).value);
}

// Applies edits keyed by setting (or setting entry) onto a base record.
export function applySettingEdits(
  base: PersistedSettings,
  edits: Record<string, unknown>,
  removed: Iterable<string>
): PersistedSettings {
  const merged: Record<string, unknown> = { ...base };
  const write = (key: string, present: boolean, value?: unknown) => {
    const [field, entry] = splitKey(key);
    if (entry === null) {
      if (present) merged[field] = value;
      else delete merged[field];
      return;
    }
    const container = { ...(isRecord(merged[field]) ? merged[field] : {}) };
    if (present) container[entry] = value;
    else delete container[entry];
    merged[field] = container;
  };
  for (const key of removed) write(key, false);
  for (const [key, value] of Object.entries(edits)) write(key, true, value);
  return normalizeSettings(merged);
}

// The newer record wins except for the settings this client's user changed.
export function rebaseSettings(
  server: PersistedSettings,
  local: PersistedSettings,
  changedKeys: Iterable<string>
): PersistedSettings {
  const edits: Record<string, unknown> = {};
  const removed: string[] = [];
  for (const key of changedKeys) {
    const { present, value } = readSetting(local, key);
    if (present) edits[key] = value;
    else removed.push(key);
  }
  return applySettingEdits(server, edits, removed);
}
