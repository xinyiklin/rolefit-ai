import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from "react";

const CLAMP_MARGIN = 8;

type Point = { x: number; y: number };
type Bounds = { minX: number; maxX: number; minY: number; maxY: number };

function clamp(value: number, min: number, max: number): number {
  return min > max ? (min + max) / 2 : Math.min(Math.max(value, min), max);
}

function boundsFor(rect: DOMRect, offset: Point): Bounds {
  return {
    minX: CLAMP_MARGIN - rect.left + offset.x,
    maxX: window.innerWidth - CLAMP_MARGIN - rect.right + offset.x,
    minY: CLAMP_MARGIN - rect.top + offset.y,
    maxY: window.innerHeight - CLAMP_MARGIN - rect.bottom + offset.y
  };
}

function clampPoint(point: Point, bounds: Bounds): Point {
  return {
    x: clamp(point.x, bounds.minX, bounds.maxX),
    y: clamp(point.y, bounds.minY, bounds.maxY)
  };
}

export function useDraggableDock(): {
  ref: (node: HTMLDivElement | null) => void;
  style: CSSProperties;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  dragging: boolean;
} {
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dockNode, setDockNode] = useState<HTMLDivElement | null>(null);
  const offsetRef = useRef(offset);
  const dragStartRef = useRef<Point | null>(null);
  const baseOffsetRef = useRef<Point>({ x: 0, y: 0 });
  const clampRef = useRef<Bounds | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  offsetRef.current = offset;

  const ref = useCallback((node: HTMLDivElement | null) => {
    setDockNode(node);
  }, []);

  const updateOffset = useCallback((next: Point) => {
    offsetRef.current = next;
    setOffset((current) => current.x === next.x && current.y === next.y ? current : next);
  }, []);

  const endDrag = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    dragStartRef.current = null;
    clampRef.current = null;
    setDragging(false);
  }, []);

  const reclamp = useCallback(() => {
    if (!dockNode) return;
    const current = offsetRef.current;
    updateOffset(clampPoint(current, boundsFor(dockNode.getBoundingClientRect(), current)));
  }, [dockNode, updateOffset]);

  useEffect(() => {
    if (!dockNode) return;
    const resizeObserver = new ResizeObserver(reclamp);
    resizeObserver.observe(dockNode);
    window.addEventListener("resize", reclamp);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", reclamp);
    };
  }, [dockNode, reclamp]);

  useEffect(() => {
    if (!dockNode) endDrag();
  }, [dockNode, endDrag]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || dragStartRef.current) return;
    if ((event.target as Element).closest("button, a, input, textarea, select")) return;

    const dock = event.currentTarget;
    const current = offsetRef.current;
    clampRef.current = boundsFor(dock.getBoundingClientRect(), current);
    dragStartRef.current = { x: event.clientX, y: event.clientY };
    baseOffsetRef.current = current;
    try {
      dock.setPointerCapture(event.pointerId);
    } catch {
      // Window listeners still own the drag if pointer capture is unavailable.
    }

    const handleMove = (moveEvent: PointerEvent) => {
      const start = dragStartRef.current;
      const bounds = clampRef.current;
      if (!start || !bounds) return;
      setDragging(true);
      updateOffset(clampPoint({
        x: baseOffsetRef.current.x + moveEvent.clientX - start.x,
        y: baseOffsetRef.current.y + moveEvent.clientY - start.y
      }, bounds));
    };
    const handleUp = (upEvent: PointerEvent) => {
      if (dock.hasPointerCapture(upEvent.pointerId)) dock.releasePointerCapture(upEvent.pointerId);
      endDrag();
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    cleanupRef.current = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [endDrag, updateOffset]);

  useEffect(() => () => cleanupRef.current?.(), []);

  const style: CSSProperties = offset.x || offset.y
    ? { transform: `translate(calc(-50% + ${offset.x}px), ${offset.y}px)` }
    : {};

  return { ref, style, onPointerDown, dragging };
}
