import { useCallback, useEffect, useState, type ReactNode, type RefObject } from "react";

import type { PolishedResume } from "../../resumeEngine";
import type { ResumeData } from "@typeset/engine/lib/resumeData.ts";
import type { ResumePolishScopeMode } from "../../lib/resumePolishScope";
import type { ResumeEditorActions } from "../../hooks/useResumeEditor";
import type { ResumeProposalTarget } from "../../resume/types";
import type { DocStyleControls } from "@typeset/editor/hooks/useDocStyle.ts";
import { DOC_PAGE_WIDTH_PX, nextZoomOption } from "@typeset/engine/lib/documentStyle.ts";
import { DocumentToolbar } from "@typeset/editor/components/toolbar/DocumentToolbar.tsx";
import {
  TypesetEditor,
  type InlineFormatState,
  type TypesetCaret,
  type TypesetEditorHandle,
  type TypesetEditorOverlayContext
} from "@typeset/editor/sections/editor/TypesetEditor.tsx";
import type { PolishProgressState } from "../../lib/aiWorkflow";
import type { AutosavedDraft } from "../../hooks/useAutosaveDraft";
import type { DraftAutosaveState } from "../../hooks/useAutosaveDraft";
import { resumePolishSectionIsLocked } from "../../../shared/resumePolishContract.ts";
import type { useResumeProposalDecisions } from "../../hooks/useResumeProposalDecisions";
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
  result: PolishedResume | null;
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
  polishScopeModes: Record<string, ResumePolishScopeMode>;
  onSetPolishScopeMode: (sectionId: string, mode: ResumePolishScopeMode) => void;
  documentActions?: ReactNode;
  // Autosave recovery: non-null when a draft from a previous session was found.
  pendingAutosaveDraft?: AutosavedDraft | null;
  onRestoreAutosaveDraft?: (draft: AutosavedDraft) => void;
  onDismissAutosaveDraft?: () => void;
  // Job target context: displayed in the header so the user knows which role
  // the resume is being polished for.
  jobTarget?: { role?: string; company?: string } | null;
  // True when the JD changed since the last Polish proposal.
  proposalStale?: boolean;
  resumeReady: boolean;
  jobReady: boolean;
  resumePolishProviderReady: boolean;
  isPolishing: boolean;
  polishProgress: PolishProgressState;
  polishStatus?: string;
  proposalDecisions: ReturnType<typeof useResumeProposalDecisions>;
  onPolish: () => void;
  onRetryPolish: () => void;
  onStopPolish: () => void;
};

// The resume surface is edit-and-polish: the owned typeset page is the editor
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
  result,
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
  polishScopeModes,
  onSetPolishScopeMode,
  documentActions,
  jobTarget,
  pendingAutosaveDraft,
  onRestoreAutosaveDraft,
  onDismissAutosaveDraft,
  proposalStale,
  resumeReady,
  jobReady,
  resumePolishProviderReady,
  isPolishing,
  polishProgress,
  polishStatus,
  proposalDecisions,
  onPolish,
  onRetryPolish,
  onStopPolish,
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

  const [highlightTarget, setHighlightTarget] = useState<ResumeProposalTarget | null>(null);
  const highlightedFieldKey = fieldKeyForReviewTarget(editedResume, highlightTarget);
  const renderOverlay = useCallback(
    (context: TypesetEditorOverlayContext) => (
      <RoleFitEditorOverlay
        {...context}
        polishScopeModes={polishScopeModes}
        onSetPolishScopeMode={onSetPolishScopeMode}
      />
    ),
    [onSetPolishScopeMode, polishScopeModes]
  );

  const selectedSectionCount = Object.values(polishScopeModes).filter((mode) => mode !== "off").length;
  const lockedSectionIds = new Set(
    editedResume.sections
      .filter((section) => resumePolishSectionIsLocked(section.heading))
      .map((section) => section.id)
  );
  const polishSectionCount = Object.entries(polishScopeModes)
    .filter(([sectionId, mode]) => mode === "polish" && !lockedSectionIds.has(sectionId))
    .length;
  const canPolish =
    resumeReady &&
    jobReady &&
    resumePolishProviderReady &&
    polishSectionCount > 0;
  const documentContext = [jobTarget?.role, jobTarget?.company].filter(Boolean).join(" at ");
  // The rail's one primary action, handed to the shell so it sits beside the
  // disclosure control whether the rail is open or closed.
  const polishAction = (
    <button
      type="button"
      className="primary-button is-compact"
      disabled={!canPolish || isPolishing}
      aria-busy={isPolishing}
      onClick={onPolish}
    >
      {isPolishing ? "Polishing…" : result ? "Polish again" : "Polish"}
    </button>
  );
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
        pageWidthPx={DOC_PAGE_WIDTH_PX * docStyle.style.zoom}
        layoutRef={layoutScrollerRef}
        notice={pendingAutosaveDraft && onRestoreAutosaveDraft && onDismissAutosaveDraft ? (
          <DraftRestoreBar
            label="Recovery draft available"
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
          action: polishAction,
          content: (
            <ResumeWorkflowRail
              result={result}
              resume={editedResume}
              decisions={proposalDecisions}
              proposalStale={proposalStale}
              jobTarget={jobTarget}
              resumeReady={resumeReady}
              jobReady={jobReady}
              resumePolishProviderReady={resumePolishProviderReady}
              selectedSectionCount={selectedSectionCount}
              polishSectionCount={polishSectionCount}
              isPolishing={isPolishing}
              progress={polishProgress}
              status={polishStatus}
              onRetryPolish={onRetryPolish}
              onStop={onStopPolish}
              onHighlight={setHighlightTarget}
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
