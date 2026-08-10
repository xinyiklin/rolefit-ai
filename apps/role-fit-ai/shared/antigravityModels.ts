// Antigravity 1.1.5 introduced stable model slugs for `--model`. Keep the
// request values separate from the human-readable labels printed by
// `agy models`: display names were the only values exposed by earlier 1.1.x
// builds, so persisted settings and already-open browser tabs may still send
// them during an upgrade.

export const DEFAULT_ANTIGRAVITY_MODEL = "gemini-3.6-flash-high";

export const ANTIGRAVITY_MODEL_OPTIONS = [
  { value: "gemini-3.6-flash-high", label: "Gemini 3.6 Flash (High)", group: "Gemini" },
  { value: "gemini-3.6-flash-medium", label: "Gemini 3.6 Flash (Medium)", group: "Gemini" },
  { value: "gemini-3.6-flash-low", label: "Gemini 3.6 Flash (Low)", group: "Gemini" },
  { value: "gemini-3.5-flash-high", label: "Gemini 3.5 Flash (High)", group: "Gemini" },
  { value: "gemini-3.5-flash-medium", label: "Gemini 3.5 Flash (Medium)", group: "Gemini" },
  { value: "gemini-3.5-flash-low", label: "Gemini 3.5 Flash (Low)", group: "Gemini" },
  { value: "gemini-3.1-pro-high", label: "Gemini 3.1 Pro (High)", group: "Gemini" },
  { value: "gemini-3.1-pro-low", label: "Gemini 3.1 Pro (Low)", group: "Gemini" },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 (Thinking)", group: "Claude" },
  { value: "claude-opus-4-6-thinking", label: "Claude Opus 4.6 (Thinking)", group: "Claude" },
  { value: "gpt-oss-120b-medium", label: "GPT-OSS 120B (Medium)", group: "GPT-OSS" }
] as const;

const LEGACY_ANTIGRAVITY_MODEL_IDS: ReadonlyMap<string, string> = new Map(
  ANTIGRAVITY_MODEL_OPTIONS.map(({ value, label }) => [label, value] as const)
);

export function normalizeAntigravityModelId(value: string): string {
  return LEGACY_ANTIGRAVITY_MODEL_IDS.get(value) ?? value;
}
