import { useCallback, useEffect, useState, type ReactNode, type RefObject } from "react";

import type { PolishedResume, ResumeDiff } from "../../resumeEngine";
import type { ResumeData } from "@typeset/engine/lib/resumeData.ts";
import type { TailorMode } from "../../lib/tailorScope";
import type { ResumeEditorActions } from "../../hooks/useResumeEditor";
import type { TailorChangeTarget } from "../../resume/types";
import type { DocStyleControls } from "@typeset/editor/hooks/useDocStyle.ts";
import { nextZoomOption } from "@typeset/engine/lib/documentStyle.ts";
import { DocumentToolbar } from "@typeset/editor/components/toolbar/DocumentToolbar.tsx";
import {
  TypesetEditor,
  type InlineFormatState,
  type TypesetEditorHandle,
  type TypesetEditorOverlayContext
} from "@typeset/editor/sections/editor/TypesetEditor.tsx";
import type { JobConstraint } from "../../lib/jobConstraints";
import type { AutosavedDraft } from "../../hooks/useAutosaveDraft";
import type { DraftAutosaveState } from "../../hooks/useAutosaveDraft";
import { fieldKeyForReviewTarget } from "../../lib/reviewTarget.ts";
import { RoleFitEditorOverlay } from "../editor/RoleFitEditorOverlay.tsx";
import { ReviewRail } from "../ReviewRail";
import { ViewportGate } from "../ViewportGate";

type ResumeTabProps = {
  documentTitle: string;
  onDocumentTitleChange: (title: string) => void;
  editedResume: ResumeData | null;
  actions: ResumeEditorActions;
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
  draftAutosaveState: DraftAutosaveState;
  // True only for the first workspace check. Manual Reload actions do not
  // replace the live editor with this arrival state.
  isWorkspaceBootstrapping: boolean;
  resultSourceLabel: string;
  // JD lifestyle/logistical conditions for the pre-apply advisory (not fit).
  jobConstraints?: JobConstraint[];
  result: PolishedResume | null;
  resumeDiff: ResumeDiff | null;
  docStyle: DocStyleControls;
  formattingToolbar: ReactNode;
  editorRef: RefObject<TypesetEditorHandle | null>;
  onInlineFormatStateChange: (state: InlineFormatState) => void;
  onRequestLinkEditor: () => void;
  tailorModes: Record<string, TailorMode>;
  onSetTailorMode: (sectionId: string, mode: TailorMode) => void;
  exportControl?: ReactNode;
  onAddHonestContext?: (keyword: string) => void;
  // Autosave recovery: non-null when a draft from a previous session was found.
  pendingAutosaveDraft?: AutosavedDraft | null;
  onRestoreAutosaveDraft?: (draft: AutosavedDraft) => void;
  onDismissAutosaveDraft?: () => void;
  // Job target context: displayed in the header so the user knows which role
  // the resume is being tailored for.
  jobTarget?: { role?: string; company?: string } | null;
  // True when the JD changed since the last polish — the review describes an
  // old posting and should be flagged as stale.
  reviewStale?: boolean;
};

