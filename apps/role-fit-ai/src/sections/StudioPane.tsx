import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { BarChart3, BriefcaseBusiness, ClipboardList, FileQuestion, FileText, Mail } from "lucide-react";
import type { OutputTab, OutputTabDescriptor, OutputTabGroup } from "./shared";
import { TAB_GROUPS } from "./shared";
import { RailResizeHandle } from "./RailResizeHandle";

// Sidebar rail entries lead with a fixed icon per tab id.
const TAB_ICONS: Record<OutputTab, ReactNode> = {
  prepare: <BriefcaseBusiness size={15} aria-hidden="true" />,
  resume: <FileText size={15} aria-hidden="true" />,
  cover: <Mail size={15} aria-hidden="true" />,
  materials: <FileQuestion size={15} aria-hidden="true" />,
  applications: <ClipboardList size={15} aria-hidden="true" />,
  analytics: <BarChart3 size={15} aria-hidden="true" />
};

// Prepare's group holds only the Prepare tab, so a label would only repeat it.
const GROUP_LABELS: Record<OutputTabGroup, string | null> = {
  PREPARE: null,
  DRAFT: "Draft",
  TRACK: "Track"
};

type StudioPaneProps = {
  activeOutputTab: OutputTab;
  setActiveOutputTab: (tab: OutputTab) => void;
  outputTabs: OutputTabDescriptor[];
  children: ReactNode;
  overlay?: ReactNode;
  // Leads the rail above the tab groups: the brand and the collapse toggle.
  sidebarHeader?: ReactNode;
  // The rail is an icon strip (user-collapsed, or always at narrow widths).
  railCollapsed?: boolean;
  // Expanded rail width in px, and the resize commit. Without onRailResize the
  // rail has no resize edge (narrow widths).
  railWidth?: number;
  onRailResize?: (width: number, collapsed: boolean) => void;
  // Pinned to the bottom of the rail, below the tab groups. These are utilities,
  // not tabs: they stay out of the tablist and its roving-tabindex model.
  sidebarUtilities?: ReactNode;
  // Optional intent signal fired when a tab is hovered or focused but not yet
  // selected. The host decides what (if anything) that warms; the rail only
  // reports the intent.
  onPrefetchOutputTab?: (tab: OutputTab) => void;
};

export function StudioPane({
  activeOutputTab,
  setActiveOutputTab,
  outputTabs,
  children,
  overlay,
  sidebarHeader,
  railCollapsed = false,
  railWidth,
  onRailResize,
  sidebarUtilities,
  onPrefetchOutputTab
}: StudioPaneProps) {
  // APG tabs keyboard model: roving tabindex + arrow/Home/End move selection and
  // follow focus to the newly active tab.
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // The only writer of the pane's rail state outside a drag, which paints the
  // same two values straight onto the pane. Re-asserting them whenever the rail
  // state or its resizability changes also restores a drag cut short by the
  // window narrowing past the breakpoint.
  const paneRef = useRef<HTMLElement>(null);
  const resizable = Boolean(onRailResize && railWidth);
  useLayoutEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    pane.dataset.rail = railCollapsed ? "collapsed" : "expanded";
    if (railWidth) pane.style.setProperty("--studio-rail-width", `${railWidth}px`);
    else pane.style.removeProperty("--studio-rail-width");
  }, [railCollapsed, railWidth, resizable]);

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = outputTabs.length - 1;
    let next = -1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = index === last ? 0 : index + 1;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = index === 0 ? last : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    else return;
    event.preventDefault();
    setActiveOutputTab(outputTabs[next].id);
    tabRefs.current[next]?.focus();
  }

  // Build the grouped rail structure. Tabs are emitted in their original order
  // so the APG keyboard model (roving tabindex by position) is preserved.
  // Groups are rendered in first-seen order so the Prepare / Draft / Track
  // split is stable.
  const groupOrder: OutputTabGroup[] = [];
  const grouped: Record<OutputTabGroup, { tab: OutputTabDescriptor; posIndex: number }[]> = {
    PREPARE: [],
    DRAFT: [],
    TRACK: [],
  };
  outputTabs.forEach((tab, posIndex) => {
    const g: OutputTabGroup = tab.group ?? TAB_GROUPS[tab.id] ?? "DRAFT";
    if (!groupOrder.includes(g)) groupOrder.push(g);
    grouped[g].push({ tab, posIndex });
  });

  return (
    <main ref={paneRef} className="studio-pane" aria-label="Output workspace">
      <div className="studio-sidebar">
        {sidebarHeader}
        {/* After the head in focus order: brand, then the rail's edge, then tabs. */}
        {onRailResize && railWidth ? (
          <RailResizeHandle collapsed={railCollapsed} width={railWidth} onCommit={onRailResize} />
        ) : null}
        <nav className="studio-tabs" role="tablist" aria-label="Output views">
          {groupOrder.map((group) => (
            <div className="studio-tabs__group" key={group}>
              {GROUP_LABELS[group] ? (
                <span className="studio-tabs__group-label" aria-hidden="true">{GROUP_LABELS[group]}</span>
              ) : null}
              {grouped[group].map(({ tab, posIndex }) => {
                return (
                  <button
                    ref={(el) => {
                      tabRefs.current[posIndex] = el;
                    }}
                    aria-controls="studio-panel"
                    aria-selected={activeOutputTab === tab.id}
                    className="studio-tab"
                    id={`tab-${tab.id}`}
                    key={tab.id}
                    onClick={() => setActiveOutputTab(tab.id)}
                    onFocus={() => onPrefetchOutputTab?.(tab.id)}
                    onKeyDown={(event) => onTabKeyDown(event, posIndex)}
                    onPointerEnter={() => onPrefetchOutputTab?.(tab.id)}
                    role="tab"
                    tabIndex={activeOutputTab === tab.id ? 0 : -1}
                    title={tab.label}
                    type="button"
                  >
                    <span className="studio-tab__icon" aria-hidden="true">
                      {TAB_ICONS[tab.id]}
                    </span>
                    <span className="studio-tab__label">{tab.label}</span>
                    {tab.badge !== undefined ? <em>{tab.badge}</em> : null}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        {sidebarUtilities ? (
          <div
            className="studio-sidebar__utilities"
            role="group"
            aria-label="Workspace utilities"
          >
            {sidebarUtilities}
          </div>
        ) : null}
      </div>

      <section className="studio-main" aria-label="Selected output">
        <div
          className="studio-body"
          data-tab={activeOutputTab}
          id="studio-panel"
          role="tabpanel"
          aria-labelledby={`tab-${activeOutputTab}`}
        >
          {children}
        </div>

        {overlay}
      </section>
    </main>
  );
}
