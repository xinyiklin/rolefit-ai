import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cliReasoningEffortOptionsFor,
  defaultCliReasoningEffort,
  providerOptions
} from "../config/aiOptions";
import { AI_STAGE_IDS } from "../config/aiStages";
import { clearStoredSettings, loadSettings, saveSettings, type PersistedSettings } from "../lib/settings";
import type { AiProviderValue } from "../config/aiOptions";
import { seedStages, stageFieldsToPersist } from "../lib/stageSettings";
import type { StageConfig, StageId } from "../lib/aiRequest";
import type {
  AvailabilityNotice,
  CandidateExperience,
  CitizenshipStatus,
  DeclaredAnswer,
  EducationLevel
} from "../lib/candidateFacts";
import type { AutoPolishThreshold } from "../lib/autoPolishPolicy.ts";
import { materializeAiSettings } from "../lib/aiSettingsPersistence.ts";
import {
  WORKSPACE_PREFERENCES_APPLIED_EVENT,
  WORKSPACE_PREFERENCES_STATUS_EVENT,
  type WorkspacePreferencesStatus
} from "../lib/workspacePreferencesSync.ts";

// Owns every auto-saved AI preference: each stage's provider/model/reasoning-effort
// config, the shared and per-stage guidance, and candidate facts. These share
// one debounced workspace write with a localStorage cache, so they live together
// here rather than scattered across App. Credentials stay in the local companion.
export function useAiSettings() {
  const saved = useMemo(() => loadSettings(), []);
  const adoptedSettingsFingerprintRef = useRef<string | null>(null);
  const latestSettingsRef = useRef<PersistedSettings>(materializeAiSettings(saved));

  const [stages, setStages] = useState<Record<StageId, StageConfig>>(() => seedStages(saved));

  const [honestContext, setHonestContext] = useState(saved.honestContext ?? "");
  const [customInstructions, setCustomInstructions] = useState(saved.customInstructions ?? "");
  const [stageCustomInstructions, setStageCustomInstructions] = useState<Partial<Record<StageId, string>>>(
    () => saved.stageCustomInstructions ?? {}
  );
  const [runFitAssessment, setRunFitAssessment] = useState(saved.runFitAssessment ?? true);
  const [autoPolishResume, setAutoPolishResume] = useState(saved.autoPolishResume ?? false);
  const [resumeAutoPolishThreshold, setResumeAutoPolishThreshold] = useState<AutoPolishThreshold>(
    saved.resumeAutoPolishThreshold ?? "REASONABLE"
  );
  const [autoPolishCoverLetter, setAutoPolishCoverLetter] = useState(saved.autoPolishCoverLetter ?? false);
  const [coverLetterAutoPolishThreshold, setCoverLetterAutoPolishThreshold] = useState<AutoPolishThreshold>(
    saved.coverLetterAutoPolishThreshold ?? "STRONG"
  );
  const [citizenshipStatus, setCitizenshipStatus] = useState<CitizenshipStatus>(saved.citizenshipStatus ?? "unspecified");
  const [legallyAuthorizedToWork, setLegallyAuthorizedToWork] = useState<DeclaredAnswer>(
    saved.legallyAuthorizedToWork ?? "unspecified"
  );
  const [requiresSponsorship, setRequiresSponsorship] = useState<DeclaredAnswer>(
    saved.requiresSponsorship ?? "unspecified"
  );
  const [educationLevel, setEducationLevel] = useState<EducationLevel>(saved.educationLevel ?? "unspecified");
  const [major, setMajor] = useState(saved.major ?? "");
  const [gpa, setGpa] = useState<number | undefined>(saved.gpa);
  const [availabilityNotice, setAvailabilityNotice] = useState<AvailabilityNotice>(
    saved.availabilityNotice ?? "unspecified"
  );
  const [availabilityDate, setAvailabilityDate] = useState(saved.availabilityDate ?? "");
  const [experienceProfile, setExperienceProfile] = useState<CandidateExperience[]>(saved.experienceProfile ?? []);
  const [workspacePreferencesStatus, setWorkspacePreferencesStatus] = useState<WorkspacePreferencesStatus>("idle");

  // A different RoleFit client can update the canonical workspace record while
  // this tab is open. workspacePreferencesSync refreshes it on focus and emits
  // this event after updating the browser cache; reconcile the hook's live
  // state so the UI does not immediately write an older snapshot back.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const adopt = () => {
      const next = loadSettings();
      adoptedSettingsFingerprintRef.current = JSON.stringify(materializeAiSettings(next));
      setStages(seedStages(next));
      setHonestContext(next.honestContext ?? "");
      setCustomInstructions(next.customInstructions ?? "");
      setStageCustomInstructions(next.stageCustomInstructions ?? {});
      setRunFitAssessment(next.runFitAssessment ?? true);
      setAutoPolishResume(next.autoPolishResume ?? false);
      setResumeAutoPolishThreshold(next.resumeAutoPolishThreshold ?? "REASONABLE");
      setAutoPolishCoverLetter(next.autoPolishCoverLetter ?? false);
      setCoverLetterAutoPolishThreshold(next.coverLetterAutoPolishThreshold ?? "STRONG");
      setCitizenshipStatus(next.citizenshipStatus ?? "unspecified");
      setLegallyAuthorizedToWork(next.legallyAuthorizedToWork ?? "unspecified");
      setRequiresSponsorship(next.requiresSponsorship ?? "unspecified");
      setEducationLevel(next.educationLevel ?? "unspecified");
      setMajor(next.major ?? "");
      setGpa(next.gpa);
      setAvailabilityNotice(next.availabilityNotice ?? "unspecified");
      setAvailabilityDate(next.availabilityDate ?? "");
      setExperienceProfile(next.experienceProfile ?? []);
    };
    window.addEventListener(WORKSPACE_PREFERENCES_APPLIED_EVENT, adopt);
    const updateStatus = (event: Event) => {
      const status = (event as CustomEvent<WorkspacePreferencesStatus>).detail;
      if (["idle", "saving", "saved", "error"].includes(status)) setWorkspacePreferencesStatus(status);
    };
    window.addEventListener(WORKSPACE_PREFERENCES_STATUS_EVENT, updateStatus);
    return () => {
      window.removeEventListener(WORKSPACE_PREFERENCES_APPLIED_EVENT, adopt);
      window.removeEventListener(WORKSPACE_PREFERENCES_STATUS_EVENT, updateStatus);
    };
  }, []);

  // The network owner keeps a durable pending marker, but it can only recover
  // values that reached the browser cache. Capture the latest rendered settings
  // synchronously when a reload or tab close interrupts the 400 ms UI debounce.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const persistLatestSettings = () => saveSettings(latestSettingsRef.current);
    window.addEventListener("pagehide", persistLatestSettings);
    return () => window.removeEventListener("pagehide", persistLatestSettings);
  }, []);

  // Auto-save preferences so they survive reloads. Debounced so the free-text
  // fields (honest context, custom instructions) do not rewrite the cache and
  // canonical workspace record on every keystroke.
  useEffect(() => {
    const nextSettings: PersistedSettings = materializeAiSettings({
      ...stageFieldsToPersist(stages),
      honestContext,
      customInstructions,
      stageCustomInstructions,
      runFitAssessment: runFitAssessment,
      autoPolishResume,
      resumeAutoPolishThreshold,
      autoPolishCoverLetter,
      coverLetterAutoPolishThreshold,
      citizenshipStatus,
      legallyAuthorizedToWork,
      requiresSponsorship,
      educationLevel,
      major,
      gpa,
      availabilityNotice,
      availabilityDate,
      experienceProfile
    });
    latestSettingsRef.current = nextSettings;
    const adoptedFingerprint = adoptedSettingsFingerprintRef.current;
    adoptedSettingsFingerprintRef.current = null;
    if (adoptedFingerprint === JSON.stringify(nextSettings)) {
      return;
    }
    const id = setTimeout(() => {
      saveSettings(nextSettings);
    }, 400);
    return () => clearTimeout(id);
  }, [
    stages,
    honestContext,
    customInstructions,
    stageCustomInstructions,
    runFitAssessment,
    autoPolishResume,
    resumeAutoPolishThreshold,
    autoPolishCoverLetter,
    coverLetterAutoPolishThreshold,
    citizenshipStatus,
    legallyAuthorizedToWork,
    requiresSponsorship,
    educationLevel,
    major,
    gpa,
    availabilityNotice,
    availabilityDate,
    experienceProfile
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
    setRunFitAssessment(true);
    setAutoPolishResume(false);
    setResumeAutoPolishThreshold("REASONABLE");
    setAutoPolishCoverLetter(false);
    setCoverLetterAutoPolishThreshold("STRONG");
    setCitizenshipStatus("unspecified");
    setLegallyAuthorizedToWork("unspecified");
    setRequiresSponsorship("unspecified");
    setEducationLevel("unspecified");
    setMajor("");
    setGpa(undefined);
    setAvailabilityNotice("unspecified");
    setAvailabilityDate("");
    setExperienceProfile([]);
  }

  return {
    stages,
    updateStage,
    changeStageProvider,
    copyStage,
    honestContext,
    setHonestContext,
    runFitAssessment,
    setRunFitAssessment,
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
    gpa,
    setGpa,
    availabilityNotice,
    setAvailabilityNotice,
    availabilityDate,
    setAvailabilityDate,
    experienceProfile,
    setExperienceProfile,
    workspacePreferencesStatus,
    customInstructions,
    setCustomInstructions,
    stageCustomInstructions,
    setStageCustomInstruction,
    customInstructionsFor,
    resetSettings
  };
}
