/** Owns explicit resume and cover-letter saves to the current application. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Application } from "./useApplications";
import {
  applicationDocumentSyncState,
  type ApplicationDocumentKind,
  type ApplicationDocumentSyncState
} from "../lib/applicationDocuments";
import type { DocumentUpload } from "../lib/applicationDocumentRequests";

// How long a completed save keeps saying so before the row settles back into
// its steady "Saved to application" state.
const JUST_SAVED_MS = 8_000;

export type ApplicationDocumentSync = {
  state: ApplicationDocumentSyncState;
  /** Row title: the action to take, or the state when there is nothing to do. */
  title: string;
  /** One short line — guidance when blocked, the target role when actionable. */
  description: string;
  disabled: boolean;
  isSaving: boolean;
  /** Result of the last attempt; empty until one runs. */
  status: string;
  statusIsError: boolean;
  save: () => Promise<void>;
};

type UseApplicationDocumentSyncArgs = {
  applications: Application[];
  applicationId: string | null;
  currentResumeText: string;
  currentResumeSource: string;
  resumeDocumentVersion: string;
  coverLetterText: string;
  currentCoverLetterSource: string;
  coverLetterDocumentVersion: string;
  saveApplicationDocument: (
    id: string,
    kind: "resume" | "cover",
    upload: DocumentUpload
  ) => Promise<{ ok: boolean; error?: string }>;
  // Each editor serializes its editable source for the copy the application
  // keeps. Both kinds are stored the same way.
  getResumeArtifacts: () => Promise<DocumentUpload | null>;
  getCoverLetterArtifacts: () => Promise<DocumentUpload | null>;
  onResumeSaved: (applicationId: string, version: string) => void;
  onCoverLetterSaved: (applicationId: string, version: string) => void;
};

type DocumentFeedback = {
  status: string;
  statusIsError: boolean;
  savedAt: number;
};

const NO_FEEDBACK: DocumentFeedback = {
  status: "",
  statusIsError: false,
  savedAt: 0
};

