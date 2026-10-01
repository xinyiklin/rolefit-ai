import { cliReasoningEffortOptionsByProvider, reconcileCliReasoningEffort } from "../../shared/cliReasoning.ts";
import type { AiProviderValue } from "../config/aiOptions.ts";
import { modelOptionsByProvider, providerOptions } from "../config/aiOptions.ts";
import { AI_STAGES, stageSettingsKeys, type AiStageId } from "../config/aiStages.ts";
import { FIT_ASSESSMENT_VERDICTS } from "../../shared/fitAssessmentContract.ts";
import type { AutoPolishThreshold } from "./autoPolishPolicy.ts";
import {
  AVAILABILITY_NOTICE_OPTIONS,
  CITIZENSHIP_OPTIONS,
  DECLARED_ANSWER_OPTIONS,
  EDUCATION_LEVEL_OPTIONS,
  normalizeAvailabilityDate,
  normalizeCandidateGpa,
  MAJOR_MAX_LENGTH,
  type AvailabilityNotice,
  type CitizenshipStatus,
  type DeclaredAnswer,
  type EducationLevel
} from "./candidateFacts.ts";
import { migrateExperienceEvidence } from "./experienceEvidenceMigration.ts";

// Allowlisted workspace preferences. localStorage is a fail-open browser cache;
// workspacePreferencesSync.ts makes the owner-only workspace file canonical.
// Credentials are absent by construction and stay in the local companion.
export type PersistedSettings = {
  // Each AI stage keeps its own concrete [provider, model, effort] triple, named
  // `<settingsPrefix>Provider` etc. from config/aiStages.ts.
  jobAnalysisProvider?: AiProviderValue;
  jobAnalysisSelectedModel?: string;
  jobAnalysisCliReasoningEffort?: string;
  fitAssessmentProvider?: AiProviderValue;
  fitAssessmentSelectedModel?: string;
  fitAssessmentCliReasoningEffort?: string;
  resumePolishProvider?: AiProviderValue;
  resumePolishSelectedModel?: string;
  resumePolishCliReasoningEffort?: string;
  coverPolishProvider?: AiProviderValue;
  coverPolishSelectedModel?: string;
  coverPolishCliReasoningEffort?: string;
  applicationAnswersProvider?: AiProviderValue;
  applicationAnswersSelectedModel?: string;
  applicationAnswersCliReasoningEffort?: string;
  applicationReviewProvider?: AiProviderValue;
  applicationReviewSelectedModel?: string;
  applicationReviewCliReasoningEffort?: string;
  profileBackground?: string;
  // Guidance applied to every instruction-enabled drafting stage that has no
  // override of its own. Fixed analysis stages never receive it.
  customInstructions?: string;
  // Per-drafting-stage overrides. A missing or blank entry inherits customInstructions.
  stageCustomInstructions?: Partial<Record<AiStageId, string>>;
  // Whether Resume Polish may bold keywords inside a bullet it rewrites. The
  // prompt asks and the server sanitizer enforces.
  boldBulletKeywords?: boolean;
  fitAssessmentAuto?: boolean;
  resumePolishAuto?: boolean;
  resumePolishAutoThreshold?: AutoPolishThreshold;
  coverPolishAuto?: boolean;
  coverPolishAutoThreshold?: AutoPolishThreshold;
  citizenshipStatus?: CitizenshipStatus;
  legallyAuthorizedToWork?: DeclaredAnswer;
  requiresSponsorship?: DeclaredAnswer;
  educationLevel?: EducationLevel;
  major?: string;
  gpa?: number;
  availabilityNotice?: AvailabilityNotice;
  availabilityDate?: string;
};

const KEY = "rolefit:settings";
let memorySettings: PersistedSettings | null = null;

const validProviders = new Set<string>(providerOptions.map((option) => option.value));

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
  "profileBackground",
  "customInstructions",
  "stageCustomInstructions",
  "boldBulletKeywords",
  "fitAssessmentAuto",
  "resumePolishAuto",
  "resumePolishAutoThreshold",
  "coverPolishAuto",
  "coverPolishAutoThreshold",
  "citizenshipStatus",
  "legallyAuthorizedToWork",
  "requiresSponsorship",
  "educationLevel",
  "major",
  "gpa",
  "availabilityNotice",
  "availabilityDate"
] as const satisfies readonly (keyof PersistedSettings)[];

// The Profile Background runs against a much smaller AI limit; this bound only keeps stored settings finite. Settings refuses edits
// past it, and migrated legacy text always fits.
export const PROFILE_BACKGROUND_STORAGE_LIMIT = 60_000;

// Only known catalog and settings-shape changes may migrate before strict
// workspace/backup validation. Unknown models, efforts, providers, and unrelated
// malformed fields still fail closed.
export function migrateStoredSettings(source: Record<string, unknown>): Record<string, unknown> {
  return migrateProviderSettings(migrateExperienceEvidence(renameLegacySettings(source)));
}

