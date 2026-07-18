// Shared AI option types (moved here from the former SourcesPane so the
// provider tables and their types live together).
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
  { value: "claude-cli", label: "Claude · CLI", model: "claude-sonnet-5" },
  { value: "codex-cli", label: "Codex · CLI", model: "gpt-5.6-sol" },
  { value: "antigravity-cli", label: "Antigravity · CLI", model: "Gemini 3.5 Flash (High)" },
  { value: "openai", label: "OpenAI · API", model: "gpt-5.6-terra" },
  { value: "anthropic", label: "Claude · API", model: "claude-sonnet-5" }
];

export const modelOptionsByProvider: Record<AiProviderValue, readonly ModelOption[]> = {
  openai: [
    { value: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
    { value: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
    { value: "gpt-5.6-luna", label: "GPT-5.6 Luna" }
  ],
  anthropic: [
    { value: "claude-sonnet-5", label: "Claude Sonnet 5" },
    { value: "claude-fable-5", label: "Claude Fable 5" },
    { value: "claude-opus-4-8", label: "Claude Opus 4.8" },
    { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" }
  ],
  // Current and still-available concrete ids present in the installed Claude
  // Code 2.1.212 binary. Labels omit the redundant "Claude" prefix because the
  // provider control already establishes that context.
  // The CLI is not signed in on this machine, so account-specific availability
  // cannot be narrowed further without completing `claude auth login`.
  "claude-cli": [
    { value: "claude-fable-5", label: "Fable 5" },
    { value: "claude-sonnet-5", label: "Sonnet 5" },
    { value: "claude-sonnet-4-6", label: "Sonnet 4.6" },
    { value: "claude-opus-4-8", label: "Opus 4.8" },
    { value: "claude-opus-4-7", label: "Opus 4.7" },
    { value: "claude-opus-4-6", label: "Opus 4.6" },
    { value: "claude-haiku-4-5", label: "Haiku 4.5" }
  ],
  // Visible (`visibility: "list"`) models and their order from Codex CLI
  // 0.144.5's refreshed models cache. Hidden `codex-auto-review` is excluded.
  "codex-cli": [
    { value: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
    { value: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
    { value: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
    { value: "gpt-5.5", label: "GPT-5.5" },
    { value: "gpt-5.4", label: "GPT-5.4" },
    { value: "gpt-5.4-mini", label: "GPT-5.4 Mini" }
  ],
  // Full model list from `agy models` (verified on agy 1.1.3), grouped by vendor
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
    { value: "GPT-OSS 120B (Medium)", label: "GPT-OSS 120B (Medium)", group: "GPT-OSS" }
  ]
};

export const cliReasoningEffortOptionsByProvider: Partial<Record<AiProviderValue, readonly ModelOption[]>> = {
  // Concrete values exposed by each installed CLI. Both helpers always pass a
  // selected value rather than relying on an ambient CLI default.
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
    { value: "xhigh", label: "Extra high" },
    { value: "max", label: "Max" },
    { value: "ultra", label: "Ultra" }
  ]
};

// Narrow Codex to the effort levels reported for the selected model in the
// installed CLI's models cache. Claude Code 2.1.212 exposes one global
// low→max set in `claude --help`, so it is returned unchanged.
export function cliReasoningEffortOptionsFor(
  provider: string,
  model: string
): readonly ModelOption[] | undefined {
  if (provider === "codex-cli") {
    const all = cliReasoningEffortOptionsByProvider["codex-cli"] ?? [];
    if (model === "gpt-5.6-sol" || model === "gpt-5.6-terra") return all;
    if (model === "gpt-5.6-luna") {
      return all.filter((option) => option.value !== "ultra");
    }
    return all.filter((option) => option.value !== "max" && option.value !== "ultra");
  }
  if (provider === "claude-cli") return cliReasoningEffortOptionsByProvider["claude-cli"];
  return undefined;
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
// "Codex · CLI (gpt-5.6-sol)". The model is in parens (provider labels already
// contain "·") and omitted when blank (e.g. an empty custom model id).
export function describeProviderModel(provider: string, model: string): string {
  const label = providerLabel(provider);
  return model ? `${label} (${model})` : label;
}
