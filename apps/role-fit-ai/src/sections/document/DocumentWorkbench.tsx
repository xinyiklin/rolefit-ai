import {
  useEffect,
  useId,
  useRef,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref
} from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";

import {
  useDocumentRailPreference,
  useDocumentRailWidth,
  type DocumentRailPreferenceKey
} from "../../hooks/useDocumentRailPreference";

type DocumentWorkbenchRail = {
  id: string;
  label: string;
  preferenceKey: DocumentRailPreferenceKey;
  content: ReactNode | null;
  // The rail's primary action. It rides beside the disclosure control in both
  // states — in the header while open, beside the reopen tab while closed — so
  // it never moves house when the rail does.
  action?: ReactNode;
  attention?: { count: number; label: string };
};

type DocumentWorkbenchProps = {
  children: ReactNode;
  layoutRef?: Ref<HTMLDivElement>;
  notice?: ReactNode;
  rail: DocumentWorkbenchRail;
  // Rendered page width in CSS px (DOC_PAGE_WIDTH_PX × zoom). The pane biases
  // the page against the rail's track, and only the host knows the zoom.
  pageWidthPx: number;
};

type DocumentWorkbenchEditorPaneProps = ComponentPropsWithoutRef<"div"> & {
  ref?: Ref<HTMLDivElement>;
};

export function DocumentWorkbenchEditorPane({
  className,
  ref,
  ...props
}: DocumentWorkbenchEditorPaneProps) {
  const classes = ["document-workbench__editor", className].filter(Boolean).join(" ");
  return <div {...props} className={classes} ref={ref} />;
}

