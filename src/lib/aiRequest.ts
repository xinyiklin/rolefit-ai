import type { AiProviderValue } from "../config/aiOptions";

export type AiRequestSettings = {
  aiProvider: AiProviderValue;
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

// Resolve the provider/key/model fields shared by every AI request body
// (`/api/polish`, `/api/application-answers`): applies the "custom" model
// escape hatch and uses the exact field names the server expects, so the
// call sites cannot drift apart. Spread the result into the request body and
// add the route-specific fields alongside it.
export function buildAiRequestFields({
  aiProvider,
  apiKey,
  apiBaseUrl,
  selectedModel,
  customModel,
  cliReasoningEffort
}: AiRequestSettings): AiRequestFields {
  return {
    provider: aiProvider,
    apiKey,
    apiBaseUrl,
    model: selectedModel === "custom" ? customModel.trim() : selectedModel,
    reasoningEffort: cliReasoningEffort
  };
}

export type DistillRequestSettings = {
  distillProvider: AiProviderValue;
  distillApiKey: string;
  distillApiBaseUrl: string;
  distillSelectedModel: string;
  distillCustomModel: string;
  distillCliReasoningEffort: string;
};

// Resolve the distill-stage request fields for `/api/distill` from the distill
// stage's own concrete config (the "same as Tailor" live-link is gone — stages are
// synced by the copy buttons instead). Returns the SAME `AiRequestFields` shape the
// distill route already reads, so no server change is needed.
export function buildDistillRequestFields(distill: DistillRequestSettings): AiRequestFields {
  return {
    provider: distill.distillProvider,
    apiKey: distill.distillApiKey,
    apiBaseUrl: distill.distillApiBaseUrl,
    model: distill.distillSelectedModel === "custom" ? distill.distillCustomModel.trim() : distill.distillSelectedModel,
    reasoningEffort: distill.distillCliReasoningEffort
  };
}

export type AuditRequestSettings = {
  auditProvider: AiProviderValue;
  auditApiKey: string;
  auditApiBaseUrl: string;
  auditSelectedModel: string;
  auditCustomModel: string;
  auditCliReasoningEffort: string;
};

export type AuditRequestFields = {
  auditProvider: string;
  auditApiKey: string;
  auditApiBaseUrl: string;
  auditModel: string;
  auditReasoningEffort: string;
};

// Resolve the independent-reviewer fields for `/api/polish`'s strict audit pass
// from the reviewer stage's own concrete config. Mirrors buildAiRequestFields
// (custom-model escape hatch, exact server field names) but namespaced with
// `audit*` so the primary rewrite/cover config is untouched.
export function buildAuditRequestFields({
  auditProvider,
  auditApiKey,
  auditApiBaseUrl,
  auditSelectedModel,
  auditCustomModel,
  auditCliReasoningEffort
}: AuditRequestSettings): AuditRequestFields {
  return {
    auditProvider,
    auditApiKey,
    auditApiBaseUrl,
    auditModel: auditSelectedModel === "custom" ? auditCustomModel.trim() : auditSelectedModel,
    auditReasoningEffort: auditCliReasoningEffort
  };
}
