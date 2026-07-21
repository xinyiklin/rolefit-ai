import type { AiProviderValue } from "../config/aiOptions.ts";
import { modelOptionsByProvider, providerOptions } from "../config/aiOptions.ts";
import { CITIZENSHIP_OPTIONS, type CitizenshipStatus } from "./candidateFacts.ts";

// Auto-saved browser UI preferences (localStorage). Credentials are absent by
// construction: supported API keys live only in the local provider companion.
export type PersistedSettings = {
  aiProvider?: AiProviderValue;
  selectedModel?: string;
  cliReasoningEffort?: string;
  // Independent reviewer for the strict-audit pass — its own concrete provider
  // config (synced via the copy buttons, not a live link).
  auditProvider?: AiProviderValue;
  auditSelectedModel?: string;
  auditCliReasoningEffort?: string;
  // Independent distiller for the /api/distill pass — its own concrete provider
  // config (synced to other stages via the copy buttons, not a live link).
  distillProvider?: AiProviderValue;
  distillSelectedModel?: string;
  distillCliReasoningEffort?: string;
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
const PERSISTED_SETTING_KEYS = [
  "aiProvider",
  "selectedModel",
  "cliReasoningEffort",
  "auditProvider",
  "auditSelectedModel",
  "auditCliReasoningEffort",
  "distillProvider",
  "distillSelectedModel",
  "distillCliReasoningEffort",
  "honestContext",
  "customInstructions",
  "strictReview",
  "polishStages",
  "citizenshipStatus",
  "legallyAuthorizedToWork",
  "requiresSponsorship",
  "workAuthorization",
  "sponsorship"
] as const satisfies readonly (keyof PersistedSettings)[];

// Reconcile persisted values that may be stale (older app version, a renamed
// provider, a removed model option, or hand-edited storage). An unknown provider
// would otherwise be shown raw in the menu and silently coerced to OpenAI
// server-side; a model left over from a different provider — or a now-removed
// option such as the CLI providers' old blank "CLI subscription default" (empty
// string) or OpenAI's old blank "Server default" — would make the dropdown and
// the submitted model disagree. The empty string is checked with `!== undefined`
// (not truthiness) so a saved "" still reconciles to the provider default; no
// provider now ships a blank-value model or effort option.
export function normalizeSettings(value: unknown): PersistedSettings {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const allowed: Record<string, unknown> = {};
  for (const key of PERSISTED_SETTING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(source, key)) allowed[key] = source[key];
  }
  const settings = allowed as PersistedSettings;
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
    if (bag[providerKey] && bag[modelKey] !== undefined) {
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
  // The AI stage sections are permanently visible. Drop the retired accordion
  // preference from older browser storage on the next normal save.
  delete (settings as unknown as Record<string, unknown>).sectionOpen;
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
  if (typeof settings.honestContext !== "string") delete settings.honestContext;
  else settings.honestContext = settings.honestContext.slice(0, 50_000);
  if (typeof settings.customInstructions !== "string") delete settings.customInstructions;
  else settings.customInstructions = settings.customInstructions.slice(0, 50_000);
  return settings;
}

export function loadSettings(): PersistedSettings {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return normalizeSettings(parsed);
  } catch {
    return {};
  }
}

// Whether settings have EVER been saved under this browser origin — distinct
// from loadSettings() returning {} for both "never saved" and "saved but
// blank". browserPrefsSync.ts's boot-time adoption decision needs to tell a
// fresh origin (e.g. a new companion port) apart from one with existing,
// possibly-empty preferences.
export function hasStoredSettings(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}

// Set once by browserPrefsSync.ts when it loads (see that file's top comment).
// saveSettings notifies this listener so a local preference change mirrors to
// the server. settings.ts never imports browserPrefsSync.ts directly — that
// would import loadSettings/normalizeSettings back out of this module and
// cycle; the listener indirection breaks the cycle instead.
let settingsSaveListener: (() => void) | null = null;
export function setSettingsSaveListener(listener: (() => void) | null): void {
  settingsSaveListener = listener;
}

export function saveSettings(settings: PersistedSettings): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(normalizeSettings(settings)));
    settingsSaveListener?.();
  } catch {
    // Storage unavailable or over quota — preferences just won't persist.
  }
}
