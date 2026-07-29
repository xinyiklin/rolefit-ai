export type ApplicationDocumentServerKind = "resume" | "cover";

export const APPLICATION_DOCUMENT_SOURCE_EXTENSION = {
  resume: "resume",
  cover: "cover"
} as const satisfies Record<ApplicationDocumentServerKind, string>;

export type ApplicationDocumentArtifacts = {
  hasPdf: boolean;
  hasSource: boolean;
  sourceFingerprint?: string;
  fileName?: string;
  savedAt?: string;
};

export type ApplicationDocumentAvailability =
  | "source-and-pdf"
  | "source-only"
  | "pdf-only"
  | "legacy-text-snapshot"
  | "none";

export function applicationDocumentAvailability(
  artifacts: ApplicationDocumentArtifacts | null | undefined,
  hasLegacyTextSnapshot: boolean
): ApplicationDocumentAvailability {
  if (artifacts?.hasSource && artifacts.hasPdf) return "source-and-pdf";
  if (artifacts?.hasSource) return "source-only";
  if (artifacts?.hasPdf) return "pdf-only";
  if (hasLegacyTextSnapshot) return "source-only";
  return "none";
}
