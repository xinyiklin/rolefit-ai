import { useState, type RefObject } from "react";
import {
  Clipboard,
  FileDown,
  FilePlus2,
  FolderOpen,
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
  onTailor
}: CoverLetterToolbarProps) {
  const [copied, setCopied] = useState(false);
  const [linkEditorOpen, setLinkEditorOpen] = useState(false);
  const { confirm } = useDialog();

  async function confirmReplace(): Promise<boolean> {
    if (!editor.dirty) return true;
    return confirm({
      title: "Replace cover letter?",
      message: "Replace the current cover letter? Unsaved edits will be lost.",
      confirmLabel: "Replace"
    });
  }

  async function chooseFile() {
    if (await confirmReplace()) inputRef.current?.click();
  }

  async function startBlank() {
    if (await confirmReplace()) editor.startBlank();
  }

  async function copyLetter() {
    if (!editor.text) return;
    try {
      await navigator.clipboard.writeText(editor.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      editor.setStatus("Copy failed. Select the letter text and copy it manually.");
    }
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
              label="New"
              tooltip="Start a blank cover letter"
              icon={<FilePlus2 size={16} />}
              showLabel
              onClick={() => void startBlank()}
            />
            <ToolbarButton
              label="Open"
              tooltip="Open a .cover, .txt, or .md file"
              icon={<FolderOpen size={16} />}
              showLabel
              onClick={() => void chooseFile()}
            />
            <ToolbarButton
              label="Save .cover"
              tooltip="Save an editable .cover file"
              icon={<Save size={16} />}
              showLabel
              disabled={!hasLetter}
              onClick={editor.saveCoverFile}
            />
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
              label={copied ? "Copied" : "Copy"}
              tooltip="Copy cover letter as plain text"
              icon={<Clipboard size={16} />}
              showLabel
              disabled={!editor.text}
              onClick={() => void copyLetter()}
            />
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
            onApply: ({ text, href }) => editorRef.current?.applyLink(text, href),
            onRemove: () => editorRef.current?.removeLink(),
            disabled: !inlineFormat.canLink,
            open: linkEditorOpen,
            onOpenChange: setLinkEditorOpen
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
