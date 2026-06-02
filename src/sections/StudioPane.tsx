import type { ReactNode } from "react";
import { scoreLabel, type OutputTab, type OutputTabDescriptor } from "./shared";

type StudioPaneProps = {
  activeOutputTab: OutputTab;
  setActiveOutputTab: (tab: OutputTab) => void;
  outputTabs: OutputTabDescriptor[];
  headlineScore: number | null;
  children: ReactNode;
  footer: ReactNode;
};

export function StudioPane({
  activeOutputTab,
  setActiveOutputTab,
  outputTabs,
  headlineScore,
  children,
  footer
}: StudioPaneProps) {
  return (
    <main className="studio-pane" aria-label="Output workspace">
      <header className="studio-header">
        <nav className="studio-tabs" role="tablist" aria-label="Output views">
          {outputTabs.map((tab) => (
            <button
              aria-controls={`panel-${tab.id}`}
              aria-selected={activeOutputTab === tab.id}
              className="studio-tab"
              id={`tab-${tab.id}`}
              key={tab.id}
              onClick={() => setActiveOutputTab(tab.id)}
              role="tab"
              type="button"
            >
              <span>{tab.label}</span>
              {tab.badge !== undefined ? <em>{tab.badge}</em> : null}
            </button>
          ))}
        </nav>
        <div className="studio-score" aria-live="polite">
          <span className="studio-score__label">Fit</span>
          <strong className="studio-score__value">{headlineScore ?? "--"}</strong>
          <span className="studio-score__sub">
            {headlineScore !== null ? scoreLabel(headlineScore) : "Awaiting"}
          </span>
        </div>
      </header>

      <div
        className="studio-body"
        id={`panel-${activeOutputTab}`}
        role="tabpanel"
        aria-labelledby={`tab-${activeOutputTab}`}
      >
        {children}
      </div>

      {footer}
    </main>
  );
}
