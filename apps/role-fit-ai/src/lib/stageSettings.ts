import { defaultCliReasoningEffort, providerOptions } from "../config/aiOptions.ts";
import { AI_STAGES, AI_STAGE_IDS, stageSettingsKeys } from "../config/aiStages.ts";
import type { AiProviderValue } from "../config/aiOptions.ts";
import type { StageConfig, StageId } from "./aiRequest.ts";
import type { PersistedSettings } from "./settings.ts";

// Pure seeding of the per-stage AI configs from persisted settings, and the
// reverse flattening back to persisted keys. Extracted from useAiSettings so the
// cover/answers inheritance below has a test seam that does not need React.

const DEFAULT_PROVIDER: AiProviderValue = "claude-cli";
const DEFAULT_MODEL = "claude-sonnet-5";

const TAILOR_KEYS = stageSettingsKeys(AI_STAGES.find((entry) => entry.id === "tailor")!);

// Stages that had no settings of their own before: they ran on the Tailor config.
// An install that predates the split inherits Tailor's provider so its behavior is
// identical across the upgrade rather than silently switching provider.
//
// The inheritance lives HERE, not in normalizeSettings: settings-key migrations
// may rename existing values, but must never seed a stage that had no persisted
// configuration of its own.
export const STAGES_INHERITING_TAILOR = new Set<StageId>(["cover", "answers"]);

export function seedStage(stage: StageId, saved: PersistedSettings): StageConfig {
  const ownKeys = stageSettingsKeys(AI_STAGES.find((entry) => entry.id === stage)!);
  const bag = saved as unknown as Record<string, string | undefined>;
  // Take provider, model, and effort from ONE source. Mixing them would pair a
  // provider with another provider's model.
  const keys =
    bag[ownKeys.provider] === undefined && STAGES_INHERITING_TAILOR.has(stage) ? TAILOR_KEYS : ownKeys;
  const provider = (bag[keys.provider] as AiProviderValue | undefined) ?? DEFAULT_PROVIDER;
  return {
    provider,
    selectedModel:
      bag[keys.model] ?? providerOptions.find((option) => option.value === provider)?.model ?? DEFAULT_MODEL,
    cliReasoningEffort: bag[keys.effort] ?? defaultCliReasoningEffort(provider)
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
