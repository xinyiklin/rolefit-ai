import { useState, type RefObject } from "react";
import {
  Download,
  FileDown,
  FilePlus2,
  FolderOpen,
  FileText,
  LayoutTemplate,
  Save
} from "lucide-react";

import { coverLetterFileName } from "@typeset/engine/lib/coverLetter.ts";
import { DocumentToolbar } from "@typeset/editor/components/toolbar/DocumentToolbar.tsx";
import { DocumentStructureControls } from "@typeset/editor/components/toolbar/DocumentStructureControls.tsx";
import { FormattingToolbar } from "@typeset/editor/components/toolbar/FormattingToolbar.tsx";
import { LineSpacingPopover } from "@typeset/editor/components/toolbar/LineSpacingPopover.tsx";
import { PageStylePopover } from "@typeset/editor/components/toolbar/PageStylePopover.tsx";
import type {
  InlineFormatState,
  TypesetEditorHandle
} from "@typeset/editor/sections/editor/TypesetEditor.tsx";
import type { ApplicationDocumentSync } from "../../hooks/useApplicationDocumentSync";
import type { DraftAutosaveState } from "../../hooks/useAutosaveDraft";
import type { CoverLetterEditorState } from "../../hooks/useCoverLetterEditor";
import { useDialog } from "../../hooks/useDialog";
import { formatHistoryDate } from "../../lib/historyDate";
import { ExportMenu } from "../ExportRail";
import { DocumentOpenMenu } from "../document/DocumentOpenMenu";
import { DocumentSaveMenu } from "../document/DocumentSaveMenu";

type CoverLetterToolbarProps = {
  editor: CoverLetterEditorState;
  editorRef: RefObject<TypesetEditorHandle | null>;
  inputRef: RefObject<HTMLInputElement | null>;
  inlineFormat: InlineFormatState;
  hasLetter: boolean;
  targetLine: string;
  // Recovery-draft state for this letter, shown beside the title exactly as the
  // resume shows its own.
  draftAutosaveState: DraftAutosaveState;
  // Explicit save of THIS letter into the tracked application; the resume keeps
  // its own independent state in its own Save menu.
  applicationSync: ApplicationDocumentSync;
  // Owned by CoverLetterTab so the editor's right-click menu and link card can
  // open this popover too; a toolbar-private state left those commands dead.
  linkEditorOpen: boolean;
  onLinkEditorOpenChange: (open: boolean) => void;
};

// Client-side preview of the file name the server will slug this variant into.
// The server re-derives it; this only shows the user what they will get.
function coverLetterVariantFileName(label: string): string {
  const slug = label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug ? slug + ".cover" : "";
}

// Strip the .cover extension the file-name helper adds, so the rename prompt
// pre-fills a bare base name the way the resume export does.
function coverPdfBaseName(documentTitle: string): string {
  return coverLetterFileName(documentTitle).replace(/\.cover$/i, "");
}

