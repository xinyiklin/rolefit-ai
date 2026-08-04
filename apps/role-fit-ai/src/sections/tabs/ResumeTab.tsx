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
  type TypesetCaret,
  type TypesetEditorHandle,
  type TypesetEditorOverlayContext
} from "@typeset/editor/sections/editor/TypesetEditor.tsx";
import type { JobConstraint } from "../../lib/jobConstraints";
import type { PolishProgressState } from "../../lib/aiWorkflow";
import type { AutosavedDraft } from "../../hooks/useAutosaveDraft";
import type { DraftAutosaveState } from "../../hooks/useAutosaveDraft";
import { fieldKeyForReviewTarget } from "../../lib/reviewTarget.ts";
import { useRestoredScroll } from "../../hooks/useRestoredScroll";
import { DraftRestoreBar } from "../DraftRestoreBar";
import {
  DocumentWorkbench,
  DocumentWorkbenchEditorPane
} from "../document/DocumentWorkbench";
import { RoleFitEditorOverlay } from "../editor/RoleFitEditorOverlay.tsx";
import { ResumeWorkflowRail } from "../resume/ResumeWorkflowRail";
import { ViewportGate } from "../ViewportGate";

type ResumeTabProps = {
  documentTitle: string;
  onDocumentTitleChange: (title: string) => void;
  editedResume: ResumeData;
  actions: ResumeEditorActions;
  canUndo: boolean;
  canRedo: boolean;
  contentUndoSequence: number | null;
  contentRedoSequence: number | null;
  dirty: boolean;
  draftAutosaveState: DraftAutosaveState;
  // JD lifestyle/logistical conditions for the pre-apply advisory (not fit).
  jobConstraints?: JobConstraint[];
  result: PolishedResume | null;
  resumeDiff: ResumeDiff | null;
  docStyle: DocStyleControls;
  formattingToolbar: ReactNode;
  editorRef: RefObject<TypesetEditorHandle | null>;
  fitViewportRef: RefObject<HTMLDivElement | null>;
  // Held by the host across the tab switch that unmounts this editor.
  initialCaret: TypesetCaret | null;
  onCaretExit: (caret: TypesetCaret | null) => void;
  initialScrollTop: number;
  onScrollExit: (top: number) => void;
  onInlineFormatStateChange: (state: InlineFormatState) => void;
  onRequestLinkEditor: () => void;
  tailorModes: Record<string, TailorMode>;
  onSetTailorMode: (sectionId: string, mode: TailorMode) => void;
  documentActions?: ReactNode;
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
  resumeReady: boolean;
  jobReady: boolean;
  tailorProviderReady: boolean;
  auditProviderReady: boolean;
  isPolishing: boolean;
  polishProgress: PolishProgressState;
  polishStatus?: string;
  onPolish: () => void;
  onRetryTailor: () => void;
  onRetryAudit: () => void;
  onStopPolish: () => void;
  onProposalChange: () => void;
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
  contentUndoSequence,
  contentRedoSequence,
  dirty,
  draftAutosaveState,
  jobConstraints,
  result,
  resumeDiff,
  docStyle,
  formattingToolbar,
  editorRef,
  fitViewportRef,
  initialCaret,
  onCaretExit,
  initialScrollTop,
  onScrollExit,
  onInlineFormatStateChange,
  onRequestLinkEditor,
  tailorModes,
  onSetTailorMode,
  documentActions,
  onAddHonestContext,
  jobTarget,
  pendingAutosaveDraft,
  onRestoreAutosaveDraft,
  onDismissAutosaveDraft,
  reviewStale,
  resumeReady,
  jobReady,
  tailorProviderReady,
  auditProviderReady,
  isPolishing,
  polishProgress,
  polishStatus,
  onPolish,
  onRetryTailor,
  onRetryAudit,
  onStopPolish,
  onProposalChange
}: ResumeTabProps) {
  const { editorScrollerRef, layoutScrollerRef } = useRestoredScroll(
    initialScrollTop,
    onScrollExit
  );
  const setEditorPaneRef = useCallback((node: HTMLDivElement | null) => {
    editorScrollerRef.current = node;
    fitViewportRef.current = node;
  }, [editorScrollerRef, fitViewportRef]);
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
  const highlightedFieldKey = fieldKeyForReviewTarget(editedResume, highlightTarget);
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

  const selectedSectionCount = Object.values(tailorModes).filter((mode) => mode !== "off").length;
  const tailorSectionCount = Object.values(tailorModes).filter((mode) => mode === "tailor").length;
  const documentContext = [jobTarget?.role, jobTarget?.company].filter(Boolean).join(" at ");
  return (
    <section className="studio-card studio-card--flush">
      <header
        className="top-toolbar resume-tab__toolbar"
        aria-label="Resume editor toolbar"
        data-toolbar-labels="icon"
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
          docStyle={docStyle}
          actions={(
            <div className="top-toolbar__file-actions" role="toolbar" aria-label="Resume actions">
              {documentActions}
            </div>
          )}
        />
        {formattingToolbar}
      </header>

      <DocumentWorkbench
        layoutRef={layoutScrollerRef}
        notice={pendingAutosaveDraft && onRestoreAutosaveDraft && onDismissAutosaveDraft ? (
          <DraftRestoreBar
            label="Unsaved draft found"
            jobLabel={pendingAutosaveDraft.jobLabel}
            savedAt={pendingAutosaveDraft.savedAt}
            onRestore={() => onRestoreAutosaveDraft(pendingAutosaveDraft)}
            onDismiss={onDismissAutosaveDraft}
          />
        ) : null}
        rail={{
          id: "resume-review",
          label: "Workflow",
          preferenceKey: "resume-review",
          content: (
            <ResumeWorkflowRail
              result={result}
              resume={editedResume}
              actions={actions}
              resumeDiff={resumeDiff}
              jobConstraints={jobConstraints}
              reviewStale={reviewStale}
              jobTarget={jobTarget}
              resumeReady={resumeReady}
              jobReady={jobReady}
              tailorProviderReady={tailorProviderReady}
              auditProviderReady={auditProviderReady}
              selectedSectionCount={selectedSectionCount}
              tailorSectionCount={tailorSectionCount}
              isPolishing={isPolishing}
              progress={polishProgress}
              status={polishStatus}
              onPolish={onPolish}
              onRetryTailor={onRetryTailor}
              onRetryAudit={onRetryAudit}
              onStop={onStopPolish}
              onHighlight={setHighlightTarget}
              onProposalChange={onProposalChange}
              onAddHonestContext={onAddHonestContext}
            />
          )
        }}
      >
        <DocumentWorkbenchEditorPane
          ref={setEditorPaneRef}
          onDragStart={(e) => {
            if (!(e.target as HTMLElement).closest?.(".resume-doc")) e.preventDefault();
          }}
        >
          <ViewportGate>
            <TypesetEditor
              ref={editorRef}
              data={editedResume}
              actions={actions}
              canUndo={canUndo}
              canRedo={canRedo}
              contentUndoSequence={contentUndoSequence}
              contentRedoSequence={contentRedoSequence}
              docStyle={docStyle}
              initialCaret={initialCaret}
              onCaretExit={onCaretExit}
              onInlineFormatStateChange={onInlineFormatStateChange}
              onRequestLinkEditor={onRequestLinkEditor}
              overlay={renderOverlay}
              highlightFieldKey={highlightedFieldKey}
            />
          </ViewportGate>
        </DocumentWorkbenchEditorPane>
      </DocumentWorkbench>
    </section>
  );
}