export function DocumentWorkbench({
  children,
  layoutRef,
  notice,
  rail,
  pageWidthPx
}: DocumentWorkbenchProps) {
  const generatedId = useId();
  const contentId = `${rail.id}-${generatedId}`;
  const hasRail = rail.content !== null;
  const attention = rail.attention && rail.attention.count > 0 ? rail.attention : null;
  const showRailLabel = `Show ${rail.label} panel${attention ? `, ${attention.label}` : ""}`;
  const { isExpanded, setIsExpanded } = useDocumentRailPreference(
    rail.preferenceKey,
    true
  );
  const { width: railWidth, setWidth: setRailWidth, bounds } = useDocumentRailWidth();
  const workbenchRef = useRef<HTMLDivElement>(null);
  // A drag writes the width variable straight onto the element and commits to
  // state once, on release: re-rendering the rail's whole review content on every
  // pointer frame is what makes a resize feel like it is dragging the workspace.
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const hideButtonRef = useRef<HTMLButtonElement>(null);
  const showButtonRef = useRef<HTMLButtonElement>(null);
  // Collapsing removes the control that was clicked, so each toggle names the
  // control that replaces it; otherwise focus falls back to <body>.
  const pendingFocusRef = useRef<"rail" | "tab" | null>(null);

  useEffect(() => {
    const target = pendingFocusRef.current;
    if (!target) return;
    pendingFocusRef.current = null;
    // The control we hand focus to is still outside the box while the track
    // animates, so a scrolling focus would drag the whole workspace sideways to
    // "reveal" it. It settles into view on its own; never scroll to it.
    (target === "rail" ? hideButtonRef : showButtonRef).current?.focus({ preventScroll: true });
  }, [isExpanded]);

  function setExpanded(next: boolean) {
    pendingFocusRef.current = next ? "rail" : "tab";
    setIsExpanded(next);
  }

  function setResizing(active: boolean) {
    const workbench = workbenchRef.current;
    if (!workbench) return;
    // The track and the pane's padding animate on the disclosure clock. Left on
    // during a drag, every pointer frame starts a new 200ms catch-up and the rail
    // trails the cursor.
    if (active) workbench.dataset.resizing = "true";
    else delete workbench.dataset.resizing;
  }

  function previewWidth(next: number) {
    const clamped = Math.min(bounds.max, Math.max(bounds.min, next));
    workbenchRef.current?.style.setProperty("--document-rail-width", `${Math.round(clamped)}px`);
    return clamped;
  }

  function onResizePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: railWidth };
    // Capture keeps the drag alive once the pointer leaves this 7px strip, but a
    // pointer the browser no longer considers active throws here; the drag still
    // tracks without it, so a failed capture must not abort the resize.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture is an optimisation, not the mechanism.
    }
    setResizing(true);
  }

  function onResizePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    // The rail grows leftward, so a drag toward the start of the line widens it.
    previewWidth(drag.startWidth + (drag.startX - event.clientX));
  }

  function endResize(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setResizing(false);
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Same: a pointer that already went away needs no release.
    }
    setRailWidth(drag.startWidth + (drag.startX - event.clientX));
  }

  function onResizeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 48 : 16;
    if (event.key === "ArrowLeft") setRailWidth(railWidth + step);
    else if (event.key === "ArrowRight") setRailWidth(railWidth - step);
    else if (event.key === "Home") setRailWidth(bounds.min);
    else if (event.key === "End") setRailWidth(bounds.max);
    else return;
    event.preventDefault();
  }

  return (
    <div
      ref={workbenchRef}
      className="document-workbench"
      style={{
        "--document-page-width": `${pageWidthPx}px`,
        "--document-rail-width": `${railWidth}px`
      } as CSSProperties}
    >
      {notice}
      <div
        ref={layoutRef}
        className={`document-workbench__layout${hasRail ? " has-rail" : ""}${
          hasRail && !isExpanded ? " is-collapsed" : ""
        }`}
      >
        {children}
        {hasRail ? (
          <>
            {/* The panel's contents hold the full rail width while the grid
                track closes, so it slides out instead of reflowing. It stays
                mounted — and inert — so local review state survives collapse. */}
            <div
              className="document-workbench__rail"
              data-state={isExpanded ? "expanded" : "collapsed"}
              inert={!isExpanded}
            >
              {/* The rail is resized from its own edge. It is a separator, not a
                  button: pointer drag and the arrow keys move the same value. */}
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label={`Resize ${rail.label} panel`}
                aria-valuenow={Math.round(railWidth)}
                aria-valuemin={Math.round(bounds.min)}
                aria-valuemax={Math.round(bounds.max)}
                tabIndex={0}
                className="document-workbench__rail-resize"
                onPointerDown={onResizePointerDown}
                onPointerMove={onResizePointerMove}
                onPointerUp={endResize}
                onPointerCancel={endResize}
                onKeyDown={onResizeKeyDown}
                onDoubleClick={() => setRailWidth(bounds.min)}
              />
              <header className="document-workbench__rail-header">
                <span className="document-workbench__rail-label">{rail.label}</span>
                {/* One action, one place at a time: the collapsed dock renders the
                    same node, so the open header must not leave a second copy
                    behind in the inert panel. */}
                {isExpanded ? rail.action : null}
                <button
                  ref={hideButtonRef}
                  type="button"
                  className="document-workbench__rail-toggle"
                  aria-expanded={isExpanded}
                  aria-controls={contentId}
                  aria-label={`Hide ${rail.label} panel`}
                  title={`Hide ${rail.label} panel`}
                  onClick={() => setExpanded(false)}
                >
                  <PanelRightClose size={16} aria-hidden="true" />
                </button>
              </header>
              <div id={contentId} className="document-workbench__rail-content">
                {rail.content}
              </div>
            </div>
            {/* Collapsed, the action and the tab keep the same order they had in
                the header, now on the document's edge. */}
            {!isExpanded ? (
              <div className="document-workbench__rail-dock">
                {rail.action}
                <button
                  ref={showButtonRef}
                  type="button"
                  className="document-workbench__rail-tab"
                  aria-expanded={false}
                  aria-controls={contentId}
                  aria-label={showRailLabel}
                  title={showRailLabel}
                  onClick={() => setExpanded(true)}
                >
                  <PanelRightOpen size={16} aria-hidden="true" />
                  {attention ? (
                    <span className="document-workbench__rail-attention" aria-hidden="true">
                      {attention.count}
                    </span>
                  ) : null}
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