export function CoverLetterToolbar({
  editor,
  editorRef,
  inputRef,
  inlineFormat,
  hasLetter,
  targetLine,
  draftAutosaveState,
  applicationSync,
  linkEditorOpen,
  onLinkEditorOpenChange
}: CoverLetterToolbarProps) {
  const { confirm } = useDialog();
  // The PDF rename prompt is opened from the Save menu's PDF row.
  const [pdfPromptOpen, setPdfPromptOpen] = useState(false);

  async function confirmReplace(): Promise<boolean> {
    if (!editor.recoveryDirty) return true;
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

  // Opening a saved letter replaces the document just as much as Blank or a file
  // upload does, so it asks first. Without this the Open menu's saved list threw
  // away unsaved edits silently — the resume's equivalents both confirm.
  async function openSaved(fileName: string) {
    await editor.openWorkspaceCoverLetter(fileName, { confirmReplace });
  }

  async function restoreSaved(key: string) {
    await editor.restoreWorkspaceCoverLetter(key, confirmReplace);
  }

  return (
    <header
      className="top-toolbar cover-letter-tab__toolbar"
      aria-label="Cover letter editor toolbar"
      data-toolbar-labels="icon"
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

      {/* documentContext carries only the job target. The old "Plain
          correspondence document" fallback restated what the page already is.
          saveStatus uses the resume's recovery vocabulary: unsaved edits are
          being kept in a recoverable draft, which is more useful than warning
          that they are unsaved. */}
      <DocumentToolbar
        documentTitle={editor.documentTitle}
        onDocumentTitleChange={editor.setDocumentTitle}
        untitledDocumentTitle="Untitled cover letter"
        documentContext={targetLine}
        saveStatus={
          !editor.recoveryDirty
            ? undefined
            : draftAutosaveState === "error"
              ? { state: "error", label: "Recovery save failed" }
              : draftAutosaveState === "saved"
                ? { state: "saved", label: "Recovery draft saved" }
                : { state: "saving", label: "Saving recovery draft" }
        }
        docStyle={editor.docStyle}
        actions={(
          <div className="top-toolbar__file-actions" role="toolbar" aria-label="Cover letter actions">
            {/* Starter moved in here: starting from the guided template and
                opening an existing letter are the same decision. */}
            <DocumentOpenMenu
              tooltip="Open a cover letter"
              icon={<FolderOpen size={16} />}
              disabled={editor.isWorkspaceReplacing}
              title="Open cover letter"
              description={
                editor.activeCoverLabel
                  ? `Current variant: ${editor.activeCoverLabel}`
                  : "No workspace variant open."
              }
              actions={[
                {
                  key: "starter",
                  icon: <LayoutTemplate size={15} aria-hidden="true" />,
                  title: "Bundled starter",
                  description: "A prompted cover letter to edit.",
                  onSelect: startStarter
                },
                {
                  key: "blank",
                  icon: <FilePlus2 size={15} aria-hidden="true" />,
                  title: "Blank document",
                  onSelect: startBlank
                },
                {
                  key: "file",
                  icon: <FolderOpen size={15} aria-hidden="true" />,
                  title: "Choose a file",
                  description: ".cover, .txt, or .md",
                  onSelect: chooseFile
                }
              ]}
              saved={{
                label: "Saved in workspace",
                emptyNote: "No saved cover-letter variants yet.",
                groups: [
                  {
                    key: "letters",
                    label: "Variants",
                    icon: <FolderOpen size={11} aria-hidden="true" />,
                    entries: editor.coverLetterOptions.map((option) => ({
                      key: option.fileName,
                      title: option.label,
                      meta: option.fileName,
                      active: option.fileName === editor.activeCoverFileName,
                      onOpen: () => void openSaved(option.fileName)
                    }))
                  },
                  ...editor.coverLetterHistory.map((group) => ({
                    key: `history-${group.variant}`,
                    label: `${group.label} earlier versions`,
                    collapsible: true,
                    defaultOpen: editor.coverLetterHistory.length === 1,
                    entries: group.entries.map((entry) => ({
                      key: entry.key,
                      title: formatHistoryDate(entry.date),
                      meta: "COVER",
                      openLabel: "Restore",
                      onOpen: () => void restoreSaved(entry.key)
                    }))
                  }))
                ]
              }}
            />
            <DocumentSaveMenu
              tooltip="Save the cover letter"
              icon={<Save size={16} />}
              disabled={!hasLetter}
              title="Save cover letter"
              description="Keep a workspace letter or take a file away."
              primary={{
                title: editor.activeCoverFileName
                  ? `Update ${editor.activeCoverLabel || "this letter"}`
                  : "Save as default letter",
                description: editor.activeCoverFileName
                  ? "The version it replaces goes to history."
                  : "Opens automatically next time.",
                onSelect: () => editor.saveToWorkspace()
              }}
              variant={{
                fieldId: "cover-letter-variant-name",
                fieldLabel: "New letter variant",
                placeholder: "e.g. Backend SDE",
                fileNameFor: coverLetterVariantFileName,
                existingNames: editor.coverLetterOptions.map((option) => option.fileName),
                onSave: (fileName) => editor.saveToWorkspace({ fileName })
              }}
              applicationSync={applicationSync}
              actions={[
                {
                  key: "cover",
                  icon: <Download size={15} aria-hidden="true" />,
                  title: "Download .cover",
                  onSelect: editor.saveCoverFile
                },
                {
                  key: "txt",
                  icon: <FileText size={15} aria-hidden="true" />,
                  title: "Download .txt",
                  description: "Content only, no formatting.",
                  disabled: !editor.text.trim(),
                  onSelect: editor.saveTextFile
                },
                {
                  key: "pdf",
                  icon: <FileDown size={15} aria-hidden="true" />,
                  title: editor.isRenderingPdf ? "Exporting PDF…" : "Download PDF",
                  disabled: !hasLetter || editor.isRenderingPdf,
                  // Same rename prompt as the resume — a PDF is the file you send,
                  // so its name is worth confirming for both documents.
                  onSelect: () => setPdfPromptOpen(true)
                }
              ]}
            />
            {/* Same rename dialog the resume uses; its trigger is the Save menu's
                PDF row. Status stays in the review rail, which already shows
                editor.status. */}
            <ExportMenu
              defaultFileBaseName={coverPdfBaseName(editor.documentTitle)}
              promptOpen={pdfPromptOpen}
              onPromptOpenChange={setPdfPromptOpen}
              onDownloadPdf={(base) => void editor.downloadPdf(base)}
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
        documentStructureTools={(
          <DocumentStructureControls
            header={editor.data.header}
            contactDivider={editor.docStyle.style.contactDivider}
            disabled={!hasLetter}
            // A cover letter has no document-spacing popover: paragraph spacing
            // covers its body, so the header's own gaps live in the Header menu.
            headerSpacing={{
              values: editor.docStyle.style,
              onChange: (key, value) => editor.docStyle.set(key, value)
            }}
            onCreateHeader={() => {
              if (editorRef.current) editorRef.current.createHeader();
              else editor.actions.createHeader();
            }}
            onSetHeaderVisible={editor.actions.setHeaderVisible}
            onSetHeaderName={(nextText) => {
              if (editorRef.current) editorRef.current.replaceHeaderNameText(nextText);
              else editor.actions.setHeaderName(nextText);
            }}
            onRemoveHeaderName={editor.actions.removeHeaderName}
            onUpdateContact={(index, nextText) => {
              if (editorRef.current) editorRef.current.replaceHeaderContactText(index, nextText);
              else editor.actions.updateContact(index, nextText);
            }}
            onInsertContact={editor.actions.insertContact}
            onRemoveContact={editor.actions.removeContact}
            onContactDividerChange={(value) => editor.docStyle.set("contactDivider", value)}
            showSections={false}
          />
        )}
        documentStyleTools={(
          <>
            <LineSpacingPopover
              controls={{
                lineHeight: inlineFormat.paragraphLineHeight,
                spaceBeforePt: inlineFormat.paragraphSpaceBeforePt,
                spaceAfterPt: inlineFormat.paragraphSpaceAfterPt,
                onLineHeightChange: (value) => editorRef.current?.setParagraphLineHeight(value),
                onSpaceBeforeChange: (value) => editorRef.current?.setParagraphSpaceBefore(value),
                onSpaceAfterChange: (value) => editorRef.current?.setParagraphSpaceAfter(value),
                onCustomChange: ({ lineHeight, spaceBeforePt, spaceAfterPt }) =>
                  editorRef.current?.setCustomSpacing(lineHeight, spaceBeforePt, spaceAfterPt),
                onRequestEditorFocus: () => editorRef.current?.focusSelection(),
                disabled: !inlineFormat.canFormatParagraph
              }}
              disabled={!hasLetter}
            />
            <PageStylePopover docStyle={editor.docStyle} disabled={!hasLetter} />
          </>
        )}
      />
    </header>
  );
}
