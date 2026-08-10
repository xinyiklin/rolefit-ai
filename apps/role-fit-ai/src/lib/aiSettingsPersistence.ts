import { normalizeSettings, type PersistedSettings } from "./settings.ts";
import { seedStages, stageFieldsToPersist } from "./stageSettings.ts";

// Materialize the sparse stored shape into the exact normalized snapshot the
// live settings hook owns. Focus adoption uses this fingerprint so an unchanged
// server record cannot leave a one-shot "skip save" flag armed for the user's
// next real edit.
export function materializeAiSettings(settings: PersistedSettings): PersistedSettings {
  return normalizeSettings({
    ...stageFieldsToPersist(seedStages(settings)),
    honestContext: settings.honestContext ?? "",
    customInstructions: settings.customInstructions ?? "",
    stageCustomInstructions: settings.stageCustomInstructions ?? {},
    runInitialFit: settings.runInitialFit ?? true,
    autoPolishResume: settings.autoPolishResume ?? false,
    resumeAutoPolishThreshold: settings.resumeAutoPolishThreshold ?? "REASONABLE",
    autoPolishCoverLetter: settings.autoPolishCoverLetter ?? false,
    coverLetterAutoPolishThreshold: settings.coverLetterAutoPolishThreshold ?? "STRONG",
    citizenshipStatus: settings.citizenshipStatus ?? "unspecified",
    legallyAuthorizedToWork: settings.legallyAuthorizedToWork ?? true,
    requiresSponsorship: settings.requiresSponsorship ?? false,
    educationLevel: settings.educationLevel ?? "unspecified",
    major: settings.major ?? "",
    gpa: settings.gpa,
    availabilityNotice: settings.availabilityNotice ?? "unspecified",
    availabilityDate: settings.availabilityDate ?? "",
    experienceProfile: settings.experienceProfile ?? []
  });
}
