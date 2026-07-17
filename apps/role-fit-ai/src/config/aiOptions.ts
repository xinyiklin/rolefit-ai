// Shared AI option types (moved here from the former SourcesPane so the
// provider tables and their types live together).
export type AiProviderValue =
  | "openai"
  | "anthropic"
  | "gemini"
  | "openrouter"
  | "groq"
  | "together"
  | "mistral"
  | "local"
  | "claude-cli"
  | "codex-cli"
  | "antigravity-cli";

export type ProviderOption = {
  readonly value: AiProviderValue;
  readonly label: string;
  readonly baseUrl: string;
  readonly model: string;
};

// `group` is optional: options that carry one render inside a `<optgroup>` of
// that label (mirroring the Claude Code app's "More models" submenu); options
// without a group render as bare `<option>`s. See groupModelOptions below.
export type ModelOption = { value: string; label: string; group?: string };

const customModelOption: ModelOption = { value: "custom", label: "Custom model" };
const customModelIdOption: ModelOption = { value: "custom", label: "Custom model ID" };

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
  { value: "claude-cli", label: "Claude · CLI", baseUrl: "", model: "claude-sonnet-5" },
  { value: "codex-cli", label: "Codex · CLI", baseUrl: "", model: "gpt-5.5" },
  { value: "antigravity-cli", label: "Antigravity · CLI", baseUrl: "", model: "Gemini 3.5 Flash (High)" },
  { value: "openai", label: "OpenAI", baseUrl: "", model: "gpt-5.5" },
  { value: "anthropic", label: "Claude", baseUrl: "", model: "claude-sonnet-5" },
  { value: "gemini", label: "Gemini", baseUrl: "", model: "gemini-3.5-flash" },
  {
    value: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "anthropic/claude-sonnet-4.6"
  },
  {
    value: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "openai/gpt-oss-120b"
  },
  {
    value: "together",
    label: "Together AI",
    baseUrl: "https://api.together.xyz/v1",
    model: "openai/gpt-oss-20b"
  },
  {
    value: "mistral",
    label: "Mistral AI",
    baseUrl: "https://api.mistral.ai/v1",
    model: "mistral-large-latest"
  },
  {
    value: "local",
    label: "Local / custom",
    baseUrl: "http://localhost:11434/v1",
    model: "llama3.2"
  }
];

