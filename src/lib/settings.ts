import type { AiProviderValue } from "../config/aiOptions";
import { modelOptionsByProvider, providerOptions } from "../config/aiOptions";

// Auto-saved UI preferences (localStorage). Intentionally excludes the API key:
// the app never persists secrets — CLI providers need no key, and API keys come
// from .env or a one-request field.
export type PersistedSettings = {
  aiProvider?: AiProviderValue;
  selectedModel?: string;
  customModel?: string;
  cliReasoningEffort?: string;
  apiBaseUrl?: string;
  // Optional independent reviewer for the strict-audit pass. Empty/absent
  // auditProvider means "same as primary". The reviewer API key, like the
  // primary key, is never persisted.
  auditProvider?: AiProviderValue;
  auditSelectedModel?: string;
  auditCustomModel?: string;
  auditCliReasoningEffort?: string;
  auditApiBaseUrl?: string;
  honestContext?: string;
  customInstructions?: string;
};

const KEY = "rolefit:settings";

const validProviders = new Set<string>(providerOptions.map((option) => option.value));

// Reconcile persisted values that may be stale (older app version, a renamed
// provider, or hand-edited storage). An unknown provider would otherwise be
// shown raw in the menu and silently coerced to OpenAI server-side; a model
// left over from a different provider would make the dropdown and the submitted
// model disagree.
function coerce(settings: PersistedSettings): PersistedSettings {
  if (settings.aiProvider && !validProviders.has(settings.aiProvider)) {
    delete settings.aiProvider;
    delete settings.selectedModel;
    delete settings.cliReasoningEffort;
  }
  if (settings.aiProvider && settings.selectedModel && settings.selectedModel !== "custom") {
    const models = modelOptionsByProvider[settings.aiProvider] ?? [];
    if (!models.some((model) => model.value === settings.selectedModel)) {
      // Fall back to the provider's own default rather than a stale cross-provider id.
      const fallback = providerOptions.find((option) => option.value === settings.aiProvider)?.model;
      if (fallback) settings.selectedModel = fallback;
      else delete settings.selectedModel;
    }
  }
  // Same staleness guard for the optional reviewer provider/model.
  if (settings.auditProvider && !validProviders.has(settings.auditProvider)) {
    delete settings.auditProvider;
    delete settings.auditSelectedModel;
    delete settings.auditCliReasoningEffort;
  }
  if (settings.auditProvider && settings.auditSelectedModel && settings.auditSelectedModel !== "custom") {
    const models = modelOptionsByProvider[settings.auditProvider] ?? [];
    if (!models.some((model) => model.value === settings.auditSelectedModel)) {
      const fallback = providerOptions.find((option) => option.value === settings.auditProvider)?.model;
      if (fallback) settings.auditSelectedModel = fallback;
      else delete settings.auditSelectedModel;
    }
  }
  return settings;
}

export function loadSettings(): PersistedSettings {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? coerce(parsed as PersistedSettings) : {};
  } catch {
    return {};
  }
}

export function saveSettings(settings: PersistedSettings): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable or over quota — preferences just won't persist.
  }
}
