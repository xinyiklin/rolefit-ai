import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Check, GripVertical, Pencil, Plus, Trash2, UserRound, X } from "lucide-react";

import type { EntryField } from "../../hooks/useResumeEditor.ts";
import type { ResumeData, ResumeSectionType } from "../../lib/resumeData.ts";
import { stripInlineMarks } from "../../lib/inlineMarksText.ts";
import type { TailorMode } from "../../lib/tailorScope";
import type { TailorChangeTarget } from "../../resume/types.ts";
import type { BlockAnchor, DragState, TypesetAnchors } from "./typesetStructure.ts";

const TAILOR_MODES: Array<{ mode: TailorMode; label: string }> = [
  { mode: "tailor", label: "Tailor" },
  { mode: "include", label: "Include" },
  { mode: "off", label: "Off" }
];

const SECTION_TYPES: Array<{ type: ResumeSectionType; label: string; description: string }> = [
  { type: "standard", label: "Bulleted entries", description: "Roles, projects, or education" },
  { type: "summary", label: "Summary", description: "Short paragraphs" },
  { type: "skills", label: "Skill list", description: "Label and inline skills" }
];

const ENTRY_FIELDS: Array<{ field: EntryField; label: string; placeholder: string }> = [
  { field: "titleLeft", label: "Title", placeholder: "Role, project, school, or award" },
  { field: "titleRight", label: "Right of title", placeholder: "Dates, link, GPA, or detail" },
  { field: "subtitleLeft", label: "Subtitle", placeholder: "Company, stack, degree, or focus" },
  { field: "subtitleRight", label: "Right of subtitle", placeholder: "Location or detail" }
];

function isEntryField(field: TailorChangeTarget["field"]): field is EntryField {
  return ENTRY_FIELDS.some((item) => item.field === field);
}

function blockRemovalKey(block: BlockAnchor): string {
  return ["block", block.kind, block.sectionId, block.entryId ?? "", block.bulletId ?? ""].join(":");
}

type PageOrigin = { left: number; top: number };

type TypesetChromeProps = {
  data: ResumeData;
  anchor: BlockAnchor | null;
  anchors: TypesetAnchors | null;
  pageOrigins: PageOrigin[];
  zoom: number;
  geometry: { margin: number; textWidth: number };
  tailorModes?: Record<string, TailorMode>;
  onSetTailorMode?: (sectionId: string, mode: TailorMode) => void;
  highlightTarget?: TailorChangeTarget | null;
  drag: DragState | null;
  onBeginDrag: (event: PointerEvent, block: BlockAnchor) => void;
  onMoveByKeyboard: (block: BlockAnchor, direction: -1 | 1) => void;
  onAddBlock: (block: BlockAnchor) => void;
  onRemoveBlock: (block: BlockAnchor) => void;
  onSetName: (name: string) => void;
  onUpdateContact: (index: number, value: string) => void;
  onUpdateEntry: (sectionId: string, entryId: string, field: EntryField, value: string) => void;
  onAddSectionItem: (sectionId: string) => void;
  onRemoveSection: (sectionId: string) => void;
  onAddContact: () => void;
  onRemoveContact: (index: number) => void;
  onAddSection: (type: ResumeSectionType, position: "top" | "bottom") => void;
};

