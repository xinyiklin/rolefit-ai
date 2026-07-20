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
// single-stage settings shape; Review/Distill use audit*/distill*).
function seedStage(stage: StageId, saved: PersistedSettings): StageConfig {
  if (stage === "tailor") {
    const provider = saved.aiProvider ?? "claude-cli";
    return {
      provider,
      selectedModel: saved.selectedModel ?? providerOptions.find((option) => option.value === provider)?.model ?? "claude-sonnet-5",
      cliReasoningEffort: saved.cliReasoningEffort ?? defaultCliReasoningEffort(provider)
    };
  }
  if (stage === "review") {
    const provider = saved.auditProvider ?? "claude-cli";
    return {
      provider,
      selectedModel: saved.auditSelectedModel ?? providerOptions.find((option) => option.value === provider)?.model ?? "claude-sonnet-5",
      cliReasoningEffort: saved.auditCliReasoningEffort ?? defaultCliReasoningEffort(provider)
    };
  }
  const provider = saved.distillProvider ?? "claude-cli";
  return {
    provider,
    selectedModel: saved.distillSelectedModel ?? providerOptions.find((option) => option.value === provider)?.model ?? "claude-sonnet-5",
    cliReasoningEffort: saved.distillCliReasoningEffort ?? defaultCliReasoningEffort(provider)
  };
}

// Owns every auto-saved AI preference: each stage's (Distill/Tailor/Review)
// provider/model/reasoning-effort config, plus the polish prefs
// that persist alongside them (honest context and custom instructions). All of
// these share one debounced localStorage write, so they live together here
// rather than scattered across App. Credentials stay in the local companion.
export function useAiSettings() {
  const saved = useMemo(() => loadSettings(), []);

  const [stages, setStages] = useState<Record<StageId, StageConfig>>(() => ({
    distill: seedStage("distill", saved),
    tailor: seedStage("tailor", saved),
    review: seedStage("review", saved)
  }));

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
        cliReasoningEffort: stages.tailor.cliReasoningEffort,
        auditProvider: stages.review.provider,
        auditSelectedModel: stages.review.selectedModel,
        auditCliReasoningEffort: stages.review.cliReasoningEffort,
        distillProvider: stages.distill.provider,
        distillSelectedModel: stages.distill.selectedModel,
        distillCliReasoningEffort: stages.distill.cliReasoningEffort,
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
        const options = cliReasoningEffortOptionsFor(config.provider, config.selectedModel);
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

  // Switching a stage's provider resets its model/effort
  // to that provider's defaults, mirroring the original per-stage handlers.
  function changeStageProvider(stage: StageId, value: AiProviderValue) {
    const option = providerOptions.find((item) => item.value === value);
    setStages((prev) => ({
      ...prev,
      [stage]: {
        provider: value,
        selectedModel: option?.model ?? "",
        cliReasoningEffort: defaultCliReasoningEffort(value)
      }
    }));
  }

  // The segmented [Distill | Tailor | Review] buttons in each section COPY one
  // stage's full provider config into another (e.g. clicking "Distill" inside the
  // Tailor section copies Distill's settings onto Tailor). It's a one-shot copy,
  // not a live link — the stages can diverge again afterward.
  function copyStage(from: StageId, to: StageId) {
    if (from === to) return;
    setStages((prev) => ({ ...prev, [to]: { ...prev[from] } }));
  }

  return {
    stages,
    updateStage,
    changeStageProvider,
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
