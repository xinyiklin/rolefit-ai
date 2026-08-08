import type { AiProviderValue } from "../config/aiOptions.ts";
import { modelOptionsByProvider, providerOptions } from "../config/aiOptions.ts";
import { AI_STAGES, AI_STAGE_IDS, stageSettingsKeys, type AiStageId } from "../config/aiStages.ts";
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
  // Legacy Final Check setting names, migrated before allowlisting.
  auditProvider?: AiProviderValue;
  auditSelectedModel?: string;
  auditCliReasoningEffort?: string;
  // Independent analyzer for the /api/job-analysis pass — its own concrete provider
  // config (synced to other stages via the copy buttons, not a live link).
  jobAnalysisProvider?: AiProviderValue;
  jobAnalysisSelectedModel?: string;
  jobAnalysisCliReasoningEffort?: string;
  // Cover-letter tailor and application Q&A. Both ran on the Tailor stage's
  // config before they were configurable; absent keys migrate from Tailor on
  // load so an existing install keeps the provider it was already using.
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
  autoCreateResumeProposal?: boolean;
  autoCreateCoverLetterProposal?: boolean;
  citizenshipStatus?: CitizenshipStatus;
  legallyAuthorizedToWork?: boolean;
  requiresSponsorship?: boolean;
  educationLevel?: EducationLevel;
  major?: string;
  // Legacy values from the short-lived tri-state version. Coerced to booleans
  // on load so old localStorage cannot leave the UI in an impossible state.
  workAuthorization?: "unspecified" | "authorized-us" | "not-authorized-us";
  sponsorship?: "unspecified" | "not-required" | "required";
};

const KEY = "rolefit:settings";

const validProviders = new Set<string>(providerOptions.map((option) => option.value));

const LEGACY_JOB_ANALYSIS_SETTINGS = [
  ["distillProvider", "jobAnalysisProvider"],
  ["distillSelectedModel", "jobAnalysisSelectedModel"],
  ["distillCliReasoningEffort", "jobAnalysisCliReasoningEffort"]
] as const;

const LEGACY_FINAL_CHECK_SETTINGS = [
  ["auditProvider", "finalCheckProvider"],
  ["auditSelectedModel", "finalCheckSelectedModel"],
  ["auditCliReasoningEffort", "finalCheckCliReasoningEffort"]
] as const;

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

// Rename persisted Distill settings before the strict allowlist/normalizer sees
// them. This is shared by localStorage, the workspace mirror, and portable
// backups so all three retain the user's exact provider configuration. When a
// hand-edited bag contains both generations, the canonical value wins.
export function migrateSettings(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const migrated = { ...(value as Record<string, unknown>) };
  for (const [legacyKey, canonicalKey] of LEGACY_JOB_ANALYSIS_SETTINGS) {
    if (!hasOwn(migrated, canonicalKey) && hasOwn(migrated, legacyKey)) {
      migrated[canonicalKey] = migrated[legacyKey];
    }
    delete migrated[legacyKey];
  }
  for (const [legacyKey, canonicalKey] of LEGACY_FINAL_CHECK_SETTINGS) {
    if (!hasOwn(migrated, canonicalKey) && hasOwn(migrated, legacyKey)) {
      migrated[canonicalKey] = migrated[legacyKey];
    }
    delete migrated[legacyKey];
  }

  const rawInstructions = migrated.stageCustomInstructions;
  if (rawInstructions && typeof rawInstructions === "object" && !Array.isArray(rawInstructions)) {
    const instructions = { ...(rawInstructions as Record<string, unknown>) };
    if (!hasOwn(instructions, "job-analysis") && hasOwn(instructions, "distill")) {
      instructions["job-analysis"] = instructions.distill;
    }
    if (!hasOwn(instructions, "final-check") && hasOwn(instructions, "review")) {
      instructions["final-check"] = instructions.review;
    }
    delete instructions.distill;
    delete instructions.review;
    migrated.stageCustomInstructions = instructions;
  }
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
  "autoCreateResumeProposal",
  "autoCreateCoverLetterProposal",
  "citizenshipStatus",
  "legallyAuthorizedToWork",
  "requiresSponsorship",
  "educationLevel",
  "major",
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
  // After the key migration above, normalization only removes or repairs values;
  // it does not seed missing stage configuration. `workspaceBackupContract.ts`
  // compares against the migrated input so old backups remain valid while
  // unsupported keys still fail closed. The cover/answers stages
  // inherit Tailor's config in useAiSettings' seeder instead, and the one
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
  for (const key of ["runInitialFit", "autoCreateResumeProposal", "autoCreateCoverLetterProposal"] as const) {
    if (settings[key] !== undefined && typeof settings[key] !== "boolean") delete settings[key];
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
