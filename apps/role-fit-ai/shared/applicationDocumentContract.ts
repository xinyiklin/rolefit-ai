export type ApplicationDocumentArtifacts = {
  hasPdf: boolean;
  hasSource: boolean;
  sourceFingerprint?: string;
  fileName?: string;
  templateId?: string;
  savedAt?: string;
};

export type ApplicationDocumentAvailability =
  | "source-and-pdf"
  | "source-only"
  | "pdf-only"
  | "none";

export function applicationDocumentAvailability(
  artifacts: ApplicationDocumentArtifacts | null | undefined
): ApplicationDocumentAvailability {
  if (artifacts?.hasSource && artifacts.hasPdf) return "source-and-pdf";
  if (artifacts?.hasSource) return "source-only";
  if (artifacts?.hasPdf) return "pdf-only";
  return "none";
}
