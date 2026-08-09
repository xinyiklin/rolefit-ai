import type { AiProviderValue } from "../config/aiOptions.ts";
import { modelOptionsByProvider, providerOptions } from "../config/aiOptions.ts";
import { AI_STAGES, AI_STAGE_IDS, stageSettingsKeys, type AiStageId } from "../config/aiStages.ts";
import { normalizeAntigravityModelId } from "../../shared/antigravityModels.ts";
import { QUICK_FIT_VERDICTS } from "../../shared/quickFitContract.ts";
import type { AutoPolishThreshold } from "./autoPolishPolicy.ts";
import {
  CITIZENSHIP_OPTIONS,
  EDUCATION_LEVEL_OPTIONS,
  MAJOR_MAX_LENGTH,
  type CitizenshipStatus,
  type EducationLevel
} from "./candidateFacts.ts";

// Auto-saved browser UI preferences (localStorage). Credentials are absent by
// construction: supported API keys live only in the local provider companion.
export type PersistedSettings = {
  aiProvider?: AiProviderValue;
  selectedModel?: string;
  cliReasoningEffort?: string;
  // Independent Final Check provider config.
  finalCheckProvider?: AiProviderValue;
  finalCheckSelectedModel?: string;
  finalCheckCliReasoningEffort?: string;
  // Independent analyzer for the /api/job-analysis pass — its own concrete provider
  // config (synced to other stages via the copy buttons, not a live link).
  jobAnalysisProvider?: AiProviderValue;
  jobAnalysisSelectedModel?: string;
  jobAnalysisCliReasoningEffort?: string;
  // Cover-letter polish and application Q&A keep independent concrete configs.
  coverProvider?: AiProviderValue;
  coverSelectedModel?: string;
  coverCliReasoningEffort?: string;
  answersProvider?: AiProviderValue;
  answersSelectedModel?: string;
  answersCliReasoningEffort?: string;
  honestContext?: string;
  // Guidance applied to every stage that has no override of its own.
  customInstructions?: string;
  // Per-stage overrides. A missing or blank entry inherits customInstructions.
  stageCustomInstructions?: Partial<Record<AiStageId, string>>;
  runInitialFit?: boolean;
  // The closing phase of Polish. It is one extra provider request per polish,
  // which is a real cost on metered providers, so it stays user-owned even
  // though it is no longer a separately operated workflow section.
  runFinalCheck?: boolean;
  autoPolishResume?: boolean;
  resumeAutoPolishThreshold?: AutoPolishThreshold;
  autoPolishCoverLetter?: boolean;
  coverLetterAutoPolishThreshold?: AutoPolishThreshold;
  citizenshipStatus?: CitizenshipStatus;
  legallyAuthorizedToWork?: boolean;
  requiresSponsorship?: boolean;
  educationLevel?: EducationLevel;
  major?: string;
};

const KEY = "rolefit:settings";

const validProviders = new Set<string>(providerOptions.map((option) => option.value));

// Normalize provider-owned model identifiers before the strict allowlist sees
// them. Shared localStorage, workspace mirrors, and portable backups use this
// same boundary.
export function migrateSettings(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const migrated = { ...(value as Record<string, unknown>) };

  // Antigravity 1.1.5 introduced stable slugs accepted by `--model`. Preserve
  // every stage's prior model choice instead of letting strict normalization
  // collapse a legacy display name to the new default.
  for (const stage of AI_STAGES) {
    const keys = stageSettingsKeys(stage);
    if (migrated[keys.provider] !== "antigravity-cli") continue;
    const model = migrated[keys.model];
    if (typeof model === "string") migrated[keys.model] = normalizeAntigravityModelId(model);
  }

  // The former switches always used REASONABLE as their fixed cutoff. Carry
  // that behavior forward exactly for existing origins, while fresh settings
  // can use the new per-document defaults chosen by useAiSettings.
  const legacyResume = migrated.autoCreateResumeProposal;
  if (typeof legacyResume === "boolean") {
    if (migrated.autoPolishResume === undefined) migrated.autoPolishResume = legacyResume;
    if (migrated.resumeAutoPolishThreshold === undefined) migrated.resumeAutoPolishThreshold = "REASONABLE";
  }
  const legacyCover = migrated.autoCreateCoverLetterProposal;
  if (typeof legacyCover === "boolean") {
    if (migrated.autoPolishCoverLetter === undefined) migrated.autoPolishCoverLetter = legacyCover;
    if (migrated.coverLetterAutoPolishThreshold === undefined) migrated.coverLetterAutoPolishThreshold = "REASONABLE";
  }
  delete migrated.autoCreateResumeProposal;
  delete migrated.autoCreateCoverLetterProposal;
  return migrated;
}

// Every stage's [provider, model, effort] key triple, derived from the stage
// list so a new stage cannot be added to the UI without being reconciled here.
const STAGE_FIELD_GROUPS: Array<[keyof PersistedSettings, keyof PersistedSettings, keyof PersistedSettings]> =
  AI_STAGES.map((stage) => {
    const keys = stageSettingsKeys(stage);
    return [
      keys.provider as keyof PersistedSettings,
      keys.model as keyof PersistedSettings,
      keys.effort as keyof PersistedSettings
    ];
  });

