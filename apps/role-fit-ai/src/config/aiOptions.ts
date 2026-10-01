export {
  cliReasoningEffortOptionsByProvider,
  cliReasoningEffortOptionsFor,
  defaultCliReasoningEffort
} from "../../shared/cliReasoning.ts";

import {
  ANTIGRAVITY_MODEL_OPTIONS,
  DEFAULT_ANTIGRAVITY_MODEL
} from "../../shared/antigravityModels.ts";

// Shared AI option types and provider tables live together so the UI and
// settings normalization use one catalog.
export type AiProviderValue =
  | "openai"
  | "anthropic"
  | "claude-cli"
  | "codex-cli"
  | "antigravity-cli";

export type ProviderOption = {
  readonly value: AiProviderValue;
  readonly label: string;
  readonly model: string;
};

// `group` is optional: options that carry one render inside a `<optgroup>` of
// that label (mirroring the Claude Code app's "More models" submenu); options
// without a group render as bare `<option>`s. See groupModelOptions below.
export type ModelOption = { value: string; label: string; group?: string };

// Ordered segments for rendering a model list: a bare option, or a labeled group
// of contiguous options sharing the same `group`. Keeps optgroup-building logic
// in one place so every model `<select>` renders groups identically.
export type ModelOptionSegment =
  | { type: "option"; option: ModelOption }
  | { type: "group"; label: string; options: ModelOption[] };

export function groupModelOptions(options: readonly ModelOption[]): ModelOptionSegment[] {
  const segments: ModelOptionSegment[] = [];
  for (const option of options) {
    if (!option.group) {
      segments.push({ type: "option", option });
      continue;
    }
    const last = segments[segments.length - 1];
    if (last && last.type === "group" && last.label === option.group) {
      last.options.push(option);
    } else {
      segments.push({ type: "group", label: option.group, options: [option] });
    }
  }
  return segments;
}

export const providerOptions: readonly ProviderOption[] = [
  { value: "claude-cli", label: "Claude · CLI", model: "claude-sonnet-5-5" },
  { value: "codex-cli", label: "Codex · CLI", model: "gpt-6.1-sol" },
  { value: "antigravity-cli", label: "Antigravity · CLI", model: DEFAULT_ANTIGRAVITY_MODEL },
  { value: "openai", label: "OpenAI · API", model: "gpt-5.6-terra" },
  { value: "anthropic", label: "Claude · API", model: "claude-sonnet-5-5" }
];

export const modelOptionsByProvider: Record<AiProviderValue, readonly ModelOption[]> = {
  openai: [
    { value: "gpt-6-astra", label: "GPT-6 Astra" },
    { value: "gpt-6.1-sol", label: "GPT-6.1 Sol" },
    { value: "gpt-6-sol", label: "GPT-6 Sol" },
    { value: "gpt-6-luna", label: "GPT-6 Luna" },
    { value: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
    { value: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
    { value: "gpt-5.6-luna", label: "GPT-5.6 Luna" }
  ],
  anthropic: [
    { value: "claude-fable-5-1", label: "Claude Fable 5.1" },
    { value: "claude-opus-5-5", label: "Claude Opus 5.5" },
    { value: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
    { value: "claude-fable-5", label: "Claude Fable 5" },
    { value: "claude-opus-5", label: "Claude Opus 5" },
    { value: "claude-sonnet-5", label: "Claude Sonnet 5" },
    { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
    { value: "claude-opus-4-8", label: "Claude Opus 4.8" }
  ],
  // Current and still-supported Claude Code ids; account access can vary.
  "claude-cli": [
    { value: "claude-fable-5-1", label: "Fable 5.1" },
    { value: "claude-opus-5-5", label: "Opus 5.5" },
    { value: "claude-sonnet-5-5", label: "Sonnet 5.5" },
    { value: "claude-fable-5", label: "Fable 5" },
    { value: "claude-sonnet-5", label: "Sonnet 5" },
    { value: "claude-sonnet-4-6", label: "Sonnet 4.6" },
    { value: "claude-opus-5", label: "Opus 5" },
    { value: "claude-opus-4-8", label: "Opus 4.8" },
    { value: "claude-opus-4-7", label: "Opus 4.7" },
    { value: "claude-opus-4-6", label: "Opus 4.6" },
    { value: "claude-haiku-4-5", label: "Haiku 4.5" }
  ],
  // Visible models in the provider catalog dated 2026-09-30 (client 0.159.0).
  "codex-cli": [
    { value: "gpt-6-astra", label: "GPT-6 Astra" },
    { value: "gpt-6.1-sol", label: "GPT-6.1 Sol" },
    { value: "gpt-6-sol", label: "GPT-6 Sol" },
    { value: "gpt-6-luna", label: "GPT-6 Luna" },
    { value: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
    { value: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
    { value: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
    { value: "gpt-5.5", label: "GPT-5.5 (retires Oct 14, 2026)" }
  ],
  // Full list from `agy models` on 1.1.11. Version 1.1.5 made the stable slugs
  // accepted by `--model`; the shared catalog keeps those request values paired
  // with the display names shown in Settings.
  "antigravity-cli": ANTIGRAVITY_MODEL_OPTIONS
};

// Friendly display label for a provider value (falls back to the raw value).
export function providerLabel(value: string): string {
  return providerOptions.find((option) => option.value === value)?.label ?? value;
}

// Provider attribution string for status lines, e.g.
// "Codex · CLI (gpt-5.6-sol)". The model is in parens (provider labels already
// contain "·") and omitted when blank (e.g. an empty custom model id).
export function describeProviderModel(provider: string, model: string): string {
  const label = providerLabel(provider);
  return model ? `${label} (${model})` : label;
}
