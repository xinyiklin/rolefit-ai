import { memo, useCallback, useEffect, useRef } from "react";

import type { ResumeBullet } from "../../lib/resumeData";
import type { ResumeEditorActions } from "../../hooks/useResumeEditor";
import { AutoTextarea } from "./fields";
import { pageBreakId } from "./pagination";
import { RowControls } from "./RowControls";
import { useSortableRow } from "./sortable";

type BulletEditorProps = {
  sectionId: string;
  entryId: string;
  bullet: ResumeBullet;
  index: number;
  siblingCount: number;
  actions: ResumeEditorActions;
  isHighlighted?: boolean;
};

function BulletEditorImpl({ sectionId, entryId, bullet, index, siblingCount, actions, isHighlighted = false }: BulletEditorProps) {
  const { setNodeRef, style, isDragging, handle } = useSortableRow(bullet.id, "bullet");
  const ownRef = useRef<HTMLLIElement>(null);
  const setRef = useCallback((node: HTMLLIElement | null) => {
    setNodeRef(node);
    (ownRef as React.MutableRefObject<HTMLLIElement | null>).current = node;
  }, [setNodeRef]);

  useEffect(() => {
    if (isHighlighted) ownRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [isHighlighted]);

  return (
    <li
      ref={setRef}
      style={style}
      data-page-break-id={pageBreakId("bullet", bullet.id)}
      className={`rdx-bullet${isDragging ? " is-dragging" : ""}${isHighlighted ? " is-highlighted" : ""}`}
    >
      <span className="rdx-bullet__dot" aria-hidden="true">•</span>
      <AutoTextarea
        className="rdx-bullet__text"
        value={bullet.text}
        placeholder="Describe an accomplishment…"
        aria-label="Bullet text"
        onChange={(value) => actions.updateBullet(sectionId, entryId, bullet.id, value)}
        onEnter={() => actions.insertBullet(sectionId, entryId, bullet.id)}
      />
      <RowControls
        label="bullet"
        dragHandle={handle}
        onMoveUp={index > 0 ? () => actions.reorderBullets(sectionId, entryId, index, index - 1) : undefined}
        onMoveDown={index < siblingCount - 1 ? () => actions.reorderBullets(sectionId, entryId, index, index + 1) : undefined}
        onAdd={() => actions.insertBullet(sectionId, entryId, bullet.id)}
        addLabel="Add bullet below"
        onRemove={() => actions.removeBullet(sectionId, entryId, bullet.id)}
      />
    </li>
  );
}

// Memoized: only the edited bullet re-renders on a keystroke.
export const BulletEditor = memo(BulletEditorImpl);
