import {
  Bold,
  CheckCircle2,
  CircleDot,
  FileDown,
  FilePlus2,
  FolderOpen,
  Italic,
  LoaderCircle,
  Redo2,
  RemoveFormatting,
  Save,
  SpellCheck,
  TriangleAlert,
  Underline,
  Undo2
} from "lucide-react";

import type { DocStyleControls } from "../../hooks/useDocStyle";
import { FONT_FAMILY_OPTIONS, type BodyAlign, type FontFamily } from "@typeset/engine/lib/documentStyle.ts";
import type { AlignmentScope } from "@typeset/engine/lib/documentStyle.ts";
import type { FieldFontFamily, StyleFieldFontStates, StyleFieldMarkStates, StyleFieldSizeStates, StyleTextField } from "@typeset/engine/lib/styleFieldFormatting.ts";
import type { FieldMark } from "@typeset/engine/lib/inlineMarksText.ts";
import type { ResumeSectionType } from "@typeset/engine/lib/resumeData.ts";
import { DocumentStructureControls } from "./DocumentStructureControls";
import { PageStylePopover } from "./PageStylePopover";
import { ParagraphStylePopover } from "./ParagraphStylePopover";
import { SpacingStylePopover } from "./SpacingStylePopover";
import { TextStylesPopover } from "./TextStylesPopover";
import { ToolbarButton } from "./ToolbarButton";
import { ZoomControl } from "./ZoomControl";
import { FontSizeControl } from "./FontSizeControl";
import { LinkControl } from "./LinkControl";
import { ALIGNMENT_OPTIONS } from "./styleOptions";

export type ToolbarSaveState = "saved" | "saving" | "unsaved" | "error";

export type ToolbarSaveStatus =
  | ToolbarSaveState
  | {
      state: ToolbarSaveState;
      label?: string;
    };

export type InlineFormatCommand = {
  onToggle: () => void;
  pressed: boolean;
  disabled?: boolean;
};

export type InlineFormattingControls = {
  fontFamily?: {
    value: FontFamily | null;
    onChange: (fontFamily: FontFamily) => void;
    disabled?: boolean;
  };
  fontSize?: {
    value: number | null;
    onChange: (fontSizePt: number) => void;
    disabled?: boolean;
  };
  alignment?: {
    value: BodyAlign | null;
    onChange: (alignment: BodyAlign) => void;
    disabled?: boolean;
  };
  bold?: InlineFormatCommand;
  italic?: InlineFormatCommand;
  underline?: InlineFormatCommand;
  link?: {
    href: string | null;
    text: string;
    automatic: boolean;
    onApply: (payload: { text: string; href: string }) => void;
    onRemove: () => void;
    disabled?: boolean;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  };
  clearFormatting?: {
    onClear: () => void;
    disabled?: boolean;
  };
};