// Settings names before the 2026-09-29 naming pass. A stored new name wins
// over its old name, so a repeated or mixed-version load cannot regress a value.
const LEGACY_SETTING_NAMES: Readonly<Record<string, keyof PersistedSettings>> = {
  aiProvider: "resumePolishProvider",
  selectedModel: "resumePolishSelectedModel",
  cliReasoningEffort: "resumePolishCliReasoningEffort",
  coverProvider: "coverPolishProvider",
  coverSelectedModel: "coverPolishSelectedModel",
  coverCliReasoningEffort: "coverPolishCliReasoningEffort",
  answersProvider: "applicationAnswersProvider",
  answersSelectedModel: "applicationAnswersSelectedModel",
  answersCliReasoningEffort: "applicationAnswersCliReasoningEffort",
  finalReviewProvider: "applicationReviewProvider",
  finalReviewSelectedModel: "applicationReviewSelectedModel",
  finalReviewCliReasoningEffort: "applicationReviewCliReasoningEffort",
  honestContext: "profileBackground",
  runFitAssessment: "fitAssessmentAuto",
  autoPolishResume: "resumePolishAuto",
  resumeAutoPolishThreshold: "resumePolishAutoThreshold",
  autoPolishCoverLetter: "coverPolishAuto",
  coverLetterAutoPolishThreshold: "coverPolishAutoThreshold"
};
const LEGACY_STAGE_IDS: Readonly<Record<string, AiStageId>> = {
  cover: "cover-polish",
  answers: "application-answers"
};

function renameKeys(source: Record<string, unknown>, names: Readonly<Record<string, string>>): Record<string, unknown> {
  const renamed = { ...source };
  for (const [legacy, current] of Object.entries(names)) {
    if (!Object.prototype.hasOwnProperty.call(renamed, legacy)) continue;
    if (!Object.prototype.hasOwnProperty.call(renamed, current)) renamed[current] = renamed[legacy];
    delete renamed[legacy];
  }
  return renamed;
}

function renameLegacySettings(source: Record<string, unknown>): Record<string, unknown> {
  const renamed = renameKeys(source, LEGACY_SETTING_NAMES);
  const overrides = renamed.stageCustomInstructions;
  if (overrides && typeof overrides === "object" && !Array.isArray(overrides)) {
    renamed.stageCustomInstructions = renameKeys(overrides as Record<string, unknown>, LEGACY_STAGE_IDS);
  }
  return renamed;
}

