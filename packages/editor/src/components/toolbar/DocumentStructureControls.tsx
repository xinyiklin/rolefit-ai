import {
  Check,
  Eye,
  EyeOff,
  LayoutGrid,
  Plus,
  Trash2,
  UserRound,
  UserRoundPlus,
  X
} from "lucide-react";
import { useEffect, useId, useState } from "react";

import { stripInlineMarks } from "@typeset/engine/lib/inlineMarksText.ts";
import {
  SECTION_TYPE_OPTIONS,
  type DocumentHeader,
  type ResumeSectionType
} from "@typeset/engine/lib/resumeData.ts";
import type { DocStyle } from "@typeset/engine/lib/documentStyle.ts";
import { Popover } from "../Popover";
import {
  CONTACT_DIVIDERS,
  HEADER_SPACING_CONTROLS,
  formatSpacingValue,
  type HeaderSpacingKey
} from "./styleOptions";
import { StyleRange } from "./StyleRange";
import { ToolbarButton } from "./ToolbarButton";

export type DocumentStructureControlsProps = {
  header: DocumentHeader | null;
  contactDivider: string;
  disabled?: boolean;
  // Supplied by a host whose document has no document-spacing popover of its
  // own: the header's gaps are then adjustable from the header itself.
  headerSpacing?: {
    values: Pick<DocStyle, HeaderSpacingKey>;
    onChange: (key: HeaderSpacingKey, value: number) => void;
  };
  onCreateHeader: () => void;
  onSetHeaderVisible: (visible: boolean) => void;
  onSetHeaderName: (name: string) => void;
  onRemoveHeaderName: () => void;
  onUpdateContact: (index: number, value: string) => void;
  onInsertContact: (index: number) => void;
  onRemoveContact: (index: number) => void;
  onContactDividerChange: (value: string) => void;
  onAddSection?: (type: ResumeSectionType, position: "top" | "bottom") => void;
  showSections?: boolean;
};

