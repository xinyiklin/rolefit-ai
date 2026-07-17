import { useCallback, useEffect, useRef, useState, type MutableRefObject, type PointerEvent } from "react";

import type { ResumeEditorActions } from "../../hooks/useResumeEditor.ts";
import type { ResumeData, ResumeSectionType } from "../../lib/resumeData.ts";
import { fieldKey } from "../../typeset/types.ts";
import { extentOf, slotsFor, type BlockAnchor, type DragState, type Extent, type TypesetAnchors } from "./typesetStructure.ts";

export type PendingCaret = (
  data: ResumeData
) => { key: string; valueIndex: number; valueEndIndex?: number } | null;

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

  const addBulletAfter = useCallback(
    (sectionId: string, entryId: string, bulletId: string) => {
      markPending();
      actions.insertBullet(sectionId, entryId, bulletId);
      pendingCaretRef.current = (data) => {
        const entry = findSection(data, sectionId)?.items.find((item) => item.id === entryId);
        const index = entry?.bullets.findIndex((bullet) => bullet.id === bulletId) ?? -1;
        const next = index >= 0 ? entry?.bullets[index + 1] : undefined;
        return next
          ? { key: fieldKey({ kind: "bullet", sectionId, entryId, bulletId: next.id }), valueIndex: 0 }
          : null;
      };
    },
    [actions, markPending, pendingCaretRef]
  );

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

  const addEntryAfter = useCallback(
    (sectionId: string, entryId: string) => {
      markPending();
      actions.insertEntry(sectionId, entryId);
      pendingCaretRef.current = (data) => {
        const section = findSection(data, sectionId);
        const index = section?.items.findIndex((item) => item.id === entryId) ?? -1;
        const next = index >= 0 ? section?.items[index + 1] : undefined;
        const key = next ? entryCaretKey(data, sectionId, next.id) : null;
        return key ? { key, valueIndex: 0 } : null;
      };
    },
    [actions, markPending, pendingCaretRef]
  );

  const addItemToSection = useCallback(
    (sectionId: string) => {
      markPending();
      actions.addEntry(sectionId);
      pendingCaretRef.current = (data) => {
        const section = findSection(data, sectionId);
        const entry = section?.items[section.items.length - 1];
        const key = entry ? entryCaretKey(data, sectionId, entry.id) : null;
        return key ? { key, valueIndex: 0 } : null;
      };
    },
    [actions, markPending, pendingCaretRef]
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

  const addContactItem = useCallback(() => {
    markPending();
    actions.addContact();
    pendingCaretRef.current = (data) =>
      data.contact.length
        ? { key: fieldKey({ kind: "contact", index: data.contact.length - 1 }), valueIndex: 0 }
        : null;
  }, [actions, markPending, pendingCaretRef]);

  const removeContactItem = useCallback(
    (index: number) => {
      markPending();
      actions.removeContact(index);
      pendingCaretRef.current = (data) =>
        data.contact.length
          ? {
              key: fieldKey({ kind: "contact", index: Math.min(index, data.contact.length - 1) }),
              valueIndex: Number.MAX_SAFE_INTEGER
            }
          : null;
    },
    [actions, markPending, pendingCaretRef]
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
      const summaryParagraph = block.kind === "bullet" && section?.type === "summary";
      if (block.kind === "bullet" && !summaryParagraph) {
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
          active: null
        };
      }
      if (block.kind === "entry" || block.kind === "skillsRow" || summaryParagraph) {
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
          active: null
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
          active: null
        };
      }
      return null;
    },
    [anchors, dataRef]
  );

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

      const onMove = (moveEvent: globalThis.PointerEvent) => {
        const state = dragRef.current;
        if (!state) return;
        const wrapper = wrapRef.current;
        if (!wrapper) return;
        const y = moveEvent.clientY - wrapper.getBoundingClientRect().top;
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

      const cleanup = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        dragCleanupRef.current = null;
      };
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
    addBulletAfter,
    removeBulletAt,
    addEntryAfter,
    addItemToSection,
    addBulletToEntry,
    removeEntryAt,
    addSection,
    removeSectionAt,
    addContactItem,
    removeContactItem,
    drag,
    dragRef,
    beginDrag,
    moveByKeyboard
  };
}
