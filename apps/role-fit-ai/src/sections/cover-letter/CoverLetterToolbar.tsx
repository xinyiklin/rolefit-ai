import type { RefObject } from "react";
import {
  FileDown,
  FilePlus2,
  FolderOpen,
  FileText,
  LayoutTemplate,
  RotateCcw,
  Save,
  Sparkles
} from "lucide-react";

import { DocumentToolbar } from "@typeset/editor/components/toolbar/DocumentToolbar.tsx";
import { FormattingToolbar } from "@typeset/editor/components/toolbar/FormattingToolbar.tsx";
import { PageStylePopover } from "@typeset/editor/components/toolbar/PageStylePopover.tsx";
import { ToolbarButton } from "@typeset/editor/components/toolbar/ToolbarButton.tsx";
import type {
  InlineFormatState,
  TypesetEditorHandle
} from "@typeset/editor/sections/editor/TypesetEditor.tsx";
import type { CoverLetterEditorState } from "../../hooks/useCoverLetterEditor";
import { useDialog } from "../../hooks/useDialog";
import { DocumentActionMenu } from "../document/DocumentActionMenu";
import { LineHeightPopover } from "./LineHeightPopover";

type CoverLetterToolbarProps = {
  editor: CoverLetterEditorState;
  editorRef: RefObject<TypesetEditorHandle | null>;
  inputRef: RefObject<HTMLInputElement | null>;
  inlineFormat: InlineFormatState;
  hasLetter: boolean;
  canTailor: boolean;
  tailorHint: string;
  isTailoring: boolean;
  targetLine: string;
  onTailor: () => void;
  // Owned by CoverLetterTab so the editor's right-click menu and link card can
  // open this popover too; a toolbar-private state left those commands dead.
  linkEditorOpen: boolean;
  onLinkEditorOpenChange: (open: boolean) => void;
};

