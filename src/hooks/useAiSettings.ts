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
// live together here rather than scattered across App. API keys (primary +
// reviewer) are intentionally NOT persisted.
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

  // Optional independent reviewer for the strict-audit pass. "" = same as the
  // primary provider. The reviewer API key, like the primary, is never persisted.
  const [auditProvider, setAuditProvider] = useState<AiProviderValue | "">(saved.auditProvider ?? "codex-cli");
  // Concrete default matching the default audit provider (codex-cli) now that the
  // CLI providers no longer offer a blank "CLI subscription default" model option.
  const [auditSelectedModel, setAuditSelectedModel] = useState(saved.auditSelectedModel ?? "gpt-5.5");
  const [auditCustomModel, setAuditCustomModel] = useState(saved.auditCustomModel ?? "");
  const [auditCliReasoningEffort, setAuditCliReasoningEffort] = useState(saved.auditCliReasoningEffort ?? "");
  const [auditApiBaseUrl, setAuditApiBaseUrl] = useState(saved.auditApiBaseUrl ?? "");
  const [auditApiKey, setAuditApiKey] = useState("");

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
        auditProvider: auditProvider || undefined,
        auditSelectedModel,
        auditCustomModel,
        auditCliReasoningEffort,
        auditApiBaseUrl,
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
    if (!auditProvider) return;
    const model = auditSelectedModel === "custom" ? auditCustomModel : auditSelectedModel;
    const options = cliReasoningEffortOptionsFor(auditProvider, model);
    if (options && options.length > 0 && !options.some((option) => option.value === auditCliReasoningEffort)) {
      setAuditCliReasoningEffort(defaultCliReasoningEffort(auditProvider));
    }
  }, [auditProvider, auditSelectedModel, auditCustomModel, auditCliReasoningEffort]);

  function handleProviderChange(value: AiProviderValue) {
    const option = providerOptions.find((item) => item.value === value);
    setAiProvider(value);
    setApiKey("");
    setApiBaseUrl(option?.baseUrl ?? "");
    setSelectedModel(option?.model ?? "");
    setCliReasoningEffort(defaultCliReasoningEffort(value));
    setCustomModel("");
  }

  function handleAuditProviderChange(value: AiProviderValue | "") {
    // "" restores "same as primary": clear the reviewer's overrides so a later
    // re-enable starts from the new provider's defaults, not stale leftovers.
    const option = providerOptions.find((item) => item.value === value);
    setAuditProvider(value);
    setAuditApiKey("");
    setAuditApiBaseUrl(value ? option?.baseUrl ?? "" : "");
    setAuditSelectedModel(value ? option?.model ?? "" : "");
    setAuditCliReasoningEffort(value ? defaultCliReasoningEffort(value) : "");
    setAuditCustomModel("");
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