const PERSISTED_SETTING_KEYS = [
  ...STAGE_FIELD_GROUPS.flat(),
  "honestContext",
  "customInstructions",
  "stageCustomInstructions",
  "runInitialFit",
  "runFinalCheck",
  "autoPolishResume",
  "resumeAutoPolishThreshold",
  "autoPolishCoverLetter",
  "coverLetterAutoPolishThreshold",
  "citizenshipStatus",
  "legallyAuthorizedToWork",
  "requiresSponsorship",
  "educationLevel",
  "major"
] as const satisfies readonly (keyof PersistedSettings)[];

// Reconcile persisted values that may be stale (older app version, a renamed
// provider, a removed model option, or hand-edited storage). An unknown provider
// would otherwise be shown raw in the menu and rejected only at request time; a
// model left over from a different provider — or a now-removed
// option such as the CLI providers' old blank "CLI subscription default" (empty
// string) or OpenAI's old blank "Server default" — would make the dropdown and
// the submitted model disagree. The empty string is checked with `!== undefined`
// (not truthiness) so a saved "" still reconciles to the provider default; no
// provider now ships a blank-value model or effort option.
export function normalizeSettings(value: unknown): PersistedSettings {
  const source = migrateSettings(value);
  const allowed: Record<string, unknown> = {};
  for (const key of PERSISTED_SETTING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(source, key)) allowed[key] = source[key];
  }
  const settings = allowed as PersistedSettings;
  // Untyped alias for the mutations below — every field here is a plain string
  // (or undefined), so indexing through the strongly-typed PersistedSettings
  // would fight the compiler for no safety benefit.
  const bag = settings as unknown as Record<string, string | undefined>;
  // Normalization only removes or repairs values; it does not seed missing
  // stage configuration. `workspaceBackupContract.ts` compares against the
  // normalized input so unsupported keys still fail closed.
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
    // Resume Polish" sentinel is gone). Drop any stale empty string — for the model too,
    // since the hook seeds its default with `?? "..."`, which does NOT replace an
    // empty string. A legacy "same as primary" stage persisted an empty model;
    // left in place it would send an empty value while the UI appeared configured.
    if (bag[providerKey] === "") delete bag[providerKey];
    if (bag[modelKey] === "") delete bag[modelKey];
  }
  for (const key of ["runInitialFit", "runFinalCheck", "autoPolishResume", "autoPolishCoverLetter"] as const) {
    if (settings[key] !== undefined && typeof settings[key] !== "boolean") delete settings[key];
  }
  const validAutoPolishThresholds = new Set<string>(QUICK_FIT_VERDICTS);
  for (const key of ["resumeAutoPolishThreshold", "coverLetterAutoPolishThreshold"] as const) {
    if (settings[key] !== undefined && !validAutoPolishThresholds.has(settings[key] as string)) delete settings[key];
  }
  // "unspecified" is the neutral default (not a selectable option), so add it
  // explicitly — the option lists carry only the concrete values.
  const validCitizenship = new Set<CitizenshipStatus>(["unspecified", ...CITIZENSHIP_OPTIONS.map((option) => option.value)]);
  if (settings.citizenshipStatus && !validCitizenship.has(settings.citizenshipStatus)) {
    delete settings.citizenshipStatus;
  }
  const validEducation = new Set<EducationLevel>(["unspecified", ...EDUCATION_LEVEL_OPTIONS.map((option) => option.value)]);
  if (settings.educationLevel && !validEducation.has(settings.educationLevel)) {
    delete settings.educationLevel;
  }
  if (settings.legallyAuthorizedToWork !== undefined && typeof settings.legallyAuthorizedToWork !== "boolean") {
    delete settings.legallyAuthorizedToWork;
  }
  if (settings.requiresSponsorship !== undefined && typeof settings.requiresSponsorship !== "boolean") {
    delete settings.requiresSponsorship;
  }
  if (typeof settings.honestContext !== "string") delete settings.honestContext;
  else settings.honestContext = settings.honestContext.slice(0, 50_000);
  if (typeof settings.customInstructions !== "string") delete settings.customInstructions;
  else settings.customInstructions = settings.customInstructions.slice(0, 50_000);
  if (typeof settings.major !== "string") delete settings.major;
  else settings.major = settings.major.slice(0, MAJOR_MAX_LENGTH);
  // Per-stage overrides: keep only known stage ids holding strings, and drop the
  // whole field when nothing survives so storage stays clean.
  if (settings.stageCustomInstructions !== null && typeof settings.stageCustomInstructions === "object" && !Array.isArray(settings.stageCustomInstructions)) {
    const raw = settings.stageCustomInstructions as Record<string, unknown>;
    const kept: Partial<Record<AiStageId, string>> = {};
    for (const stageId of AI_STAGE_IDS) {
      const text = raw[stageId];
      if (typeof text === "string" && text.trim()) kept[stageId] = text.slice(0, 50_000);
    }
    if (Object.keys(kept).length) settings.stageCustomInstructions = kept;
    else delete settings.stageCustomInstructions;
  } else {
    delete settings.stageCustomInstructions;
  }
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

// Drop every stored preference for this origin. Settings' reset action calls
// this and then reseeds its own in-memory state from defaults; the listener
// still fires so the server-side mirror is cleared in the same step.
export function clearStoredSettings(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(KEY);
    settingsSaveListener?.();
  } catch {
    // Storage unavailable — nothing persisted to clear.
  }
}