export function TypesetChrome({
  data,
  anchor,
  anchors,
  pageOrigins,
  zoom,
  geometry,
  tailorModes,
  onSetTailorMode,
  highlightTarget,
  drag,
  onBeginDrag,
  onMoveByKeyboard,
  onAddBlock,
  onRemoveBlock,
  onSetName,
  onUpdateContact,
  onUpdateEntry,
  onAddSectionItem,
  onRemoveSection,
  onAddContact,
  onRemoveContact,
  onAddSection
}: TypesetChromeProps) {
  const footerRef = useRef<HTMLDivElement | null>(null);
  const entryDetailsRef = useRef<HTMLDivElement | null>(null);
  const [sectionMenuOpen, setSectionMenuOpen] = useState(false);
  const [headerOpen, setHeaderOpen] = useState(false);
  const [sectionInsertPosition, setSectionInsertPosition] = useState<"top" | "bottom">("bottom");
  const [confirmingRemoval, setConfirmingRemoval] = useState<string | null>(null);
  const [detailsTarget, setDetailsTarget] = useState<{ sectionId: string; entryId: string } | null>(null);
  const reviewDetailsKeyRef = useRef<string | null>(null);

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
    if (!confirmingRemoval) return;
    const timer = window.setTimeout(() => setConfirmingRemoval(null), 4000);
    return () => window.clearTimeout(timer);
  }, [confirmingRemoval]);

  useEffect(() => {
    if (!detailsTarget) return;
    const closeOutside = (event: globalThis.PointerEvent) => {
      if (!entryDetailsRef.current?.contains(event.target as Node)) setDetailsTarget(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDetailsTarget(null);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [detailsTarget]);

  // Empty optional entry fields do not have a painted span to highlight. Open
  // the entry-details panel exactly once for that review target and keep it
  // open while the user types; close only when the review target changes.
  useEffect(() => {
    const nextKey =
      highlightTarget?.entryId && isEntryField(highlightTarget.field)
        ? `${highlightTarget.sectionId}:${highlightTarget.entryId}:${highlightTarget.field}`
        : null;
    if (nextKey === reviewDetailsKeyRef.current) return;
    if (reviewDetailsKeyRef.current) setDetailsTarget(null);
    reviewDetailsKeyRef.current = null;
    if (!nextKey || !highlightTarget?.entryId || !isEntryField(highlightTarget.field)) return;
    const entry = data.sections
      .find((item) => item.id === highlightTarget.sectionId)
      ?.items.find((item) => item.id === highlightTarget.entryId);
    if (!entry || entry[highlightTarget.field].trim()) return;
    reviewDetailsKeyRef.current = nextKey;
    setDetailsTarget({ sectionId: highlightTarget.sectionId, entryId: highlightTarget.entryId });
  }, [data, highlightTarget]);

  const heading = anchor && anchors ? anchors.headings.get(anchor.sectionId) ?? null : null;
  const anchorOrigin = anchor ? pageOrigins[anchor.page] ?? null : null;
  const headingOrigin = heading ? pageOrigins[heading.page] ?? null : null;
  const section = anchor ? data.sections.find((item) => item.id === anchor.sectionId) : null;
  const sectionMode = anchor ? tailorModes?.[anchor.sectionId] ?? "off" : "off";
  const gutterBlock = anchor && anchor.kind !== "heading" && anchor.kind !== "contact" ? anchor : null;
  const summaryParagraph = gutterBlock?.kind === "bullet" && section?.type === "summary";
  const gutterNoun = summaryParagraph
    ? "summary paragraph"
    : gutterBlock?.kind === "bullet"
      ? "bullet"
      : gutterBlock?.kind === "skillsRow"
        ? "skill row"
        : "entry";
  const gutterAddLabel = summaryParagraph
    ? "Add summary paragraph below"
    : gutterBlock?.kind === "bullet"
      ? "Add bullet below"
      : gutterBlock?.kind === "skillsRow"
        ? "Add skill row below"
        : "Add bullet to this entry";
  const headingBlock = anchor?.kind === "heading" ? anchor : null;
  const contactBlock = anchor?.kind === "contact" ? anchor : null;
  const gutterRemovalKey = gutterBlock ? blockRemovalKey(gutterBlock) : null;
  const headingRemovalKey = headingBlock ? `section:${headingBlock.sectionId}` : null;
  const contactRemovalKey = contactBlock ? `contact:${contactBlock.contactIndex}` : null;
  const sectionItemNoun = section?.type === "skills" ? "skill row" : section?.type === "summary" ? "summary paragraph" : "entry";
  const dropSlot = drag?.active !== null && drag?.active !== undefined ? drag.slots[drag.active] : null;
  const dropOrigin = dropSlot ? pageOrigins[dropSlot.page] ?? null : null;
  const detailsSection = detailsTarget
    ? data.sections.find((item) => item.id === detailsTarget.sectionId)
    : null;
  const detailsEntry = detailsSection?.items.find((item) => item.id === detailsTarget?.entryId) ?? null;
  const detailsAnchor = detailsTarget
    ? anchors?.blocks.find((block) => block.kind === "entry" && block.entryId === detailsTarget.entryId) ??
      anchors?.blocks.find((block) => block.entryId === detailsTarget.entryId) ??
      null
    : null;
  const detailsOrigin = detailsAnchor ? pageOrigins[detailsAnchor.page] ?? null : null;
  const highlightedDetailsField =
    detailsTarget &&
    highlightTarget?.entryId === detailsTarget.entryId &&
    highlightTarget.sectionId === detailsTarget.sectionId &&
    isEntryField(highlightTarget.field)
      ? highlightTarget.field
      : null;

  return (
    <>
      {anchor && heading && headingOrigin && tailorModes && onSetTailorMode ? (
        <div
          className="ts-chrome ts-chrome--chips"
          role="radiogroup"
          aria-label="Section tailor mode"
          style={{
            left: headingOrigin.left,
            top: headingOrigin.top + heading.top * zoom - 2,
            width: 612 * zoom,
            paddingRight: Math.max(geometry.margin * zoom - 4, 0)
          }}
        >
          {TAILOR_MODES.map(({ mode, label }, index) => (
            <button
              key={mode}
              type="button"
              role="radio"
              className={`ts-chip${sectionMode === mode ? " is-on" : ""}`}
              aria-checked={sectionMode === mode}
              tabIndex={sectionMode === mode ? 0 : -1}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSetTailorMode(anchor.sectionId, mode)}
              onKeyDown={(event) => {
                if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
                event.preventDefault();
                const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : TAILOR_MODES.length - 1;
                const next = (index + delta) % TAILOR_MODES.length;
                onSetTailorMode(anchor.sectionId, TAILOR_MODES[next].mode);
                (event.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
              }}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {gutterBlock && anchorOrigin && !drag ? (
        <div
          className="ts-chrome ts-chrome--gutter"
          style={{ left: anchorOrigin.left + 4, top: anchorOrigin.top + gutterBlock.top * zoom - 1 }}
        >
          <button
            type="button"
            className="ts-gutter-btn ts-grip"
            title="Drag to reorder, or use Arrow keys"
            aria-label={`Reorder ${gutterNoun}. Drag, or press Arrow Up or Arrow Down`}
            onMouseDown={(event) => event.preventDefault()}
            onPointerDown={(event) => onBeginDrag(event, gutterBlock)}
            onKeyDown={(event) => {
              if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                event.preventDefault();
                onMoveByKeyboard(gutterBlock, event.key === "ArrowUp" ? -1 : 1);
              }
            }}
          >
            <GripVertical size={12} aria-hidden="true" />
          </button>
          {/* A summary is a single paragraph — no add/delete controls (delete
              the whole section from its heading instead). Reorder stays for the
              rare imported summary that carries more than one paragraph. */}
          {!summaryParagraph ? (
            <button
              type="button"
              className="ts-gutter-btn"
              title={gutterAddLabel}
              aria-label={gutterAddLabel}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onAddBlock(gutterBlock)}
            >
              <Plus size={12} aria-hidden="true" />
            </button>
          ) : null}
          {gutterBlock.kind === "entry" ? (
            <button
              type="button"
              className="ts-gutter-btn"
              title="Edit entry details"
              aria-label="Edit entry title, date, subtitle, and location"
              aria-haspopup="dialog"
              aria-expanded={detailsTarget?.entryId === gutterBlock.entryId}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                reviewDetailsKeyRef.current = null;
                setDetailsTarget({ sectionId: gutterBlock.sectionId, entryId: gutterBlock.entryId! })
              }}
            >
              <Pencil size={12} aria-hidden="true" />
            </button>
          ) : null}
          {summaryParagraph ? null : confirmingRemoval === gutterRemovalKey ? (
            <>
              <button
                type="button"
                autoFocus
                className="ts-gutter-btn ts-gutter-btn--danger"
                title={`Confirm delete ${gutterNoun}`}
                aria-label={`Confirm delete ${gutterNoun}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setConfirmingRemoval(null);
                  onRemoveBlock(gutterBlock);
                }}
              >
                <Check size={12} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="ts-gutter-btn"
                title={`Keep ${gutterNoun}`}
                aria-label={`Cancel delete ${gutterNoun}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setConfirmingRemoval(null)}
              >
                <X size={12} aria-hidden="true" />
              </button>
            </>
          ) : (
            <button
              type="button"
              className="ts-gutter-btn ts-gutter-btn--danger"
              title={`Delete ${gutterNoun}`}
              aria-label={`Delete ${gutterNoun}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setConfirmingRemoval(gutterRemovalKey)}
            >
              <Trash2 size={12} aria-hidden="true" />
            </button>
          )}
        </div>
      ) : null}

      {headingBlock && anchorOrigin && !drag ? (
        <div
          className="ts-chrome ts-chrome--gutter"
          style={{ left: anchorOrigin.left + 4, top: anchorOrigin.top + headingBlock.top * zoom - 1 }}
        >
          <button
            type="button"
            className="ts-gutter-btn ts-grip"
            title="Drag to reorder section, or use Arrow keys"
            aria-label="Reorder section. Drag, or press Arrow Up or Arrow Down"
            onMouseDown={(event) => event.preventDefault()}
            onPointerDown={(event) => onBeginDrag(event, headingBlock)}
            onKeyDown={(event) => {
              if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                event.preventDefault();
                onMoveByKeyboard(headingBlock, event.key === "ArrowUp" ? -1 : 1);
              }
            }}
          >
            <GripVertical size={12} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="ts-gutter-btn"
            title={`Add ${sectionItemNoun} to this section`}
            aria-label={`Add ${sectionItemNoun} to this section`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onAddSectionItem(headingBlock.sectionId)}
          >
            <Plus size={12} aria-hidden="true" />
          </button>
          {confirmingRemoval === headingRemovalKey ? (
            <>
              <button
                type="button"
                autoFocus
                className="ts-gutter-btn ts-gutter-btn--danger"
                title="Confirm delete section"
                aria-label="Confirm delete section"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setConfirmingRemoval(null);
                  onRemoveSection(headingBlock.sectionId);
                }}
              >
                <Check size={12} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="ts-gutter-btn"
                title="Keep section"
                aria-label="Cancel delete section"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setConfirmingRemoval(null)}
              >
                <X size={12} aria-hidden="true" />
              </button>
            </>
          ) : (
            <button
              type="button"
              className="ts-gutter-btn ts-gutter-btn--danger"
              title="Delete section"
              aria-label="Delete section"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setConfirmingRemoval(headingRemovalKey)}
            >
              <Trash2 size={12} aria-hidden="true" />
            </button>
          )}
        </div>
      ) : null}

      {contactBlock && anchorOrigin && !drag ? (
        <div
          className="ts-chrome ts-chrome--gutter"
          style={{ left: anchorOrigin.left + 4, top: anchorOrigin.top + contactBlock.top * zoom - 1 }}
        >
          <button
            type="button"
            className="ts-gutter-btn"
            title="Add contact item"
            aria-label="Add contact item"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onAddContact}
          >
            <Plus size={12} aria-hidden="true" />
          </button>
          {confirmingRemoval === contactRemovalKey ? (
            <>
              <button
                type="button"
                autoFocus
                className="ts-gutter-btn ts-gutter-btn--danger"
                title="Confirm delete contact item"
                aria-label="Confirm delete contact item"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setConfirmingRemoval(null);
                  onRemoveContact(contactBlock.contactIndex!);
                }}
              >
                <Check size={12} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="ts-gutter-btn"
                title="Keep contact item"
                aria-label="Cancel delete contact item"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setConfirmingRemoval(null)}
              >
                <X size={12} aria-hidden="true" />
              </button>
            </>
          ) : (
            <button
              type="button"
              className="ts-gutter-btn ts-gutter-btn--danger"
              title="Delete this contact item"
              aria-label="Delete this contact item"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setConfirmingRemoval(contactRemovalKey)}
            >
              <Trash2 size={12} aria-hidden="true" />
            </button>
          )}
        </div>
      ) : null}

      {detailsTarget && detailsEntry && detailsAnchor && detailsOrigin ? (
        <div
          ref={entryDetailsRef}
          className="ts-entry-details"
          role="dialog"
          aria-label="Entry details"
          style={{
            left: detailsOrigin.left + Math.max(geometry.margin * zoom, 28),
            top: detailsOrigin.top + detailsAnchor.bottom * zoom + 6
          }}
        >
          <div className="ts-entry-details__head">
            <strong>Entry details</strong>
            <button
              type="button"
              className="ts-entry-details__close"
              aria-label="Close entry details"
              onClick={() => setDetailsTarget(null)}
            >
              <X size={13} aria-hidden="true" />
            </button>
          </div>
          <div className="ts-entry-details__grid">
            {ENTRY_FIELDS.map(({ field, label, placeholder }) => (
              <label key={field} className="ts-entry-details__field">
                <span>{label}</span>
                <input
                  className={highlightedDetailsField === field ? "is-highlighted" : undefined}
                  value={stripInlineMarks(detailsEntry[field])}
                  placeholder={placeholder}
                  autoComplete="off"
                  onChange={(event) =>
                    onUpdateEntry(detailsTarget.sectionId, detailsTarget.entryId, field, event.target.value)
                  }
                />
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {dropSlot && dropOrigin ? (
        <div
          className="ts-drop-indicator"
          aria-hidden="true"
          style={{
            left: dropOrigin.left + geometry.margin * zoom,
            top: dropOrigin.top + dropSlot.yBp * zoom - 1,
            width: geometry.textWidth * zoom
          }}
        />
      ) : null}

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
                data.contact.map((value, index) => {
                  const removalKey = `contact:${index}`;
                  return (
                    <div className="ts-header-details__contact" key={index}>
                      <input
                        aria-label={`Contact item ${index + 1}`}
                        value={stripInlineMarks(value)}
                        placeholder="email, phone, location, or link"
                        autoComplete="off"
                        onChange={(event) => onUpdateContact(index, event.target.value)}
                      />
                      {confirmingRemoval === removalKey ? (
                        <>
                          <button
                            type="button"
                            autoFocus
                            className="is-danger"
                            aria-label={`Confirm delete contact item ${index + 1}`}
                            title="Confirm delete"
                            onClick={() => {
                              setConfirmingRemoval(null);
                              onRemoveContact(index);
                            }}
                          >
                            <Check size={12} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Cancel delete contact item ${index + 1}`}
                            title="Keep contact item"
                            onClick={() => setConfirmingRemoval(null)}
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
                          onClick={() => setConfirmingRemoval(removalKey)}
                        >
                          <Trash2 size={12} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  );
                })
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
    </>
  );
}