export function CoverLetterToolbar({
  editor,
  editorRef,
  inputRef,
  inlineFormat,
  hasLetter,
  canTailor,
  tailorHint,
  isTailoring,
  targetLine,
  onTailor,
  linkEditorOpen,
  onLinkEditorOpenChange
}: CoverLetterToolbarProps) {
  const { confirm } = useDialog();

  async function confirmReplace(): Promise<boolean> {
    if (!editor.dirty) return true;
    return confirm({
      title: "Replace cover letter?",
      message: "Replace the current cover letter? Unsaved edits will be lost.",
      confirmLabel: "Replace"
    });
  }

  async function chooseFile(): Promise<boolean> {
    if (!(await confirmReplace())) return false;
    inputRef.current?.click();
    return true;
  }

  async function startBlank() {
    if (await confirmReplace()) editor.startBlank();
  }

  async function startStarter() {
    if (await confirmReplace()) editor.startStarter();
  }

  return (
    <header
      className="top-toolbar cover-letter-tab__toolbar"
      aria-label="Cover letter editor toolbar"
      data-toolbar-labels="text"
    >
      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        accept=".cover,.txt,.md,application/json,text/plain,text/markdown"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void editor.openFile(file);
          event.currentTarget.value = "";
        }}
      />

      <DocumentToolbar
        documentTitle={editor.documentTitle}
        onDocumentTitleChange={editor.setDocumentTitle}
        untitledDocumentTitle="Untitled cover letter"
        documentContext={targetLine || "Plain correspondence document"}
        saveStatus={
          editor.dirty
            ? { state: "unsaved", label: "Unsaved cover letter" }
            : undefined
        }
        docStyle={editor.docStyle}
        actions={(
          <div className="top-toolbar__file-actions" role="toolbar" aria-label="Cover letter actions">
            <ToolbarButton
              label="Starter"
              tooltip="Open the guided cover-letter starter"
              icon={<LayoutTemplate size={16} />}
              showLabel
              onClick={() => void startStarter()}
            />
            <DocumentActionMenu
              label="Open"
              tooltip="Open a cover letter"
              icon={<FolderOpen size={16} />}
            >
              {({ close }) => (
                <div className="document-action-panel cover-letter-open-menu">
                  <div className="document-action-panel__head">
                    <strong>Open cover letter</strong>
                    <span>Editable .cover files preserve formatting; text and Markdown open as plain drafts.</span>
                  </div>
                  <button
                    type="button"
                    className="document-action-row"
                    onClick={() => {
                      void chooseFile().then((opened) => {
                        if (opened) close();
                      });
                    }}
                  >
                    <FolderOpen size={15} aria-hidden="true" />
                    <span>
                      <strong>Choose a file</strong>
                      <small>.cover, .txt, or .md</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="document-action-row"
                    onClick={() => {
                      void startBlank().then(close);
                    }}
                  >
                    <FilePlus2 size={15} aria-hidden="true" />
                    <span>
                      <strong>Blank document</strong>
                      <small>Start without the guided prompts.</small>
                    </span>
                  </button>
                </div>
              )}
            </DocumentActionMenu>
            <DocumentActionMenu
              label="Save"
              tooltip="Save the cover letter"
              icon={<Save size={16} />}
              disabled={!hasLetter}
            >
              {({ close }) => (
                <div className="document-action-panel cover-letter-save-menu">
                  <div className="document-action-panel__head">
                    <strong>Save cover letter</strong>
                    <span>Choose an editable document or a plain-text copy.</span>
                  </div>
                  <button
                    type="button"
                    className="document-action-row"
                    onClick={() => {
                      editor.saveCoverFile();
                      close();
                    }}
                  >
                    <Save size={15} aria-hidden="true" />
                    <span>
                      <strong>Editable .cover</strong>
                      <small>Preserves content, formatting, and document style.</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="document-action-row"
                    disabled={!editor.text.trim()}
                    onClick={() => {
                      editor.saveTextFile();
                      close();
                    }}
                  >
                    <FileText size={15} aria-hidden="true" />
                    <span>
                      <strong>Plain-text .txt</strong>
                      <small>Content only, for email or another editor.</small>
                    </span>
                  </button>
                </div>
              )}
            </DocumentActionMenu>
            <ToolbarButton
              label={editor.isRenderingPdf ? "Exporting…" : "PDF"}
              tooltip="Export cover letter PDF"
              icon={<FileDown size={16} />}
              showLabel
              disabled={!hasLetter || editor.isRenderingPdf}
              aria-busy={editor.isRenderingPdf}
              onClick={() => void editor.downloadPdf()}
            />
            {editor.canRestoreTailorSource ? (
              <ToolbarButton
                label="Restore source"
                tooltip="Restore the letter from before AI tailoring"
                icon={<RotateCcw size={16} />}
                showLabel
                onClick={editor.restoreTailorSource}
              />
            ) : null}
            <ToolbarButton
              label={isTailoring ? "Tailoring…" : "Tailor"}
              tooltip={tailorHint || "Tailor the existing cover letter"}
              icon={<Sparkles size={16} />}
              showLabel
              tone="primary"
              disabled={!canTailor}
              aria-busy={isTailoring}
              onClick={onTailor}
            />
          </div>
        )}
      />

      <FormattingToolbar
        onUndo={() => editorRef.current?.undo()}
        onRedo={() => editorRef.current?.redo()}
        canUndo={editor.canUndo}
        canRedo={editor.canRedo}
        formattingDisabled={!hasLetter}
        inlineFormatting={{
          onRequestEditorFocus: () => editorRef.current?.focusSelection(),
          fontFamily: {
            value: inlineFormat.fontFamily,
            onChange: (fontFamily) => editorRef.current?.setFontFamily(fontFamily),
            disabled: false
          },
          fontSize: {
            value: inlineFormat.fontSizePt,
            onChange: (fontSizePt) => editorRef.current?.setFontSize(fontSizePt),
            disabled: false
          },
          alignment: {
            value: inlineFormat.alignment,
            onChange: (alignment) => editorRef.current?.setAlignment(alignment),
            disabled: false
          },
          bold: {
            onToggle: () => editorRef.current?.toggleMark("bold"),
            pressed: inlineFormat.bold
          },
          italic: {
            onToggle: () => editorRef.current?.toggleMark("italic"),
            pressed: inlineFormat.italic
          },
          underline: {
            onToggle: () => editorRef.current?.toggleMark("underline"),
            pressed: inlineFormat.underline
          },
          link: {
            href: inlineFormat.linkHref,
            text: inlineFormat.linkText,
            automatic: inlineFormat.linkAutomatic,
            textEditable: inlineFormat.linkTextEditable,
            onApply: ({ text, href }) => editorRef.current?.applyLink(text, href),
            onRemove: () => editorRef.current?.removeLink(),
            disabled: !inlineFormat.canLink,
            open: linkEditorOpen,
            onOpenChange: onLinkEditorOpenChange
          },
          clearFormatting: {
            onClear: () => editorRef.current?.clearFormatting(),
            disabled: !inlineFormat.canClearFormatting
          }
        }}
        docStyle={editor.docStyle}
        documentStyleTools={(
          <>
            <LineHeightPopover docStyle={editor.docStyle} disabled={!hasLetter} />
            <PageStylePopover docStyle={editor.docStyle} disabled={!hasLetter} />
          </>
        )}
      />
    </header>
  );
}
