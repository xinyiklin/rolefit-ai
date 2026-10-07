import { reconcileCliReasoningEffort } from "../../shared/cliReasoning.ts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AI_STAGES, stageSettingsKeys } from "../config/aiStages.ts";
import { clearStoredSettings, loadSettings, saveSettings, type PersistedSettings } from "../lib/settings";
import type { AiProviderValue } from "../config/aiOptions";
import { seedStage, seedStages, stageFieldsToPersist } from "../lib/stageSettings";
import type { StageConfig, StageId } from "../lib/aiRequest";
import type {
  AvailabilityNotice,
  CitizenshipStatus,
  DeclaredAnswer,
  EducationLevel
} from "../lib/candidateFacts";
import type { AutoPolishThreshold } from "../lib/autoPolishPolicy.ts";
import { materializeAiSettings } from "../lib/aiSettingsPersistence.ts";
import type { VariantExclusions, VariantKind } from "../lib/variantPool.ts";
import {
  WORKSPACE_PREFERENCES_APPLIED_EVENT,
  WORKSPACE_PREFERENCES_STATUS_EVENT,
  type WorkspacePreferencesStatus
} from "../lib/workspacePreferencesSync.ts";
import { changedSettingKeys, rebaseSettings } from "../lib/workspacePreferencesRebase.ts";