function migrateProviderSettings(source: Record<string, unknown>): Record<string, unknown> {
  const migrated = { ...source };
  for (const [providerKey, modelKey, effortKey] of STAGE_FIELD_GROUPS) {
    const provider = migrated[providerKey];
    const storedModel = migrated[modelKey];
    if (provider !== "codex-cli" && provider !== "claude-cli") continue;
    if (typeof storedModel !== "string") continue;
    let model = storedModel;
    if (provider === "codex-cli" && ["gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex-spark"].includes(model)) {
      model = providerOptions.find((option) => option.value === provider)!.model;
      migrated[modelKey] = model;
    }
    const effort = migrated[effortKey];
    if (modelOptionsByProvider[provider].some((option) => option.value === model)
      && typeof effort === "string"
      && (effort === "" || cliReasoningEffortOptionsByProvider[provider]?.some((option) => option.value === effort))) {
      migrated[effortKey] = reconcileCliReasoningEffort(provider, model, effort);
    }
  }
  return migrated;
}

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
    if (bag[providerKey] && bag[modelKey] && bag[effortKey] !== undefined) {
      bag[effortKey] = reconcileCliReasoningEffort(bag[providerKey]!, bag[modelKey]!, bag[effortKey]!);
    }
    // Each stage now holds a concrete provider + model (the old "" = "same as
    // Resume Polish" sentinel is gone). Drop any stale empty string — for the model too,
    // since the hook seeds its default with `?? "..."`, which does NOT replace an
    // empty string. A legacy "same as primary" stage persisted an empty model;
    // left in place it would send an empty value while the UI appeared configured.
    if (bag[providerKey] === "") delete bag[providerKey];
    if (bag[modelKey] === "") delete bag[modelKey];
  }
  for (const key of ["boldBulletKeywords", "fitAssessmentAuto", "resumePolishAuto", "coverPolishAuto"] as const) {
    if (settings[key] !== undefined && typeof settings[key] !== "boolean") delete settings[key];
  }
  const validAutoPolishThresholds = new Set<string>(FIT_ASSESSMENT_VERDICTS);
  for (const key of ["resumePolishAutoThreshold", "coverPolishAutoThreshold"] as const) {
    if (settings[key] !== undefined && !validAutoPolishThresholds.has(settings[key] as string)) delete settings[key];
  }
  // "unspecified" is the neutral default (not a selectable option), so add it
  // explicitly — the option lists carry only the concrete values.
  const validCitizenship = new Set<CitizenshipStatus>(["unspecified", ...CITIZENSHIP_OPTIONS.map((option) => option.value)]);
  if (settings.citizenshipStatus !== undefined && !validCitizenship.has(settings.citizenshipStatus)) {
    delete settings.citizenshipStatus;
  }
  const validEducation = new Set<EducationLevel>(["unspecified", ...EDUCATION_LEVEL_OPTIONS.map((option) => option.value)]);
  if (settings.educationLevel !== undefined && !validEducation.has(settings.educationLevel)) {
    delete settings.educationLevel;
  }
  const validDeclaredAnswers = new Set<DeclaredAnswer>(
    DECLARED_ANSWER_OPTIONS.map((option) => option.value)
  );
  for (const key of ["legallyAuthorizedToWork", "requiresSponsorship"] as const) {
    if (settings[key] !== undefined && !validDeclaredAnswers.has(settings[key])) {
      delete settings[key];
    }
  }
  if (typeof settings.profileBackground !== "string") delete settings.profileBackground;
  else settings.profileBackground = settings.profileBackground.slice(0, PROFILE_BACKGROUND_STORAGE_LIMIT);
  if (typeof settings.customInstructions !== "string") delete settings.customInstructions;
  else settings.customInstructions = settings.customInstructions.slice(0, 50_000);
  if (typeof settings.major !== "string") delete settings.major;
  else settings.major = settings.major.slice(0, MAJOR_MAX_LENGTH);
  const normalizedGpa = normalizeCandidateGpa(settings.gpa);
  if (normalizedGpa !== null) settings.gpa = normalizedGpa;
  else delete settings.gpa;
  const validAvailabilityNotices = new Set<AvailabilityNotice>(
    AVAILABILITY_NOTICE_OPTIONS.map((option) => option.value)
  );
  if (
    settings.availabilityNotice === undefined
    || !validAvailabilityNotices.has(settings.availabilityNotice)
  ) {
    delete settings.availabilityNotice;
    delete settings.availabilityDate;
  } else if (settings.availabilityNotice === "specific-date") {
    const availabilityDate = normalizeAvailabilityDate(settings.availabilityDate);
    if (availabilityDate) settings.availabilityDate = availabilityDate;
    else {
      delete settings.availabilityNotice;
      delete settings.availabilityDate;
    }
  } else {
    delete settings.availabilityDate;
  }
  // Per-stage overrides: keep only known stage ids holding strings, and drop the
  // whole field when nothing survives so storage stays clean.
  if (settings.stageCustomInstructions !== null && typeof settings.stageCustomInstructions === "object" && !Array.isArray(settings.stageCustomInstructions)) {
    const raw = settings.stageCustomInstructions as Record<string, unknown>;
    const kept: Partial<Record<AiStageId, string>> = {};
    for (const stageId of AI_STAGES.filter((stage) => stage.supportsInstructions).map((stage) => stage.id)) {
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
  if (typeof localStorage === "undefined") return memorySettings ?? {};
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return memorySettings ?? {};
    const parsed = JSON.parse(raw);
    memorySettings = normalizeSettings(
      parsed && typeof parsed === "object" && !Array.isArray(parsed) ? migrateStoredSettings(parsed) : parsed
    );
    return memorySettings;
  } catch {
    return memorySettings ?? {};
  }
}

// Whether settings have EVER been saved under this browser origin — distinct
// from loadSettings() returning {} for both "never saved" and "saved but
// blank". workspacePreferencesSync.ts uses this to seed a new workspace from a
// pre-existing browser cache when no canonical file exists yet.
export function hasStoredSettings(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}

// Set once by workspacePreferencesSync.ts when it loads (see that file's top comment).
// saveSettings notifies this listener so a local preference change persists to
// the server. settings.ts never imports workspacePreferencesSync.ts directly — that
// would import loadSettings/normalizeSettings back out of this module and
// cycle; the listener indirection breaks the cycle instead.
let settingsSaveListener: ((settings: PersistedSettings) => void) | null = null;
export function setSettingsSaveListener(listener: ((settings: PersistedSettings) => void) | null): void {
  settingsSaveListener = listener;
}

export function saveSettings(settings: PersistedSettings): void {
  const normalized = normalizeSettings(settings);
  memorySettings = normalized;
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(KEY, JSON.stringify(normalized));
    }
  } catch {
    // The canonical workspace write below does not depend on this cache.
  }
  settingsSaveListener?.(normalized);
}

// Drop every cached preference for this origin. Settings' reset action calls
// this and then reseeds its own in-memory state from defaults; the listener still
// fires so the canonical workspace record is reset in the same step.
export function clearStoredSettings(): void {
  memorySettings = {};
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(KEY);
  } catch {
    // The canonical workspace clear below does not depend on this cache.
  }
  settingsSaveListener?.({});
}
