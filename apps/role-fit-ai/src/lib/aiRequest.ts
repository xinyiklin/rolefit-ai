import type { AiProviderValue } from "../config/aiOptions";

// The three AI pipeline stages, each with its own concrete provider config
// (no "same as Tailor" live link — the AI menu's "Copy from" control does a
// one-shot copy between stages instead).
export type StageId = "distill" | "tailor" | "review";

export type StageConfig = {
  provider: AiProviderValue;
  apiKey: string;
  apiBaseUrl: string;
  selectedModel: string;
  customModel: string;
  cliReasoningEffort: string;
};

export type AiRequestFields = {
  provider: AiProviderValue;
  apiKey: string;
  apiBaseUrl: string;
  model: string;
  reasoningEffort: string;
};

// Resolve the provider/key/model fields shared by every non-audit AI request
// body (`/api/polish`'s tailor stage, `/api/distill`, `/api/application-answers`,
// `/api/cover-letter`): applies the "custom" model escape hatch and uses the
// exact field names the server expects, so the call sites cannot drift apart.
// Spread the result into the request body and add the route-specific fields
// alongside it.
export function buildStageRequestFields(config: StageConfig): AiRequestFields {
  return {
    provider: config.provider,
    apiKey: config.apiKey,
    apiBaseUrl: config.apiBaseUrl,
    model: config.selectedModel === "custom" ? config.customModel.trim() : config.selectedModel,
    reasoningEffort: config.cliReasoningEffort
  };
}

export type AuditRequestFields = {
  auditProvider: string;
  auditApiKey: string;
  auditApiBaseUrl: string;
  auditModel: string;
  auditReasoningEffort: string;
};

// Resolve the independent-reviewer fields for `/api/polish`'s strict audit pass
// from the reviewer stage's own concrete config. Mirrors buildStageRequestFields
// (custom-model escape hatch, exact server field names) but namespaced with
// `audit*` so the primary rewrite/cover config is untouched.
export function buildAuditRequestFields(config: StageConfig): AuditRequestFields {
  return {
    auditProvider: config.provider,
    auditApiKey: config.apiKey,
    auditApiBaseUrl: config.apiBaseUrl,
    auditModel: config.selectedModel === "custom" ? config.customModel.trim() : config.selectedModel,
    auditReasoningEffort: config.cliReasoningEffort
  };
}
