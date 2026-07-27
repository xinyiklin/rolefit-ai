// Which document versions a tracked application currently holds, and the
// smallest patch that replaces exactly one of them.
//
// Apply snapshots both documents at once. Afterwards the resume and the cover
// letter each keep their own saved/unsaved state, because the common workflow
// is to apply first and finish the letter later. Every patch here names ONLY
// its own document's fields so updating one can never rewrite the other.

import type { Application } from "../hooks/useApplications";
import type { ResumeData } from "@typeset/engine/lib/resumeData.ts";
// Extension-qualified so the offline evals can import this module directly.
import { normalizeJobUrl } from "./jobIdentity.ts";

export type ApplicationDocumentKind = "resume" | "coverLetter";

export type ApplicationDocumentSyncState =
  // No application exists for this job target yet — Apply creates it.
  | "no-application"
  // The editor content matches the version stored on the application.
  | "saved"
  // The editor content differs from the stored version (edited or regenerated).
  | "unsaved";

/** Field ownership, exported so the evals can assert the two sets stay disjoint. */
export const RESUME_DOCUMENT_FIELDS = ["resumeData", "polishedText"] as const;
export const COVER_LETTER_DOCUMENT_FIELDS = ["coverLetterText"] as const;

// Whitespace-insensitive comparison: the editor round-trips a document through
// its structured model, so re-serialization can shift line breaks and padding
// without any authored change. Comparing raw text would report "unsaved"
// immediately after a save.
export function normalizeDocumentSnapshot(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function savedDocumentText(
  application: Application | null | undefined,
  kind: ApplicationDocumentKind
): string {
  if (!application) return "";
  return (kind === "resume" ? application.polishedText : application.coverLetterText) ?? "";
}

export function applicationDocumentSyncState(
  application: Application | null | undefined,
  kind: ApplicationDocumentKind,
  currentText: string
): ApplicationDocumentSyncState {
  if (!application) return "no-application";
  return normalizeDocumentSnapshot(savedDocumentText(application, kind)) ===
    normalizeDocumentSnapshot(currentText)
    ? "saved"
    : "unsaved";
}

// `resumeData` is omitted rather than set to undefined: the patch is merged by
// object spread, so an explicit undefined would erase a stored editor snapshot
// the caller never meant to touch.
export function resumeApplicationPatch(
  currentText: string,
  resumeData: ResumeData | null
): Partial<Application> {
  return {
    polishedText: currentText,
    ...(resumeData ? { resumeData } : {})
  };
}

export function coverLetterApplicationPatch(currentText: string): Partial<Application> {
  return { coverLetterText: currentText };
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
