// Which document versions a tracked application currently holds.
//
// Apply snapshots only the documents included in the prepared package.
// Afterwards the resume and cover letter each keep their own saved/unsaved
// state, so either can be revised independently. File bytes and tracker fields
// are committed together by the application-document server boundary.

import type { Application } from "../hooks/useApplications";
// Extension-qualified so the offline evals can import this module directly.
import { normalizeJobUrl } from "./jobIdentity.ts";
import { documentSourceFingerprint } from "./documentSourceFingerprint.ts";

export type ApplicationDocumentKind = "resume" | "coverLetter";

export type ApplicationDocumentSyncState =
  // No application exists for this job target yet — Apply creates it.
  | "no-application"
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

export function applicationDocumentSyncState(
  application: Application | null | undefined,
  kind: ApplicationDocumentKind,
  currentText: string,
  currentSourceText: string
): ApplicationDocumentSyncState {
  if (!application) return "no-application";
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

// Does this application still describe the job target currently loaded? Used to
// drop a remembered link when the user moves on to another posting, so a later
// "Update application" cannot write one job's document onto another's record.
// Apply may merge into a repost whose primary URL differs, so a URL the record
// absorbed as an alternate posting location counts as a match.
export function applicationMatchesJobTarget(
  application: Application,
  jobUrl: string,
  jobDescription: string
): boolean {
  const targetUrl = jobUrl.trim();
  if (targetUrl) {
    const normalized = normalizeJobUrl(targetUrl);
    if (application.jobUrl.trim() && normalizeJobUrl(application.jobUrl.trim()) === normalized) return true;
    return Boolean(
      application.sourceUrls?.some((entry) => entry.url && normalizeJobUrl(entry.url) === normalized)
    );
  }
  const targetDescription = jobDescription.trim();
  return Boolean(targetDescription && (application.jobDescription ?? "").trim() === targetDescription);
}
