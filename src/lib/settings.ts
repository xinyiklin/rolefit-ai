import type { AiProviderValue } from "../config/aiOptions";
import { modelOptionsByProvider, providerOptions } from "../config/aiOptions";
import { CITIZENSHIP_OPTIONS, type CitizenshipStatus } from "./candidateFacts";

// Auto-saved UI preferences (localStorage). Intentionally excludes the API key:
// the app never persists secrets — CLI providers need no key, and API keys come
// from .env or a one-request field.
export type PersistedSettings = {
  aiProvider?: AiProviderValue;
  selectedModel?: string;
  customModel?: string;
  cliReasoningEffort?: string;
  apiBaseUrl?: string;
  // Independent reviewer for the strict-audit pass — its own concrete provider
  // config (synced via the copy buttons, not a live link). The reviewer API key,
  // like the primary key, is never persisted.
  auditProvider?: AiProviderValue;
  auditSelectedModel?: string;
  auditCustomModel?: string;
  auditCliReasoningEffort?: string;
  auditApiBaseUrl?: string;
  // Independent distiller for the /api/distill pass — its own concrete provider
  // config (synced to other stages via the copy buttons, not a live link). The
  // distill API key, like the primary and reviewer keys, is never persisted.
  distillProvider?: AiProviderValue;
  distillSelectedModel?: string;
  distillCustomModel?: string;
  distillCliReasoningEffort?: string;
  distillApiBaseUrl?: string;
  // Per-section expand/collapse state for the AI menu (Distill / Tailor / Review).
  sectionOpen?: { distill?: boolean; tailor?: boolean; review?: boolean };
  honestContext?: string;
  customInstructions?: string;
  strictReview?: boolean;
  polishStages?: "tailor" | "review" | "both";
  citizenshipStatus?: CitizenshipStatus;
  legallyAuthorizedToWork?: boolean;
  requiresSponsorship?: boolean;
  // Legacy values from the short-lived tri-state version. Coerced to booleans
  // on load so old localStorage cannot leave the UI in an impossible state.
  workAuthorization?: "unspecified" | "authorized-us" | "not-authorized-us";
  sponsorship?: "unspecified" | "not-required" | "required";
};

const KEY = "rolefit:settings";

const validProviders = new Set<string>(providerOptions.map((option) => option.value));

// The three stages' provider/model/effort fields, in the same [provider, model,
// effort] shape so one loop can reconcile all of them identically.
const STAGE_FIELD_GROUPS: Array<[keyof PersistedSettings, keyof PersistedSettings, keyof PersistedSettings]> = [
  ["aiProvider", "selectedModel", "cliReasoningEffort"],
  ["auditProvider", "auditSelectedModel", "auditCliReasoningEffort"],
  ["distillProvider", "distillSelectedModel", "distillCliReasoningEffort"]
];

// Reconcile persisted values that may be stale (older app version, a renamed
// provider, a removed model option, or hand-edited storage). An unknown provider
// would otherwise be shown raw in the menu and silently coerced to OpenAI
// server-side; a model left over from a different provider — or a now-removed
// option such as the CLI providers' old blank "CLI subscription default" (empty
// string) or OpenAI's old blank "Server default" — would make the dropdown and
// the submitted model disagree. The empty string is checked with `!== undefined`
// (not truthiness) so a saved "" still reconciles to the provider default; no
// provider now ships a blank-value model or effort option.
function coerce(settings: PersistedSettings): PersistedSettings {
  // Untyped alias for the mutations below — every field here is a plain string
  // (or undefined), so indexing through the strongly-typed PersistedSettings
  // would fight the compiler for no safety benefit.
  const bag = settings as unknown as Record<string, string | undefined>;
  for (const [providerKey, modelKey, effortKey] of STAGE_FIELD_GROUPS) {
    if (bag[providerKey] && !validProviders.has(bag[providerKey] as string)) {
      delete bag[providerKey];
      delete bag[modelKey];
      delete bag[effortKey];
    }
    if (bag[providerKey] && bag[modelKey] !== undefined && bag[modelKey] !== "custom") {
      const models = modelOptionsByProvider[bag[providerKey] as AiProviderValue] ?? [];
      if (!models.some((model) => model.value === bag[modelKey])) {
        // Fall back to the provider's own default rather than a stale cross-provider id.
        const fallback = providerOptions.find((option) => option.value === bag[providerKey])?.model;
        if (fallback) bag[modelKey] = fallback;
        else delete bag[modelKey];
      }
    }
    // Each stage now holds a concrete provider + model (the old "" = "same as
    // Tailor" sentinel is gone). Drop any stale empty string — for the model too,
    // since the hook seeds its default with `?? "..."`, which does NOT replace an
    // empty string. A legacy "same as primary" reviewer persisted an empty
    // auditSelectedModel; left in place it would send an empty model, resolve to the
    // CLI default, and mis-trigger the "reviewed by" attribution.
    if (bag[providerKey] === "") delete bag[providerKey];
    if (bag[modelKey] === "") delete bag[modelKey];
  }
  // Section open/collapse map: keep only well-formed boolean fields; drop the rest
  // so a corrupt value can't leave a section stuck. An absent field defaults open.
  if (settings.sectionOpen !== undefined) {
    const raw = settings.sectionOpen;
    if (!raw || typeof raw !== "object") {
      delete settings.sectionOpen;
    } else {
      const cleaned: { distill?: boolean; tailor?: boolean; review?: boolean } = {};
      for (const key of ["distill", "tailor", "review"] as const) {
        if (typeof raw[key] === "boolean") cleaned[key] = raw[key];
      }
      settings.sectionOpen = cleaned;
    }
  }
  if (settings.strictReview !== undefined && typeof settings.strictReview !== "boolean") {
    delete settings.strictReview;
  }
  // Validate polishStages — only the 3 literal values are valid.
  const validStages = new Set(["tailor", "review", "both"]);
  if (settings.polishStages !== undefined && !validStages.has(settings.polishStages)) {
    delete settings.polishStages;
  }
  // Migrate legacy strictReview → polishStages when polishStages is absent.
  if (settings.polishStages === undefined && typeof settings.strictReview === "boolean") {
    settings.polishStages = settings.strictReview ? "both" : "tailor";
  }
  // "unspecified" is the neutral default (not a selectable option), so add it
  // explicitly — CITIZENSHIP_OPTIONS lists only the concrete statuses.
  const validCitizenship = new Set<CitizenshipStatus>(["unspecified", ...CITIZENSHIP_OPTIONS.map((option) => option.value)]);
  if (settings.citizenshipStatus && !validCitizenship.has(settings.citizenshipStatus)) {
    delete settings.citizenshipStatus;
  }
  if (settings.legallyAuthorizedToWork !== undefined && typeof settings.legallyAuthorizedToWork !== "boolean") {
    delete settings.legallyAuthorizedToWork;
  }
  if (settings.requiresSponsorship !== undefined && typeof settings.requiresSponsorship !== "boolean") {
    delete settings.requiresSponsorship;
  }
  if (settings.legallyAuthorizedToWork === undefined && settings.workAuthorization) {
    if (settings.workAuthorization === "authorized-us") settings.legallyAuthorizedToWork = true;
    if (settings.workAuthorization === "not-authorized-us") settings.legallyAuthorizedToWork = false;
  }
  if (settings.requiresSponsorship === undefined && settings.sponsorship) {
    if (settings.sponsorship === "required") settings.requiresSponsorship = true;
    if (settings.sponsorship === "not-required") settings.requiresSponsorship = false;
  }
  delete settings.workAuthorization;
  delete settings.sponsorship;
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