// The document header (name + contacts) and "add section" controls live here, in
// the always-visible toolbar, instead of a footer the user had to scroll to.
export function DocumentStructureControls({
  header,
  contactDivider,
  disabled = false,
  headerSpacing,
  onCreateHeader,
  onSetHeaderVisible,
  onSetHeaderName,
  onRemoveHeaderName,
  onUpdateContact,
  onInsertContact,
  onRemoveContact,
  onContactDividerChange,
  onAddSection,
  showSections = true
}: DocumentStructureControlsProps) {
  const [confirming, setConfirming] = useState<number | null>(null);
  const [position, setPosition] = useState<"top" | "bottom">("bottom");
  const dividerId = useId();
  const toggleLabel = header
    ? header.visible
      ? "Hide header"
      : "Show header"
    : "Create header";

  useEffect(() => {
    if (confirming === null) return;
    const timer = window.setTimeout(() => setConfirming(null), 4000);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  return (
    <div
      className="top-toolbar__group top-toolbar__document-structure"
      role="group"
      aria-label="Document structure"
    >
      <Popover
        ariaLabel="Header"
        align="start"
        className="structure-control"
        trigger={(triggerProps, open) => (
          <ToolbarButton
            {...triggerProps}
            className={open ? "is-active" : ""}
            label="Header"
            tooltip="Edit the document header: name and contact items"
            icon={<UserRound size={16} />}
            showLabel
            disabled={disabled}
          />
        )}
      >
        {() => (
          <div className="structure-popover">
            <div className="structure-popover__head">
              <strong>Header</strong>
            </div>
            {!header ? (
              <div className="structure-popover__empty-state">
                <p>This document has no header.</p>
                <button type="button" disabled={disabled} onClick={onCreateHeader}>
                  <UserRoundPlus size={13} aria-hidden="true" />
                  Create header
                </button>
              </div>
            ) : (
              <>
                {!header.visible ? (
                  <p className="structure-popover__notice" role="status">
                    Header is hidden from the document. Its contents are preserved.
                  </p>
                ) : null}
                <div className="structure-popover__field">
                  <div className="structure-popover__field-head">
                    <span>Name</span>
                    {header.name === null ? (
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => onSetHeaderName("")}
                      >
                        <Plus size={12} aria-hidden="true" />
                        Add name
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="is-danger"
                        aria-label="Remove name field"
                        title="Remove name field"
                        disabled={disabled}
                        onClick={onRemoveHeaderName}
                      >
                        <Trash2 size={12} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                  {header.name !== null ? (
                    <input
                      value={stripInlineMarks(header.name)}
                      placeholder="Your name"
                      autoComplete="name"
                      aria-label="Header name"
                      disabled={disabled}
                      onChange={(event) => onSetHeaderName(event.target.value)}
                    />
                  ) : null}
                </div>
                <div className="structure-popover__contacts">
                  <div className="structure-popover__contacts-head">
                    <span>Contact items</span>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onInsertContact(header.contact.length)}
                    >
                      <Plus size={12} aria-hidden="true" />
                      Add
                    </button>
                  </div>
                  {header.contact.length ? (
                    header.contact.map((value, index) => (
                      <div className="structure-popover__contact" key={index}>
                        <input
                          aria-label={`Contact item ${index + 1}`}
                          value={stripInlineMarks(value)}
                          placeholder="email, phone, location, or link"
                          autoComplete="off"
                          disabled={disabled}
                          onChange={(event) => onUpdateContact(index, event.target.value)}
                        />
                        {confirming === index ? (
                          <>
                            <button
                              type="button"
                              autoFocus
                              className="is-danger"
                              aria-label={`Confirm delete contact item ${index + 1}`}
                              title="Confirm delete"
                              disabled={disabled}
                              onClick={() => {
                                setConfirming(null);
                                onRemoveContact(index);
                              }}
                            >
                              <Check size={12} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Cancel delete contact item ${index + 1}`}
                              title="Keep contact item"
                              disabled={disabled}
                              onClick={() => setConfirming(null)}
                            >
                              <X size={12} aria-hidden="true" />
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="is-danger"
                            aria-label={`Delete contact item ${index + 1}`}
                            title="Delete contact item"
                            disabled={disabled}
                            onClick={() => setConfirming(index)}
                          >
                            <Trash2 size={12} aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    ))
                  ) : (
                    <p className="structure-popover__empty">No contact items.</p>
                  )}
                </div>
                <div className="structure-popover__field">
                  <span id={dividerId}>Contact separator</span>
                  <div className="style-popover__glyph-row" role="group" aria-labelledby={dividerId}>
                    {CONTACT_DIVIDERS.map((divider) => (
                      <button
                        key={divider}
                        type="button"
                        className={`style-popover__glyph${contactDivider === divider ? " is-selected" : ""}`}
                        aria-label={`Use ${divider} as contact separator`}
                        aria-pressed={contactDivider === divider}
                        disabled={disabled}
                        onClick={() => onContactDividerChange(divider)}
                      >
                        {divider}
                      </button>
                    ))}
                    <label className="style-popover__custom-glyph">
                      <span className="sr-only">Custom contact separator</span>
                      <input
                        type="text"
                        maxLength={2}
                        value={contactDivider}
                        disabled={disabled}
                        onChange={(event) => {
                          const divider = event.target.value.slice(0, 2);
                          if (divider) onContactDividerChange(divider);
                        }}
                        aria-label="Custom contact separator, one or two characters"
                      />
                    </label>
                  </div>
                </div>
                {headerSpacing ? (
                  <div className="structure-popover__field">
                    <span id={`${dividerId}-spacing`}>Spacing</span>
                    <div
                      className="style-popover__range-list"
                      role="group"
                      aria-labelledby={`${dividerId}-spacing`}
                    >
                      {HEADER_SPACING_CONTROLS.map((control) => (
                        <StyleRange
                          key={control.key}
                          id={`${dividerId}-${control.key}`}
                          label={control.label}
                          value={headerSpacing.values[control.key]}
                          min={control.min}
                          max={control.max}
                          step={control.step}
                          displayValue={formatSpacingValue(
                            headerSpacing.values[control.key],
                            control.unit
                          )}
                          onChange={(value) => headerSpacing.onChange(control.key, value)}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </div>
        )}
      </Popover>
      <ToolbarButton
        className="structure-control__header-toggle"
        label={toggleLabel}
        tooltip={toggleLabel}
        icon={
          header
            ? header.visible
              ? <Eye size={15} />
              : <EyeOff size={15} />
            : <UserRoundPlus size={15} />
        }
        aria-label={toggleLabel}
        aria-pressed={header ? header.visible : undefined}
        disabled={disabled}
        onClick={() => {
          if (!header) onCreateHeader();
          else onSetHeaderVisible(!header.visible);
        }}
      />

      {showSections && onAddSection ? <Popover
        ariaLabel="Add section"
        align="start"
        className="structure-control"
        trigger={(triggerProps, open) => (
          <ToolbarButton
            {...triggerProps}
            className={open ? "is-active" : ""}
            label="Section"
            tooltip="Add a section"
            icon={<LayoutGrid size={16} />}
            showLabel
            disabled={disabled}
          />
        )}
      >
        {({ close }) => (
          <div className="structure-popover">
            <div className="structure-popover__head">
              <strong>Add section</strong>
            </div>
            <div className="structure-popover__position" role="group" aria-label="Section position">
              {(["top", "bottom"] as const).map((pos) => (
                <button
                  key={pos}
                  type="button"
                  className={`structure-popover__position-btn${position === pos ? " is-on" : ""}`}
                  aria-pressed={position === pos}
                  disabled={disabled}
                  onClick={() => setPosition(pos)}
                >
                  {pos === "top" ? "At top" : "At bottom"}
                </button>
              ))}
            </div>
            {SECTION_TYPE_OPTIONS.map((option) => (
              <button
                key={option.type}
                type="button"
                className="structure-popover__option"
                disabled={disabled}
                onClick={() => {
                  onAddSection(option.type, position);
                  close();
                }}
              >
                <span>{option.label}</span>
                <small>{option.description}</small>
              </button>
            ))}
          </div>
        )}
      </Popover> : null}
    </div>
  );
}
