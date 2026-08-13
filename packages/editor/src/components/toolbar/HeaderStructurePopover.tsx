import {
  Check,
  Eye,
  EyeOff,
  Plus,
  Trash2,
  UserRound,
  UserRoundPlus,
  X
} from "lucide-react";
import { useEffect, useId, useState } from "react";

import { stripInlineMarks } from "@typeset/engine/lib/inlineMarksText.ts";
import type { DocumentHeader } from "@typeset/engine/lib/resumeData.ts";
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

type HeaderStructurePopoverProps = {
  header: DocumentHeader | null;
  contactDivider: string;
  disabled: boolean;
  allowNameRemoval?: boolean;
  headerSpacing?: {
    values: Pick<DocStyle, HeaderSpacingKey>;
    onChange: (key: HeaderSpacingKey, value: number) => void;
  };
  onCreateHeader: () => void;
  onSetHeaderVisible: (visible: boolean) => void;
  onSetHeaderName: (name: string) => void;
  onRemoveHeaderName?: () => void;
  onUpdateContact: (index: number, value: string) => void;
  onInsertContact: (index: number) => void;
  onRemoveContact: (index: number) => void;
  onContactDividerChange: (value: string) => void;
};

export function HeaderStructurePopover({
  header,
  contactDivider,
  disabled,
  allowNameRemoval = false,
  headerSpacing,
  onCreateHeader,
  onSetHeaderVisible,
  onSetHeaderName,
  onRemoveHeaderName,
  onUpdateContact,
  onInsertContact,
  onRemoveContact,
  onContactDividerChange
}: HeaderStructurePopoverProps) {
  const [confirming, setConfirming] = useState<number | null>(null);
  const dividerId = useId();

  useEffect(() => {
    if (confirming === null) return;
    const timer = window.setTimeout(() => setConfirming(null), 4000);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  return (
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
            {header ? (
              <ToolbarButton
                className="structure-popover__visibility"
                label="Header visibility"
                tooltip={header.visible ? "Hide header" : "Show header"}
                icon={header.visible ? <Eye size={15} /> : <EyeOff size={15} />}
                pressed={header.visible}
                disabled={disabled}
                onClick={() => onSetHeaderVisible(!header.visible)}
              />
            ) : null}
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
              <div className="structure-popover__field">
                <div className="structure-popover__field-head">
                  <span>Name</span>
                  {allowNameRemoval && header.name === null ? (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onSetHeaderName("")}
                    >
                      <Plus size={12} aria-hidden="true" />
                      Add name
                    </button>
                  ) : allowNameRemoval && onRemoveHeaderName ? (
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
                  ) : null}
                </div>
                {allowNameRemoval && header.name === null ? null : (
                  <input
                    value={stripInlineMarks(header.name ?? "")}
                    placeholder="Your name"
                    autoComplete="name"
                    aria-label="Header name"
                    disabled={disabled}
                    onChange={(event) => onSetHeaderName(event.target.value)}
                  />
                )}
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
                        disabled={disabled}
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
  );
}
