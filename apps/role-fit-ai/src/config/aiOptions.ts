export {
  cliReasoningEffortOptionsByProvider,
  cliReasoningEffortOptionsFor,
  defaultCliReasoningEffort
} from "../../shared/cliReasoning.ts";

// Shared AI option types and provider tables live together so the UI and
// settings normalization use one catalog.
export type AiProviderValue =
  | "openai"
  | "anthropic"
  | "claude-cli"
  | "codex-cli";

export type ProviderOption = {
  readonly value: AiProviderValue;
  readonly label: string;
  readonly model: string;
  readonly vendor: AiVendor;
  readonly transport: AiTransport;
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

export type AiVendor = "claude" | "openai";
export type AiTransport = "cli" | "api";

export const providerOptions: readonly ProviderOption[] = [
  { value: "claude-cli", label: "Claude · CLI", model: "claude-sonnet-5-5", vendor: "claude", transport: "cli" },
  { value: "anthropic", label: "Claude · API", model: "claude-sonnet-5-5", vendor: "claude", transport: "api" },
  { value: "codex-cli", label: "OpenAI · CLI", model: "gpt-6.1-sol", vendor: "openai", transport: "cli" },
  { value: "openai", label: "OpenAI · API", model: "gpt-6.1-sol", vendor: "openai", transport: "api" }
];

export const vendorLabels: Readonly<Record<AiVendor, string>> = { claude: "Claude", openai: "OpenAI" };

export function providerFor(vendor: AiVendor, transport: AiTransport): AiProviderValue {
  return providerOptions.find((option) => option.vendor === vendor && option.transport === transport)!.value;
}

export function providerOption(provider: string): ProviderOption | undefined {
  return providerOptions.find((option) => option.value === provider);
}

// A vendor's CLI and API serve the same current models (checked 2026-10-18
// against the Claude and OpenAI model lists and Codex catalog 0.159.2).
const CLAUDE_MODELS: readonly ModelOption[] = [
  { value: "claude-fable-5-1", label: "Fable 5.1" },
  { value: "claude-opus-5-5", label: "Opus 5.5" },
  { value: "claude-sonnet-5-5", label: "Sonnet 5.5" },
  { value: "claude-haiku-5-5", label: "Haiku 5.5" }
];
const OPENAI_MODELS: readonly ModelOption[] = [
  { value: "gpt-6-astra", label: "GPT-6 Astra" },
  { value: "gpt-6.1-sol", label: "GPT-6.1 Sol" },
  { value: "gpt-6-luna", label: "GPT-6 Luna" }
];

export const modelOptionsByProvider: Record<AiProviderValue, readonly ModelOption[]> = {
  "claude-cli": CLAUDE_MODELS,
  anthropic: CLAUDE_MODELS,
  "codex-cli": OPENAI_MODELS,
  openai: OPENAI_MODELS
};

// Removed model ids and their same-tier successor. Saved settings, workspace
// preferences, and backups repair through this map before strict validation.
export const retiredModelSuccessors: Readonly<Record<string, string>> = {
  "claude-fable-5": "claude-fable-5-1",
  "claude-opus-5": "claude-opus-5-5",
  "claude-opus-4-8": "claude-opus-5-5",
  "claude-opus-4-7": "claude-opus-5-5",
  "claude-opus-4-6": "claude-opus-5-5",
  "claude-sonnet-5": "claude-sonnet-5-5",
  "claude-sonnet-4-6": "claude-sonnet-5-5",
  "claude-haiku-4-5": "claude-haiku-5-5",
  "claude-haiku-4-5-20251001": "claude-haiku-5-5",
  "gpt-6-sol": "gpt-6.1-sol",
  "gpt-5.6-sol": "gpt-6.1-sol",
  "gpt-5.6-terra": "gpt-6.1-sol",
  "gpt-5.6-luna": "gpt-6-luna",
  "gpt-5.5": "gpt-6.1-sol",
  "gpt-5.4": "gpt-6.1-sol",
  "gpt-5.4-mini": "gpt-6.1-sol",
  "gpt-5.3-codex-spark": "gpt-6.1-sol"
};

// Friendly display label for a provider value (falls back to the raw value).
export function providerLabel(value: string): string {
  return providerOptions.find((option) => option.value === value)?.label ?? value;
}

// Provider attribution string for status lines, e.g.
// "OpenAI · CLI (gpt-6.1-sol)". The model is in parens (provider labels already
// contain "·") and omitted when blank (e.g. an empty custom model id).
export function describeProviderModel(provider: string, model: string): string {
  const label = providerLabel(provider);
  return model ? `${label} (${model})` : label;
}
