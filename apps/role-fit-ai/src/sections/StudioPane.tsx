import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { BarChart3, ClipboardList, FileText, Mail } from "lucide-react";
import type { OutputTab, OutputTabDescriptor, OutputTabGroup } from "./shared";
import { TAB_GROUPS } from "./shared";

// Sidebar rail entries lead with a fixed icon per tab id.
const TAB_ICONS: Record<OutputTab, ReactNode> = {
  resume: <FileText size={15} aria-hidden="true" />,
  materials: <Mail size={15} aria-hidden="true" />,
  applications: <ClipboardList size={15} aria-hidden="true" />,
  analytics: <BarChart3 size={15} aria-hidden="true" />
};

type StudioPaneProps = {
  activeOutputTab: OutputTab;
  setActiveOutputTab: (tab: OutputTab) => void;
  outputTabs: OutputTabDescriptor[];
  children: ReactNode;
  footer?: ReactNode;
  overlay?: ReactNode;
};

export function StudioPane({
  activeOutputTab,
  setActiveOutputTab,
  outputTabs,
  children,
  footer,
  overlay
}: StudioPaneProps) {
  // APG tabs keyboard model: roving tabindex + arrow/Home/End move selection and
  // follow focus to the newly active tab.
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

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
  // Groups are rendered in first-seen order so the DRAFT / TRACK split is stable.
  const groupOrder: OutputTabGroup[] = [];
  const grouped: Record<OutputTabGroup, { tab: OutputTabDescriptor; posIndex: number }[]> = {
    DRAFT: [],
    TRACK: [],
  };
  outputTabs.forEach((tab, posIndex) => {
    const g: OutputTabGroup = tab.group ?? TAB_GROUPS[tab.id] ?? "DRAFT";
    if (!groupOrder.includes(g)) groupOrder.push(g);
    grouped[g].push({ tab, posIndex });
  });

  return (
    <main className="studio-pane" aria-label="Output workspace">
      <div className="studio-sidebar">
      <nav className="studio-tabs" role="tablist" aria-label="Output views">
        {groupOrder.map((group) => (
          <div className="studio-tabs__group" key={group}>
            <span className="studio-tabs__group-label" aria-hidden="true">
              {group}
            </span>
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
                  onKeyDown={(event) => onTabKeyDown(event, posIndex)}
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

        {footer}
        {overlay}
      </section>
    </main>
  );
}
