// The shared formatting row: history, selection typography, inline marks,
// links, alignment, the document-style popovers, and zoom. TopToolbar composes
// it under Typeset's identity/file row; other hosts (role-fit-ai) mount it
// directly under their own masthead. Class names stay in the top-toolbar__*
// family — the selectors in toolbar.css are flat, so the row styles the same
// wherever it is mounted.
//
// Responsive disclosure is staged, widest band first: the document-style menus
// move into the anchored More overlay, then selection typography, then
// alignment, then the two secondary emphasis commands (clear formatting and
// spell check). Every stage moves a control into the overlay or hides a control
// that has a duplicate mounted there — the row never scrolls and is never
// clipped, so each stage's residual set must still fit its band. See the
// disclosure ladder in toolbar.css, which carries the measured thresholds.
import {
  Bold,
  EllipsisVertical,
  Italic,
  Redo2,
  RemoveFormatting,
  SpellCheck,
  Underline,
  Undo2
} from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";

import type { DocStyleControls } from "../../hooks/useDocStyle";
import { type BodyAlign, type FontFamily } from "@typeset/engine/lib/documentStyle.ts";
import type { AlignmentScope } from "@typeset/engine/lib/documentStyle.ts";
import type { FieldFontFamily, StyleFieldFontStates, StyleFieldMarkStates, StyleFieldSizeStates, StyleTextField } from "@typeset/engine/lib/styleFieldFormatting.ts";
import type { FieldMark } from "@typeset/engine/lib/inlineMarksText.ts";
import { AlignmentControl } from "./AlignmentControl";
import { PageStylePopover } from "./PageStylePopover";
import { ParagraphStylePopover } from "./ParagraphStylePopover";
import { SpacingStylePopover } from "./SpacingStylePopover";
import { TextStylesPopover } from "./TextStylesPopover";
import { ToolbarButton } from "./ToolbarButton";
import { ZoomControl } from "./ZoomControl";
import { FontSizeControl } from "./FontSizeControl";
import { FontFamilyControl } from "./FontFamilyControl";
import { LinkControl } from "./LinkControl";

export type InlineFormatCommand = {
  onToggle: () => void;
  pressed: boolean;
  disabled?: boolean;
};

