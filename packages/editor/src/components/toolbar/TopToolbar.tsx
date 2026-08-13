import type { ReactNode } from "react";

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

// The formatting-row types live with FormattingToolbar; re-export them so
// TopToolbar consumers keep their import path.
export type { InlineFormatCommand, InlineFormattingControls } from "./FormattingToolbar";
export type { ToolbarSaveState, ToolbarSaveStatus } from "./DocumentToolbar";

export type TopToolbarProps = {
  documentTitle: string;
  onDocumentTitleChange?: (title: string) => void;
  saveStatus: ToolbarSaveStatus;
  fileActions: ReactNode;
  documentStructure?: DocumentStructureToolbarControls;
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
  fileActions,
  documentStructure,
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
            {fileActions}
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
