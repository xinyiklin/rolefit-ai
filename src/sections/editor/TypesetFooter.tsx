import { useEffect, useRef, useState } from "react";
import { Check, Plus, Trash2, UserRound, X } from "lucide-react";

import type { ResumeData, ResumeSectionType } from "../../lib/resumeData.ts";
import { stripInlineMarks } from "../../lib/inlineMarksText.ts";

const SECTION_TYPES: Array<{ type: ResumeSectionType; label: string; description: string }> = [
  { type: "standard", label: "Bulleted entries", description: "Roles, projects, or education" },
  { type: "summary", label: "Summary", description: "Short paragraphs" },
  { type: "skills", label: "Skill list", description: "Label and inline skills" }
];

type TypesetFooterProps = {
  data: ResumeData;
  onSetName: (name: string) => void;
  onUpdateContact: (index: number, value: string) => void;
  onAddContact: () => void;
  onRemoveContact: (index: number) => void;
  onAddSection: (type: ResumeSectionType, position: "top" | "bottom") => void;
};

export function TypesetFooter({
  data,
  onSetName,
  onUpdateContact,
  onAddContact,
  onRemoveContact,
  onAddSection
}: TypesetFooterProps) {
  const footerRef = useRef<HTMLDivElement | null>(null);
  const [sectionMenuOpen, setSectionMenuOpen] = useState(false);
  const [headerOpen, setHeaderOpen] = useState(false);
  const [sectionInsertPosition, setSectionInsertPosition] = useState<"top" | "bottom">("bottom");
  const [confirmingContact, setConfirmingContact] = useState<number | null>(null);

  useEffect(() => {
    if (!sectionMenuOpen && !headerOpen) return;
    const closeOutside = (event: globalThis.PointerEvent) => {
      if (!footerRef.current?.contains(event.target as Node)) {
        setSectionMenuOpen(false);
        setHeaderOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSectionMenuOpen(false);
        setHeaderOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [headerOpen, sectionMenuOpen]);

  useEffect(() => {
    if (confirmingContact === null) return;
    const timer = window.setTimeout(() => setConfirmingContact(null), 4000);
    return () => window.clearTimeout(timer);
  }, [confirmingContact]);

  return (
    <div className="ts-add-section" ref={footerRef}>
      <div className="ts-add-section__buttons">
        <button
          type="button"
          className="ghost-button is-compact"
          aria-haspopup="dialog"
          aria-expanded={headerOpen}
          onClick={() => {
            setSectionMenuOpen(false);
            setHeaderOpen((open) => !open);
          }}
        >
          <UserRound size={13} aria-hidden="true" />
          Header
        </button>
        <button
          type="button"
          className="ghost-button is-compact"
          aria-haspopup="dialog"
          aria-expanded={sectionMenuOpen}
          onClick={() => {
            setHeaderOpen(false);
            setSectionMenuOpen((open) => !open);
          }}
        >
          <Plus size={13} aria-hidden="true" />
          Add section
        </button>
      </div>

      {headerOpen ? (
        <div className="ts-header-details" role="dialog" aria-label="Resume header details">
          <div className="ts-entry-details__head">
            <strong>Header details</strong>
            <button
              type="button"
              className="ts-entry-details__close"
              aria-label="Close header details"
              onClick={() => setHeaderOpen(false)}
            >
              <X size={13} aria-hidden="true" />
            </button>
          </div>
          <label className="ts-entry-details__field">
            <span>Name</span>
            <input
              value={stripInlineMarks(data.name)}
              placeholder="Your name"
              autoComplete="name"
              onChange={(event) => onSetName(event.target.value)}
            />
          </label>
          <div className="ts-header-details__contacts">
            <div className="ts-header-details__label">
              <span>Contact items</span>
              <button type="button" onClick={onAddContact}>
                <Plus size={12} aria-hidden="true" />
                Add
              </button>
            </div>
            {data.contact.length ? (
              data.contact.map((value, index) => (
                <div className="ts-header-details__contact" key={index}>
                  <input
                    aria-label={`Contact item ${index + 1}`}
                    value={stripInlineMarks(value)}
                    placeholder="email, phone, location, or link"
                    autoComplete="off"
                    onChange={(event) => onUpdateContact(index, event.target.value)}
                  />
                  {confirmingContact === index ? (
                    <>
                      <button
                        type="button"
                        autoFocus
                        className="is-danger"
                        aria-label={`Confirm delete contact item ${index + 1}`}
                        title="Confirm delete"
                        onClick={() => {
                          setConfirmingContact(null);
                          onRemoveContact(index);
                        }}
                      >
                        <Check size={12} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Cancel delete contact item ${index + 1}`}
                        title="Keep contact item"
                        onClick={() => setConfirmingContact(null)}
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
                      onClick={() => setConfirmingContact(index)}
                    >
                      <Trash2 size={12} aria-hidden="true" />
                    </button>
                  )}
                </div>
              ))
            ) : (
              <p className="ts-header-details__empty">No contact items. Add one to show it in the header.</p>
            )}
          </div>
        </div>
      ) : null}

      {sectionMenuOpen ? (
        <div className="ts-add-section__menu" role="dialog" aria-label="Add resume section">
          <div className="ts-add-section__position" role="group" aria-label="Section position">
            {(["top", "bottom"] as const).map((position) => (
              <button
                key={position}
                type="button"
                className={`ts-add-section__position-btn${sectionInsertPosition === position ? " is-on" : ""}`}
                aria-pressed={sectionInsertPosition === position}
                onClick={() => setSectionInsertPosition(position)}
              >
                {position === "top" ? "At top" : "At bottom"}
              </button>
            ))}
          </div>
          {SECTION_TYPES.map((option) => (
            <button
              key={option.type}
              type="button"
              className="ts-add-section__option"
              onClick={() => {
                onAddSection(option.type, sectionInsertPosition);
                setSectionMenuOpen(false);
              }}
            >
              <span>{option.label}</span>
              <small>{option.description}</small>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
