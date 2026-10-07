import { reconcileCliReasoningEffort } from "../../shared/cliReasoning.ts";
import { defaultCliReasoningEffort, providerOptions } from "../config/aiOptions.ts";
import { AI_STAGES, AI_STAGE_IDS, stageSettingsKeys } from "../config/aiStages.ts";
import type { AiProviderValue } from "../config/aiOptions.ts";
import type { StageConfig, StageId } from "./aiRequest.ts";
import type { PersistedSettings } from "./settings.ts";

const STAGE_DEFAULTS: Record<StageId, StageConfig> = {
  "job-analysis": { provider: "claude-cli", selectedModel: "claude-sonnet-5-5", cliReasoningEffort: "low" },
  "fit-assessment": { provider: "claude-cli", selectedModel: "claude-sonnet-5-5", cliReasoningEffort: "low" },
  "resume-polish": { provider: "claude-cli", selectedModel: "claude-opus-5-5", cliReasoningEffort: "high" },
  "cover-polish": { provider: "codex-cli", selectedModel: "gpt-6.1-sol", cliReasoningEffort: "medium" },
  "application-answers": { provider: "claude-cli", selectedModel: "claude-opus-5-5", cliReasoningEffort: "high" },
  "application-review": { provider: "claude-cli", selectedModel: "claude-sonnet-5-5", cliReasoningEffort: "low" }
};

export function seedStage(stage: StageId, saved: PersistedSettings): StageConfig {
  if (stage === "application-review" && saved.applicationReviewProvider === undefined) return seedStage("fit-assessment", saved);
  const ownKeys = stageSettingsKeys(AI_STAGES.find((entry) => entry.id === stage)!);
  const bag = saved as unknown as Record<string, string | undefined>;
  const defaults = STAGE_DEFAULTS[stage];
  // Sparse saved model choices used Claude CLI before stage-specific defaults.
  const provider = (bag[ownKeys.provider] as AiProviderValue | undefined) ?? (bag[ownKeys.model] !== undefined ? "claude-cli" : defaults.provider);
  const selectedModel = bag[ownKeys.model] ?? (provider === defaults.provider ? defaults.selectedModel : providerOptions.find((option) => option.value === provider)?.model) ?? defaults.selectedModel;
  const defaultEffort = provider === defaults.provider && selectedModel === defaults.selectedModel
    ? defaults.cliReasoningEffort : defaultCliReasoningEffort(provider);
  return {
    provider,
    selectedModel,
    cliReasoningEffort: reconcileCliReasoningEffort(provider, selectedModel, bag[ownKeys.effort] ?? defaultEffort)
  };
}

export function seedStages(saved: PersistedSettings): Record<StageId, StageConfig> {
  return Object.fromEntries(
    AI_STAGE_IDS.map((stage) => [stage, seedStage(stage, saved)])
  ) as Record<StageId, StageConfig>;
}

/** Flatten every stage's config back into the persisted key names. */
export function stageFieldsToPersist(stages: Record<StageId, StageConfig>): PersistedSettings {
  const bag: Record<string, string> = {};
  for (const stage of AI_STAGES) {
    const keys = stageSettingsKeys(stage);
    const config = stages[stage.id];
    bag[keys.provider] = config.provider;
    bag[keys.model] = config.selectedModel;
    bag[keys.effort] = config.cliReasoningEffort;
  }
  return bag as PersistedSettings;
}
