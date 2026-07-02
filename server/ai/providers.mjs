// Provider identity + per-request configuration resolution: which provider/
// model/key/base-URL/reasoning-effort a request resolves to, plus the default
// provider and the validation shared by /api/polish and /api/application-answers.

import { UserSafeAiError } from "./errors.mjs";

export function getDefaultProvider() {
  // No explicit AI_PROVIDER → default to the zero-per-token-cost Claude CLI
  // (subscription-backed). normalizeProvider still coerces unknown strings to
  // "openai", so only the "nothing specified" default flips here.
  return normalizeProvider(process.env.AI_PROVIDER || "claude-cli");
}

export function getDefaultModel() {
  return process.env.AI_MODEL ?? providerDefaultModel(getDefaultProvider());
}

function defaultCompatibleBaseUrl() {
  return process.env.AI_BASE_URL ?? process.env.OPENAI_COMPATIBLE_BASE_URL ?? "";
}

export function providerLabel(provider) {
  return (
    {
      openai: "OpenAI",
      anthropic: "Claude",
      gemini: "Gemini",
      openrouter: "OpenRouter",
      groq: "Groq",
      together: "Together AI",
      mistral: "Mistral",
      local: "Local AI",
      "openai-compatible": "OpenAI-compatible provider",
      "claude-cli": "Claude Code",
      "codex-cli": "Codex CLI",
      "gemini-cli": "Gemini CLI"
    }[provider] ?? "AI provider"
  );
}

// Every provider id the app understands. "openai" is the default any unknown
// value coerces to, so it is also the membership baseline for isKnownProvider().
const KNOWN_PROVIDERS = new Set([
  "openai",
  "anthropic",
  "gemini",
  "openrouter",
  "groq",
  "together",
  "mistral",
  "openai-compatible",
  "local",
  "claude-cli",
  "codex-cli",
  "gemini-cli"
]);

export function isKnownProvider(value) {
  return KNOWN_PROVIDERS.has(String(value ?? "").trim().toLowerCase());
}

export function normalizeProvider(provider) {
  const normalized = String(provider ?? "").trim().toLowerCase();
  return KNOWN_PROVIDERS.has(normalized) ? normalized : "openai";
}

export function isCliProvider(provider) {
  return provider === "claude-cli" || provider === "codex-cli" || provider === "gemini-cli";
}

function normalizeCliReasoningEffort(provider, effort) {
  let normalized = String(effort ?? "").trim().toLowerCase();
  if (!normalized) return "";
  if (provider === "codex-cli" && normalized === "light") normalized = "low";

  const allowed = {
    "claude-cli": ["low", "medium", "high", "xhigh", "max"],
    "codex-cli": ["low", "medium", "high", "xhigh"]
  }[provider];

  return allowed?.includes(normalized) ? normalized : null;
}

function providerDefaultModel(provider) {
  return (
    {
      openai: process.env.OPENAI_MODEL ?? "gpt-5.5",
      anthropic: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
      gemini: process.env.GEMINI_MODEL ?? "gemini-3.5-flash",
      openrouter: process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4.6",
      groq: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
      together: process.env.TOGETHER_MODEL ?? "openai/gpt-oss-20b",
      mistral: process.env.MISTRAL_MODEL ?? "mistral-large-latest",
      "openai-compatible": process.env.AI_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-5.5",
      local: process.env.LOCAL_AI_MODEL ?? "llama3.2",
      "claude-cli": process.env.CLAUDE_CLI_MODEL ?? "",
      "codex-cli": process.env.CODEX_CLI_MODEL ?? "",
      "gemini-cli": process.env.GEMINI_CLI_MODEL ?? ""
    }[provider] ?? process.env.OPENAI_MODEL ?? "gpt-5.5"
  );
}

