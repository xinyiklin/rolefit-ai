import { useEffect, useMemo, useState } from "react";
import {
  cliReasoningEffortOptionsFor,
  defaultCliReasoningEffort,
  providerOptions
} from "../config/aiOptions";
import { loadSettings, saveSettings } from "../lib/settings";
import type { AiProviderValue } from "../config/aiOptions";
import type { CitizenshipStatus } from "../lib/candidateFacts";

// Owns every auto-saved AI preference: the primary provider/model/key/base-URL/
// reasoning-effort, the optional independent-reviewer (audit*) overrides, and
// the polish prefs that persist alongside them (honest context and custom
// instructions). All of these share one debounced localStorage write, so they
// live together here rather than scattered across App. API keys for every stage
// are intentionally NOT persisted.
export function useAiSettings() {
  const saved = useMemo(() => loadSettings(), []);

  const [aiProvider, setAiProvider] = useState<AiProviderValue>(saved.aiProvider ?? "claude-cli");
  const [apiKey, setApiKey] = useState("");
  const [apiBaseUrl, setApiBaseUrl] = useState(saved.apiBaseUrl ?? "");
  const [selectedModel, setSelectedModel] = useState(saved.selectedModel ?? "claude-sonnet-5");
  const [cliReasoningEffort, setCliReasoningEffort] = useState(
    saved.cliReasoningEffort ?? defaultCliReasoningEffort(saved.aiProvider ?? "claude-cli")
  );
  const [customModel, setCustomModel] = useState(saved.customModel ?? "");

  // Independent reviewer for the strict-audit pass. Each stage now holds its OWN
  // concrete provider config (no "same as Tailor" live link); the per-section
  // segmented buttons COPY one stage's settings into another. Fresh defaults mirror
  // the Tailor default (claude-cli / claude-sonnet-5) so all three start unified.
  // The reviewer API key, like the primary, is never persisted.
  const [auditProvider, setAuditProvider] = useState<AiProviderValue>(saved.auditProvider ?? "claude-cli");
  const [auditSelectedModel, setAuditSelectedModel] = useState(saved.auditSelectedModel ?? "claude-sonnet-5");
  const [auditCustomModel, setAuditCustomModel] = useState(saved.auditCustomModel ?? "");
  const [auditCliReasoningEffort, setAuditCliReasoningEffort] = useState(
    saved.auditCliReasoningEffort ?? defaultCliReasoningEffort(saved.auditProvider ?? "claude-cli")
  );
  const [auditApiBaseUrl, setAuditApiBaseUrl] = useState(saved.auditApiBaseUrl ?? "");
  const [auditApiKey, setAuditApiKey] = useState("");

  // Independent distiller for the /api/distill pass — own concrete config, same
  // copy-not-link model and Tailor-matching defaults as the reviewer above.
  const [distillProvider, setDistillProvider] = useState<AiProviderValue>(saved.distillProvider ?? "claude-cli");
  const [distillSelectedModel, setDistillSelectedModel] = useState(saved.distillSelectedModel ?? "claude-sonnet-5");
  const [distillCustomModel, setDistillCustomModel] = useState(saved.distillCustomModel ?? "");
  const [distillCliReasoningEffort, setDistillCliReasoningEffort] = useState(
    saved.distillCliReasoningEffort ?? defaultCliReasoningEffort(saved.distillProvider ?? "claude-cli")
  );
  const [distillApiBaseUrl, setDistillApiBaseUrl] = useState(saved.distillApiBaseUrl ?? "");
  const [distillApiKey, setDistillApiKey] = useState("");

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
  // Keep strictReview for back-compat: derived from polishStages so any code
  // reading it still gets a sensible boolean. Not persisted directly any more.
  const strictReview = polishStages === "both" || polishStages === "review";
  const [citizenshipStatus, setCitizenshipStatus] = useState<CitizenshipStatus>(saved.citizenshipStatus ?? "unspecified");
  const [legallyAuthorizedToWork, setLegallyAuthorizedToWork] = useState(saved.legallyAuthorizedToWork ?? true);
  const [requiresSponsorship, setRequiresSponsorship] = useState(saved.requiresSponsorship ?? false);

  // Auto-save preferences so they survive reloads. Debounced so the free-text
  // fields (honest context, custom instructions) don't serialize + write
  // localStorage on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => {
      saveSettings({
        aiProvider,
        selectedModel,
        customModel,
        cliReasoningEffort,
        apiBaseUrl,
        auditProvider,
        auditSelectedModel,
        auditCustomModel,
        auditCliReasoningEffort,
        auditApiBaseUrl,
        distillProvider,
        distillSelectedModel,
        distillCustomModel,
        distillCliReasoningEffort,
        distillApiBaseUrl,
        sectionOpen,
        honestContext,
        customInstructions,
        strictReview,
        polishStages,
        citizenshipStatus,
        legallyAuthorizedToWork,
        requiresSponsorship
      });
    }, 400);
    return () => clearTimeout(id);
  }, [
    aiProvider,
    selectedModel,
    customModel,
    cliReasoningEffort,
    apiBaseUrl,
    auditProvider,
    auditSelectedModel,
    auditCustomModel,
    auditCliReasoningEffort,
    auditApiBaseUrl,
    distillProvider,
    distillSelectedModel,
    distillCustomModel,
    distillCliReasoningEffort,
    distillApiBaseUrl,
    sectionOpen,
    honestContext,
    customInstructions,
    polishStages,
    citizenshipStatus,
    legallyAuthorizedToWork,
    requiresSponsorship
  ]);

  // Keep each reasoning effort valid for its selected model — the tiers a model
  // exposes vary (Haiku none; Opus/Sonnet 4.6 lack xhigh). When the current value
  // isn't offered by the model, fall back to the provider default (always a member
  // of any non-empty tier list). An empty list (Haiku / non-CLI) hides the control,
  // so the leftover value is inert and left untouched.
  useEffect(() => {
    const model = selectedModel === "custom" ? customModel : selectedModel;
    const options = cliReasoningEffortOptionsFor(aiProvider, model);
    if (options && options.length > 0 && !options.some((option) => option.value === cliReasoningEffort)) {
      setCliReasoningEffort(defaultCliReasoningEffort(aiProvider));
    }
  }, [aiProvider, selectedModel, customModel, cliReasoningEffort]);

  useEffect(() => {
    const model = auditSelectedModel === "custom" ? auditCustomModel : auditSelectedModel;
    const options = cliReasoningEffortOptionsFor(auditProvider, model);
    if (options && options.length > 0 && !options.some((option) => option.value === auditCliReasoningEffort)) {
      setAuditCliReasoningEffort(defaultCliReasoningEffort(auditProvider));
    }
  }, [auditProvider, auditSelectedModel, auditCustomModel, auditCliReasoningEffort]);

  useEffect(() => {
    const model = distillSelectedModel === "custom" ? distillCustomModel : distillSelectedModel;
    const options = cliReasoningEffortOptionsFor(distillProvider, model);
    if (options && options.length > 0 && !options.some((option) => option.value === distillCliReasoningEffort)) {
      setDistillCliReasoningEffort(defaultCliReasoningEffort(distillProvider));
    }
  }, [distillProvider, distillSelectedModel, distillCustomModel, distillCliReasoningEffort]);

  function handleProviderChange(value: AiProviderValue) {
    const option = providerOptions.find((item) => item.value === value);
    setAiProvider(value);
    setApiKey("");
    setApiBaseUrl(option?.baseUrl ?? "");
    setSelectedModel(option?.model ?? "");
    setCliReasoningEffort(defaultCliReasoningEffort(value));
    setCustomModel("");
  }

  function handleAuditProviderChange(value: AiProviderValue) {
    const option = providerOptions.find((item) => item.value === value);
    setAuditProvider(value);
    setAuditApiKey("");
    setAuditApiBaseUrl(option?.baseUrl ?? "");
    setAuditSelectedModel(option?.model ?? "");
    setAuditCliReasoningEffort(defaultCliReasoningEffort(value));
    setAuditCustomModel("");
  }

  function handleDistillProviderChange(value: AiProviderValue) {
    const option = providerOptions.find((item) => item.value === value);
    setDistillProvider(value);
    setDistillApiKey("");
    setDistillApiBaseUrl(option?.baseUrl ?? "");
    setDistillSelectedModel(option?.model ?? "");
    setDistillCliReasoningEffort(defaultCliReasoningEffort(value));
    setDistillCustomModel("");
  }

  function toggleSection(stage: "distill" | "tailor" | "review") {
    setSectionOpen((prev) => ({ ...prev, [stage]: !prev[stage] }));
  }

  // The segmented [Distill | Tailor | Review] buttons in each section COPY one
  // stage's full provider config into another (e.g. clicking "Distill" inside the
  // Tailor section copies Distill's settings onto Tailor). It's a one-shot copy,
  // not a live link — the stages can diverge again afterward. Includes the API key
  // (in-memory only) so a copied hosted-provider stage is immediately usable.
  type StageConfig = {
    provider: AiProviderValue;
    apiKey: string;
    apiBaseUrl: string;
    selectedModel: string;
    customModel: string;
    cliReasoningEffort: string;
  };
  function readStage(stage: "distill" | "tailor" | "review"): StageConfig {
    if (stage === "tailor") return { provider: aiProvider, apiKey, apiBaseUrl, selectedModel, customModel, cliReasoningEffort };
    if (stage === "distill")
      return {
        provider: distillProvider,
        apiKey: distillApiKey,
        apiBaseUrl: distillApiBaseUrl,
        selectedModel: distillSelectedModel,
        customModel: distillCustomModel,
        cliReasoningEffort: distillCliReasoningEffort
      };
    return {
      provider: auditProvider,
      apiKey: auditApiKey,
      apiBaseUrl: auditApiBaseUrl,
      selectedModel: auditSelectedModel,
      customModel: auditCustomModel,
      cliReasoningEffort: auditCliReasoningEffort
    };
  }
  function writeStage(stage: "distill" | "tailor" | "review", c: StageConfig) {
    if (stage === "tailor") {
      setAiProvider(c.provider);
      setApiKey(c.apiKey);
      setApiBaseUrl(c.apiBaseUrl);
      setSelectedModel(c.selectedModel);
      setCustomModel(c.customModel);
      setCliReasoningEffort(c.cliReasoningEffort);
    } else if (stage === "distill") {
      setDistillProvider(c.provider);
      setDistillApiKey(c.apiKey);
      setDistillApiBaseUrl(c.apiBaseUrl);
      setDistillSelectedModel(c.selectedModel);
      setDistillCustomModel(c.customModel);
      setDistillCliReasoningEffort(c.cliReasoningEffort);
    } else {
      setAuditProvider(c.provider);
      setAuditApiKey(c.apiKey);
      setAuditApiBaseUrl(c.apiBaseUrl);
      setAuditSelectedModel(c.selectedModel);
      setAuditCustomModel(c.customModel);
      setAuditCliReasoningEffort(c.cliReasoningEffort);
    }
  }
  function copyStage(from: "distill" | "tailor" | "review", to: "distill" | "tailor" | "review") {
    if (from === to) return;
    writeStage(to, readStage(from));
  }

  return {
    aiProvider,
    apiKey,
    setApiKey,
    apiBaseUrl,
    setApiBaseUrl,
    selectedModel,
    setSelectedModel,
    cliReasoningEffort,
    setCliReasoningEffort,
    customModel,
    setCustomModel,
    handleProviderChange,
    auditProvider,
    auditSelectedModel,
    setAuditSelectedModel,
    auditCustomModel,
    setAuditCustomModel,
    auditCliReasoningEffort,
    setAuditCliReasoningEffort,
    auditApiBaseUrl,
    setAuditApiBaseUrl,
    auditApiKey,
    setAuditApiKey,
    handleAuditProviderChange,
    distillProvider,
    distillSelectedModel,
    setDistillSelectedModel,
    distillCustomModel,
    setDistillCustomModel,
    distillCliReasoningEffort,
    setDistillCliReasoningEffort,
    distillApiBaseUrl,
    setDistillApiBaseUrl,
    distillApiKey,
    setDistillApiKey,
    handleDistillProviderChange,
    sectionOpen,
    toggleSection,
    copyStage,
    honestContext,
    setHonestContext,
    polishStages,
    setPolishStages,
    strictReview,
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
