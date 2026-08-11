// Which document versions a tracked application currently holds.
//
// Apply snapshots only the documents included in the prepared package.
// Afterwards the resume and cover letter each keep their own saved/unsaved
// state, so either can be revised independently. File bytes and tracker fields
// are committed together by the application-document server boundary.

import type { Application } from "../hooks/useApplications";
import { documentSourceFingerprint } from "./documentSourceFingerprint.ts";

export type ApplicationDocumentKind = "resume" | "coverLetter";

export type ApplicationDocumentSyncState =
  // No application exists for this job target yet — Apply creates it.
  | "no-application"
  // A Skipped record is job-only history, not an employer submission package.
  | "job-only"
  // The editor content matches the version stored on the application.
  | "saved"
  // The editor content differs from the stored version (edited or regenerated).
  | "unsaved";

// Whitespace-insensitive comparison: the editor round-trips a document through
// its structured model, so re-serialization can shift line breaks and padding
// without any authored change. Comparing raw text would report "unsaved"
// immediately after a save.
export function normalizeDocumentSnapshot(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// Resume Polish stores the document as it existed when the proposal was made.
// Apply calls a resume tailored only when the live document actually differs
// from that baseline; an AI receipt by itself does not prove an edit was used.
export function resumeUsedForApplication(
  currentResumeText: string,
  proposalBaselineText?: string
): "base" | "tailored" {
  if (!proposalBaselineText?.trim()) return "base";
  return normalizeDocumentSnapshot(currentResumeText) === normalizeDocumentSnapshot(proposalBaselineText)
    ? "base"
    : "tailored";
}

export function applicationDocumentSyncState(
  application: Application | null | undefined,
  kind: ApplicationDocumentKind,
  currentText: string,
  currentSourceText: string
): ApplicationDocumentSyncState {
  if (!application) return "no-application";
  if (application.status === "not_applying") return "job-only";
  const artifacts = kind === "resume"
    ? application.resumeArtifacts
    : application.coverLetterArtifacts;
  // The strict source is the lossless document contract. Prefer its complete
  // fingerprint over any flattened preview. The tracker stores metadata only;
  // editable document content lives exclusively in the strict source file.
  if (currentSourceText && artifacts?.hasSource && artifacts.sourceFingerprint) {
    return artifacts.sourceFingerprint === documentSourceFingerprint(currentSourceText)
      ? "saved"
      : "unsaved";
  }
  if (!currentText.trim()) return "saved";
  return "unsaved";
}
