import { useEffect, useMemo, useState } from "react";
import {
  cliReasoningEffortOptionsFor,
  defaultCliReasoningEffort,
  providerOptions
} from "../config/aiOptions";
import { loadSettings, saveSettings, type PersistedSettings } from "../lib/settings";
import type { AiProviderValue } from "../config/aiOptions";
import type { StageConfig, StageId } from "../lib/aiRequest";
import type { CitizenshipStatus } from "../lib/candidateFacts";

const STAGE_IDS: StageId[] = ["distill", "tailor", "review"];

// Seed one stage's config from the persisted settings, using each stage's own
// key prefix (Tailor's is unprefixed for back-compat with the original
// single-stage settings shape; Review/Distill use audit*/distill*). API keys
// are never persisted, so every stage always starts with an empty key.
function seedStage(stage: StageId, saved: PersistedSettings): StageConfig {
  if (stage === "tailor") {
    const provider = saved.aiProvider ?? "claude-cli";
    return {
      provider,
      apiKey: "",
      apiBaseUrl: saved.apiBaseUrl ?? "",
      selectedModel: saved.selectedModel ?? "claude-sonnet-5",
      customModel: saved.customModel ?? "",
      cliReasoningEffort: saved.cliReasoningEffort ?? defaultCliReasoningEffort(provider)
    };
  }
  if (stage === "review") {
    const provider = saved.auditProvider ?? "claude-cli";
    return {
      provider,
      apiKey: "",
      apiBaseUrl: saved.auditApiBaseUrl ?? "",
      selectedModel: saved.auditSelectedModel ?? "claude-sonnet-5",
      customModel: saved.auditCustomModel ?? "",
      cliReasoningEffort: saved.auditCliReasoningEffort ?? defaultCliReasoningEffort(provider)
    };
  }
  const provider = saved.distillProvider ?? "claude-cli";
  return {
    provider,
    apiKey: "",
    apiBaseUrl: saved.distillApiBaseUrl ?? "",
    selectedModel: saved.distillSelectedModel ?? "claude-sonnet-5",
    customModel: saved.distillCustomModel ?? "",
    cliReasoningEffort: saved.distillCliReasoningEffort ?? defaultCliReasoningEffort(provider)
  };
}

