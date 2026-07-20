// Provider identity + per-request configuration resolution: which provider/
// model/key/reasoning-effort a request resolves to, plus the default
// provider and the validation shared by /api/polish and /api/application-answers.

import { UserSafeAiError } from "./errors.ts";
import {
  getManagedApiKey,
  getManagedProviderConnection,
  isCompanionManaged,
  type RoleFitManagedProviderId
} from "../provider-connections.ts";

// Request bodies are boundary data ("parse, don't validate"): every field is
// untyped input coerced defensively below, so they carry `unknown` fields.
type ProviderRequestBody = {
  provider?: unknown;
  model?: unknown;
  reasoningEffort?: unknown;
};

type AuditRequestBody = {
  auditProvider?: unknown;
  auditModel?: unknown;
  auditReasoningEffort?: unknown;
};

type ReviewOnlyRequestBody = ProviderRequestBody & AuditRequestBody;

// The resolved per-request provider config the routes destructure. reasoningEffort
// is narrowed to string at the return (the null case throws before returning).
export type ResolvedProviderConfig = {
  provider: string;
  apiKey: string;
  model: string;
  reasoningEffort: string;
};

export function getDefaultProvider(): string {
  // No explicit AI_PROVIDER → default to the zero-per-token-cost Claude CLI
  // (subscription-backed). A non-empty typo must fail closed rather than silently
  // selecting paid OpenAI.
  const configured = String(process.env.AI_PROVIDER ?? "").trim();
  if (configured && !isKnownProvider(configured)) {
    throw new UserSafeAiError(
      `Unknown AI_PROVIDER "${configured.slice(0, 40)}". Set it to a supported provider or remove it to use Claude Code.`,
      400
    );
  }
  return normalizeProvider(configured || "claude-cli");
}

export function getDefaultModel(): string {
  return process.env.AI_MODEL ?? providerDefaultModel(getDefaultProvider());
}

export function providerLabel(provider: string): string {
  return (
    {
      openai: "OpenAI",
      anthropic: "Claude",
      "claude-cli": "Claude Code",
      "codex-cli": "Codex CLI",
      "antigravity-cli": "Antigravity CLI"
    }[provider] ?? "AI provider"
  );
}

// Every provider id the app understands. Public request/default resolvers reject
// unknown non-empty values before normalizeProvider is called.
const KNOWN_PROVIDERS = new Set([
  "openai",
  "anthropic",
  "claude-cli",
  "codex-cli",
  "antigravity-cli"
]);

// Module-internal: only resolveAuditProviderRequest below rejects an unknown
// reviewer provider with it. Not part of the module's public surface.
function isKnownProvider(value: unknown): boolean {
  return KNOWN_PROVIDERS.has(String(value ?? "").trim().toLowerCase());
}

function normalizeProvider(provider: unknown): string {
  // Every caller validates membership first; keep normalization free of a paid
  // provider fallback so a future call site cannot silently turn a typo into an
  // OpenAI dispatch.
  return String(provider ?? "").trim().toLowerCase();
}

export function isCliProvider(provider: string): boolean {
  return provider === "claude-cli" || provider === "codex-cli" || provider === "antigravity-cli";
}

function normalizeCliReasoningEffort(provider: string, effort: unknown): string | null {
  let normalized = String(effort ?? "").trim().toLowerCase();
  if (!normalized) return "";
  if (provider === "codex-cli" && normalized === "light") normalized = "low";

  const allowed = {
    "claude-cli": ["low", "medium", "high", "xhigh", "max"],
    "codex-cli": ["low", "medium", "high", "xhigh", "max", "ultra"]
  }[provider];

  return allowed?.includes(normalized) ? normalized : null;
}

function providerDefaultModel(provider: string): string {
  return (
    {
      openai: process.env.OPENAI_MODEL ?? "gpt-5.6-terra",
      anthropic: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5",
      "claude-cli": process.env.CLAUDE_CLI_MODEL ?? "claude-sonnet-5",
      "codex-cli": process.env.CODEX_CLI_MODEL ?? "gpt-5.6-sol",
      "antigravity-cli": process.env.ANTIGRAVITY_CLI_MODEL ?? "Gemini 3.5 Flash (High)"
    }[provider] ?? process.env.OPENAI_MODEL ?? "gpt-5.6-terra"
  );
}

function providerApiKey(provider: string): string {
  if (provider === "openai" || provider === "anthropic") {
    // Once the companion snapshot boundary is active it is authoritative,
    // including the absence of a credential. Never fall through to a process
    // or `.env` key in companion-managed mode.
    if (isCompanionManaged()) return getManagedApiKey(provider) ?? "";
  }
  // Credential boundary: never let an OpenAI key bleed into Claude or vice
  // versa merely because another provider key is present in the process.
  const providerSpecific = {
    openai: process.env.OPENAI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY
  }[provider];
  return providerSpecific || "";
}

