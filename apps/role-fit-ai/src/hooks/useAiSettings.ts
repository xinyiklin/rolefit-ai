import { useCallback, useEffect, useMemo, useState } from "react";
import {
  cliReasoningEffortOptionsFor,
  defaultCliReasoningEffort,
  providerOptions
} from "../config/aiOptions";
import { AI_STAGE_IDS } from "../config/aiStages";
import { clearStoredSettings, loadSettings, saveSettings } from "../lib/settings";
import type { AiProviderValue } from "../config/aiOptions";
import { seedStages, stageFieldsToPersist } from "../lib/stageSettings";
import type { StageConfig, StageId } from "../lib/aiRequest";
import type { CitizenshipStatus, EducationLevel } from "../lib/candidateFacts";
import type { AutoPolishThreshold } from "../../shared/quickFitContract.ts";

// Owns every auto-saved AI preference: each stage's provider/model/reasoning-effort
// config, the shared and per-stage guidance, and candidate facts. These share
// one debounced localStorage write, so
// they live together here rather than scattered across App. Credentials stay in
// the local companion.
export function useAiSettings() {
  const saved = useMemo(() => loadSettings(), []);

  const [stages, setStages] = useState<Record<StageId, StageConfig>>(() => seedStages(saved));

  const [honestContext, setHonestContext] = useState(saved.honestContext ?? "");
  const [customInstructions, setCustomInstructions] = useState(saved.customInstructions ?? "");
  const [stageCustomInstructions, setStageCustomInstructions] = useState<Partial<Record<StageId, string>>>(
    () => saved.stageCustomInstructions ?? {}
  );
  const [runInitialFit, setRunInitialFit] = useState(saved.runInitialFit ?? true);
  const [runFinalCheck, setRunFinalCheck] = useState(saved.runFinalCheck ?? true);
  const [autoPolishResume, setAutoPolishResume] = useState(saved.autoPolishResume ?? false);
  const [resumeAutoPolishThreshold, setResumeAutoPolishThreshold] = useState<AutoPolishThreshold>(
    saved.resumeAutoPolishThreshold ?? "REASONABLE"
  );
  const [autoPolishCoverLetter, setAutoPolishCoverLetter] = useState(saved.autoPolishCoverLetter ?? false);
  const [coverLetterAutoPolishThreshold, setCoverLetterAutoPolishThreshold] = useState<AutoPolishThreshold>(
    saved.coverLetterAutoPolishThreshold ?? "STRONG"
  );
  const [citizenshipStatus, setCitizenshipStatus] = useState<CitizenshipStatus>(saved.citizenshipStatus ?? "unspecified");
  const [legallyAuthorizedToWork, setLegallyAuthorizedToWork] = useState(saved.legallyAuthorizedToWork ?? true);
  const [requiresSponsorship, setRequiresSponsorship] = useState(saved.requiresSponsorship ?? false);
  const [educationLevel, setEducationLevel] = useState<EducationLevel>(saved.educationLevel ?? "unspecified");
  const [major, setMajor] = useState(saved.major ?? "");

  // Auto-save preferences so they survive reloads. Debounced so the free-text
  // fields (honest context, custom instructions) don't serialize + write
  // localStorage on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => {
      saveSettings({
        ...stageFieldsToPersist(stages),
        honestContext,
        customInstructions,
        stageCustomInstructions,
        runInitialFit,
        runFinalCheck,
        autoPolishResume,
        resumeAutoPolishThreshold,
        autoPolishCoverLetter,
        coverLetterAutoPolishThreshold,
        citizenshipStatus,
        legallyAuthorizedToWork,
        requiresSponsorship,
        educationLevel,
        major
      });
    }, 400);
    return () => clearTimeout(id);
  }, [
    stages,
    honestContext,
    customInstructions,
    stageCustomInstructions,
    runInitialFit,
    runFinalCheck,
    autoPolishResume,
    resumeAutoPolishThreshold,
    autoPolishCoverLetter,
    coverLetterAutoPolishThreshold,
    citizenshipStatus,
    legallyAuthorizedToWork,
    requiresSponsorship,
    educationLevel,
    major
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
      for (const stage of AI_STAGE_IDS) {
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

  // The "Copy settings from…" control in each stage section COPIES one stage's
  // full provider config into another. It's a one-shot copy, not a live link —
  // the stages can diverge again afterward.
  function copyStage(from: StageId, to: StageId) {
    if (from === to) return;
    setStages((prev) => ({ ...prev, [to]: { ...prev[from] } }));
  }

  function setStageCustomInstruction(stage: StageId, text: string) {
    setStageCustomInstructions((prev) => {
      // Drop an emptied override rather than storing "" — a blank override and
      // "no override" must mean the same thing (inherit the shared guidance),
      // and only one of them should ever be persisted.
      if (!text.trim()) {
        if (prev[stage] === undefined) return prev;
        const next = { ...prev };
        delete next[stage];
        return next;
      }
      return { ...prev, [stage]: text };
    });
  }

  // Resolve the guidance one stage actually sends: its own override when it has
  // non-blank text, otherwise the shared instructions.
  const customInstructionsFor = useCallback(
    (stage: StageId) => {
      const override = stageCustomInstructions[stage];
      return override && override.trim() ? override : customInstructions;
    },
    [customInstructions, stageCustomInstructions]
  );

  // Discard every stored preference and return the in-memory state to the same
  // defaults a fresh origin would get.
  function resetSettings() {
    clearStoredSettings();
    setStages(seedStages({}));
    setHonestContext("");
    setCustomInstructions("");
    setStageCustomInstructions({});
    setRunInitialFit(true);
    setRunFinalCheck(true);
    setAutoPolishResume(false);
    setResumeAutoPolishThreshold("REASONABLE");
    setAutoPolishCoverLetter(false);
    setCoverLetterAutoPolishThreshold("STRONG");
    setCitizenshipStatus("unspecified");
    setLegallyAuthorizedToWork(true);
    setRequiresSponsorship(false);
    setEducationLevel("unspecified");
    setMajor("");
  }

  return {
    stages,
    updateStage,
    changeStageProvider,
    copyStage,
    honestContext,
    setHonestContext,
    runInitialFit,
    setRunInitialFit,
    runFinalCheck,
    setRunFinalCheck,
    autoPolishResume,
    setAutoPolishResume,
    resumeAutoPolishThreshold,
    setResumeAutoPolishThreshold,
    autoPolishCoverLetter,
    setAutoPolishCoverLetter,
    coverLetterAutoPolishThreshold,
    setCoverLetterAutoPolishThreshold,
    citizenshipStatus,
    setCitizenshipStatus,
    legallyAuthorizedToWork,
    setLegallyAuthorizedToWork,
    requiresSponsorship,
    setRequiresSponsorship,
    educationLevel,
    setEducationLevel,
    major,
    setMajor,
    customInstructions,
    setCustomInstructions,
    stageCustomInstructions,
    setStageCustomInstruction,
    customInstructionsFor,
    resetSettings
  };
}
