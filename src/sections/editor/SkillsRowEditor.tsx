import { memo, useCallback, useEffect, useRef } from "react";

import type { ResumeEntry } from "../../lib/resumeData";
import type { ResumeEditorActions } from "../../hooks/useResumeEditor";
import { AutoTextarea, EditableInput } from "./fields";
import { pageBreakId } from "./pagination";
import { RowControls } from "./RowControls";
import { useSortableRow } from "./sortable";

type SkillsRowEditorProps = {
  sectionId: string;
  entry: ResumeEntry;
  index: number;
  siblingCount: number;
  actions: ResumeEditorActions;
  isHighlighted?: boolean;
};

function SkillsRowEditorImpl({ sectionId, entry, index, siblingCount, actions, isHighlighted = false }: SkillsRowEditorProps) {
  const { setNodeRef, style, isDragging, handle } = useSortableRow(entry.id, "skill row");
  const ownRef = useRef<HTMLDivElement>(null);
  const setRef = useCallback((node: HTMLDivElement | null) => {
    setNodeRef(node);
    (ownRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
  }, [setNodeRef]);

  useEffect(() => {
    if (isHighlighted) ownRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [isHighlighted]);

  return (
    <div
      ref={setRef}
      style={style}
      data-page-break-id={pageBreakId("entry", entry.id)}
      className={`rdx-skills-row${isDragging ? " is-dragging" : ""}${isHighlighted ? " is-highlighted" : ""}`}
    >
      <div className="rdx-skills-row__content">
        <EditableInput
          className="rdx-skills-row__label"
          value={entry.titleLeft}
          autoSize
          placeholder="Label"
          aria-label="Skills label"
          onChange={(value) => actions.updateEntry(sectionId, entry.id, "titleLeft", value)}
        />
        <span className="rdx-skills-row__colon" aria-hidden="true">:</span>
        <AutoTextarea
          className="rdx-skills-row__skills"
          value={entry.subtitleLeft}
          placeholder="Comma-separated skills"
          aria-label="Skills list"
          onChange={(value) => actions.updateEntry(sectionId, entry.id, "subtitleLeft", value)}
        />
      </div>
      <RowControls
        label="skill row"
        dragHandle={handle}
        onMoveUp={index > 0 ? () => actions.reorderEntries(sectionId, index, index - 1) : undefined}
        onMoveDown={index < siblingCount - 1 ? () => actions.reorderEntries(sectionId, index, index + 1) : undefined}
        onAdd={() => actions.insertEntry(sectionId, entry.id)}
        addLabel="Add skill row below"
        onRemove={() => actions.removeEntry(sectionId, entry.id)}
      />
    </div>
  );
}

// Memoized: only the edited skill row re-renders on a keystroke.
export const SkillsRowEditor = memo(SkillsRowEditorImpl);
