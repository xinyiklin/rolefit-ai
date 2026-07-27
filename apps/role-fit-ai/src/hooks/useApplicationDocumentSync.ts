/**
 * useApplicationDocumentSync — save the resume or the cover letter to the
 * application this session is working on, after Apply has already created it.
 *
 * Apply stores both documents at once; the letter is often still untailored at
 * that moment, and the resume keeps being edited afterwards. This hook owns the
 * per-document saved/unsaved state and the two explicit save actions, so a
 * finished letter no longer has to be copied by hand.
 *
 * State ownership: the remembered application link, the per-document busy /
 * status / just-saved state are OWNED here. The applications store, the job
 * target, and the two editors' current content arrive as args and are never
 * mutated except through the atomic application-file mutation boundary.
 *
 * Saving is ALWAYS user-initiated. Nothing here runs on an effect: regenerating
 * or editing a document must never silently rewrite what the application holds.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Application } from "./useApplications";
import {
  applicationDocumentSyncState,
  applicationMatchesJobTarget,
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
  findForTarget: (url: string, desc: string) => Application | undefined;
  jobUrl: string;
  jobDescription: string;
  currentResumeText: string;
  currentResumeSource: string;
  coverLetterText: string;
  currentCoverLetterSource: string;
  saveApplicationDocument: (
    id: string,
    kind: "resume" | "cover",
    upload: DocumentUpload
  ) => Promise<{ ok: boolean; error?: string }>;
  // Each editor serializes its editable source for the copy the application
  // keeps. Both kinds are stored the same way.
  getResumeArtifacts: () => Promise<DocumentUpload | null>;
  getCoverLetterArtifacts: () => Promise<DocumentUpload | null>;
  onResumeSaved: () => void;
  onCoverLetterSaved: () => void;
};

type DocumentFeedback = { status: string; statusIsError: boolean; savedAt: number };

const NO_FEEDBACK: DocumentFeedback = { status: "", statusIsError: false, savedAt: 0 };

export function useApplicationDocumentSync({
  applications,
  findForTarget,
  jobUrl,
  jobDescription,
  currentResumeText,
  currentResumeSource,
  coverLetterText,
  currentCoverLetterSource,
  saveApplicationDocument,
  getResumeArtifacts,
  getCoverLetterArtifacts,
  onResumeSaved,
  onCoverLetterSaved
}: UseApplicationDocumentSyncArgs) {
  // The application this session applied to (or restored from the tracker). It
  // takes precedence over the job-target lookup because Apply may have merged
  // into a record whose own primary URL is a different posting of the same role.
  const [linkedId, setLinkedId] = useState<string | null>(null);
  const [savingKinds, setSavingKinds] = useState<Set<ApplicationDocumentKind>>(
    () => new Set()
  );
  const [resumeFeedback, setResumeFeedback] = useState<DocumentFeedback>(NO_FEEDBACK);
  const [coverFeedback, setCoverFeedback] = useState<DocumentFeedback>(NO_FEEDBACK);
  const saveInFlight = useRef<Set<ApplicationDocumentKind>>(new Set());

  const linkApplication = useCallback((id: string | null) => {
    setLinkedId(id);
    setResumeFeedback(NO_FEEDBACK);
    setCoverFeedback(NO_FEEDBACK);
  }, []);

  const targetMatch = findForTarget(jobUrl, jobDescription);
  const linked = linkedId ? applications.find((a) => a.id === linkedId) ?? null : null;
  const application = linked ?? targetMatch ?? null;

  // Drop the link once the desk is pointed at a different posting. Without this
  // an "Update application" after loading a new job would write this job's
  // document onto the previous role's record.
  useEffect(() => {
    if (!linked) return;
    if (applicationMatchesJobTarget(linked, jobUrl, jobDescription)) return;
    setLinkedId(null);
    setResumeFeedback(NO_FEEDBACK);
    setCoverFeedback(NO_FEEDBACK);
  }, [linked, jobUrl, jobDescription]);

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

  const resumeState = applicationDocumentSyncState(
    application,
    "resume",
    currentResumeText,
    currentResumeSource
  );
  const coverState = applicationDocumentSyncState(
    application,
    "coverLetter",
    coverLetterText,
    currentCoverLetterSource
  );

  const save = useCallback(
    async (kind: ApplicationDocumentKind) => {
      if (!application) return;
      if (saveInFlight.current.has(kind)) return;
      // Never let an empty editor erase the version the application holds.
      if (!(kind === "resume" ? currentResumeText : coverLetterText).trim()) return;
      const setFeedback = kind === "resume" ? setResumeFeedback : setCoverFeedback;
      saveInFlight.current.add(kind);
      setSavingKinds((current) => new Set(current).add(kind));
      setFeedback(NO_FEEDBACK);
      try {
        const artifacts = kind === "resume" ? await getResumeArtifacts() : await getCoverLetterArtifacts();
        if (!artifacts) {
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
        const noun = kind === "resume" ? "Resume" : "Cover letter";
        const result = await saveApplicationDocument(
          application.id,
          kind === "resume" ? "resume" : "cover",
          artifacts
        );
        if (!result.ok) {
          setFeedback({
            status: result.error ?? `${noun} update failed. The saved application is unchanged.`,
            statusIsError: true,
            savedAt: 0
          });
          return;
        }
        (kind === "resume" ? onResumeSaved : onCoverLetterSaved)();
        setFeedback({
          status: `${noun} updated.`,
          statusIsError: false,
          savedAt: Date.now()
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

  return { application, linkApplication, resume, coverLetter };
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
      : state === "unsaved"
        ? isSaving
          ? "Updating application…"
          : "Update application"
        : "Saved to application";
  const description =
    state === "no-application"
      ? "Apply first to create the application."
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
