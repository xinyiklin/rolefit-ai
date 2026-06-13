import { Fragment, memo } from "react";

import type { ResumeSectionData } from "../../lib/resumeData";
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
  tailorSelected?: boolean;
  onToggleTailor?: (sectionId: string, selected: boolean) => void;
  highlightedEntryId?: string | null;
  highlightedBulletId?: string | null;
  pageBreaks?: ResumePageBreaks;
};

function SectionEditorImpl({ section, index, siblingCount, actions, tailorSelected = false, onToggleTailor, highlightedEntryId = null, highlightedBulletId = null, pageBreaks = {} }: SectionEditorProps) {
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
        {onToggleTailor ? (
          <label className={`rdx-tailor-toggle${tailorSelected ? " is-selected" : ""}`}>
            <input
              type="checkbox"
              checked={tailorSelected}
              onChange={(event) => onToggleTailor(section.id, event.target.checked)}
            />
            <span>Tailor</span>
          </label>
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
