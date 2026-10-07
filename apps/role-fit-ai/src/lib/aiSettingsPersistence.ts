import { normalizeSettings, type PersistedSettings } from "./settings.ts";
import { seedStages, stageFieldsToPersist } from "./stageSettings.ts";

// Materialize the sparse stored shape into the exact normalized snapshot the
// live settings hook owns. Focus adoption uses this fingerprint so an unchanged
// server record cannot leave a one-shot "skip save" flag armed for the user's
// next real edit.
export function materializeAiSettings(settings: PersistedSettings): PersistedSettings {
  return normalizeSettings({
    ...stageFieldsToPersist(seedStages(settings)),
    profileBackground: settings.profileBackground ?? "",
    customInstructions: settings.customInstructions ?? "",
    stageCustomInstructions: settings.stageCustomInstructions ?? {},
    boldBulletKeywords: settings.boldBulletKeywords ?? true,
    fitAssessmentAuto: settings.fitAssessmentAuto ?? true,
    resumePolishAuto: settings.resumePolishAuto ?? false,
    resumePolishAutoThreshold: settings.resumePolishAutoThreshold ?? "REASONABLE",
    coverPolishAuto: settings.coverPolishAuto ?? false,
    coverPolishAutoThreshold: settings.coverPolishAutoThreshold ?? "STRONG",
    excludedResumeVariants: settings.excludedResumeVariants ?? {},
    excludedCoverLetterVariants: settings.excludedCoverLetterVariants ?? {},
    citizenshipStatus: settings.citizenshipStatus ?? "unspecified",
    legallyAuthorizedToWork: settings.legallyAuthorizedToWork ?? "unspecified",
    requiresSponsorship: settings.requiresSponsorship ?? "unspecified",
    educationLevel: settings.educationLevel ?? "unspecified",
    major: settings.major ?? "",
    gpa: settings.gpa,
    availabilityNotice: settings.availabilityNotice ?? "unspecified",
    availabilityDate: settings.availabilityDate ?? ""
  });
}