export function useApplicationDocumentSync({
  applications,
  applicationId,
  currentResumeText,
  currentResumeSource,
  resumeDocumentVersion,
  coverLetterText,
  currentCoverLetterSource,
  coverLetterDocumentVersion,
  saveApplicationDocument,
  getResumeArtifacts,
  getCoverLetterArtifacts,
  onResumeSaved,
  onCoverLetterSaved
}: UseApplicationDocumentSyncArgs) {
  const [savingKinds, setSavingKinds] = useState<Set<ApplicationDocumentKind>>(() => new Set());
  const [resumeFeedback, setResumeFeedback] = useState<DocumentFeedback>(NO_FEEDBACK);
  const [coverFeedback, setCoverFeedback] = useState<DocumentFeedback>(NO_FEEDBACK);
  const saveInFlight = useRef<Set<ApplicationDocumentKind>>(new Set());
  const latestSaveIdentityRef = useRef({
    applicationId: "",
    resume: resumeDocumentVersion,
    coverLetter: coverLetterDocumentVersion
  });

  // The explicit preparation id is the only document destination. A matching
  // URL or job description is duplicate evidence, never permission to update a
  // historical record.
  const application = applicationId
    ? applications.find((candidate) => candidate.id === applicationId) ?? null
    : null;

  latestSaveIdentityRef.current = {
    applicationId: application?.id ?? "",
    resume: resumeDocumentVersion,
    coverLetter: coverLetterDocumentVersion
  };

  useEffect(() => {
    setResumeFeedback(NO_FEEDBACK);
    setCoverFeedback(NO_FEEDBACK);
  }, [applicationId]);

  // "Updated just now" has to stop being true on its own — a timer drops the
  // marker (leaving any status line intact) so the row settles back to the
  // steady saved state instead of claiming a stale moment.
  useEffect(() => {
    const stamps = [resumeFeedback.savedAt, coverFeedback.savedAt].filter(Boolean);
    if (!stamps.length) return;
    const timer = window.setTimeout(() => {
      setResumeFeedback((current) => (current.savedAt ? { ...current, savedAt: 0 } : current));
      setCoverFeedback((current) => (current.savedAt ? { ...current, savedAt: 0 } : current));
    }, JUST_SAVED_MS);
    return () => window.clearTimeout(timer);
  }, [resumeFeedback.savedAt, coverFeedback.savedAt]);

  const resumeState = applicationDocumentSyncState(application, "resume", currentResumeText, currentResumeSource);
  const coverState = applicationDocumentSyncState(
    application,
    "coverLetter",
    coverLetterText,
    currentCoverLetterSource
  );

  const save = useCallback(
    async (kind: ApplicationDocumentKind) => {
      if (!application) return;
      if (application.status === "not_applying") return;
      if (saveInFlight.current.has(kind)) return;
      // Never let an empty editor erase the version the application holds.
      if (!(kind === "resume" ? currentResumeText : coverLetterText).trim()) return;
      const setFeedback = kind === "resume" ? setResumeFeedback : setCoverFeedback;
      const noun = kind === "resume" ? "Resume" : "Cover letter";
      const startedApplicationId = application.id;
      const startedVersion =
        kind === "resume"
          ? latestSaveIdentityRef.current.resume
          : latestSaveIdentityRef.current.coverLetter;
      const sameApplication = () =>
        latestSaveIdentityRef.current.applicationId === startedApplicationId;
      const stillCurrent = () => {
        const latest = latestSaveIdentityRef.current;
        return (
          latest.applicationId === startedApplicationId &&
          (kind === "resume" ? latest.resume : latest.coverLetter) ===
            startedVersion
        );
      };
      saveInFlight.current.add(kind);
      setSavingKinds((current) => new Set(current).add(kind));
      setFeedback(NO_FEEDBACK);
      try {
        const artifacts = kind === "resume" ? await getResumeArtifacts() : await getCoverLetterArtifacts();
        if (!artifacts) {
          if (!sameApplication()) return;
          setFeedback({
            status:
              kind === "resume"
                ? "Resume update failed. No editable resume source is available."
                : "Cover letter update failed. No editable cover letter source is available.",
            statusIsError: true,
            savedAt: 0
          });
          return;
        }
        if (!sameApplication()) return;
        if (!stillCurrent()) {
          setFeedback({
            status:
              kind === "resume"
                ? "Resume changed before it could be saved. The current draft was kept; save again."
                : "Cover letter changed before it could be saved. The current draft was kept; save again.",
            statusIsError: true,
            savedAt: 0
          });
          return;
        }
        const result = await saveApplicationDocument(application.id, kind === "resume" ? "resume" : "cover", artifacts);
        if (!sameApplication()) return;
        if (!result.ok) {
          setFeedback({
            status: result.error ?? `${noun} update failed. The saved application is unchanged.`,
            statusIsError: true,
            savedAt: 0
          });
          return;
        }
        if (!stillCurrent()) {
          setFeedback({
            status: `${noun} changed while saving. The application has the earlier version; save the current draft again.`,
            statusIsError: true,
            savedAt: 0
          });
          return;
        }
        (kind === "resume" ? onResumeSaved : onCoverLetterSaved)(startedApplicationId, startedVersion);
        setFeedback({
          status: `${noun} updated.`,
          statusIsError: false,
          savedAt: Date.now()
        });
      } catch {
        if (!sameApplication()) return;
        setFeedback({
          status: `${noun} update could not be confirmed. Refresh Applications before retrying.`,
          statusIsError: true,
          savedAt: 0
        });
      } finally {
        saveInFlight.current.delete(kind);
        setSavingKinds((current) => {
          const next = new Set(current);
          next.delete(kind);
          return next;
        });
      }
    },
    [
      application,
      coverLetterText,
      currentResumeText,
      getCoverLetterArtifacts,
      getResumeArtifacts,
      onCoverLetterSaved,
      onResumeSaved,
      saveApplicationDocument
    ]
  );

  const saveResume = useCallback(() => save("resume"), [save]);
  const saveCoverLetter = useCallback(() => save("coverLetter"), [save]);

  const targetLabel = application?.title || application?.company || "this application";

  const resume = useMemo(
    () =>
      describe({
        kind: "resume",
        state: resumeState,
        hasContent: Boolean(currentResumeText.trim()),
        feedback: resumeFeedback,
        isSaving: savingKinds.has("resume"),
        targetLabel,
        save: saveResume
      }),
    [currentResumeText, resumeFeedback, resumeState, saveResume, savingKinds, targetLabel]
  );

  const coverLetter = useMemo(
    () =>
      describe({
        kind: "coverLetter",
        state: coverState,
        hasContent: Boolean(coverLetterText.trim()),
        feedback: coverFeedback,
        isSaving: savingKinds.has("coverLetter"),
        targetLabel,
        save: saveCoverLetter
      }),
    [coverFeedback, coverLetterText, coverState, saveCoverLetter, savingKinds, targetLabel]
  );

  return { application, resume, coverLetter };
}

// Row copy for one document. Kept terse: a title that names the action (or the
// settled state) and a single supporting line.
function describe({
  kind,
  state,
  hasContent,
  feedback,
  isSaving,
  targetLabel,
  save
}: {
  kind: ApplicationDocumentKind;
  state: ApplicationDocumentSyncState;
  hasContent: boolean;
  feedback: DocumentFeedback;
  isSaving: boolean;
  targetLabel: string;
  save: () => Promise<void>;
}): ApplicationDocumentSync {
  const noun = kind === "resume" ? "resume" : "cover letter";
  const justSaved = state === "saved" && feedback.savedAt > 0;
  const title =
    state === "no-application"
      ? "Save to application"
      : state === "job-only"
        ? "Not saved with skipped job"
      : state === "unsaved"
        ? isSaving
          ? "Updating application…"
          : "Update application"
        : "Saved to application";
  const description =
    state === "no-application"
      ? "Apply first to create the application."
      : state === "job-only"
        ? `Start a new application attempt before saving a ${noun}.`
      : state === "unsaved"
        ? hasContent
          ? `Replace the ${noun} saved to ${targetLabel}.`
          : // An empty editor is not an update — it would erase the version the
            // application already holds.
            `Add ${noun} content before saving it to ${targetLabel}.`
        : justSaved
          ? "Updated just now."
          : `This ${noun} matches ${targetLabel}.`;
  return {
    state,
    title,
    description,
    disabled: state !== "unsaved" || !hasContent || isSaving,
    isSaving,
    status: feedback.status,
    statusIsError: feedback.statusIsError,
    save
  };
}
