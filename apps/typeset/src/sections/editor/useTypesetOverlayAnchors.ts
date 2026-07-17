// Geometry tracking for the structure overlay: where the painted pages sit
// inside the editor wrapper, which block anchor the pointer is over, and which
// field the caret is in. Pure positioning/hover state — structural commands
// and drag behavior live in useTypesetStructure.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type RefObject } from "react";

import { PAGE_HEIGHT_BP, PAGE_WIDTH_BP } from "@typeset/engine/typeset/blocks";
import { anchorForField, type BlockAnchor, type TypesetAnchors } from "./typesetStructure.ts";
import { keyOfNode } from "./domSelection.ts";

type PageOrigin = { left: number; top: number };

export function useTypesetOverlayAnchors({
  wrapRef,
  hostRef,
  anchors,
  zoom,
  docVersion,
  nonce
}: {
  wrapRef: RefObject<HTMLDivElement | null>;
  hostRef: RefObject<HTMLDivElement | null>;
  anchors: TypesetAnchors | null;
  zoom: number;
  docVersion: number;
  nonce: number;
}) {
  const [pageOrigins, setPageOrigins] = useState<PageOrigin[]>([]);
  const [hovered, setHovered] = useState<BlockAnchor | null>(null);
  const [activeFieldKey, setActiveFieldKey] = useState<string | null>(null);
  const activeAnchor = useMemo(() => anchorForField(anchors, activeFieldKey), [activeFieldKey, anchors]);

  // Page positions inside the wrapper (the overlay is a sibling of the
  // contenteditable host — controls must never live INSIDE the editable DOM).
  // Measured from LIVE rects relative to the wrapper. offsetLeft/offsetTop can't
  // be trusted: they go stale when the editor pane changes width (review rail
  // dock/undock, window resize) or when the page-centering CSS applies after the
  // first paint, floating every margin control (grips, action buttons, drop
  // indicator) off the sheet. A ResizeObserver alone is not enough either — it
  // is paint-gated and silently never fires in an occluded/background tab — so
  // the pointer path (updateHover) re-measures too. The compare skips the state
  // update when nothing moved, so hovering doesn't thrash renders.
  const measurePageOrigins = useCallback((): PageOrigin[] => {
    const wrap = wrapRef.current;
    if (!wrap) return [];
    const wrapRect = wrap.getBoundingClientRect();
    const next: PageOrigin[] = [];
    for (const page of wrap.querySelectorAll<HTMLElement>(".tsd-page")) {
      const rect = page.getBoundingClientRect();
      if (rect.width === 0) continue; // skip transient 0-size remount ghosts
      next.push({ left: rect.left - wrapRect.left, top: rect.top - wrapRect.top });
    }
    setPageOrigins((prev) =>
      prev.length === next.length && prev.every((p, i) => p.left === next[i].left && p.top === next[i].top)
        ? prev
        : next
    );
    return next;
  }, [wrapRef]);

  useLayoutEffect(() => {
    measurePageOrigins();
    // Fresh layout = stale hover: the anchor under the pointer may have moved
    // (or its contact INDEX may now mean a different item). Hide the overlay
    // until the pointer moves again rather than act on old geometry.
    setHovered(null);
    const onResize = () => measurePageOrigins();
    window.addEventListener("resize", onResize);
    const wrap = wrapRef.current;
    const observer =
      wrap && typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => measurePageOrigins()) : null;
    if (wrap && observer) {
      observer.observe(wrap);
      for (const page of wrap.querySelectorAll<HTMLElement>(".tsd-page")) observer.observe(page);
    }
    return () => {
      window.removeEventListener("resize", onResize);
      observer?.disconnect();
    };
  }, [docVersion, nonce, measurePageOrigins, wrapRef]);

  // Timestamp throttle, NOT requestAnimationFrame: the block lookup is ~30
  // array checks (cheap enough to run inline), and an rAF-gated hover wedges
  // permanently anywhere frames are starved (occluded/background tabs) — the
  // scheduled callback never runs and its guard blocks every later mousemove.
  const lastHoverAtRef = useRef(0);
  const updateHover = useCallback(
    (e: MouseEvent) => {
      // Freeze while the pointer is over the kit: reaching down the gutter stack
      // for a lower button moves the pointer's y into the next block, which would
      // otherwise re-target the hover and make the kit run away from the cursor.
      if ((e.target as HTMLElement | null)?.closest?.(".ts-structure-overlay")) return;
      const now = performance.now();
      if (now - lastHoverAtRef.current < 40) return;
      lastHoverAtRef.current = now;
      const wrap = wrapRef.current;
      if (!wrap || !anchors) return;
      // Re-measure on the pointer path: this is the surface where the overlay
      // shows, so it stays glued to the sheet even if a resize slipped past the
      // observers (e.g. an occluded tab where ResizeObserver never fired).
      const origins = measurePageOrigins();
      const rect = wrap.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      let next: BlockAnchor | null = null;
      for (let pi = 0; pi < origins.length; pi += 1) {
        const o = origins[pi];
        if (x < o.left || x > o.left + PAGE_WIDTH_BP * zoom || y < o.top || y > o.top + PAGE_HEIGHT_BP * zoom) continue;
        const yBp = (y - o.top) / zoom;
        const xBp = (x - o.left) / zoom;
        // Adjacent block ranges can OVERLAP by a couple of bp (a block's
        // descender allowance reaches past the next block's ascender line), so
        // first-match would target the PREVIOUS block near a top edge — pick
        // the candidate whose center is nearest instead. QA caught this as a
        // delete landing on the wrong bullet. Contact items also discriminate
        // by x (they share one line): x-matched contact wins over its line.
        let best: BlockAnchor | null = null;
        let bestDist = Infinity;
        let bestContact: BlockAnchor | null = null;
        let bestContactDist = Infinity;
        for (const b of anchors.blocks) {
          if (b.page !== pi || yBp < b.top - 1 || yBp > b.bottom + 1) continue;
          if (b.kind === "contact") {
            if (xBp < (b.x0 ?? 0) - 3 || xBp > (b.x1 ?? 0) + 3) continue;
            const dx = Math.abs(xBp - ((b.x0 ?? 0) + (b.x1 ?? 0)) / 2);
            if (dx < bestContactDist) {
              bestContactDist = dx;
              bestContact = b;
            }
            continue;
          }
          const dist = Math.abs(yBp - (b.top + b.bottom) / 2);
          if (dist < bestDist) {
            bestDist = dist;
            best = b;
          }
        }
        next = bestContact ?? best;
        break;
      }
      setHovered((prev) => {
        if (prev === next) return prev;
        if (
          prev &&
          next &&
          prev.kind === next.kind &&
          prev.sectionId === next.sectionId &&
          prev.entryId === next.entryId &&
          prev.bulletId === next.bulletId &&
          // contactIndex is part of a contact anchor's identity — omitting it
          // froze hover on the FIRST contact item ever hovered (QA caught a
          // delete landing on the wrong contact item).
          prev.contactIndex === next.contactIndex
        ) {
          return prev; // same block — keep the identity, skip the re-render
        }
        return next;
      });
    },
    [anchors, measurePageOrigins, wrapRef, zoom]
  );
  const clearHover = useCallback(() => setHovered(null), []);

  // Keep the structural controls tied to the caret as well as the pointer.
  // This makes the controls reachable after Tab leaves the single editable
  // host, instead of making keyboard users depend on a prior mouse hover.
  useEffect(() => {
    const host = hostRef.current;
    const wrap = wrapRef.current;
    if (!host || !wrap) return;
    const syncActiveField = () => {
      const selection = window.getSelection();
      const keyed = keyOfNode(selection?.focusNode ?? null);
      if (keyed && host.contains(keyed.el)) {
        setActiveFieldKey((current) => (current === keyed.key ? current : keyed.key));
      }
    };
    const clearOutside = (event: PointerEvent) => {
      if (!wrap.contains(event.target as Node)) setActiveFieldKey(null);
    };
    document.addEventListener("selectionchange", syncActiveField);
    document.addEventListener("pointerdown", clearOutside);
    syncActiveField();
    return () => {
      document.removeEventListener("selectionchange", syncActiveField);
      document.removeEventListener("pointerdown", clearOutside);
    };
  }, [docVersion, hostRef, nonce, wrapRef]);

  return { pageOrigins, hovered, activeAnchor, updateHover, clearHover };
}
