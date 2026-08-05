import {
  useEffect,
  useId,
  useRef,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type ReactNode,
  type Ref
} from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";

import {
  useDocumentRailPreference,
  type DocumentRailPreferenceKey
} from "../../hooks/useDocumentRailPreference";

type DocumentWorkbenchRail = {
  id: string;
  label: string;
  preferenceKey: DocumentRailPreferenceKey;
  content: ReactNode | null;
  collapsedAction?: ReactNode;
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

  return (
    <div
      className="document-workbench"
      style={{ "--document-page-width": `${pageWidthPx}px` } as CSSProperties}
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
              <header className="document-workbench__rail-header">
                <span className="document-workbench__rail-label">{rail.label}</span>
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
            {!isExpanded ? (
              <>
                {rail.collapsedAction ? (
                  <div className="document-workbench__collapsed-action">
                    {rail.collapsedAction}
                  </div>
                ) : null}
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
              </>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
