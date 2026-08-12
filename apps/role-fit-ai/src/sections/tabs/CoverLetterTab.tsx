import { useRef, useState, type RefObject } from "react";

import {
  TypesetEditor,
  type InlineFormatState,
  type TypesetCaret,
  type TypesetEditorHandle
} from "@typeset/editor/sections/editor/TypesetEditor.tsx";
import type { ApplicationDocumentSync } from "../../hooks/useApplicationDocumentSync";
import type { DraftAutosaveState } from "../../hooks/useAutosaveDraft";
import type { CoverLetterAutosavedDraft } from "../../hooks/useCoverLetterAutosaveDraft";
import type { CoverLetterEditorState } from "../../hooks/useCoverLetterEditor";
import type {
  CoverLetterFailure,
  CoverLetterProposal
} from "../../hooks/useCoverLetter";
import type { CoverLetterTailorResult } from "../../lib/coverLetterEvidence";
import type {
  CoverLetterDetailKey,
  CoverLetterPreflight
} from "../../lib/coverLetterPreflight";
import { DOC_PAGE_WIDTH_PX } from "@typeset/engine/lib/documentStyle.ts";
import { useRestoredScroll } from "../../hooks/useRestoredScroll";
import { CoverLetterReview } from "../cover-letter/CoverLetterReview";
import { DraftRestoreBar } from "../DraftRestoreBar";
import { CoverLetterToolbar } from "../cover-letter/CoverLetterToolbar";
import {
  DocumentWorkbench,
  DocumentWorkbenchEditorPane
} from "../document/DocumentWorkbench";

const COVER_LETTER_STRUCTURE_CAPABILITIES = {
  header: true,
  sections: false
} as const;

