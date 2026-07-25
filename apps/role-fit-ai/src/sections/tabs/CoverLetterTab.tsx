import { useRef, useState, type RefObject } from "react";

import {
  TypesetEditor,
  type InlineFormatState,
  type TypesetEditorHandle
} from "@typeset/editor/sections/editor/TypesetEditor.tsx";
import type { CoverLetterEditorState } from "../../hooks/useCoverLetterEditor";
import { CoverLetterReview } from "../cover-letter/CoverLetterReview";
import { CoverLetterToolbar } from "../cover-letter/CoverLetterToolbar";

type CoverLetterTabProps = {
  editor: CoverLetterEditorState;
  editorRef: RefObject<TypesetEditorHandle | null>;
  inlineFormat: InlineFormatState;
  onInlineFormatStateChange: (state: InlineFormatState) => void;
  onTailor: () => void;
  isTailoring: boolean;
  tailorStatus: string;
  resumeReady: boolean;
  jobReady: boolean;
  providerReady: boolean;
  providerMessage: string;
  jobTarget?: { role?: string; company?: string };
};

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export function CoverLetterTab({
  editor,
  editorRef,
  inlineFormat,
  onInlineFormatStateChange,
  onTailor,
  isTailoring,
  tailorStatus,
  resumeReady,
  jobReady,
  providerReady,
  providerMessage,
  jobTarget
}: CoverLetterTabProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pageCount, setPageCount] = useState(0);
  // Held here, not in the toolbar, so the editor's right-click menu and link card
  // can open the same link popover the toolbar button opens.
  const [linkEditorOpen, setLinkEditorOpen] = useState(false);
  const hasLetter = true;
  const canTailor =
    editor.text.trim().length >= 80 && resumeReady && jobReady && providerReady && !isTailoring;
  const targetLine = [jobTarget?.role, jobTarget?.company].filter(Boolean).join(" at ");
  const hasPlaceholder = /\[(?:add|insert|your|company|name|date)[^\]]*\]/i.test(editor.text);
  const hasGreeting = /\bdear\b/i.test(editor.text.slice(0, 400));
  const tailorHint = editor.text.trim().length < 80
    ? "Write or open at least 80 words before tailoring."
    : !resumeReady && !jobReady
      ? "Add a resume and job description first."
      : !resumeReady
        ? "Add your resume first."
        : !jobReady
          ? "Add the job description first."
          : !providerReady
            ? providerMessage
            : "";

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
        isTailoring={isTailoring}
        targetLine={targetLine}
        onTailor={onTailor}
      />

      <div className="cover-letter-workbench">
        <div className="cover-letter-workbench__editor">
          <TypesetEditor
            ref={editorRef}
            data={editor.data}
            actions={editor.actions}
            canUndo={editor.canUndo}
            canRedo={editor.canRedo}
            docStyle={editor.docStyle}
            documentKind="cover-letter"
            structureEditing={false}
            onRequestLinkEditor={() => setLinkEditorOpen(true)}
            onInlineFormatStateChange={onInlineFormatStateChange}
            onPageCount={setPageCount}
          />
        </div>

        <CoverLetterReview
          words={wordCount(editor.text)}
          pageCount={pageCount}
          hasGreeting={hasGreeting}
          hasPlaceholder={hasPlaceholder}
          status={tailorHint || tailorStatus || editor.status}
        />
      </div>
    </section>
  );
}
