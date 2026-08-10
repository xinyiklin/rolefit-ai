import type { AiProviderValue } from "../config/aiOptions";
import type { AiStageId } from "../config/aiStages";

// Every configurable AI stage has its own concrete provider config (no "same as
// Resume Polish" live link — Settings' "Copy settings" control does a one-shot copy
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

// Resolve the provider/model fields shared by every AI request
// body (`/api/polish`'s Resume Polish stage, `/api/job-analysis`, `/api/application-answers`,
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

export function aiRequestFieldsMatch(left: AiRequestFields, right: AiRequestFields): boolean {
  return (
    left.provider === right.provider
    && left.model === right.model
    && left.reasoningEffort === right.reasoningEffort
  );
}
