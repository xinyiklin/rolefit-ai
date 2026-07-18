import {
  FileDown,
  FilePlus2,
  FolderOpen,
  Save
} from "lucide-react";

import type { DocStyleControls } from "../../hooks/useDocStyle";
import type { BodyAlign } from "@typeset/engine/lib/documentStyle.ts";
import type { AlignmentScope } from "@typeset/engine/lib/documentStyle.ts";
import type { FieldFontFamily, StyleFieldFontStates, StyleFieldMarkStates, StyleFieldSizeStates, StyleTextField } from "@typeset/engine/lib/styleFieldFormatting.ts";
import type { FieldMark } from "@typeset/engine/lib/inlineMarksText.ts";
import {
  DocumentToolbar,
  type DocumentStructureToolbarControls,
  type ToolbarSaveStatus
} from "./DocumentToolbar";
import { FormattingToolbar, type InlineFormattingControls } from "./FormattingToolbar";
import { ToolbarButton } from "./ToolbarButton";

// The formatting-row types live with FormattingToolbar; re-export them so
// TopToolbar consumers keep their import path.
export type { InlineFormatCommand, InlineFormattingControls } from "./FormattingToolbar";
export type { ToolbarSaveState, ToolbarSaveStatus } from "./DocumentToolbar";

export type TopToolbarProps = {
  documentTitle: string;
  onDocumentTitleChange?: (title: string) => void;
  saveStatus: ToolbarSaveStatus;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onExport: () => void;
  documentStructure?: DocumentStructureToolbarControls;
  saveDisabled?: boolean;
  exportDisabled?: boolean;
  isSaving?: boolean;
  isExporting?: boolean;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  inlineFormatting?: InlineFormattingControls;
  formattingDisabled?: boolean;
  docStyle: DocStyleControls;
  globalAlignments?: Record<AlignmentScope, BodyAlign | null>;
  onGlobalAlignmentChange?: (scope: AlignmentScope, alignment: BodyAlign) => void;
  styleMarkStates?: StyleFieldMarkStates;
  onStyleFieldMarkChange?: (field: StyleTextField, mark: FieldMark, on: boolean) => void;
  styleFontStates?: StyleFieldFontStates;
  onStyleFieldFontChange?: (field: StyleTextField, family: FieldFontFamily) => void;
  styleSizeStates?: StyleFieldSizeStates;
  onStyleFieldSizeChange?: (field: StyleTextField, sizePt: number) => void;
  onResetStyleFormatting?: () => void;
  onFitZoom?: () => void;
};

export function TopToolbar({
  documentTitle,
  onDocumentTitleChange,
  saveStatus,
  onNew,
  onOpen,
  onSave,
  onExport,
  documentStructure,
  saveDisabled = false,
  exportDisabled = false,
  isSaving = false,
  isExporting = false,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  inlineFormatting,
  formattingDisabled = false,
  docStyle,
  globalAlignments,
  onGlobalAlignmentChange,
  styleMarkStates,
  onStyleFieldMarkChange,
  styleFontStates,
  onStyleFieldFontChange,
  styleSizeStates,
  onStyleFieldSizeChange,
  onResetStyleFormatting,
  onFitZoom
}: TopToolbarProps) {
  return (
    <header className="top-toolbar" aria-label="Typeset editor toolbar">
      <DocumentToolbar
        productName="Typeset"
        documentTitle={documentTitle}
        onDocumentTitleChange={onDocumentTitleChange}
        saveStatus={saveStatus}
        documentStructure={documentStructure}
        docStyle={docStyle}
        actions={(
          <div className="top-toolbar__file-actions" role="toolbar" aria-label="File actions">
            <ToolbarButton
              label="New"
              tooltip="New resume"
              icon={<FilePlus2 size={16} />}
              showLabel
              onClick={onNew}
            />
            <ToolbarButton
              label="Open"
              tooltip="Open a .resume file"
              icon={<FolderOpen size={16} />}
              showLabel
              onClick={onOpen}
            />
            <ToolbarButton
              label={isSaving ? "Saving…" : "Save"}
              tooltip="Save a .resume file"
              icon={<Save size={16} />}
              showLabel
              onClick={onSave}
              disabled={saveDisabled || isSaving}
              aria-busy={isSaving}
              aria-label="Save resume file"
            />
            <ToolbarButton
              label={isExporting ? "Exporting…" : "Export PDF"}
              tooltip="Export PDF"
              icon={<FileDown size={16} />}
              showLabel
              tone="primary"
              onClick={onExport}
              disabled={exportDisabled || isExporting}
              aria-busy={isExporting}
              aria-label="Export PDF"
            />
          </div>
        )}
      />

      <FormattingToolbar
        onUndo={onUndo}
        onRedo={onRedo}
        canUndo={canUndo}
        canRedo={canRedo}
        inlineFormatting={inlineFormatting}
        formattingDisabled={formattingDisabled}
        docStyle={docStyle}
        globalAlignments={globalAlignments}
        onGlobalAlignmentChange={onGlobalAlignmentChange}
        styleMarkStates={styleMarkStates}
        onStyleFieldMarkChange={onStyleFieldMarkChange}
        styleFontStates={styleFontStates}
        onStyleFieldFontChange={onStyleFieldFontChange}
        styleSizeStates={styleSizeStates}
        onStyleFieldSizeChange={onStyleFieldSizeChange}
        onResetStyleFormatting={onResetStyleFormatting}
        onFitZoom={onFitZoom}
      />
    </header>
  );
}