export const modelOptionsByProvider: Record<AiProviderValue, readonly ModelOption[]> = {
  openai: [
    { value: "gpt-5.5", label: "GPT-5.5" },
    { value: "gpt-5.4", label: "GPT-5.4" },
    { value: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
    { value: "gpt-5.4-nano", label: "GPT-5.4 Nano" },
    customModelOption
  ],
  anthropic: [
    { value: "claude-sonnet-5", label: "Claude Sonnet 5" },
    { value: "claude-opus-4-8", label: "Claude Opus 4.8" },
    { value: "claude-opus-4-7", label: "Claude Opus 4.7" },
    { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 (legacy)" },
    { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
    customModelOption
  ],
  gemini: [
    { value: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { value: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite" },
    customModelOption
  ],
  openrouter: [
    { value: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6" },
    { value: "openai/gpt-5.5", label: "GPT-5.5" },
    { value: "google/gemini-3.5-flash", label: "Gemini 3.5 Flash" },
    customModelOption
  ],
  // llama-3.3-70b-versatile dropped: Groq deprecated it (free-tier shutdown
  // 2026-08-16); openai/gpt-oss-120b is Groq's recommended replacement + default.
  groq: [
    { value: "openai/gpt-oss-120b", label: "GPT-OSS 120B" },
    { value: "openai/gpt-oss-20b", label: "GPT-OSS 20B" },
    customModelOption
  ],
  together: [
    { value: "openai/gpt-oss-20b", label: "GPT-OSS 20B" },
    customModelOption
  ],
  mistral: [
    { value: "mistral-large-latest", label: "Mistral Large" },
    { value: "mistral-medium-latest", label: "Mistral Medium" },
    { value: "mistral-small-latest", label: "Mistral Small" },
    customModelOption
  ],
  local: [
    { value: "llama3.2", label: "Llama 3.2" },
    { value: "llama3.1", label: "Llama 3.1" },
    { value: "local-model", label: "Local model" },
    customModelOption
  ],
  // Full model ids (per `claude --help`) grouped by model family. Fable 5 is
  // intentionally omitted: its subscription access ends ~2026-07-07. Labels keep
  // the family name so the collapsed <select> stays unambiguous (a browser shows
  // only the option label, not its <optgroup> header).
  "claude-cli": [
    { value: "claude-opus-4-8", label: "Opus 4.8", group: "Opus" },
    { value: "claude-opus-4-7", label: "Opus 4.7", group: "Opus" },
    { value: "claude-opus-4-6", label: "Opus 4.6", group: "Opus" },
    { value: "claude-sonnet-5", label: "Sonnet 5", group: "Sonnet" },
    { value: "claude-sonnet-4-6", label: "Sonnet 4.6", group: "Sonnet" },
    { value: "claude-haiku-4-5", label: "Haiku 4.5", group: "Haiku" },
    customModelIdOption
  ],
  "codex-cli": [
    { value: "gpt-5.5", label: "GPT-5.5" },
    { value: "gpt-5.4", label: "GPT-5.4" },
    { value: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
    customModelIdOption
  ],
  // Full model list from `agy models` (verified on agy 1.0.16), grouped by vendor
  // family (Gemini native; Claude/GPT-OSS proxied). Values are the EXACT display
  // names — spaces and parens included — since agy silently accepts unknown values
  // (a shortened slug quietly falls back to a default). Keep in sync with `agy models`.
  "antigravity-cli": [
    { value: "Gemini 3.5 Flash (Low)", label: "Gemini 3.5 Flash (Low)", group: "Gemini" },
    { value: "Gemini 3.5 Flash (Medium)", label: "Gemini 3.5 Flash (Medium)", group: "Gemini" },
    { value: "Gemini 3.5 Flash (High)", label: "Gemini 3.5 Flash (High)", group: "Gemini" },
    { value: "Gemini 3.1 Pro (Low)", label: "Gemini 3.1 Pro (Low)", group: "Gemini" },
    { value: "Gemini 3.1 Pro (High)", label: "Gemini 3.1 Pro (High)", group: "Gemini" },
    { value: "Claude Sonnet 4.6 (Thinking)", label: "Claude Sonnet 4.6 (Thinking)", group: "Claude" },
    { value: "Claude Opus 4.6 (Thinking)", label: "Claude Opus 4.6 (Thinking)", group: "Claude" },
    { value: "GPT-OSS 120B (Medium)", label: "GPT-OSS 120B (Medium)", group: "GPT-OSS" },
    customModelIdOption
  ]
};

export const cliReasoningEffortOptionsByProvider: Partial<Record<AiProviderValue, readonly ModelOption[]>> = {
  // Reasoning effort tiers — no "CLI default" for either provider (every entry is
  // a concrete level). claude-cli's helper always passes `--effort` (its CLI
  // session default is never used); codex-cli now passes an explicit
  // `-c model_reasoning_effort`. Per-model narrowing lives in
  // cliReasoningEffortOptionsFor (Haiku has none; Opus/Sonnet 4.6 lack xhigh).
  "claude-cli": [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
    { value: "xhigh", label: "Extra high" },
    { value: "max", label: "Max" }
  ],
  "codex-cli": [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
    { value: "xhigh", label: "Extra high" }
  ]
};

// Narrow a provider's effort tiers to what the selected MODEL actually exposes, so
// the menu corresponds to each model. Verified against Anthropic's effort matrix;
// the CLI accepts any level without erroring, so this is a UI/semantic filter, not
// an error guard:
//   • Haiku 4.5 — effort is inert → no tiers (the effort control hides).
//   • Opus 4.6 / Sonnet 4.6 — no `xhigh` (added on Opus 4.7 / Sonnet 5).
//   • Opus 4.7/4.8, Sonnet 5, custom/unknown — the full low→max set.
// codex-cli is uniform across gpt-5.x. Returns undefined for non-CLI providers.
export function cliReasoningEffortOptionsFor(
  provider: string,
  model: string
): readonly ModelOption[] | undefined {
  if (provider === "codex-cli") return cliReasoningEffortOptionsByProvider["codex-cli"];
  if (provider !== "claude-cli") return undefined;
  const all = cliReasoningEffortOptionsByProvider["claude-cli"] ?? [];
  if (/haiku/i.test(model)) return [];
  if (model === "claude-opus-4-6" || model === "claude-sonnet-4-6") {
    return all.filter((option) => option.value !== "xhigh");
  }
  return all;
}

// The effort a CLI provider starts at when the user hasn't picked one. Both values
// are members of every non-empty per-model list above, so a model switch can
// always fall back to it. claude-cli forces low (speed on a bounded rewrite);
// codex-cli uses medium (its typical default, now explicit). Non-CLI → "" (ignored).
export function defaultCliReasoningEffort(provider: string): string {
  if (provider === "claude-cli") return "low";
  if (provider === "codex-cli") return "medium";
  return "";
}

// Friendly display label for a provider value (falls back to the raw value).
export function providerLabel(value: string): string {
  return providerOptions.find((option) => option.value === value)?.label ?? value;
}

// Provider attribution string for status lines and the reviewer caption, e.g.
// "Codex · CLI (gpt-5.5)". The model is in parens (provider labels already
// contain "·") and omitted when blank (e.g. an empty custom model id).
export function describeProviderModel(provider: string, model: string): string {
  const label = providerLabel(provider);
  return model ? `${label} (${model})` : label;
}
