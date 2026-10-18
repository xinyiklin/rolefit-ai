import { cliReasoningEffortOptionsFor, defaultCliReasoningEffort } from "../../shared/cliReasoning.ts";
import {
  modelOptionsByProvider,
  providerFor,
  providerOption,
  type AiProviderValue,
  type AiTransport,
  type AiVendor
} from "../config/aiOptions.ts";
import { AI_STAGE_IDS } from "../config/aiStages.ts";
import type { StageConfig, StageId } from "./aiRequest.ts";
import { PROVIDER_PLANS, type ProviderPlanId } from "./stageSettings.ts";

// Plan and transport are one-shot rewrites of the per-stage settings. Their
// shown state is derived from the stages, so the stage rows stay the only
// stored source of which provider runs each stage.

type Stages = Record<StageId, StageConfig>;
export type VendorTransportState = AiTransport | "mixed" | "unused";
export type StagesChange = { stages: Stages; adjusted: number };

const EFFORT_ORDER = ["low", "medium", "high", "xhigh", "max", "ultra"];

function vendorOf(provider: string): AiVendor | undefined {
  return providerOption(provider)?.vendor;
}

function mapStages(stages: Stages, update: (config: StageConfig, stage: StageId) => StageConfig): Stages {
  return Object.fromEntries(AI_STAGE_IDS.map((stage) => [stage, update(stages[stage], stage)])) as Stages;
}

// An unsupported effort steps down to the nearest supported one (Codex Ultra
// becomes Max on the API) instead of resetting to the vendor default.
function nearestEffort(provider: AiProviderValue, model: string, effort: string): string {
  const options = cliReasoningEffortOptionsFor(provider, model) ?? [];
  if (!options.length || options.some((option) => option.value === effort)) return options.length ? effort : "";
  const rank = EFFORT_ORDER.indexOf(effort);
  const below = options.filter((option) => EFFORT_ORDER.indexOf(option.value) <= rank);
  return below.length ? below[below.length - 1].value : defaultCliReasoningEffort(provider);
}

function moveTo(config: StageConfig, provider: AiProviderValue): StageConfig {
  const selectedModel = modelOptionsByProvider[provider].some((option) => option.value === config.selectedModel)
    ? config.selectedModel
    : providerOption(provider)!.model;
  return { provider, selectedModel, cliReasoningEffort: nearestEffort(provider, selectedModel, config.cliReasoningEffort) };
}

function countAdjusted(intended: Stages, actual: Stages): number {
  return AI_STAGE_IDS.filter((stage) =>
    intended[stage].selectedModel !== actual[stage].selectedModel
    || intended[stage].cliReasoningEffort !== actual[stage].cliReasoningEffort
  ).length;
}

export function currentPlan(stages: Stages): ProviderPlanId | "custom" {
  const ids = Object.keys(PROVIDER_PLANS) as ProviderPlanId[];
  return ids.find((id) => AI_STAGE_IDS.every((stage) => {
    const planned = PROVIDER_PLANS[id][stage];
    const actual = stages[stage];
    return vendorOf(actual.provider) === vendorOf(planned.provider)
      && actual.selectedModel === planned.selectedModel
      && actual.cliReasoningEffort === planned.cliReasoningEffort;
  })) ?? "custom";
}

export function vendorTransport(stages: Stages, vendor: AiVendor): VendorTransportState {
  const transports = new Set(
    AI_STAGE_IDS.map((stage) => providerOption(stages[stage].provider))
      .filter((option) => option?.vendor === vendor)
      .map((option) => option!.transport)
  );
  if (!transports.size) return "unused";
  return transports.size > 1 ? "mixed" : [...transports][0];
}

// The transport a plan uses for a vendor: the one its stages already use when
// that provider is added, else an added CLI, else an added API, else CLI.
export function preferredTransport(stages: Stages, vendor: AiVendor, added: ReadonlySet<string>): AiTransport {
  const current = vendorTransport(stages, vendor);
  if ((current === "cli" || current === "api") && added.has(providerFor(vendor, current))) return current;
  if (added.has(providerFor(vendor, "cli"))) return "cli";
  return added.has(providerFor(vendor, "api")) ? "api" : "cli";
}

export function switchVendorTransport(stages: Stages, vendor: AiVendor, transport: AiTransport): StagesChange {
  const provider = providerFor(vendor, transport);
  const next = mapStages(stages, (config) => (vendorOf(config.provider) === vendor ? moveTo(config, provider) : config));
  return { stages: next, adjusted: countAdjusted(stages, next) };
}

export function applyProviderPlan(
  plan: ProviderPlanId,
  transports: Readonly<Record<AiVendor, AiTransport>>
): StagesChange {
  const planned = PROVIDER_PLANS[plan] as Stages;
  const next = mapStages(planned, (config) => moveTo(config, providerFor(vendorOf(config.provider)!, transports[vendorOf(config.provider)!])));
  return { stages: next, adjusted: countAdjusted(planned, next) };
}