function providerApiKey(provider, requestApiKey) {
  if (requestApiKey) return requestApiKey;
  return (
    {
      openai: process.env.OPENAI_API_KEY,
      anthropic: process.env.ANTHROPIC_API_KEY,
      gemini: process.env.GEMINI_API_KEY,
      openrouter: process.env.OPENROUTER_API_KEY,
      groq: process.env.GROQ_API_KEY,
      together: process.env.TOGETHER_API_KEY,
      mistral: process.env.MISTRAL_API_KEY,
      "openai-compatible": process.env.AI_API_KEY || process.env.OPENAI_API_KEY,
      local: process.env.AI_API_KEY
    }[provider] ||
    process.env.AI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    ""
  );
}

function providerBaseUrl(provider, requestBaseUrl) {
  return (
    String(requestBaseUrl ?? "").trim() ||
    {
      openrouter: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
      groq: process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1",
      together: process.env.TOGETHER_BASE_URL || "https://api.together.xyz/v1",
      mistral: process.env.MISTRAL_BASE_URL || "https://api.mistral.ai/v1",
      local: process.env.LOCAL_AI_BASE_URL || "http://localhost:11434/v1",
      "openai-compatible": defaultCompatibleBaseUrl()
    }[provider] ||
    defaultCompatibleBaseUrl()
  );
}

// Resolve provider, key, base URL, model, and reasoning effort from a request
// body, applying the same validation handlePolish used. Throws UserSafeAiError
// (handled by each route's catch) on a missing key, bad model, or unsupported
// CLI effort. Shared by /api/polish and /api/application-answers.
export function resolveProviderRequest(body) {
  const provider = normalizeProvider(body.provider || getDefaultProvider());
  const requestApiKey = String(body.apiKey ?? "").trim();
  const apiKey = providerApiKey(provider, requestApiKey);
  const apiBaseUrl = providerBaseUrl(provider, body.apiBaseUrl);
  const requestedModel = String(body.model ?? "").trim().slice(0, 80);
  const model = requestedModel || providerDefaultModel(provider);
  const reasoningEffort = normalizeCliReasoningEffort(provider, body.reasoningEffort);

  if (!apiKey && !isCliProvider(provider)) {
    throw new UserSafeAiError(
      `Add an API key in AI settings or set the ${provider.toUpperCase()} API key in .env before starting the app.`,
      401
    );
  }
  if (model && model.startsWith("-")) {
    // A leading dash could read as a flag to the spawned CLI providers
    // (`--model <value>`); no real model id starts with one.
    throw new UserSafeAiError("Model name cannot start with a dash.", 400);
  }
  if (model && !/^[a-z0-9_.:/@+-]+$/i.test(model)) {
    throw new UserSafeAiError(
      "Model name can only use letters, numbers, dots, dashes, underscores, slashes, at signs, pluses, or colons.",
      400
    );
  }
  if (reasoningEffort === null) {
    throw new UserSafeAiError("Unsupported reasoning effort for the selected CLI provider.", 400);
  }

  return { provider, apiKey, apiBaseUrl, model, reasoningEffort };
}

// Resolve the optional independent-reviewer provider for the strict-audit pass.
// When the request supplies no auditProvider, the audit reuses the already
// resolved primary config so behavior is unchanged. A supplied auditProvider is
// validated by the same rules as the primary (a hosted provider missing a key
// still fails loudly). Reviewer fields are namespaced (audit*) so the primary
// rewrite/cover config is untouched.
export function resolveAuditProviderRequest(body, primary) {
  const raw = String(body.auditProvider ?? "").trim();
  if (!raw) return primary;
  // Reject an unknown reviewer provider instead of letting normalizeProvider
  // silently coerce a typo to OpenAI — otherwise the "independent reviewer"
  // could audit with a provider the user never chose, and a later key error
  // would mislead by naming OpenAI rather than the audit field.
  if (!isKnownProvider(raw)) {
    throw new UserSafeAiError(
      `Unknown reviewer provider "${raw.slice(0, 40)}". Pick a supported provider for the audit pass, or leave it as same-as-primary.`,
      400
    );
  }
  return resolveProviderRequest({
    provider: raw,
    apiKey: body.auditApiKey,
    apiBaseUrl: body.auditApiBaseUrl,
    model: body.auditModel,
    reasoningEffort: body.auditReasoningEffort
  });
}
