import { Fragment, memo } from "react";

import type { ResumeSectionData } from "../../lib/resumeData";
import type { TailorMode } from "../../lib/tailorScope";
import type { ResumeEditorActions } from "../../hooks/useResumeEditor";
import { EditableInput } from "./fields";
import { pageBreakId, type ResumePageBreaks } from "./pagination";
import { RowControls } from "./RowControls";
import { EntryEditor } from "./EntryEditor";
import { SkillsRowEditor } from "./SkillsRowEditor";
import { SummaryRowEditor } from "./SummaryRowEditor";
import { SortableList, useSortableRow } from "./sortable";

type SectionEditorProps = {
  section: ResumeSectionData;
  index: number;
  siblingCount: number;
  actions: ResumeEditorActions;
  tailorMode?: TailorMode;
  onSetTailorMode?: (sectionId: string, mode: TailorMode) => void;
  highlightedEntryId?: string | null;
  highlightedBulletId?: string | null;
  pageBreaks?: ResumePageBreaks;
};

const TAILOR_MODES: TailorMode[] = ["tailor", "include", "off"];
const TAILOR_MODE_LABEL: Record<TailorMode, string> = { tailor: "Tailor", include: "Include", off: "Off" };

function SectionEditorImpl({ section, index, siblingCount, actions, tailorMode = "off", onSetTailorMode, highlightedEntryId = null, highlightedBulletId = null, pageBreaks = {} }: SectionEditorProps) {
  const { setNodeRef, style, isDragging, handle } = useSortableRow(section.id, "section");
  const isSkills = section.type === "skills";
  const isSummary = section.type === "summary";
  return (
    <section
      ref={setNodeRef}
      style={style}
      data-section-id={section.id}
      data-page-break-id={pageBreakId("section", section.id)}
      className={`rdx-section${isSkills ? " rdx-section--skills" : ""}${isSummary ? " rdx-section--summary" : ""}${isDragging ? " is-dragging" : ""}`}
    >
      <div className="rdx-section__head">
        <EditableInput
          className="rdx-section__heading"
          value={section.heading}
          placeholder="SECTION TITLE"
          aria-label="Section title"
          onChange={(value) => actions.setHeading(section.id, value)}
        />
        {onSetTailorMode ? (
          <div
            className="rdx-tailor-seg"
            role="radiogroup"
            data-active={tailorMode}
            aria-label={`Tailoring for ${section.heading.trim() || "section"}`}
          >
            {TAILOR_MODES.map((mode, i) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={tailorMode === mode}
                tabIndex={tailorMode === mode ? 0 : -1}
                className={`rdx-tailor-seg__opt rdx-tailor-seg__opt--${mode}${tailorMode === mode ? " is-active" : ""}`}
                title={
                  mode === "tailor"
                    ? "AI suggests edits to this section"
                    : mode === "include"
                    ? "Keep as-is, but let the AI use it for fit and grounding"
                    : "Leave this section out of tailoring"
                }
                onClick={() => onSetTailorMode(section.id, mode)}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
                  event.preventDefault();
                  const delta = event.key === "ArrowRight" ? 1 : TAILOR_MODES.length - 1;
                  const next = (i + delta) % TAILOR_MODES.length;
                  onSetTailorMode(section.id, TAILOR_MODES[next]);
                  (event.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
                }}
              >
                {TAILOR_MODE_LABEL[mode]}
              </button>
            ))}
          </div>
        ) : null}
        <RowControls
          label="section"
          dragHandle={handle}
          onMoveUp={index > 0 ? () => actions.reorderSections(index, index - 1) : undefined}
          onMoveDown={index < siblingCount - 1 ? () => actions.reorderSections(index, index + 1) : undefined}
          onAdd={() => actions.addEntry(section.id)}
          addLabel={isSkills ? "Add skill row to this section" : isSummary ? "Add paragraph to this section" : "Add entry to this section"}
          onRemove={() => actions.removeSection(section.id)}
        />
      </div>

      <SortableList
        ids={section.items.map((entry) => entry.id)}
        onReorder={(from, to) => actions.reorderEntries(section.id, from, to)}
      >
        {section.items.map((entry, i) => {
          const breakId = pageBreakId("entry", entry.id);
          return (
            <Fragment key={entry.id}>
              {pageBreaks[breakId] ? (
                <div className="rdx-page-break" style={{ height: pageBreaks[breakId] }} aria-hidden="true" />
              ) : null}
              {isSkills ? (
                <SkillsRowEditor sectionId={section.id} entry={entry} index={i} siblingCount={section.items.length} actions={actions} isHighlighted={highlightedEntryId === entry.id} />
              ) : isSummary ? (
                <SummaryRowEditor sectionId={section.id} entry={entry} index={i} siblingCount={section.items.length} actions={actions} isHighlighted={highlightedEntryId === entry.id} highlightedBulletId={highlightedEntryId === entry.id ? highlightedBulletId : null} />
              ) : (
                <EntryEditor sectionId={section.id} entry={entry} index={i} siblingCount={section.items.length} actions={actions} pageBreaks={pageBreaks} isHighlighted={highlightedEntryId === entry.id} highlightedBulletId={highlightedEntryId === entry.id ? highlightedBulletId : null} />
              )}
            </Fragment>
          );
        })}
      </SortableList>
    </section>
  );
}

// Memoized: the reducer preserves object identity for untouched sections, so only
// the edited section re-renders on a keystroke instead of the whole tree.
export const SectionEditor = memo(SectionEditorImpl);
