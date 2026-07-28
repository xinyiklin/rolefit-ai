import { useMemo, useRef, useState, type RefObject } from "react";

import { parseCoverLetterText } from "@typeset/engine/lib/coverLetter.ts";
import { toTypesetSchema } from "@typeset/engine/typeset/schema.ts";
import { layoutCoverLetter } from "@typeset/engine/typeset/layout.ts";
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
  CoverLetterEvidenceItem,
  CoverLetterPreparation,
  CoverLetterProposal
} from "../../lib/coverLetterEvidence";
import type {
  CoverLetterPreparationFieldKey,
  CoverLetterPreflight,
  CoverLetterSourceMode
} from "../../lib/coverLetterPreflight";
import { useRestoredScroll } from "../../hooks/useRestoredScroll";
import { CoverLetterReview } from "../cover-letter/CoverLetterReview";
import { DraftRestoreBar } from "../DraftRestoreBar";
import { CoverLetterToolbar } from "../cover-letter/CoverLetterToolbar";

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
  onDraft: () => void;
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
  providerMessage: string;
  jobTarget?: { role?: string; company?: string };
  preflight: CoverLetterPreflight;
  proposal: CoverLetterProposal | null;
  evidence: CoverLetterEvidenceItem[];
  preparation: CoverLetterPreparation | null;
  clarificationAnswers: Record<string, string>;
  onSourceModeChange: (mode: CoverLetterSourceMode) => void;
  onPreparationFieldChange: (key: CoverLetterPreparationFieldKey, value: string) => void;
  onClarificationChange: (evidenceId: string, value: string) => void;
  onEvidenceDecisionChange: (evidenceId: string, decision: "use" | "skip") => void;
  onAcceptProposal: () => void;
  onEditProposal: () => void;
  onDiscardProposal: () => void;
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
  onDraft,
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
  providerMessage,
  jobTarget,
  preflight,
  proposal,
  evidence,
  preparation,
  clarificationAnswers,
  onSourceModeChange,
  onPreparationFieldChange,
  onClarificationChange,
  onEvidenceDecisionChange,
  onAcceptProposal,
  onEditProposal,
  onDiscardProposal
}: CoverLetterTabProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollerRef = useRestoredScroll(initialScrollTop, onScrollExit);
  const [pageCount, setPageCount] = useState(0);
  // Held here, not in the toolbar, so the editor's right-click menu and link card
  // can open the same link popover the toolbar button opens.
  const [linkEditorOpen, setLinkEditorOpen] = useState(false);
  const hasLetter = true;
  const canTailor =
    preflight.readyForPreparation &&
    resumeReady &&
    jobReady &&
    providerReady &&
    !isTailoring &&
    !preparation &&
    !proposal;
  const targetLine = [jobTarget?.role, jobTarget?.company].filter(Boolean).join(" at ");
  const readinessHint = preflight.blockingReasons[0]
    ? preflight.blockingReasons[0]
    : !resumeReady && !jobReady
      ? "Add a resume and job description first."
      : !resumeReady
        ? "Add your resume first."
        : !jobReady
          ? "Add the job description first."
          : !providerReady
            ? providerMessage
            : "";
  const tailorHint = proposal
    ? "Review the proposal in the rail."
    : preparation
      ? "Review the evidence plan in the rail."
      : readinessHint;
  const proposalPageCount = useMemo(() => {
    if (!proposal) return 0;
    try {
      return layoutCoverLetter(
        toTypesetSchema(parseCoverLetterText(proposal.coverLetterText)),
        editor.docStyle.style
      ).pages.length;
    } catch {
      return 0;
    }
  }, [editor.docStyle.style, proposal]);

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
        canTailor={canTailor}
        tailorHint={tailorHint}
        actionLabel={
          preflight.sourceMode === "authored_letter"
            ? "Polish"
            : preflight.readyForPreparation
              ? "Draft"
              : "Complete details"
        }
        isTailoring={isTailoring}
        targetLine={targetLine}
        onTailor={onTailor}
        applicationSync={applicationSync}
        draftAutosaveState={draftAutosaveState}
      />

      <div className="cover-letter-workbench">
        {pendingAutosaveDraft ? (
          <DraftRestoreBar
            label="Unsaved cover letter found"
            jobLabel={pendingAutosaveDraft.jobLabel}
            savedAt={pendingAutosaveDraft.savedAt}
            onRestore={() => onRestoreAutosaveDraft(pendingAutosaveDraft)}
            onDismiss={onDismissAutosaveDraft}
          />
        ) : null}

        <div className="cover-letter-workbench__editor" ref={scrollerRef}>
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
            structureEditing={false}
            initialCaret={initialCaret}
            onCaretExit={onCaretExit}
            onRequestLinkEditor={() => setLinkEditorOpen(true)}
            onInlineFormatStateChange={onInlineFormatStateChange}
            onPageCount={setPageCount}
          />
        </div>

        <CoverLetterReview
          words={wordCount(editor.text)}
          pageCount={pageCount}
          proposalPageCount={proposalPageCount}
          preflight={preflight}
          evidence={evidence}
          preparation={preparation}
          proposal={proposal}
          proposalWords={proposal ? wordCount(proposal.coverLetterText) : 0}
          clarificationAnswers={clarificationAnswers}
          isWorking={isTailoring}
          onSourceModeChange={onSourceModeChange}
          onPreparationFieldChange={onPreparationFieldChange}
          onClarificationChange={onClarificationChange}
          onEvidenceDecisionChange={onEvidenceDecisionChange}
          onPrepare={onTailor}
          onDraft={onDraft}
          onAcceptProposal={onAcceptProposal}
          onEditProposal={onEditProposal}
          onDiscardProposal={onDiscardProposal}
          status={tailorHint || tailorStatus || editor.status}
        />
      </div>
    </section>
  );
}
