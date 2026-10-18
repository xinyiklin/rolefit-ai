import { reconcileCliReasoningEffort } from "../../shared/cliReasoning.ts";
import { defaultCliReasoningEffort, providerOption } from "../config/aiOptions.ts";
import { AI_STAGES, AI_STAGE_IDS, stageSettingsKeys } from "../config/aiStages.ts";
import type { AiProviderValue } from "../config/aiOptions.ts";
import type { StageConfig, StageId } from "./aiRequest.ts";
import type { PersistedSettings } from "./settings.ts";

export type ProviderPlanId = "hybrid" | "claude" | "openai";

// One vendor/model/effort per stage. Plans are stored on the CLI providers; the
// vendor's transport (CLI or API) is chosen separately. Hybrid is the
// benchmarked default; see docs/engineering/benchmarks.md for each plan's evidence.
export const PROVIDER_PLANS: Readonly<Record<ProviderPlanId, Readonly<Record<StageId, StageConfig>>>> = {
  hybrid: {
    "job-analysis": { provider: "claude-cli", selectedModel: "claude-sonnet-5-5", cliReasoningEffort: "low" },
    "fit-assessment": { provider: "claude-cli", selectedModel: "claude-sonnet-5-5", cliReasoningEffort: "low" },
    "resume-polish": { provider: "codex-cli", selectedModel: "gpt-6.1-sol", cliReasoningEffort: "medium" },
    "cover-polish": { provider: "codex-cli", selectedModel: "gpt-6.1-sol", cliReasoningEffort: "medium" },
    "application-answers": { provider: "claude-cli", selectedModel: "claude-opus-5-5", cliReasoningEffort: "high" },
    "application-review": { provider: "claude-cli", selectedModel: "claude-sonnet-5-5", cliReasoningEffort: "low" },
    "resume-import": { provider: "claude-cli", selectedModel: "claude-sonnet-5-5", cliReasoningEffort: "low" }
  },
  claude: {
    "job-analysis": { provider: "claude-cli", selectedModel: "claude-sonnet-5-5", cliReasoningEffort: "low" },
    "fit-assessment": { provider: "claude-cli", selectedModel: "claude-sonnet-5-5", cliReasoningEffort: "low" },
    "resume-polish": { provider: "claude-cli", selectedModel: "claude-opus-5-5", cliReasoningEffort: "high" },
    "cover-polish": { provider: "claude-cli", selectedModel: "claude-opus-5-5", cliReasoningEffort: "high" },
    "application-answers": { provider: "claude-cli", selectedModel: "claude-opus-5-5", cliReasoningEffort: "high" },
    "application-review": { provider: "claude-cli", selectedModel: "claude-sonnet-5-5", cliReasoningEffort: "low" },
    "resume-import": { provider: "claude-cli", selectedModel: "claude-sonnet-5-5", cliReasoningEffort: "low" }
  },
  openai: {
    "job-analysis": { provider: "codex-cli", selectedModel: "gpt-6.1-sol", cliReasoningEffort: "low" },
    "fit-assessment": { provider: "codex-cli", selectedModel: "gpt-6.1-sol", cliReasoningEffort: "low" },
    "resume-polish": { provider: "codex-cli", selectedModel: "gpt-6.1-sol", cliReasoningEffort: "medium" },
    "cover-polish": { provider: "codex-cli", selectedModel: "gpt-6.1-sol", cliReasoningEffort: "medium" },
    "application-answers": { provider: "codex-cli", selectedModel: "gpt-6.1-sol", cliReasoningEffort: "medium" },
    "application-review": { provider: "codex-cli", selectedModel: "gpt-6.1-sol", cliReasoningEffort: "low" },
    "resume-import": { provider: "codex-cli", selectedModel: "gpt-6.1-sol", cliReasoningEffort: "low" }
  }
};

export function stageDefault(stage: StageId): StageConfig {
  return PROVIDER_PLANS.hybrid[stage];
}

// The recommended setting a stage seeds when it moves to a provider: the first
// plan that runs this stage on the provider's vendor, on the provider's transport.
function recommendedFor(stage: StageId, provider: AiProviderValue): StageConfig | undefined {
  const vendor = providerOption(provider)?.vendor;
  const plan = (["hybrid", "claude", "openai"] as const)
    .map((id) => PROVIDER_PLANS[id][stage])
    .find((config) => providerOption(config.provider)?.vendor === vendor);
  return plan && { ...plan, provider };
}

export function seedStage(stage: StageId, saved: PersistedSettings): StageConfig {
  if (stage === "application-review" && saved.applicationReviewProvider === undefined) return seedStage("fit-assessment", saved);
  const ownKeys = stageSettingsKeys(AI_STAGES.find((entry) => entry.id === stage)!);
  const bag = saved as unknown as Record<string, string | undefined>;
  const defaults = stageDefault(stage);
  // Sparse saved model choices used Claude CLI before stage-specific defaults.
  const provider = (bag[ownKeys.provider] as AiProviderValue | undefined) ?? (bag[ownKeys.model] !== undefined ? "claude-cli" : defaults.provider);
  const recommended = recommendedFor(stage, provider);
  const selectedModel = bag[ownKeys.model] ?? recommended?.selectedModel ?? providerOption(provider)?.model ?? defaults.selectedModel;
  const defaultEffort = recommended && selectedModel === recommended.selectedModel
    ? recommended.cliReasoningEffort : defaultCliReasoningEffort(provider);
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