function assertCompanionProviderReady(provider: RoleFitManagedProviderId): void {
  if (!isCompanionManaged()) return;

  const connection = getManagedProviderConnection(provider);
  if (!connection) {
    throw new UserSafeAiError(
      `Add ${providerLabel(provider)} in RoleFit Companion before trying again.`,
      409
    );
  }
  if (!connection.ready) {
    throw new UserSafeAiError(
      `Reconnect ${providerLabel(provider)} in RoleFit Companion before trying again.`,
      409
    );
  }
}

// Resolve provider, key, model, and reasoning effort from a request
// body, applying the same validation handlePolish used. Throws UserSafeAiError
// (handled by each route's catch) on a missing key, bad model, or unsupported
// CLI effort. Shared by /api/polish and /api/application-answers.
export function resolveProviderRequest(body: ProviderRequestBody): ResolvedProviderConfig {
  const requestedProvider = String(body.provider ?? "").trim();
  // An omitted provider keeps the headless/default path. An explicitly supplied
  // typo must not silently become OpenAI: that can select a paid provider the
  // caller never intended and makes the resulting key/model error misleading.
  if (requestedProvider && !isKnownProvider(requestedProvider)) {
    throw new UserSafeAiError(
      `Unknown AI provider "${requestedProvider.slice(0, 40)}". Pick a supported provider or omit the field to use the configured default.`,
      400
    );
  }
  const provider = normalizeProvider(
    requestedProvider || getDefaultProvider()
  ) as RoleFitManagedProviderId;
  assertCompanionProviderReady(provider);
  const apiKey = providerApiKey(provider);
  const requestedModel = String(body.model ?? "").trim();
  if (requestedModel.length > 80) {
    throw new UserSafeAiError("Model name is too long. Check AI settings and try again.", 400);
  }
  // AI_MODEL is the documented override for the HEADLESS/default path. An
  // explicit request provider keeps its provider-specific default so a stale
  // global override cannot silently select an incompatible model after the user
  // chooses another provider in the UI.
  const model = requestedModel || (requestedProvider ? providerDefaultModel(provider) : getDefaultModel());
  if (model.length > 120) {
    throw new UserSafeAiError("Configured model name is too long. Check AI settings and try again.", 400);
  }
  const reasoningEffort = normalizeCliReasoningEffort(provider, body.reasoningEffort);

  if (!apiKey && !isCliProvider(provider)) {
    throw new UserSafeAiError(
      `Add this provider in RoleFit Companion or set the ${provider.toUpperCase()} API key in .env before starting the app.`,
      401
    );
  }
  if (model && model.startsWith("-")) {
    // A leading dash could read as a flag to the spawned CLI providers
    // (`--model <value>`); no real model id starts with one. This guard stays
    // even though spaces/parens are allowed below.
    throw new UserSafeAiError("Model name cannot start with a dash.", 400);
  }
  // Spaces and parentheses are permitted because the Antigravity CLI's model ids
  // are display names like "Gemini 3.5 Flash (High)" (from `agy models`). They are
  // injection-safe: CLI providers spawn with an argv array (no shell), so the
  // value is one argument, and the leading-dash guard above still blocks flag
  // injection. Hosted providers only place the model in a JSON body / encoded URL.
  if (model && !/^[a-z0-9 _.:/@+()-]+$/i.test(model)) {
    throw new UserSafeAiError(
      "Model name can only use letters, numbers, spaces, dots, dashes, underscores, slashes, at signs, pluses, parentheses, or colons.",
      400
    );
  }
  if (reasoningEffort === null) {
    throw new UserSafeAiError("Unsupported reasoning effort for the selected CLI provider.", 400);
  }

  return { provider, apiKey, model, reasoningEffort };
}

// Review-only requests do not dispatch the Tailor provider. Resolve the audit*
// namespace directly when present so a missing/invalid UNUSED Tailor key cannot
// block a valid standalone Review. Headless callers that omit auditProvider keep
// the existing primary-field/default semantics.
export function resolveReviewOnlyProviderRequest(body: ReviewOnlyRequestBody): ResolvedProviderConfig {
  const raw = String(body.auditProvider ?? "").trim();
  if (!raw) return resolveProviderRequest(body);
  if (!isKnownProvider(raw)) {
    throw new UserSafeAiError(
      `Unknown reviewer provider "${raw.slice(0, 40)}". Pick a supported provider for the audit pass.`,
      400
    );
  }
  return resolveProviderRequest({
    provider: raw,
    model: body.auditModel,
    reasoningEffort: body.auditReasoningEffort
  });
}

// Resolve the optional independent-reviewer provider for the strict-audit pass.
// When the request supplies no auditProvider, the audit reuses the already
// resolved primary config so behavior is unchanged. A supplied auditProvider is
// validated by the same rules as the primary (a hosted provider missing a key
// still fails loudly). Reviewer fields are namespaced (audit*) so the primary
// rewrite/cover config is untouched.
export function resolveAuditProviderRequest(
  body: AuditRequestBody,
  primary: ResolvedProviderConfig
): ResolvedProviderConfig {
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
    model: body.auditModel,
    reasoningEffort: body.auditReasoningEffort
  });
}
