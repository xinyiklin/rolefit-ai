import { Fragment, memo, useCallback, useEffect, useRef } from "react";

import type { ResumeEntry } from "../../lib/resumeData";
import type { ResumeEditorActions } from "../../hooks/useResumeEditor";
import { EditableInput } from "./fields";
import { pageBreakId, type ResumePageBreaks } from "./pagination";
import { RowControls } from "./RowControls";
import { BulletEditor } from "./BulletEditor";
import { SortableList, useSortableRow } from "./sortable";

type EntryEditorProps = {
  sectionId: string;
  entry: ResumeEntry;
  index: number;
  siblingCount: number;
  actions: ResumeEditorActions;
  isHighlighted?: boolean;
  highlightedBulletId?: string | null;
  pageBreaks?: ResumePageBreaks;
};

function EntryEditorImpl({ sectionId, entry, index, siblingCount, actions, isHighlighted = false, highlightedBulletId = null, pageBreaks = {} }: EntryEditorProps) {
  const { setNodeRef, style, isDragging, handle } = useSortableRow(entry.id, "entry");
  const ownRef = useRef<HTMLDivElement>(null);
  const setRef = useCallback((node: HTMLDivElement | null) => {
    setNodeRef(node);
    (ownRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
  }, [setNodeRef]);

  useEffect(() => {
    if (isHighlighted && !highlightedBulletId) ownRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [isHighlighted, highlightedBulletId]);

  return (
    <div
      ref={setRef}
      style={style}
      data-page-break-id={pageBreakId("entry", entry.id)}
      className={`rdx-entry${isDragging ? " is-dragging" : ""}${isHighlighted && !highlightedBulletId ? " is-highlighted" : ""}`}
    >
      <div className="rdx-entry__head">
        <div className="rdx-entry__rows">
          <div className="rdx-entry__row">
            <EditableInput
              className="rdx-entry__title"
              value={entry.titleLeft}
              placeholder="Title / school / project / role"
              aria-label="Entry title left"
              onChange={(value) => actions.updateEntry(sectionId, entry.id, "titleLeft", value)}
            />
            <EditableInput
              className="rdx-entry__meta"
              value={entry.titleRight}
              autoSize
              placeholder="Date / link"
              aria-label="Entry title right"
              onChange={(value) => actions.updateEntry(sectionId, entry.id, "titleRight", value)}
            />
          </div>
          <div className="rdx-entry__row rdx-entry__row--sub">
            <EditableInput
              className="rdx-entry__subtitle"
              value={entry.subtitleLeft}
              placeholder="Degree / company / tech stack"
              aria-label="Entry subtitle left"
              onChange={(value) => actions.updateEntry(sectionId, entry.id, "subtitleLeft", value)}
            />
            <EditableInput
              className="rdx-entry__location"
              value={entry.subtitleRight}
              autoSize
              placeholder="Location"
              aria-label="Entry subtitle right"
              onChange={(value) => actions.updateEntry(sectionId, entry.id, "subtitleRight", value)}
            />
          </div>
        </div>
        <RowControls
          label="entry"
          dragHandle={handle}
          onMoveUp={index > 0 ? () => actions.reorderEntries(sectionId, index, index - 1) : undefined}
          onMoveDown={index < siblingCount - 1 ? () => actions.reorderEntries(sectionId, index, index + 1) : undefined}
          onAdd={() => actions.addBullet(sectionId, entry.id)}
          addLabel="Add bullet to this entry"
          onRemove={() => actions.removeEntry(sectionId, entry.id)}
        />
      </div>

      {entry.bullets.length ? (
        <ul className="rdx-bullets">
          <SortableList
            ids={entry.bullets.map((bullet) => bullet.id)}
            onReorder={(from, to) => actions.reorderBullets(sectionId, entry.id, from, to)}
          >
            {entry.bullets.map((bullet, bi) => {
              const breakId = pageBreakId("bullet", bullet.id);
              return (
                <Fragment key={bullet.id}>
                  {pageBreaks[breakId] ? (
                    <li className="rdx-page-break" style={{ height: pageBreaks[breakId] }} aria-hidden="true" />
                  ) : null}
                  <BulletEditor
                    sectionId={sectionId}
                    entryId={entry.id}
                    bullet={bullet}
                    index={bi}
                    siblingCount={entry.bullets.length}
                    actions={actions}
                    isHighlighted={isHighlighted && highlightedBulletId === bullet.id}
                  />
                </Fragment>
              );
            })}
          </SortableList>
        </ul>
      ) : null}
    </div>
  );
}

// Memoized: only the edited entry re-renders on a keystroke (untouched entries
// keep their identity through the reducer).
export const EntryEditor = memo(EntryEditorImpl);
