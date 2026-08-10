import { defaultCliReasoningEffort, providerOptions } from "../config/aiOptions.ts";
import { AI_STAGES, AI_STAGE_IDS, stageSettingsKeys } from "../config/aiStages.ts";
import type { AiProviderValue } from "../config/aiOptions.ts";
import type { StageConfig, StageId } from "./aiRequest.ts";
import type { PersistedSettings } from "./settings.ts";

// Pure seeding of the per-stage AI configs from persisted settings, and the
// reverse flattening back to persisted keys. Extracted from useAiSettings so the
// stage defaults have a test seam that does not need React.

const DEFAULT_PROVIDER: AiProviderValue = "claude-cli";
const DEFAULT_MODEL = "claude-sonnet-5";

export function seedStage(stage: StageId, saved: PersistedSettings): StageConfig {
  const ownKeys = stageSettingsKeys(AI_STAGES.find((entry) => entry.id === stage)!);
  const bag = saved as unknown as Record<string, string | undefined>;
  const provider = (bag[ownKeys.provider] as AiProviderValue | undefined) ?? DEFAULT_PROVIDER;
  return {
    provider,
    selectedModel:
      bag[ownKeys.model] ?? providerOptions.find((option) => option.value === provider)?.model ?? DEFAULT_MODEL,
    cliReasoningEffort: bag[ownKeys.effort] ?? defaultCliReasoningEffort(provider)
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