export type InlineFormattingControls = {
  onRequestEditorFocus?: () => void;
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
    // False when the selection spans several fields; see LinkControl.
    textEditable?: boolean;
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

export type FormattingToolbarProps = {
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
  // Observe a host pane whose width can change without a window resize.
  fitViewportRef?: RefObject<HTMLElement | null>;
  // Embedded hosts may place document-structure controls with the style menus.
  // The standalone TopToolbar keeps them in DocumentToolbar.
  documentStructureTools?: ReactNode;
  // A host with a different document grammar may replace the resume-specific
  // style menus while retaining the shared history/zoom/selection toolbar.
  // `undefined` preserves the standard resume controls; any supplied node is
  // the complete document-style tool set for that host.
  documentStyleTools?: ReactNode;
};

function SelectionTypographyControls({
  inlineFormatting,
  formattingDisabled,
  docStyle,
  overflow = false
}: {
  inlineFormatting?: InlineFormattingControls;
  formattingDisabled: boolean;
  docStyle: DocStyleControls;
  overflow?: boolean;
}) {
  return (
    <div
      className={`top-toolbar__group top-toolbar__group--typography top-toolbar__group--typography-${
        overflow ? "overflow" : "primary"
      }`}
      role="group"
      aria-label="Selected text typography"
    >
      <label className="top-toolbar__font-control top-toolbar__font-control--family">
        <span className="sr-only">Font family for selected text</span>
        <FontFamilyControl
          value={inlineFormatting?.fontFamily?.value ?? docStyle.style.fontFamily}
          onChange={(value) => inlineFormatting?.fontFamily?.onChange(value)}
          onCommitFocus={inlineFormatting?.onRequestEditorFocus}
          disabled={formattingDisabled || inlineFormatting?.fontFamily?.disabled !== false}
          ariaLabel="Font family for selected text"
          title={inlineFormatting?.fontFamily?.disabled === false ? "Apply font to selected text" : "Select text to change its font"}
        />
      </label>
      <label className="top-toolbar__font-control top-toolbar__font-control--size">
        <span className="sr-only">Font size for selected text in points</span>
        <FontSizeControl
          value={inlineFormatting?.fontSize?.value ?? null}
          onChange={(value) => inlineFormatting?.fontSize?.onChange(value)}
          onCommitFocus={inlineFormatting?.onRequestEditorFocus}
          disabled={formattingDisabled || inlineFormatting?.fontSize?.disabled !== false}
          ariaLabel="Font size for selected text in points"
          title={inlineFormatting?.fontSize?.disabled === false ? "Apply size to selected text" : "Select text to change its size"}
        />
      </label>
    </div>
  );
}

function SelectionAlignmentControls({
  inlineFormatting,
  formattingDisabled,
  docStyle,
  overflow = false
}: {
  inlineFormatting?: InlineFormattingControls;
  formattingDisabled: boolean;
  docStyle: DocStyleControls;
  overflow?: boolean;
}) {
  return (
    <div
      className={`top-toolbar__group top-toolbar__group--body-align top-toolbar__group--body-align-${
        overflow ? "overflow" : "primary"
      }`}
    >
      <AlignmentControl
        value={inlineFormatting?.alignment?.value ?? docStyle.style.bodyAlign}
        onChange={(alignment) => inlineFormatting?.alignment?.onChange(alignment)}
        disabled={formattingDisabled || inlineFormatting?.alignment?.disabled !== false}
      />
    </div>
  );
}

// Clear formatting and spell check are the last controls the row gives up: both
// stay reachable in the More overlay, so the narrowest band hides these mounts
// rather than dropping the commands. Kept beside the emphasis buttons at wide
// widths so the group reads as one cluster.
//
// CLEAR_FORMATTING_SHORTCUT is an expression, not a JSX string literal: a JSX
// attribute value does not process escapes, so `"Ctrl/⌘\\"` printed two
// backslashes in the tooltip.
const CLEAR_FORMATTING_SHORTCUT = "Ctrl/⌘\\";

function EmphasisExtraControls({
  inlineFormatting,
  formattingDisabled,
  docStyle,
  overflow = false
}: {
  inlineFormatting?: InlineFormattingControls;
  formattingDisabled: boolean;
  docStyle: DocStyleControls;
  overflow?: boolean;
}) {
  return (
    <>
      {inlineFormatting?.clearFormatting ? (
        <ToolbarButton
          className={`top-toolbar__emphasis-extra top-toolbar__emphasis-extra--${overflow ? "overflow" : "primary"}`}
          label="Clear formatting"
          tooltip="Clear formatting"
          shortcut={CLEAR_FORMATTING_SHORTCUT}
          icon={<RemoveFormatting size={16} />}
          onClick={inlineFormatting.clearFormatting.onClear}
          onMouseDown={(event) => event.preventDefault()}
          disabled={formattingDisabled || Boolean(inlineFormatting.clearFormatting.disabled)}
        />
      ) : null}
      <ToolbarButton
        className={`top-toolbar__emphasis-extra top-toolbar__emphasis-extra--${overflow ? "overflow" : "primary"}`}
        label="Spell check"
        tooltip={docStyle.style.spellCheck ? "Turn spell check off" : "Turn spell check on"}
        icon={<SpellCheck size={16} />}
        pressed={docStyle.style.spellCheck}
        onClick={() => docStyle.set("spellCheck", !docStyle.style.spellCheck)}
        onMouseDown={(event) => event.preventDefault()}
      />
    </>
  );
}

export function FormattingToolbar({
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
  onFitZoom,
  fitViewportRef,
  documentStructureTools,
  documentStyleTools
}: FormattingToolbarProps) {
  const hasInlineControls = Boolean(
    inlineFormatting?.bold || inlineFormatting?.italic || inlineFormatting?.underline || inlineFormatting?.link
  );
  const [moreOpen, setMoreOpen] = useState(false);
  const moreToolsId = `formatting-more-${useId()}`;
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const morePanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moreOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setMoreOpen(false);
      moreButtonRef.current?.focus();
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (moreButtonRef.current?.contains(target) || morePanelRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest(".font-size-control__menu")) return;
      setMoreOpen(false);
    };

    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [moreOpen]);

  return (
    <div
      className={`top-toolbar__secondary-row top-toolbar__secondary-row--formatting${moreOpen ? " is-more-open" : ""}`}
      role="toolbar"
      aria-label="Editing and formatting tools"
    >
      <div className="top-toolbar__main-tools">
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

        <ZoomControl
          docStyle={docStyle}
          onFitZoom={onFitZoom}
          fitViewportRef={fitViewportRef}
        />

        <span className="top-toolbar__divider" role="separator" aria-orientation="vertical" />

        <SelectionTypographyControls
          inlineFormatting={inlineFormatting}
          formattingDisabled={formattingDisabled}
          docStyle={docStyle}
        />

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
                textEditable={inlineFormatting.link.textEditable}
                automatic={inlineFormatting.link.automatic}
                onApply={inlineFormatting.link.onApply}
                onRemove={inlineFormatting.link.onRemove}
                disabled={formattingDisabled || Boolean(inlineFormatting.link.disabled)}
                open={inlineFormatting.link.open}
                onOpenChange={inlineFormatting.link.onOpenChange}
              />
            ) : null}
            <EmphasisExtraControls
              inlineFormatting={inlineFormatting}
              formattingDisabled={formattingDisabled}
              docStyle={docStyle}
            />
          </div>
        ) : null}

        {hasInlineControls ? (
          <span className="top-toolbar__divider" role="separator" aria-orientation="vertical" />
        ) : null}

        <SelectionAlignmentControls
          inlineFormatting={inlineFormatting}
          formattingDisabled={formattingDisabled}
          docStyle={docStyle}
        />

        <span
          className="top-toolbar__divider top-toolbar__divider--direct-alignment"
          role="separator"
          aria-orientation="vertical"
        />

        <div className="top-toolbar__more-trigger">
          <ToolbarButton
            ref={moreButtonRef}
            label={moreOpen ? "Hide more formatting" : "More formatting"}
            tooltip={moreOpen ? "Hide more formatting" : "More formatting"}
            icon={<EllipsisVertical size={18} />}
            className={moreOpen ? "is-active" : ""}
            aria-controls={moreToolsId}
            aria-expanded={moreOpen}
            aria-haspopup="dialog"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setMoreOpen((open) => !open)}
          />
        </div>
      </div>

      <div
        ref={morePanelRef}
        id={moreToolsId}
        className="top-toolbar__overflow-tools"
        role={moreOpen ? "dialog" : "group"}
        aria-modal={moreOpen ? false : undefined}
        aria-label="More formatting tools"
      >
        <SelectionTypographyControls
          inlineFormatting={inlineFormatting}
          formattingDisabled={formattingDisabled}
          docStyle={docStyle}
          overflow
        />
        <span
          className="top-toolbar__divider top-toolbar__divider--overflow-typography"
          role="separator"
          aria-orientation="vertical"
        />

        {hasInlineControls ? (
          <div
            className="top-toolbar__group top-toolbar__group--emphasis-extra-overflow"
            role="group"
            aria-label="Formatting and proofing"
          >
            <EmphasisExtraControls
              inlineFormatting={inlineFormatting}
              formattingDisabled={formattingDisabled}
              docStyle={docStyle}
              overflow
            />
          </div>
        ) : null}

        <span
          className="top-toolbar__divider top-toolbar__divider--overflow-emphasis"
          role="separator"
          aria-orientation="vertical"
        />

        <SelectionAlignmentControls
          inlineFormatting={inlineFormatting}
          formattingDisabled={formattingDisabled}
          docStyle={docStyle}
          overflow
        />

        <span
          className="top-toolbar__divider top-toolbar__divider--overflow-alignment"
          role="separator"
          aria-orientation="vertical"
        />

        <div className="top-toolbar__group top-toolbar__group--style" role="group" aria-label="Document style">
          {documentStructureTools}
          {documentStyleTools !== undefined ? documentStyleTools : (
            <>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
