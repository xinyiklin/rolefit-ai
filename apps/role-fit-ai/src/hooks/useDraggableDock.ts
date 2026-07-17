import { useCallback, useEffect, useRef, useState } from "react";

const CLAMP_MARGIN = 8;

type Point = { x: number; y: number };

// Makes the fixed `.progress-dock` draggable so it never blocks the editor or
// preview underneath it. The dock's base position stays CSS-authoritative
// (`position: fixed; top: ...; left: 50%; transform: translateX(-50%)`) — this
// hook only ever ADDS an accumulated pixel offset on top of that via `style`,
// and returns `{}` until the user has actually dragged at least once so the
// CSS centering isn't overridden for the untouched common case.
export function useDraggableDock(): {
  style: React.CSSProperties;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  dragging: boolean;
} {
  // Accumulated offset from prior drags (persists across drags, not across
  // reloads — this is a local-personal-app affordance, not a saved preference).
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  // Mutable drag-session state — doesn't need to be React state since nothing
  // reads it during render; refs avoid re-subscribing the move/up listeners on
  // every pixel of movement.
  const dragStartRef = useRef<Point | null>(null);
  const baseOffsetRef = useRef<Point>({ x: 0, y: 0 });
  const clampRef = useRef<{ minX: number; maxX: number; minY: number; maxY: number } | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const endDrag = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    dragStartRef.current = null;
    clampRef.current = null;
    setDragging(false);
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Only the primary button/touch/pen contact starts a drag, and only one
      // drag at a time — a second touch mid-drag would otherwise overwrite
      // cleanupRef and leak the first session's window listeners.
      if (e.button !== 0 || dragStartRef.current) return;
      // Let interactive children (Retry/Stop/Dismiss buttons, links, etc.) work
      // normally instead of starting a drag.
      if ((e.target as Element).closest("button, a, input, textarea, select")) return;

      const dock = e.currentTarget;
      const rect = dock.getBoundingClientRect();
      // Clamp bounds are measured once at drag start from the dock's current
      // rect, so a dock that changes size between drags still clamps correctly
      // per-drag (it just won't live-reflow the clamp mid-drag). The rect
      // already includes the accumulated `offset` from prior drags, but the
      // clamped value is the ABSOLUTE offset — fold the current offset back in
      // so repeat drags clamp to the same 8px viewport margin as the first.
      clampRef.current = {
        minX: CLAMP_MARGIN - rect.left + offset.x,
        maxX: window.innerWidth - CLAMP_MARGIN - rect.right + offset.x,
        minY: CLAMP_MARGIN - rect.top + offset.y,
        maxY: window.innerHeight - CLAMP_MARGIN - rect.bottom + offset.y
      };

      dragStartRef.current = { x: e.clientX, y: e.clientY };
      baseOffsetRef.current = offset;
      // Capture keeps mid-drag pointer events from triggering hover/click side
      // effects elsewhere. Best-effort: the dock is `pointer-events: none` (only
      // its cards hit-test), and browsers differ on whether capture retargets to
      // such an element — which is why the move/up listeners below go on window,
      // not the dock.
      try {
        dock.setPointerCapture(e.pointerId);
      } catch {
        // A stale/inactive pointer can't be captured; window listeners still work.
      }

      const handleMove = (moveEvent: PointerEvent) => {
        const start = dragStartRef.current;
        const clamp = clampRef.current;
        if (!start || !clamp) return;
        setDragging(true);
        const rawX = baseOffsetRef.current.x + (moveEvent.clientX - start.x);
        const rawY = baseOffsetRef.current.y + (moveEvent.clientY - start.y);
        setOffset({
          x: Math.min(Math.max(rawX, clamp.minX), clamp.maxX),
          y: Math.min(Math.max(rawY, clamp.minY), clamp.maxY)
        });
      };

      const handleUp = (upEvent: PointerEvent) => {
        if (dock.hasPointerCapture(upEvent.pointerId)) {
          dock.releasePointerCapture(upEvent.pointerId);
        }
        endDrag();
      };

      // Window-level listeners: the dock itself is `pointer-events: none`, so
      // events only bubble through it while the pointer is over a card. Window
      // sees every move/up regardless of where the pointer wanders (or whether
      // the capture above took), so the drag can't stall or wedge mid-gesture.
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
      window.addEventListener("pointercancel", handleUp);
      cleanupRef.current = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        window.removeEventListener("pointercancel", handleUp);
      };
    },
    [offset, endDrag]
  );

  // Clean up any in-flight listeners if the dock unmounts mid-drag.
  useEffect(() => () => cleanupRef.current?.(), []);

  const hasOffset = offset.x !== 0 || offset.y !== 0;
  const style: React.CSSProperties =
    hasOffset || dragging
      ? { transform: `translate(calc(-50% + ${offset.x}px), ${offset.y}px)`, touchAction: "none" }
      : {};

  return { style, onPointerDown, dragging };
}
