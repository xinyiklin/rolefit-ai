import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { STUDIO_RAIL_BOUNDS, clampRailWidth } from "../hooks/useStudioRail";

type RailResizeHandleProps = {
  collapsed: boolean;
  width: number;
  onCommit: (width: number, collapsed: boolean) => void;
};

// Release snaps toward the state the drag left: a pull this far out of the icon
// rail opens it, a push this far below the minimum width closes it.
const SNAP_DISTANCE = 24;
const KEY_STEP = 16;

type Drag = {
  pointerId: number;
  startX: number;
  startWidth: number;
  raw: number;
  frame: number;
  pane: HTMLElement | null;
};

// Writes the rail state onto the pane directly. React only rewrites these when
// its own values change, so a drag sets them itself and puts them back.
function paintRail(pane: HTMLElement | null, collapsed: boolean, width: number) {
  if (!pane) return;
  pane.dataset.rail = collapsed ? "collapsed" : "expanded";
  pane.style.setProperty("--studio-rail-width", `${width}px`);
}

// The studio rail's resize edge: a separator, not a button. Pointer drag and the
// arrow keys move the same value; a double-click restores the default width.
// Its range runs from the icon rail (collapsed) to the maximum; Home is the
// narrowest expanded width. During a drag the rail follows the pointer, writing
// at most one width per animation frame onto the pane (no React render).
// Release settles it into the icon rail or into the allowed range, both on the
// rail's normal transition.
export function RailResizeHandle({ collapsed, width, onCommit }: RailResizeHandleProps) {
  const dragRef = useRef<Drag | null>(null);

  // The handle unmounts mid-drag when the window narrows past the breakpoint:
  // end the drag here; StudioPane re-asserts the rail state it now renders.
  useEffect(() => () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (drag.frame) cancelAnimationFrame(drag.frame);
    if (drag.pane) delete drag.pane.dataset.resizing;
  }, []);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const startWidth = collapsed ? STUDIO_RAIL_BOUNDS.collapsed : width;
    const element = event.currentTarget.closest<HTMLElement>(".studio-pane");
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth, raw: startWidth, frame: 0, pane: element };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture keeps the drag alive off the strip; the drag works without it.
    }
    if (!element) return;
    // A collapsed rail opens into its expanded layout at icon width, so the
    // labels grow into view instead of popping in at a threshold.
    element.dataset.resizing = "true";
    paintRail(element, false, startWidth);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.raw = drag.startWidth + (event.clientX - drag.startX);
    if (drag.frame) return;
    drag.frame = requestAnimationFrame(() => {
      drag.frame = 0;
      const next = Math.round(Math.min(STUDIO_RAIL_BOUNDS.max, Math.max(STUDIO_RAIL_BOUNDS.collapsed, drag.raw)));
      drag.pane?.style.setProperty("--studio-rail-width", `${next}px`);
    });
  }

  function onPointerEnd(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (drag.frame) cancelAnimationFrame(drag.frame);
    const nextCollapsed = collapsed
      ? drag.raw < STUDIO_RAIL_BOUNDS.collapsed + SNAP_DISTANCE
      : drag.raw < STUDIO_RAIL_BOUNDS.min - SNAP_DISTANCE;
    const nextWidth = nextCollapsed ? width : clampRailWidth(drag.raw);
    // Transitions back on first, so the settle to the final width animates.
    if (drag.pane) delete drag.pane.dataset.resizing;
    paintRail(drag.pane, nextCollapsed, nextWidth);
    onCommit(nextWidth, nextCollapsed);
  }

  // A cancelled pointer (the system took it) abandons the drag.
  function onPointerCancel(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (drag.frame) cancelAnimationFrame(drag.frame);
    if (drag.pane) delete drag.pane.dataset.resizing;
    paintRail(drag.pane, collapsed, width);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (collapsed) return;
      if (width <= STUDIO_RAIL_BOUNDS.min) onCommit(width, true);
      else onCommit(clampRailWidth(width - KEY_STEP), false);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      onCommit(collapsed ? width : clampRailWidth(width + KEY_STEP), false);
    } else if (event.key === "Home") {
      event.preventDefault();
      onCommit(STUDIO_RAIL_BOUNDS.min, false);
    } else if (event.key === "End") {
      event.preventDefault();
      onCommit(STUDIO_RAIL_BOUNDS.max, false);
    }
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={collapsed ? STUDIO_RAIL_BOUNDS.collapsed : width}
      aria-valuetext={collapsed ? "Collapsed" : `${width} pixels`}
      aria-valuemin={STUDIO_RAIL_BOUNDS.collapsed}
      aria-valuemax={STUDIO_RAIL_BOUNDS.max}
      tabIndex={0}
      className="studio-sidebar__resize"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerCancel}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onCommit(STUDIO_RAIL_BOUNDS.initial, false)}
    />
  );
}