type CoverLetterTabProps = {
  editor: CoverLetterEditorState;
  editorRef: RefObject<TypesetEditorHandle | null>;
  // Held by the host across the tab switch that unmounts this editor.
  initialCaret: TypesetCaret | null;
  onCaretExit: (caret: TypesetCaret | null) => void;
  initialScrollTop: number;
  onScrollExit: (top: number) => void;
  inlineFormat: InlineFormatState;
  onInlineFormatStateChange: (state: InlineFormatState) => void;
  onTailor: () => void;
  onDocumentChoice: () => void;
  applicationSync: ApplicationDocumentSync;
  draftAutosaveState: DraftAutosaveState;
  // Autosave recovery: non-null when a draft from a previous session was found.
  pendingAutosaveDraft: CoverLetterAutosavedDraft | null;
  onRestoreAutosaveDraft: (draft: CoverLetterAutosavedDraft) => void;
  onDismissAutosaveDraft: () => void;
  isTailoring: boolean;
  tailorStatus: string;
  resumeReady: boolean;
  jobReady: boolean;
  providerReady: boolean;
  jobTarget?: { role?: string; company?: string };
  preflight: CoverLetterPreflight;
  proposal: CoverLetterProposal | null;
  appliedResult: CoverLetterTailorResult | null;
  failure: CoverLetterFailure | null;
  slotAnswers: Record<string, string>;
  onDetailChange: (key: CoverLetterDetailKey, value: string) => void;
  onSlotAnswerChange: (slotId: string, value: string) => void;
  onAcceptProposal: () => void;
  onDiscardProposal: () => void;
  onAddHonestContext?: (keyword: string) => void;
  onRestorePreTailor: () => void;
};

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export function CoverLetterTab({
  editor,
  editorRef,
  initialCaret,
  onCaretExit,
  initialScrollTop,
  onScrollExit,
  inlineFormat,
  onInlineFormatStateChange,
  onTailor,
  onDocumentChoice,
  applicationSync,
  draftAutosaveState,
  pendingAutosaveDraft,
  onRestoreAutosaveDraft,
  onDismissAutosaveDraft,
  isTailoring,
  tailorStatus,
  resumeReady,
  jobReady,
  providerReady,
  jobTarget,
  preflight,
  proposal,
  appliedResult,
  failure,
  slotAnswers,
  onDetailChange,
  onSlotAnswerChange,
  onAcceptProposal,
  onDiscardProposal,
  onAddHonestContext,
  onRestorePreTailor
}: CoverLetterTabProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { editorScrollerRef, layoutScrollerRef } = useRestoredScroll(
    initialScrollTop,
    onScrollExit
  );
  const [pageCount, setPageCount] = useState(0);
  // Held here, not in the toolbar, so the editor's right-click menu and link card
  // can open the same link popover the toolbar button opens.
  const [linkEditorOpen, setLinkEditorOpen] = useState(false);
  const hasLetter = true;
  // Enabled state depends only on real readiness — never on whether some
  // intermediate review object happens to exist.
  const canTailor =
    preflight.canTailor && resumeReady && jobReady && providerReady && !isTailoring;
  const targetLine = [jobTarget?.role, jobTarget?.company].filter(Boolean).join(" at ");
  const issueCount = failure?.kind === "blocked" ? failure.issues.length : 0;
  // Idle, the rail's phase, description, and checks already carry the workflow
  // message; repeating it under the action was this letter's one extra line the
  // resume never had. The editor's own receipts (save, PDF) still surface here.
  const workflowActive = isTailoring || Boolean(failure) || Boolean(proposal) || Boolean(appliedResult);
  const railStatus = (workflowActive ? tailorStatus : "") || editor.status;

  return (
    <section className="studio-card studio-card--flush cover-letter-page">
      <CoverLetterToolbar
        linkEditorOpen={linkEditorOpen}
        onLinkEditorOpenChange={setLinkEditorOpen}
        editor={editor}
        editorRef={editorRef}
        inputRef={inputRef}
        inlineFormat={inlineFormat}
        hasLetter={hasLetter}
        targetLine={targetLine}
        applicationSync={applicationSync}
        onDocumentChoice={onDocumentChoice}
        draftAutosaveState={draftAutosaveState}
      />

      <DocumentWorkbench
        pageWidthPx={DOC_PAGE_WIDTH_PX * editor.docStyle.style.zoom}
        layoutRef={layoutScrollerRef}
        notice={pendingAutosaveDraft ? (
          <DraftRestoreBar
            label="Recovery draft available"
            jobLabel={pendingAutosaveDraft.jobLabel}
            savedAt={pendingAutosaveDraft.savedAt}
            onRestore={() => onRestoreAutosaveDraft(pendingAutosaveDraft)}
            onDismiss={onDismissAutosaveDraft}
          />
        ) : null}
        rail={{
          id: "cover-tailoring",
          label: "Workflow",
          preferenceKey: "cover-tailoring",
          // The rail's one primary action, handed to the shell so it sits beside
          // the disclosure control whether the rail is open or closed.
          action: (
            <button
              type="button"
              className="primary-button is-compact"
              disabled={!canTailor}
              aria-busy={isTailoring}
              onClick={onTailor}
            >
              {isTailoring ? "Polishing…" : proposal || appliedResult ? "Polish again" : "Polish"}
            </button>
          ),
          ...(issueCount > 0
            ? {
                attention: {
                  count: issueCount,
                  label: `${issueCount} ${issueCount === 1 ? "issue" : "issues"}`
                }
              }
            : {}),
          content: <CoverLetterReview
            words={wordCount(editor.text)}
            pageCount={pageCount}
            currentText={editor.text}
            preflight={preflight}
            proposal={proposal}
            appliedResult={appliedResult}
            failure={failure}
            canRestore={editor.canRestorePreTailor}
            isTailoring={isTailoring}
            resumeReady={resumeReady}
            jobReady={jobReady}
            providerReady={providerReady}
            slotAnswers={slotAnswers}
            onDetailChange={onDetailChange}
            onSlotAnswerChange={onSlotAnswerChange}
            onTailor={onTailor}
            onAcceptProposal={onAcceptProposal}
            onDiscardProposal={onDiscardProposal}
            onRestore={onRestorePreTailor}
            onAddHonestContext={onAddHonestContext}
            status={railStatus}
          />
        }}
      >
        <DocumentWorkbenchEditorPane
          className="document-workbench__editor--cover-letter"
          ref={editorScrollerRef}
        >
          <TypesetEditor
            ref={editorRef}
            data={editor.data}
            actions={editor.actions}
            canUndo={editor.canUndo}
            canRedo={editor.canRedo}
            contentUndoSequence={editor.undoSequence}
            contentRedoSequence={editor.redoSequence}
            docStyle={editor.docStyle}
            documentKind="cover-letter"
            structureCapabilities={COVER_LETTER_STRUCTURE_CAPABILITIES}
            initialCaret={initialCaret}
            onCaretExit={onCaretExit}
            onRequestLinkEditor={() => setLinkEditorOpen(true)}
            onInlineFormatStateChange={onInlineFormatStateChange}
            onPageCount={setPageCount}
          />
        </DocumentWorkbenchEditorPane>
      </DocumentWorkbench>
    </section>
  );
}
