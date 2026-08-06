import type { AiProviderValue } from "../config/aiOptions";
import type { AiStageId } from "../config/aiStages";

// Every configurable AI stage has its own concrete provider config (no "same as
// Tailor" live link — Settings' "Copy settings" control does a one-shot copy
// between stages instead). The stage list itself lives in config/aiStages.ts.
export type StageId = AiStageId;

export type StageConfig = {
  provider: AiProviderValue;
  selectedModel: string;
  cliReasoningEffort: string;
};

export type AiRequestFields = {
  provider: AiProviderValue;
  model: string;
  reasoningEffort: string;
};

// Resolve the provider/model fields shared by every non-audit AI request
// body (`/api/polish`'s tailor stage, `/api/job-analysis`, `/api/application-answers`,
// `/api/cover-letter`): uses the exact field names the server expects, so the
// call sites cannot drift apart.
// Spread the result into the request body and add the route-specific fields
// alongside it.
export function buildStageRequestFields(config: StageConfig): AiRequestFields {
  return {
    provider: config.provider,
    model: config.selectedModel,
    reasoningEffort: config.cliReasoningEffort
  };
}

export type AuditRequestFields = {
  auditProvider: string;
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
    auditModel: config.selectedModel,
    auditReasoningEffort: config.cliReasoningEffort
  };
}
