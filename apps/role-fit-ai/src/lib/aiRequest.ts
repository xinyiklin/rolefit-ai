import type { AiProviderValue } from "../config/aiOptions";

// The three AI pipeline stages, each with its own concrete provider config
// (no "same as Tailor" live link — the AI menu's "Copy from" control does a
// one-shot copy between stages instead).
export type StageId = "distill" | "tailor" | "review";

export type StageConfig = {
  provider: AiProviderValue;
  apiKey: string;
  selectedModel: string;
  cliReasoningEffort: string;
};

export type AiRequestFields = {
  provider: AiProviderValue;
  apiKey: string;
  model: string;
  reasoningEffort: string;
};

// Resolve the provider/key/model fields shared by every non-audit AI request
// body (`/api/polish`'s tailor stage, `/api/distill`, `/api/application-answers`,
// `/api/cover-letter`): uses the exact field names the server expects, so the
// call sites cannot drift apart.
// Spread the result into the request body and add the route-specific fields
// alongside it.
export function buildStageRequestFields(config: StageConfig): AiRequestFields {
  return {
    provider: config.provider,
    apiKey: config.apiKey,
    model: config.selectedModel,
    reasoningEffort: config.cliReasoningEffort
  };
}

export type AuditRequestFields = {
  auditProvider: string;
  auditApiKey: string;
  auditModel: string;
  auditReasoningEffort: string;
};

// Resolve the independent-reviewer fields for `/api/polish`'s strict audit pass
// from the reviewer stage's own concrete config. Mirrors buildStageRequestFields
// with exact server field names, but namespaced with `audit*` so the primary
// rewrite/cover config is untouched.
export function buildAuditRequestFields(config: StageConfig): AuditRequestFields {
  return {
    auditProvider: config.provider,
    auditApiKey: config.apiKey,
    auditModel: config.selectedModel,
    auditReasoningEffort: config.cliReasoningEffort
  };
}
