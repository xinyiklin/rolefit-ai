import { useCallback, useEffect, useRef, useState, type MutableRefObject, type PointerEvent } from "react";

import type { ResumeEditorActions } from "../../hooks/useResumeEditor.ts";
import type { ResumeData, ResumeSectionType } from "@typeset/engine/lib/resumeData.ts";
import { fieldKey } from "@typeset/engine/typeset/types.ts";
import { extentOf, slotsFor, type BlockAnchor, type DragState, type Extent, type TypesetAnchors } from "./typesetStructure.ts";

export type PendingCaret = (
  data: ResumeData
) => { key: string; valueIndex: number; valueEndIndex?: number } | null;

// The dragged block's own box on the first page it occupies, for the lift
// highlight (multi-page blocks just highlight from their top; the drop line is
// what matters for placement).
const sourceExtentOf = (extent: Extent) => ({
  page: extent.firstPage,
  top: extent.top,
  bottom: extent.firstPage === extent.lastPage ? extent.bottom : extent.top + 24
});

// The editor is shared by hosts with different shell class names. Resolve the
// nearest real vertical scroll container from computed layout instead of
// reaching for a host-owned selector.
function nearestVerticalScroller(start: HTMLElement | null): HTMLElement | null {
  let current = start?.parentElement ?? null;
  while (current) {
    const overflowY = window.getComputedStyle(current).overflowY;
    const canScroll = overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay";
    if (canScroll && current.scrollHeight > current.clientHeight) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

type StructureControllerArgs = {
  actions: ResumeEditorActions;
  dataRef: MutableRefObject<ResumeData>;
  wrapRef: MutableRefObject<HTMLDivElement | null>;
  pendingCaretRef: MutableRefObject<PendingCaret | null>;
  markPending: () => void;
  anchors: TypesetAnchors | null;
  pageOrigins: Array<{ left: number; top: number }>;
  zoom: number;
};

export function useTypesetStructure({
  actions,
  dataRef,
  wrapRef,
  pendingCaretRef,
  markPending,
  anchors,
  pageOrigins,
  zoom
}: StructureControllerArgs) {
  const findSection = (data: ResumeData, sectionId: string) => data.sections.find((section) => section.id === sectionId);
  const entryCaretKey = (data: ResumeData, sectionId: string, entryId: string): string | null => {
    const section = findSection(data, sectionId);
    const entry = section?.items.find((item) => item.id === entryId);
    if (!section || !entry) return null;
    if (section.type === "skills") return fieldKey({ kind: "skillsRow", sectionId, entryId });
    if (section.type === "summary") {
      return entry.bullets[0]
        ? fieldKey({ kind: "bullet", sectionId, entryId, bulletId: entry.bullets[0].id })
        : null;
    }
    return fieldKey({ kind: "entry", sectionId, entryId, field: "titleLeft" });
  };

  const removeBulletAt = useCallback(
    (sectionId: string, entryId: string, bulletId: string) => {
      const entry = findSection(dataRef.current, sectionId)?.items.find((item) => item.id === entryId);
      const index = entry?.bullets.findIndex((bullet) => bullet.id === bulletId) ?? -1;
      const previousId = index > 0 ? entry?.bullets[index - 1]?.id : undefined;
      markPending();
      actions.removeBullet(sectionId, entryId, bulletId);
      pendingCaretRef.current = (data) => {
        if (previousId) {
          return {
            key: fieldKey({ kind: "bullet", sectionId, entryId, bulletId: previousId }),
            valueIndex: Number.MAX_SAFE_INTEGER
          };
        }
        const key = entryCaretKey(data, sectionId, entryId);
        return key ? { key, valueIndex: Number.MAX_SAFE_INTEGER } : null;
      };
    },
    [actions, dataRef, markPending, pendingCaretRef]
  );

  const addBulletToEntry = useCallback(
    (sectionId: string, entryId: string) => {
      markPending();
      actions.addBullet(sectionId, entryId);
      pendingCaretRef.current = (data) => {
        const entry = findSection(data, sectionId)?.items.find((item) => item.id === entryId);
        const bullet = entry?.bullets[entry.bullets.length - 1];
        return bullet
          ? { key: fieldKey({ kind: "bullet", sectionId, entryId, bulletId: bullet.id }), valueIndex: 0 }
          : null;
      };
    },
    [actions, markPending, pendingCaretRef]
  );

  const removeEntryAt = useCallback(
    (sectionId: string, entryId: string) => {
      const section = findSection(dataRef.current, sectionId);
      const index = section?.items.findIndex((item) => item.id === entryId) ?? -1;
      const previousId = index > 0 ? section?.items[index - 1]?.id : undefined;
      markPending();
      actions.removeEntry(sectionId, entryId);
      pendingCaretRef.current = (data) => {
        const previousKey = previousId ? entryCaretKey(data, sectionId, previousId) : null;
        const key = previousKey ?? fieldKey({ kind: "heading", sectionId });
        return { key, valueIndex: Number.MAX_SAFE_INTEGER };
      };
    },
    [actions, dataRef, markPending, pendingCaretRef]
  );

  const addSection = useCallback(
    (sectionType: ResumeSectionType, position: "top" | "bottom") => {
      markPending();
      actions.addSection(sectionType, position);
      pendingCaretRef.current = (data) => {
        const section = position === "top" ? data.sections[0] : data.sections[data.sections.length - 1];
        return section
          ? {
              key: fieldKey({ kind: "heading", sectionId: section.id }),
              valueIndex: 0,
              valueEndIndex: section.heading.length
            }
          : null;
      };
    },
    [actions, markPending, pendingCaretRef]
  );

  // Relative inserts for the right-click menu. After the splice the reference
  // element sits at a new index; the freshly created sibling is one slot toward
  // the insert direction (above → refIndex-1, below → refIndex+1). The caret
  // lands in the new element so the user can type immediately.
  const relativeOffset = (position: "above" | "below") => (position === "above" ? -1 : 1);

  const addEntryRelative = useCallback(
    (sectionId: string, entryId: string, position: "above" | "below") => {
      markPending();
      actions.insertEntry(sectionId, entryId, position);
      pendingCaretRef.current = (data) => {
        const section = findSection(data, sectionId);
        const refIndex = section?.items.findIndex((item) => item.id === entryId) ?? -1;
        const created = refIndex >= 0 ? section?.items[refIndex + relativeOffset(position)] : undefined;
        const key = created ? entryCaretKey(data, sectionId, created.id) : null;
        return key ? { key, valueIndex: 0 } : null;
      };
    },
    [actions, markPending, pendingCaretRef]
  );

  const addBulletRelative = useCallback(
    (sectionId: string, entryId: string, bulletId: string, position: "above" | "below") => {
      markPending();
      actions.insertBullet(sectionId, entryId, bulletId, position);
      pendingCaretRef.current = (data) => {
        const entry = findSection(data, sectionId)?.items.find((item) => item.id === entryId);
        const refIndex = entry?.bullets.findIndex((bullet) => bullet.id === bulletId) ?? -1;
        const created = refIndex >= 0 ? entry?.bullets[refIndex + relativeOffset(position)] : undefined;
        return created
          ? { key: fieldKey({ kind: "bullet", sectionId, entryId, bulletId: created.id }), valueIndex: 0 }
          : null;
      };
    },
    [actions, markPending, pendingCaretRef]
  );

  const addSectionRelative = useCallback(
    (sectionId: string, position: "above" | "below", sectionType: ResumeSectionType = "standard") => {
      markPending();
      actions.insertSection(sectionType, sectionId, position);
      pendingCaretRef.current = (data) => {
        const refIndex = data.sections.findIndex((section) => section.id === sectionId);
        const created = refIndex >= 0 ? data.sections[refIndex + relativeOffset(position)] : undefined;
        return created
          ? {
              key: fieldKey({ kind: "heading", sectionId: created.id }),
              valueIndex: 0,
              valueEndIndex: created.heading.length
            }
          : null;
      };
    },
    [actions, markPending, pendingCaretRef]
  );

  const removeSectionAt = useCallback(
    (sectionId: string) => {
      const sections = dataRef.current.sections;
      const index = sections.findIndex((section) => section.id === sectionId);
      const fallbackId = sections[index - 1]?.id ?? sections[index + 1]?.id;
      markPending();
      actions.removeSection(sectionId);
      pendingCaretRef.current = (data) => {
        const section = data.sections.find((item) => item.id === fallbackId);
        return section
          ? { key: fieldKey({ kind: "heading", sectionId: section.id }), valueIndex: Number.MAX_SAFE_INTEGER }
          : null;
      };
    },
    [actions, dataRef, markPending, pendingCaretRef]
  );

  const dragRef = useRef<DragState | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => dragCleanupRef.current?.(), []);

  const dragPlanFor = useCallback(
    (block: BlockAnchor): DragState | null => {
      if (!anchors) return null;
      const data = dataRef.current;
      const section = data.sections.find((item) => item.id === block.sectionId);
      // A summary is one running block: its paragraphs (and lone entry) are not
      // drag-reorderable. The section itself still moves via its heading grip.
      if (section?.type === "summary" && block.kind !== "heading") return null;
      if (block.kind === "bullet") {
        const entry = section?.items.find((item) => item.id === block.entryId);
        if (!entry || entry.bullets.length < 2) return null;
        const extents = entry.bullets.map((bullet) =>
          extentOf(
            anchors.blocks,
            (anchor) => anchor.kind === "bullet" && anchor.bulletId === bullet.id && anchor.entryId === block.entryId
          )
        );
        if (extents.some((extent) => !extent)) return null;
        const fromIndex = entry.bullets.findIndex((bullet) => bullet.id === block.bulletId);
        if (fromIndex < 0) return null;
        return {
          kind: "bullet",
          sectionId: block.sectionId,
          entryId: block.entryId,
          fromIndex,
          slots: slotsFor(extents as Extent[]),
          active: null,
          source: sourceExtentOf((extents as Extent[])[fromIndex])
        };
      }
      if (block.kind === "entry" || block.kind === "skillsRow") {
        if (!section || section.items.length < 2) return null;
        const extents = section.items.map((item) => extentOf(anchors.blocks, (anchor) => anchor.entryId === item.id));
        if (extents.some((extent) => !extent)) return null;
        const fromIndex = section.items.findIndex((item) => item.id === block.entryId);
        if (fromIndex < 0) return null;
        return {
          kind: "entry",
          sectionId: block.sectionId,
          fromIndex,
          slots: slotsFor(extents as Extent[]),
          active: null,
          source: sourceExtentOf((extents as Extent[])[fromIndex])
        };
      }
      if (block.kind === "heading") {
        if (data.sections.length < 2) return null;
        const extents = data.sections.map((item) =>
          extentOf(anchors.blocks, (anchor) => anchor.sectionId === item.id)
        );
        if (extents.some((extent) => !extent)) return null;
        const fromIndex = data.sections.findIndex((item) => item.id === block.sectionId);
        if (fromIndex < 0) return null;
        return {
          kind: "section",
          sectionId: block.sectionId,
          fromIndex,
          slots: slotsFor(extents as Extent[]),
          active: null,
          source: sourceExtentOf((extents as Extent[])[fromIndex])
        };
      }
      return null;
    },
    [anchors, dataRef]
  );

  // A block shows a drag grip only when a real reorder is possible: there are at
  // least two siblings, the block is not a summary paragraph, and every sibling
  // is currently laid out. This keeps dead grips off single-item lists.
  const canDrag = useCallback((block: BlockAnchor) => dragPlanFor(block) !== null, [dragPlanFor]);

  const commitReorder = useCallback(
    (plan: DragState, slot: number) => {
      const target = slot > plan.fromIndex ? slot - 1 : slot;
      if (target === plan.fromIndex) return;
      markPending();
      if (plan.kind === "bullet") actions.reorderBullets(plan.sectionId, plan.entryId!, plan.fromIndex, target);
      else if (plan.kind === "entry") actions.reorderEntries(plan.sectionId, plan.fromIndex, target);
      else actions.reorderSections(plan.fromIndex, target);
    },
    [actions, markPending]
  );

  const beginDrag = useCallback(
    (event: PointerEvent, block: BlockAnchor) => {
      const plan = dragPlanFor(block);
      if (!plan) return;
      event.preventDefault();
      dragCleanupRef.current?.();
      dragRef.current = plan;
      setDrag(plan);

      const scroller = nearestVerticalScroller(wrapRef.current);
      let pointerY = event.clientY;

      const pickSlot = () => {
        const state = dragRef.current;
        const wrapper = wrapRef.current;
        if (!state || !wrapper) return;
        const y = pointerY - wrapper.getBoundingClientRect().top;
        let active: number | null = null;
        let distance = Infinity;
        state.slots.forEach((slot, index) => {
          const origin = pageOrigins[slot.page];
          if (!origin) return;
          const nextDistance = Math.abs(y - (origin.top + slot.yBp * zoom));
          if (nextDistance < distance) {
            distance = nextDistance;
            active = index;
          }
        });
        if (active !== state.active) {
          const next = { ...state, active };
          dragRef.current = next;
          setDrag(next);
        }
      };

      // Auto-scroll while the pointer rests near the top/bottom of the scroll
      // viewport, so a long resume can be reordered without releasing the grip.
      // The rAF loop keeps scrolling even when the pointer is held still, and
      // re-picks the drop slot as fresh content comes into view.
      let raf = 0;
      const tick = () => {
        if (!dragRef.current) return;
        if (scroller) {
          const rect = scroller.getBoundingClientRect();
          const edge = 56;
          if (pointerY < rect.top + edge) scroller.scrollTop -= Math.ceil(((rect.top + edge - pointerY) / edge) * 14);
          else if (pointerY > rect.bottom - edge) scroller.scrollTop += Math.ceil(((pointerY - (rect.bottom - edge)) / edge) * 14);
        }
        pickSlot();
        raf = requestAnimationFrame(tick);
      };

      const onMove = (moveEvent: globalThis.PointerEvent) => {
        pointerY = moveEvent.clientY;
        pickSlot();
      };

      const cleanup = () => {
        cancelAnimationFrame(raf);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        dragCleanupRef.current = null;
      };
      raf = requestAnimationFrame(tick);
      const onUp = () => {
        const state = dragRef.current;
        cleanup();
        dragRef.current = null;
        setDrag(null);
        if (state?.active !== null && state?.active !== undefined) commitReorder(state, state.active);
      };
      const onCancel = () => {
        cleanup();
        dragRef.current = null;
        setDrag(null);
      };
      dragCleanupRef.current = cleanup;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp, { once: true });
      window.addEventListener("pointercancel", onCancel, { once: true });
    },
    [commitReorder, dragPlanFor, pageOrigins, wrapRef, zoom]
  );

  const moveByKeyboard = useCallback(
    (block: BlockAnchor, direction: -1 | 1) => {
      const plan = dragPlanFor(block);
      if (!plan) return;
      const target = plan.fromIndex + direction;
      const count = plan.slots.length - 1;
      if (target < 0 || target >= count) return;
      markPending();
      if (plan.kind === "bullet") actions.reorderBullets(plan.sectionId, plan.entryId!, plan.fromIndex, target);
      else if (plan.kind === "entry") actions.reorderEntries(plan.sectionId, plan.fromIndex, target);
      else actions.reorderSections(plan.fromIndex, target);
    },
    [actions, dragPlanFor, markPending]
  );

  return {
    removeBulletAt,
    addBulletToEntry,
    removeEntryAt,
    addSection,
    addEntryRelative,
    addBulletRelative,
    addSectionRelative,
    removeSectionAt,
    drag,
    dragRef,
    canDrag,
    beginDrag,
    moveByKeyboard
  };
}