export type TopToolbarProps = {
  documentTitle: string;
  onDocumentTitleChange?: (title: string) => void;
  saveStatus: ToolbarSaveStatus;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onExport: () => void;
  documentStructure?: {
    name: string;
    contact: string[];
    disabled?: boolean;
    onSetName: (name: string) => void;
    onUpdateContact: (index: number, value: string) => void;
    onAddContact: () => void;
    onRemoveContact: (index: number) => void;
    onAddSection: (type: ResumeSectionType, position: "top" | "bottom") => void;
  };
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

const SAVE_STATUS_LABELS: Record<ToolbarSaveState, string> = {
  saved: "Saved locally",
  saving: "Saving locally",
  unsaved: "Unsaved changes",
  error: "Save failed"
};

const UNTITLED_DOCUMENT_TITLE = "Untitled resume";

function SaveStatus({ status }: { status: ToolbarSaveStatus }) {
  const state = typeof status === "string" ? status : status.state;
  const label = typeof status === "string" ? SAVE_STATUS_LABELS[status] : status.label ?? SAVE_STATUS_LABELS[state];
  const icon = {
    saved: <CheckCircle2 size={13} />,
    saving: <LoaderCircle size={13} />,
    unsaved: <CircleDot size={13} />,
    error: <TriangleAlert size={13} />
  }[state];

  return (
    <span className={`top-toolbar__save-status top-toolbar__save-status--${state}`} role="status" aria-live="polite">
      <span className="top-toolbar__save-status-icon" aria-hidden="true">
        {icon}
      </span>
      <span>{label}</span>
    </span>
  );
}

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
  const hasInlineControls = Boolean(
    inlineFormatting?.bold || inlineFormatting?.italic || inlineFormatting?.underline || inlineFormatting?.link
  );

  return (
    <header className="top-toolbar" aria-label="Typeset editor toolbar">
      <div className="top-toolbar__primary-row">
        <div className="top-toolbar__identity">
          <span className="top-toolbar__product-name">Typeset</span>
          <span className="top-toolbar__identity-divider" aria-hidden="true" />
          <div className="top-toolbar__document-meta">
            {onDocumentTitleChange ? (
              <label className="top-toolbar__title-field">
                <span className="sr-only">Document title</span>
                <input
                  type="text"
                  value={documentTitle}
                  size={Math.max(1, Math.min(36, documentTitle.length || 1))}
                  maxLength={120}
                  spellCheck="false"
                  onChange={(event) => onDocumentTitleChange(event.target.value)}
                  onBlur={(event) => {
                    if (!event.currentTarget.value.trim()) onDocumentTitleChange(UNTITLED_DOCUMENT_TITLE);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                  aria-label="Document title"
                />
              </label>
            ) : (
              <span className="top-toolbar__document-title">{documentTitle}</span>
            )}
            <SaveStatus status={saveStatus} />
          </div>
        </div>

        {documentStructure ? (
          <DocumentStructureControls
            name={documentStructure.name}
            contact={documentStructure.contact}
            contactDivider={docStyle.style.contactDivider}
            disabled={documentStructure.disabled}
            onSetName={documentStructure.onSetName}
            onUpdateContact={documentStructure.onUpdateContact}
            onAddContact={documentStructure.onAddContact}
            onRemoveContact={documentStructure.onRemoveContact}
            onContactDividerChange={(value) => docStyle.set("contactDivider", value)}
            onAddSection={documentStructure.onAddSection}
          />
        ) : null}

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
      </div>

      <div className="top-toolbar__secondary-row" role="toolbar" aria-label="Editing and formatting tools">
        <div className="top-toolbar__group" role="group" aria-label="History">
          <ToolbarButton
            label="Undo"
            tooltip="Undo"
            shortcut="Ctrl/⌘Z"
            icon={<Undo2 size={16} />}
            onClick={onUndo}
            disabled={!canUndo}
          />
          <ToolbarButton
            label="Redo"
            tooltip="Redo"
            shortcut="Ctrl/⌘ Shift Z"
            icon={<Redo2 size={16} />}
            onClick={onRedo}
            disabled={!canRedo}
          />
        </div>

        <span className="top-toolbar__divider" role="separator" aria-orientation="vertical" />

        <div
          className="top-toolbar__group top-toolbar__group--typography"
          role="group"
          aria-label="Selected text typography"
        >
          <label className="top-toolbar__font-control top-toolbar__font-control--family">
            <span className="sr-only">Font family for selected text</span>
            <select
              value={inlineFormatting?.fontFamily?.value ?? docStyle.style.fontFamily}
              onChange={(event) => inlineFormatting?.fontFamily?.onChange(event.target.value as FontFamily)}
              disabled={formattingDisabled || inlineFormatting?.fontFamily?.disabled !== false}
              aria-label="Font family for selected text"
              title={inlineFormatting?.fontFamily?.disabled === false ? "Apply font to selected text" : "Select text to change its font"}
            >
              {FONT_FAMILY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="top-toolbar__font-control top-toolbar__font-control--size">
            <span className="sr-only">Font size for selected text in points</span>
            <FontSizeControl
              value={inlineFormatting?.fontSize?.value ?? null}
              onChange={(value) => inlineFormatting?.fontSize?.onChange(value)}
              disabled={formattingDisabled || inlineFormatting?.fontSize?.disabled !== false}
              ariaLabel="Font size for selected text in points"
              title={inlineFormatting?.fontSize?.disabled === false ? "Apply size to selected text" : "Select text to change its size"}
            />
          </label>
        </div>

        <span
          className="top-toolbar__divider top-toolbar__divider--direct-typography"
          role="separator"
          aria-orientation="vertical"
        />

        {hasInlineControls ? (
          <div className="top-toolbar__group" role="group" aria-label="Inline formatting">
            {inlineFormatting?.bold ? (
              <ToolbarButton
                label="Bold"
                tooltip="Bold"
                shortcut="Ctrl/⌘B"
                icon={<Bold size={16} />}
                pressed={inlineFormatting.bold.pressed}
                onClick={inlineFormatting.bold.onToggle}
                onMouseDown={(event) => event.preventDefault()}
                disabled={formattingDisabled || inlineFormatting.bold.disabled}
              />
            ) : null}
            {inlineFormatting?.italic ? (
              <ToolbarButton
                label="Italic"
                tooltip="Italic"
                shortcut="Ctrl/⌘I"
                icon={<Italic size={16} />}
                pressed={inlineFormatting.italic.pressed}
                onClick={inlineFormatting.italic.onToggle}
                onMouseDown={(event) => event.preventDefault()}
                disabled={formattingDisabled || inlineFormatting.italic.disabled}
              />
            ) : null}
            {inlineFormatting?.underline ? (
              <ToolbarButton
                label="Underline"
                tooltip="Underline"
                shortcut="Ctrl/⌘U"
                icon={<Underline size={16} />}
                pressed={inlineFormatting.underline.pressed}
                onClick={inlineFormatting.underline.onToggle}
                onMouseDown={(event) => event.preventDefault()}
                disabled={formattingDisabled || inlineFormatting.underline.disabled}
              />
            ) : null}
            {inlineFormatting?.link ? (
              <LinkControl
                href={inlineFormatting.link.href}
                text={inlineFormatting.link.text}
                automatic={inlineFormatting.link.automatic}
                onApply={inlineFormatting.link.onApply}
                onRemove={inlineFormatting.link.onRemove}
                disabled={formattingDisabled || Boolean(inlineFormatting.link.disabled)}
                open={inlineFormatting.link.open}
                onOpenChange={inlineFormatting.link.onOpenChange}
              />
            ) : null}
            {inlineFormatting?.clearFormatting ? (
              <ToolbarButton
                label="Clear formatting"
                tooltip="Clear formatting"
                shortcut="Ctrl/⌘\"
                icon={<RemoveFormatting size={16} />}
                onClick={inlineFormatting.clearFormatting.onClear}
                onMouseDown={(event) => event.preventDefault()}
                disabled={formattingDisabled || Boolean(inlineFormatting.clearFormatting.disabled)}
              />
            ) : null}
            <ToolbarButton
              label="Spell check"
              tooltip={docStyle.style.spellCheck ? "Turn spell check off" : "Turn spell check on"}
              icon={<SpellCheck size={16} />}
              pressed={docStyle.style.spellCheck}
              onClick={() => docStyle.set("spellCheck", !docStyle.style.spellCheck)}
              onMouseDown={(event) => event.preventDefault()}
            />
          </div>
        ) : null}

        {hasInlineControls ? (
          <span className="top-toolbar__divider" role="separator" aria-orientation="vertical" />
        ) : null}

        <div
          className="top-toolbar__group top-toolbar__group--body-align"
          role="group"
          aria-label="Selected paragraph alignment"
        >
          {ALIGNMENT_OPTIONS.map(({ value, label, Icon }) => (
            <ToolbarButton
              key={value}
              label={`Align selected paragraph ${label.toLowerCase()}`}
              tooltip={`Align selected paragraph ${label.toLowerCase()}`}
              icon={<Icon size={16} />}
              pressed={(inlineFormatting?.alignment?.value ?? docStyle.style.bodyAlign) === value}
              onClick={() => inlineFormatting?.alignment?.onChange(value)}
              onMouseDown={(event) => event.preventDefault()}
              disabled={formattingDisabled || inlineFormatting?.alignment?.disabled !== false}
            />
          ))}
        </div>

        <span
          className="top-toolbar__divider top-toolbar__divider--direct-alignment"
          role="separator"
          aria-orientation="vertical"
        />

        <div className="top-toolbar__group top-toolbar__group--style" role="group" aria-label="Document style">
          <SpacingStylePopover docStyle={docStyle} disabled={formattingDisabled} />
          <ParagraphStylePopover
            docStyle={docStyle}
            disabled={formattingDisabled}
            globalAlignments={globalAlignments}
            onGlobalAlignmentChange={onGlobalAlignmentChange}
          />
          <TextStylesPopover
            docStyle={docStyle}
            disabled={formattingDisabled}
            styleMarkStates={styleMarkStates}
            onStyleFieldMarkChange={onStyleFieldMarkChange}
            styleFontStates={styleFontStates}
            onStyleFieldFontChange={onStyleFieldFontChange}
            styleSizeStates={styleSizeStates}
            onStyleFieldSizeChange={onStyleFieldSizeChange}
            onResetStyleFormatting={onResetStyleFormatting}
          />
          <PageStylePopover docStyle={docStyle} disabled={formattingDisabled} />
        </div>

        <div className="top-toolbar__spacer" />

        <ZoomControl docStyle={docStyle} onFitZoom={onFitZoom} />
      </div>
    </header>
  );
}
