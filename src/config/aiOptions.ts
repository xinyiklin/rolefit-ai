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
  | "gemini-cli";

export type ProviderOption = {
  readonly value: AiProviderValue;
  readonly label: string;
  readonly baseUrl: string;
  readonly model: string;
};

export type ModelOption = { value: string; label: string };

const customModelOption: ModelOption = { value: "custom", label: "Custom model" };
const customModelIdOption: ModelOption = { value: "custom", label: "Custom model ID" };

export const providerOptions: readonly ProviderOption[] = [
  { value: "claude-cli", label: "Claude · CLI", baseUrl: "", model: "sonnet" },
  { value: "codex-cli", label: "Codex · CLI", baseUrl: "", model: "" },
  { value: "gemini-cli", label: "Gemini · CLI", baseUrl: "", model: "" },
  { value: "openai", label: "OpenAI", baseUrl: "", model: "" },
  { value: "anthropic", label: "Claude", baseUrl: "", model: "claude-sonnet-4-6" },
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
    model: "llama-3.3-70b-versatile"
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
    { value: "", label: "Server default" },
    { value: "gpt-5.5", label: "GPT-5.5" },
    { value: "gpt-5.4", label: "GPT-5.4" },
    { value: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
    { value: "gpt-5.4-nano", label: "GPT-5.4 Nano" },
    customModelOption
  ],
  anthropic: [
    { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
    { value: "claude-opus-4-8", label: "Claude Opus 4.8" },
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
  groq: [
    { value: "llama-3.3-70b-versatile", label: "Llama 3.3 70B Versatile" },
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
  "claude-cli": [
    { value: "", label: "CLI subscription default" },
    { value: "sonnet", label: "Sonnet (latest alias)" },
    { value: "opus", label: "Opus (latest alias)" },
    { value: "haiku", label: "Haiku (latest alias)" },
    customModelIdOption
  ],
  "codex-cli": [
    { value: "", label: "CLI subscription default" },
    { value: "gpt-5.5", label: "GPT-5.5" },
    { value: "gpt-5.4", label: "GPT-5.4" },
    customModelIdOption
  ],
  "gemini-cli": [
    { value: "", label: "CLI subscription default" },
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    customModelIdOption
  ]
};

export const cliReasoningEffortOptionsByProvider: Partial<Record<AiProviderValue, readonly ModelOption[]>> = {
  "claude-cli": [
    { value: "", label: "CLI default" },
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
    { value: "xhigh", label: "Extra high" },
    { value: "max", label: "Max" }
  ],
  "codex-cli": [
    { value: "", label: "CLI default" },
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
    { value: "xhigh", label: "Extra high" }
  ]
};

// Friendly display label for a provider value (falls back to the raw value).
export function providerLabel(value: string): string {
  return providerOptions.find((option) => option.value === value)?.label ?? value;
}

// Provider attribution string for status lines and the reviewer caption, e.g.
// "Codex · CLI (gpt-5.5)". The model is in parens (provider labels already
// contain "·") and omitted when blank (e.g. a CLI subscription default).
export function describeProviderModel(provider: string, model: string): string {
  const label = providerLabel(provider);
  return model ? `${label} (${model})` : label;
}
