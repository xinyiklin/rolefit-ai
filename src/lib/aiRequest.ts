import type { AiProviderValue } from "../sections/SourcesPane";

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