// Owns every auto-saved AI preference: each stage's provider/model/reasoning-effort
// config, the shared and per-stage guidance, and candidate facts. These share
// one debounced workspace write with a localStorage cache, so they live together
// here rather than scattered across App. Credentials stay in the local companion.
export function useAiSettings() {
  const saved = useMemo(() => loadSettings(), []);
  const adoptedSettingsFingerprintRef = useRef<string | null>(null);
  const latestSettingsRef = useRef<PersistedSettings>(materializeAiSettings(saved));
  // The settings last saved or adopted; rendered changes beyond it are still
  // inside the UI debounce.
  const committedSettingsRef = useRef<PersistedSettings>(latestSettingsRef.current);

  const [stages, setStages] = useState<Record<StageId, StageConfig>>(() => seedStages(saved));

  const [profileBackground, setProfileBackground] = useState(saved.profileBackground ?? "");
  const [customInstructions, setCustomInstructions] = useState(saved.customInstructions ?? "");
  const [stageCustomInstructions, setStageCustomInstructions] = useState<Partial<Record<StageId, string>>>(
    () => saved.stageCustomInstructions ?? {}
  );
  const [boldBulletKeywords, setBoldBulletKeywords] = useState(saved.boldBulletKeywords ?? true);
  const [fitAssessmentAuto, setFitAssessmentAuto] = useState(saved.fitAssessmentAuto ?? true);
  const [resumePolishAuto, setResumePolishAuto] = useState(saved.resumePolishAuto ?? false);
  const [resumePolishAutoThreshold, setResumePolishAutoThreshold] = useState<AutoPolishThreshold>(
    saved.resumePolishAutoThreshold ?? "REASONABLE"
  );
  const [coverPolishAuto, setCoverPolishAuto] = useState(saved.coverPolishAuto ?? false);
  const [coverPolishAutoThreshold, setCoverPolishAutoThreshold] = useState<AutoPolishThreshold>(
    saved.coverPolishAutoThreshold ?? "STRONG"
  );
  const [excludedResumeVariants, setExcludedResumeVariants] = useState<VariantExclusions>(
    saved.excludedResumeVariants ?? {}
  );
  const [excludedCoverLetterVariants, setExcludedCoverLetterVariants] = useState<VariantExclusions>(
    saved.excludedCoverLetterVariants ?? {}
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
  const [workspacePreferencesStatus, setWorkspacePreferencesStatus] = useState<WorkspacePreferencesStatus>("idle");

  // A different RoleFit client can update the canonical workspace record while
  // this tab is open. workspacePreferencesSync refreshes it on focus and emits
  // this event after updating the browser cache; reconcile the hook's live
  // state so the UI does not immediately write an older snapshot back. Edits
  // still inside the debounce stay on top and are saved after adoption.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const adopt = () => {
      const adopted = loadSettings();
      const unsaved = changedSettingKeys(committedSettingsRef.current, latestSettingsRef.current);
      const next = unsaved.length ? rebaseSettings(adopted, latestSettingsRef.current, unsaved) : adopted;
      committedSettingsRef.current = materializeAiSettings(adopted);
      adoptedSettingsFingerprintRef.current = JSON.stringify(committedSettingsRef.current);
      setStages(seedStages(next));
      setProfileBackground(next.profileBackground ?? "");
      setCustomInstructions(next.customInstructions ?? "");
      setStageCustomInstructions(next.stageCustomInstructions ?? {});
      setBoldBulletKeywords(next.boldBulletKeywords ?? true);
      setFitAssessmentAuto(next.fitAssessmentAuto ?? true);
      setResumePolishAuto(next.resumePolishAuto ?? false);
      setResumePolishAutoThreshold(next.resumePolishAutoThreshold ?? "REASONABLE");
      setCoverPolishAuto(next.coverPolishAuto ?? false);
      setCoverPolishAutoThreshold(next.coverPolishAutoThreshold ?? "STRONG");
      setExcludedResumeVariants(next.excludedResumeVariants ?? {});
      setExcludedCoverLetterVariants(next.excludedCoverLetterVariants ?? {});
      setCitizenshipStatus(next.citizenshipStatus ?? "unspecified");
      setLegallyAuthorizedToWork(next.legallyAuthorizedToWork ?? "unspecified");
      setRequiresSponsorship(next.requiresSponsorship ?? "unspecified");
      setEducationLevel(next.educationLevel ?? "unspecified");
      setMajor(next.major ?? "");
      setGpa(next.gpa);
      setAvailabilityNotice(next.availabilityNotice ?? "unspecified");
      setAvailabilityDate(next.availabilityDate ?? "");
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
    const persistLatestSettings = () => {
      committedSettingsRef.current = latestSettingsRef.current;
      saveSettings(latestSettingsRef.current);
    };
    window.addEventListener("pagehide", persistLatestSettings);
    return () => window.removeEventListener("pagehide", persistLatestSettings);
  }, []);

  // Auto-save preferences so they survive reloads. Debounced so the free-text
  // fields (Profile Background, custom instructions) do not rewrite the cache and
  // canonical workspace record on every keystroke.
  useEffect(() => {
    const nextSettings: PersistedSettings = materializeAiSettings({
      ...stageFieldsToPersist(stages),
      profileBackground,
      customInstructions,
      stageCustomInstructions,
      boldBulletKeywords,
      fitAssessmentAuto,
      resumePolishAuto,
      resumePolishAutoThreshold,
      coverPolishAuto,
      coverPolishAutoThreshold,
      excludedResumeVariants,
      excludedCoverLetterVariants,
      citizenshipStatus,
      legallyAuthorizedToWork,
      requiresSponsorship,
      educationLevel,
      major,
      gpa,
      availabilityNotice,
      availabilityDate
    });
    latestSettingsRef.current = nextSettings;
    const adoptedFingerprint = adoptedSettingsFingerprintRef.current;
    adoptedSettingsFingerprintRef.current = null;
    if (adoptedFingerprint === JSON.stringify(nextSettings)) {
      return;
    }
    const id = setTimeout(() => {
      committedSettingsRef.current = nextSettings;
      saveSettings(nextSettings);
    }, 400);
    return () => clearTimeout(id);
  }, [
    stages,
    profileBackground,
    customInstructions,
    stageCustomInstructions,
    boldBulletKeywords,
    fitAssessmentAuto,
    resumePolishAuto,
    resumePolishAutoThreshold,
    coverPolishAuto,
    coverPolishAutoThreshold,
    excludedResumeVariants,
    excludedCoverLetterVariants,
    citizenshipStatus,
    legallyAuthorizedToWork,
    requiresSponsorship,
    educationLevel,
    major,
    gpa,
    availabilityNotice,
    availabilityDate
  ]);

  function updateStage(stage: StageId, patch: Partial<StageConfig>) {
    setStages((prev) => {
      const next = { ...prev[stage], ...patch };
      next.cliReasoningEffort = reconcileCliReasoningEffort(next.provider, next.selectedModel, next.cliReasoningEffort);
      return { ...prev, [stage]: next };
    });
  }

  function changeStageProvider(stage: StageId, value: AiProviderValue) {
    const keys = stageSettingsKeys(AI_STAGES.find((entry) => entry.id === stage)!);
    setStages((prev) => ({
      ...prev,
      [stage]: seedStage(stage, { [keys.provider]: value })
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

  function setVariantEligibility(kind: VariantKind, fileName: string, eligible: boolean) {
    const update = (prev: VariantExclusions): VariantExclusions => {
      const excluded = Object.prototype.hasOwnProperty.call(prev, fileName);
      if (excluded === !eligible) return prev;
      if (!eligible) return { ...prev, [fileName]: true };
      const next = { ...prev };
      delete next[fileName];
      return next;
    };
    if (kind === "resume") setExcludedResumeVariants(update);
    else setExcludedCoverLetterVariants(update);
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
    setProfileBackground("");
    setCustomInstructions("");
    setStageCustomInstructions({});
    setBoldBulletKeywords(true);
    setFitAssessmentAuto(true);
    setResumePolishAuto(false);
    setResumePolishAutoThreshold("REASONABLE");
    setCoverPolishAuto(false);
    setCoverPolishAutoThreshold("STRONG");
    setExcludedResumeVariants({});
    setExcludedCoverLetterVariants({});
    setCitizenshipStatus("unspecified");
    setLegallyAuthorizedToWork("unspecified");
    setRequiresSponsorship("unspecified");
    setEducationLevel("unspecified");
    setMajor("");
    setGpa(undefined);
    setAvailabilityNotice("unspecified");
    setAvailabilityDate("");
  }

  return {
    stages,
    updateStage,
    changeStageProvider,
    copyStage,
    profileBackground,
    setProfileBackground,
    boldBulletKeywords,
    setBoldBulletKeywords,
    fitAssessmentAuto,
    setFitAssessmentAuto,
    resumePolishAuto,
    setResumePolishAuto,
    resumePolishAutoThreshold,
    setResumePolishAutoThreshold,
    coverPolishAuto,
    setCoverPolishAuto,
    coverPolishAutoThreshold,
    setCoverPolishAutoThreshold,
    excludedResumeVariants,
    excludedCoverLetterVariants,
    setVariantEligibility,
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
    workspacePreferencesStatus,
    customInstructions,
    setCustomInstructions,
    stageCustomInstructions,
    setStageCustomInstruction,
    customInstructionsFor,
    resetSettings
  };
}
