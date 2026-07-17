import { Check, LayoutGrid, Plus, Trash2, UserRound, X } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { stripInlineMarks } from "@typeset/engine/lib/inlineMarksText.ts";
import { SECTION_TYPE_OPTIONS, type ResumeSectionType } from "@typeset/engine/lib/resumeData.ts";
import { Popover } from "../Popover";
import { CONTACT_DIVIDERS } from "./styleOptions";
import { ToolbarButton } from "./ToolbarButton";

export type DocumentStructureControlsProps = {
  name: string;
  contact: string[];
  contactDivider: string;
  disabled?: boolean;
  onSetName: (name: string) => void;
  onUpdateContact: (index: number, value: string) => void;
  onAddContact: () => void;
  onRemoveContact: (index: number) => void;
  onContactDividerChange: (value: string) => void;
  onAddSection: (type: ResumeSectionType, position: "top" | "bottom") => void;
};

// The document header (name + contacts) and "add section" controls live here, in
// the always-visible toolbar, instead of a footer the user had to scroll to.
export function DocumentStructureControls({
  name,
  contact,
  contactDivider,
  disabled = false,
  onSetName,
  onUpdateContact,
  onAddContact,
  onRemoveContact,
  onContactDividerChange,
  onAddSection
}: DocumentStructureControlsProps) {
  const [confirming, setConfirming] = useState<number | null>(null);
  const [position, setPosition] = useState<"top" | "bottom">("bottom");
  const dividerId = useId();

  useEffect(() => {
    if (confirming === null) return;
    const timer = window.setTimeout(() => setConfirming(null), 4000);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  return (
    <div className="top-toolbar__group" role="group" aria-label="Document structure">
      <Popover
        ariaLabel="Header"
        align="start"
        className="structure-control"
        trigger={(triggerProps, open) => (
          <ToolbarButton
            {...triggerProps}
            className={open ? "is-active" : ""}
            label="Header"
            tooltip="Edit the resume header — name and contact items"
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
            <label className="structure-popover__field">
              <span>Name</span>
              <input
                value={stripInlineMarks(name)}
                placeholder="Your name"
                autoComplete="name"
                onChange={(event) => onSetName(event.target.value)}
              />
            </label>
            <div className="structure-popover__contacts">
              <div className="structure-popover__contacts-head">
                <span>Contact items</span>
                <button type="button" onClick={onAddContact}>
                  <Plus size={12} aria-hidden="true" />
                  Add
                </button>
              </div>
              {contact.length ? (
                contact.map((value, index) => (
                  <div className="structure-popover__contact" key={index}>
                    <input
                      aria-label={`Contact item ${index + 1}`}
                      value={stripInlineMarks(value)}
                      placeholder="email, phone, location, or link"
                      autoComplete="off"
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
                        onClick={() => setConfirming(index)}
                      >
                        <Trash2 size={12} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                ))
              ) : (
                <p className="structure-popover__empty">No contact items. Add one to show it in the header.</p>
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
                    onChange={(event) => onContactDividerChange(event.target.value.slice(0, 2))}
                    aria-label="Custom contact separator, one or two characters"
                  />
                </label>
              </div>
            </div>
          </div>
        )}
      </Popover>

      <Popover
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
      </Popover>
    </div>
  );
}