// Owns every auto-saved AI preference: each stage's (Distill/Tailor/Review)
// provider/model/key/base-URL/reasoning-effort config, plus the polish prefs
// that persist alongside them (honest context and custom instructions). All of
// these share one debounced localStorage write, so they live together here
// rather than scattered across App. API keys for every stage are intentionally
// NOT persisted.
export function useAiSettings() {
  const saved = useMemo(() => loadSettings(), []);

  const [stages, setStages] = useState<Record<StageId, StageConfig>>(() => ({
    distill: seedStage("distill", saved),
    tailor: seedStage("tailor", saved),
    review: seedStage("review", saved)
  }));

  // Per-section expand/collapse state for the AI menu (Distill / Tailor / Review),
  // persisted so a collapsed section stays collapsed across reloads. All start open.
  const [sectionOpen, setSectionOpen] = useState<{ distill: boolean; tailor: boolean; review: boolean }>({
    distill: saved.sectionOpen?.distill ?? true,
    tailor: saved.sectionOpen?.tailor ?? true,
    review: saved.sectionOpen?.review ?? true
  });

  const [honestContext, setHonestContext] = useState(saved.honestContext ?? "");
  const [customInstructions, setCustomInstructions] = useState(saved.customInstructions ?? "");
  // Default "tailor" (no review) — preserve the user's choice once they opt in.
  // Legacy strictReview boolean is migrated to polishStages in settings.ts coerce().
  const [polishStages, setPolishStages] = useState<"tailor" | "review" | "both">(saved.polishStages ?? "tailor");
  const [citizenshipStatus, setCitizenshipStatus] = useState<CitizenshipStatus>(saved.citizenshipStatus ?? "unspecified");
  const [legallyAuthorizedToWork, setLegallyAuthorizedToWork] = useState(saved.legallyAuthorizedToWork ?? true);
  const [requiresSponsorship, setRequiresSponsorship] = useState(saved.requiresSponsorship ?? false);

  // Auto-save preferences so they survive reloads. Debounced so the free-text
  // fields (honest context, custom instructions) don't serialize + write
  // localStorage on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => {
      saveSettings({
        aiProvider: stages.tailor.provider,
        selectedModel: stages.tailor.selectedModel,
        customModel: stages.tailor.customModel,
        cliReasoningEffort: stages.tailor.cliReasoningEffort,
        apiBaseUrl: stages.tailor.apiBaseUrl,
        auditProvider: stages.review.provider,
        auditSelectedModel: stages.review.selectedModel,
        auditCustomModel: stages.review.customModel,
        auditCliReasoningEffort: stages.review.cliReasoningEffort,
        auditApiBaseUrl: stages.review.apiBaseUrl,
        distillProvider: stages.distill.provider,
        distillSelectedModel: stages.distill.selectedModel,
        distillCustomModel: stages.distill.customModel,
        distillCliReasoningEffort: stages.distill.cliReasoningEffort,
        distillApiBaseUrl: stages.distill.apiBaseUrl,
        sectionOpen,
        honestContext,
        customInstructions,
        polishStages,
        citizenshipStatus,
        legallyAuthorizedToWork,
        requiresSponsorship
      });
    }, 400);
    return () => clearTimeout(id);
  }, [
    stages,
    sectionOpen,
    honestContext,
    customInstructions,
    polishStages,
    citizenshipStatus,
    legallyAuthorizedToWork,
    requiresSponsorship
  ]);

  // Keep each stage's reasoning effort valid for its selected model — the tiers
  // a model exposes vary (Haiku none; Opus/Sonnet 4.6 lack xhigh). When the
  // current value isn't offered by the model, fall back to the provider default
  // (always a member of any non-empty tier list). An empty list (Haiku / non-CLI)
  // hides the control, so the leftover value is inert and left untouched.
  useEffect(() => {
    setStages((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const stage of STAGE_IDS) {
        const config = prev[stage];
        const model = config.selectedModel === "custom" ? config.customModel : config.selectedModel;
        const options = cliReasoningEffortOptionsFor(config.provider, model);
        if (options && options.length > 0 && !options.some((option) => option.value === config.cliReasoningEffort)) {
          next[stage] = { ...config, cliReasoningEffort: defaultCliReasoningEffort(config.provider) };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [stages]);

  function updateStage(stage: StageId, patch: Partial<StageConfig>) {
    setStages((prev) => ({ ...prev, [stage]: { ...prev[stage], ...patch } }));
  }

  // Switching a stage's provider resets its key/base-URL/model/effort/custom-model
  // to that provider's defaults, mirroring the original per-stage handlers.
  function changeStageProvider(stage: StageId, value: AiProviderValue) {
    const option = providerOptions.find((item) => item.value === value);
    setStages((prev) => ({
      ...prev,
      [stage]: {
        provider: value,
        apiKey: "",
        apiBaseUrl: option?.baseUrl ?? "",
        selectedModel: option?.model ?? "",
        customModel: "",
        cliReasoningEffort: defaultCliReasoningEffort(value)
      }
    }));
  }

  function toggleSection(stage: StageId) {
    setSectionOpen((prev) => ({ ...prev, [stage]: !prev[stage] }));
  }

  // The segmented [Distill | Tailor | Review] buttons in each section COPY one
  // stage's full provider config into another (e.g. clicking "Distill" inside the
  // Tailor section copies Distill's settings onto Tailor). It's a one-shot copy,
  // not a live link — the stages can diverge again afterward. Includes the API key
  // (in-memory only) so a copied hosted-provider stage is immediately usable.
  function copyStage(from: StageId, to: StageId) {
    if (from === to) return;
    setStages((prev) => ({ ...prev, [to]: { ...prev[from] } }));
  }

  return {
    stages,
    updateStage,
    changeStageProvider,
    sectionOpen,
    toggleSection,
    copyStage,
    honestContext,
    setHonestContext,
    polishStages,
    setPolishStages,
    citizenshipStatus,
    setCitizenshipStatus,
    legallyAuthorizedToWork,
    setLegallyAuthorizedToWork,
    requiresSponsorship,
    setRequiresSponsorship,
    customInstructions,
    setCustomInstructions
  };
}
