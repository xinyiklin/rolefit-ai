import type { CSSProperties, PointerEvent } from "react";
import { GripVertical } from "lucide-react";

import type { ResumeData } from "@typeset/engine/lib/resumeData.ts";
import type { BlockAnchor, DragState } from "./typesetStructure.ts";

const GRIP_GUTTER_PX = 28;
const GRIP_INK_GAP_PX = 4;
const MIN_GRIP_HEIGHT_PX = 32;

type PageOrigin = { left: number; top: number };

type TypesetStructureOverlayProps = {
  data: ResumeData;
  anchor: BlockAnchor | null;
  pageOrigins: PageOrigin[];
  zoom: number;
  geometry: { marginLeft: number; textWidth: number };
  drag: DragState | null;
  canDrag: (block: BlockAnchor) => boolean;
  onBeginDrag: (event: PointerEvent, block: BlockAnchor) => void;
  onMoveByKeyboard: (block: BlockAnchor, direction: -1 | 1) => void;
};

// Structure overlay for the engine-rendered page: a single drag grip per reorderable
// block. Adding and deleting blocks now live in the right-click menu, so the
// gutter stays quiet — just the handle for reorder (pointer drag or Arrow keys).
export function TypesetStructureOverlay({
  data,
  anchor,
  pageOrigins,
  zoom,
  geometry,
  drag,
  canDrag,
  onBeginDrag,
  onMoveByKeyboard
}: TypesetStructureOverlayProps) {
  const anchorOrigin = anchor ? pageOrigins[anchor.page] ?? null : null;
  const section = anchor ? data.sections.find((item) => item.id === anchor.sectionId) : null;
  // A grip appears only where a drag would actually reorder something: contacts
  // never reorder, and single-item lists / summary paragraphs report canDrag
  // false, so no dead handle is painted.
  const gripBlock = anchor && anchor.kind !== "contact" && canDrag(anchor) ? anchor : null;
  // The handle scales with page zoom so it stays proportional to the document.
  const handleSize = Math.max(12, Math.min(24, Math.round(14 * zoom)));
  const gripNoun =
    gripBlock?.kind === "heading"
      ? "section"
      : gripBlock?.kind === "bullet" && section?.type === "summary"
        ? "paragraph"
        : gripBlock?.kind === "bullet"
          ? "bullet"
          : gripBlock?.kind === "skillsRow"
            ? "skill row"
            : "entry";

  const dropSlot = drag?.active !== null && drag?.active !== undefined ? drag.slots[drag.active] : null;
  const dropOrigin = dropSlot ? pageOrigins[dropSlot.page] ?? null : null;
  const sourceOrigin = drag ? pageOrigins[drag.source.page] ?? null : null;
  const textLeft = (origin: PageOrigin) => origin.left + geometry.marginLeft * zoom;
  const gripStyle =
    gripBlock && anchorOrigin
      ? (() => {
          const left = textLeft(anchorOrigin) - GRIP_GUTTER_PX;
          const firstInkLeft = anchorOrigin.left + (gripBlock.x0 ?? geometry.marginLeft) * zoom;
          const width = Math.max(GRIP_GUTTER_PX, firstInkLeft - GRIP_INK_GAP_PX - left);
          const height = Math.max(MIN_GRIP_HEIGHT_PX, (gripBlock.bottom - gripBlock.top) * zoom + 8);
          return {
            left,
            top: anchorOrigin.top + ((gripBlock.top + gripBlock.bottom) / 2) * zoom - height / 2,
            "--ts-grip-width": `${width}px`,
            "--ts-grip-height": `${height}px`
          } as CSSProperties;
        })()
      : undefined;

  return (
    <>
      {gripBlock && anchorOrigin && !drag ? (
        <button
          type="button"
          className="ts-grip ts-structure-overlay"
          // Start in the gutter and extend across the block's leading indent,
          // stopping just before the first marker or editable glyph.
          style={gripStyle}
          title={`Drag to reorder ${gripNoun}, or use Arrow keys`}
          aria-label={`Reorder ${gripNoun}. Drag, or press Arrow Up or Arrow Down`}
          onMouseDown={(event) => event.preventDefault()}
          onPointerDown={(event) => onBeginDrag(event, gripBlock)}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              onMoveByKeyboard(gripBlock, event.key === "ArrowUp" ? -1 : 1);
            }
          }}
        >
          <GripVertical className="ts-grip__handle" size={handleSize} aria-hidden="true" />
        </button>
      ) : null}

      {/* Lift: highlight the block being dragged so it is clear what is moving. */}
      {drag && sourceOrigin ? (
        <div
          className="ts-drag-source"
          aria-hidden="true"
          style={{
            left: textLeft(sourceOrigin),
            top: sourceOrigin.top + drag.source.top * zoom - 2,
            width: geometry.textWidth * zoom,
            height: (drag.source.bottom - drag.source.top) * zoom + 4
          }}
        />
      ) : null}

      {dropSlot && dropOrigin ? (
        <div
          className="ts-drop-indicator"
          aria-hidden="true"
          style={{
            left: textLeft(dropOrigin),
            top: dropOrigin.top + dropSlot.yBp * zoom - 1,
            width: geometry.textWidth * zoom
          }}
        />
      ) : null}
    </>
  );
}
