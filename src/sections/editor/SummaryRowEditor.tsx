import { memo, useCallback, useEffect, useRef } from "react";

import type { ResumeEntry } from "../../lib/resumeData";
import type { ResumeEditorActions } from "../../hooks/useResumeEditor";
import { AutoTextarea } from "./fields";
import { pageBreakId } from "./pagination";
import { RowControls } from "./RowControls";
import { useSortableRow } from "./sortable";

type SummaryRowEditorProps = {
  sectionId: string;
  entry: ResumeEntry;
  index: number;
  siblingCount: number;
  actions: ResumeEditorActions;
  isHighlighted?: boolean;
  highlightedBulletId?: string | null;
};

// One summary paragraph. The text lives in the entry's single bullet (see
// newSummaryEntry) so tailor suggestions target it like any other bullet, but it
// renders as a plain paragraph — no glyph, no heading slots.
function SummaryRowEditorImpl({ sectionId, entry, index, siblingCount, actions, isHighlighted = false, highlightedBulletId = null }: SummaryRowEditorProps) {
  const { setNodeRef, style, isDragging, handle } = useSortableRow(entry.id, "summary paragraph");
  const ownRef = useRef<HTMLDivElement>(null);
  const setRef = useCallback((node: HTMLDivElement | null) => {
    setNodeRef(node);
    (ownRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
  }, [setNodeRef]);

  const bullet = entry.bullets[0];
  const highlighted = isHighlighted && (!highlightedBulletId || highlightedBulletId === bullet?.id);

  useEffect(() => {
    if (highlighted) ownRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [highlighted]);

  return (
    <div
      ref={setRef}
      style={style}
      data-page-break-id={pageBreakId("entry", entry.id)}
      className={`rdx-summary-row${isDragging ? " is-dragging" : ""}${highlighted ? " is-highlighted" : ""}`}
    >
      {bullet ? (
        <AutoTextarea
          className="rdx-summary-row__text"
          value={bullet.text}
          placeholder="Two or three sentences: who you are, your strongest evidence, and the role you fit."
          aria-label="Summary paragraph"
          onChange={(value) => actions.updateBullet(sectionId, entry.id, bullet.id, value)}
        />
      ) : (
        // Defensive: a bullet-less summary entry shouldn't exist (newSummaryEntry
        // always seeds one), but keep the row's controls reachable if it ever does.
        <span className="rdx-summary-row__text" aria-hidden="true" />
      )}
      <RowControls
        label="summary paragraph"
        dragHandle={handle}
        onMoveUp={index > 0 ? () => actions.reorderEntries(sectionId, index, index - 1) : undefined}
        onMoveDown={index < siblingCount - 1 ? () => actions.reorderEntries(sectionId, index, index + 1) : undefined}
        onAdd={() => actions.insertEntry(sectionId, entry.id)}
        addLabel="Add paragraph below"
        onRemove={() => actions.removeEntry(sectionId, entry.id)}
      />
    </div>
  );
}

// Memoized: only the edited paragraph re-renders on a keystroke.
export const SummaryRowEditor = memo(SummaryRowEditorImpl);