// The resume surface is edit-and-check: the owned typeset page is the editor
// and export layout, and once a recruiter
// review exists it docks beside the editor as an actionable rail — accept,
// modify, or apply-all the suggested edits without leaving the document.
export function ResumeTab({
  documentTitle,
  onDocumentTitleChange,
  editedResume,
  actions,
  canUndo,
  canRedo,
  dirty,
  draftAutosaveState,
  isWorkspaceBootstrapping,
  resultSourceLabel,
  jobConstraints,
  result,
  resumeDiff,
  docStyle,
  formattingToolbar,
  editorRef,
  onInlineFormatStateChange,
  onRequestLinkEditor,
  tailorModes,
  onSetTailorMode,
  exportControl,
  onAddHonestContext,
  jobTarget,
  pendingAutosaveDraft,
  onRestoreAutosaveDraft,
  onDismissAutosaveDraft,
  reviewStale
}: ResumeTabProps) {
  // Intercept Ctrl/Cmd +/-/0 to control editor zoom instead of browser zoom.
  // Deliberately unconditional (no focus/modal gating) — matches the deleted
  // hook's original scope, including its incidental double-fire with
  // PreviewOverlay's own Ctrl+/-/0 handler while the PDF preview is open.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        docStyle.set("zoom", nextZoomOption(docStyle.style.zoom, 1));
      } else if (e.key === "-") {
        e.preventDefault();
        docStyle.set("zoom", nextZoomOption(docStyle.style.zoom, -1));
      } else if (e.key === "0") {
        e.preventDefault();
        docStyle.set("zoom", 1);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [docStyle]);

  const [highlightTarget, setHighlightTarget] = useState<TailorChangeTarget | null>(null);
  const highlightedFieldKey = editedResume ? fieldKeyForReviewTarget(editedResume, highlightTarget) : null;
  const renderOverlay = useCallback(
    (context: TypesetEditorOverlayContext) => (
      <RoleFitEditorOverlay
        {...context}
        actions={actions}
        tailorModes={tailorModes}
        onSetTailorMode={onSetTailorMode}
        highlightTarget={highlightTarget}
      />
    ),
    [actions, highlightTarget, onSetTailorMode, tailorModes]
  );

  const hasReview = Boolean(result?.strictReview || result?.suggestedChanges?.length);
  const hasSuggestions = Boolean(result?.suggestedChanges?.length);
  const sourceLabel = hasSuggestions ? "AI suggestions" : resultSourceLabel;
  const jobTargetLabel = [jobTarget?.role, jobTarget?.company].filter(Boolean).join(" at ");
  const documentContext = [sourceLabel, jobTargetLabel].filter(Boolean).join(" · ");
  return (
    <section className="studio-card studio-card--flush">
      <header
        className="top-toolbar resume-tab__toolbar"
        aria-label="Resume editor toolbar"
        data-toolbar-labels="text"
      >
        <DocumentToolbar
          documentTitle={documentTitle}
          onDocumentTitleChange={onDocumentTitleChange}
          documentContext={documentContext}
          saveStatus={
            !dirty
              ? undefined
              : draftAutosaveState === "error"
                ? { state: "error", label: "Recovery save failed" }
                : draftAutosaveState === "saved"
                  ? { state: "saved", label: "Recovery draft saved" }
                  : { state: "saving", label: "Saving recovery draft" }
          }
          documentStructure={{
            name: editedResume?.name ?? "",
            contact: editedResume?.contact ?? [],
            disabled: !editedResume,
            onSetName: actions.setName,
            onUpdateContact: actions.updateContact,
            onAddContact: actions.addContact,
            onRemoveContact: actions.removeContact,
            onAddSection: (type, position) => editorRef.current?.addSection(type, position)
          }}
          docStyle={docStyle}
          actions={(
            <div className="studio-card__tools">
              {exportControl}
            </div>
          )}
        />
        {formattingToolbar}
      </header>

      <div className={`resume-workbench${hasReview ? " has-rail" : ""}`}>
        {/* Floated as an overlay so appearing/dismissing never reflows the
            editor (it sits over the desk margin above the page). */}
        {pendingAutosaveDraft && onRestoreAutosaveDraft && onDismissAutosaveDraft ? (
          <div className="draft-restore-bar" role="alert">
            <span className="draft-restore-bar__text">
              Unsaved draft found
              {pendingAutosaveDraft.jobLabel ? ` · ${pendingAutosaveDraft.jobLabel}` : ""}
              {" "}
              <span className="draft-restore-bar__time">
                {new Date(pendingAutosaveDraft.savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </span>
            <button
              type="button"
              className="ghost-button is-compact draft-restore-bar__action"
              onClick={() => onRestoreAutosaveDraft(pendingAutosaveDraft)}
            >
              Restore
            </button>
            <button
              type="button"
              className="ghost-button is-compact draft-restore-bar__dismiss"
              aria-label="Dismiss"
              onClick={onDismissAutosaveDraft}
            >
              ×
            </button>
          </div>
        ) : null}

        <div
          className="resume-workbench__editor"
          onDragStart={(e) => {
            if (!(e.target as HTMLElement).closest?.(".resume-doc")) e.preventDefault();
          }}
        >
          <ViewportGate>
            {editedResume ? (
              <TypesetEditor
                ref={editorRef}
                data={editedResume}
                actions={actions}
                canUndo={canUndo}
                canRedo={canRedo}
                docStyle={docStyle}
                onInlineFormatStateChange={onInlineFormatStateChange}
                onRequestLinkEditor={onRequestLinkEditor}
                overlay={renderOverlay}
                highlightFieldKey={highlightedFieldKey}
              />
            ) : isWorkspaceBootstrapping ? (
              <p className="resume-doc__boot" role="status" aria-live="polite">
                Opening workspace…
              </p>
            ) : (
              <div className="resume-doc__empty">
                <strong>Bring a resume to the desk</strong>
                <span>Open Resume above to upload a source file.</span>
              </div>
            )}
          </ViewportGate>
        </div>

        {hasReview && result ? (
          <div className="resume-workbench__rail">
            <ReviewRail
              result={result}
              resume={editedResume}
              actions={actions}
              resumeDiff={resumeDiff}
              jobConstraints={jobConstraints}
              reviewStale={reviewStale}
              onHighlight={setHighlightTarget}
              onAddHonestContext={onAddHonestContext}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}
