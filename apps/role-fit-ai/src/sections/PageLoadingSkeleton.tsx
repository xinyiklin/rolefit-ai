import type { ReactNode } from "react";

function Shape({ className = "" }: { className?: string }) {
  return <span className={`page-loading__shape ${className}`} />;
}

function LoadingPage({
  title,
  className,
  children
}: {
  title: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <section className={`workspace-page page-loading ${className}`}>
      <header className="workspace-page__head">
        <h2 className="page-serif">{title}</h2>
        <p className="page-loading__status" role="status">Loading {title.toLowerCase()}…</p>
      </header>
      {children}
    </section>
  );
}

function PlaceholderLines() {
  return (
    <div className="page-loading__lines">
      <Shape className="page-loading__line--short" />
      <Shape />
      <Shape className="page-loading__line--medium" />
    </div>
  );
}

function TableCells() {
  return (
    <>
      <Shape className="page-loading__line--medium" />
      <Shape />
      <Shape className="page-loading__line--medium" />
      <Shape className="page-loading__line--medium" />
      <Shape className="applications-table__cell--next-action" />
      <Shape className="page-loading__line--medium" />
      <Shape />
    </>
  );
}

function PlaceholderFacts({ count }: { count: number }) {
  return (
    <div className="page-loading__lines">
      {Array.from({ length: count }, (_, row) => (
        <div className="page-loading__fact" key={row}>
          <Shape />
          <Shape className="page-loading__line--medium" />
        </div>
      ))}
    </div>
  );
}

export function ApplicationsLoadingSkeleton({ view }: { view: "table" | "calendar" }) {
  return (
    <LoadingPage title="Applications" className="applications-page">
      <div className="workspace-toolbar workspace-toolbar--tracker page-loading__pulse" aria-hidden="true" aria-busy="true">
        <Shape className="page-loading__control" />
        <div className="page-loading__controls">
          <Shape className="page-loading__control" />
          <Shape className="page-loading__control" />
        </div>
      </div>
      <div className="tracker-layout page-loading__pulse" aria-hidden="true" aria-busy="true">
        <div className="applications-table-wrap">
          {view === "calendar" ? (
            <div className="page-loading__calendar">
              <Shape className="page-loading__calendar-title" />
              <div className="page-loading__days">
                {Array.from({ length: 35 }, (_, day) => (
                  <div className="page-loading__day" key={day}><Shape /></div>
                ))}
              </div>
            </div>
          ) : (
            <div className="applications-table page-loading__table">
              <div className="applications-table__head">
                <div className="applications-table__row applications-table__row--head">
                  <TableCells />
                </div>
              </div>
              <div className="applications-table__body">
                {Array.from({ length: 8 }, (_, row) => (
                  <div className="applications-table__row" key={row}>
                    <TableCells />
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="page-loading__pagination">
            <Shape />
            <Shape />
          </div>
        </div>
        <div className="pipeline-inspector page-loading__inspector">
          <div className="page-loading__identity">
            <Shape className="page-loading__company-mark" />
            <PlaceholderLines />
          </div>
          <div className="page-loading__rail-section">
            <PlaceholderFacts count={5} />
          </div>
          <div className="page-loading__rail-section">
            <PlaceholderLines />
          </div>
          <div className="page-loading__rail-section">
            <Shape className="page-loading__line--short" />
            <PlaceholderFacts count={3} />
          </div>
          <div className="page-loading__rail-section page-loading__controls">
            <Shape className="page-loading__action" />
            <Shape className="page-loading__action" />
          </div>
        </div>
      </div>
    </LoadingPage>
  );
}

export function AnalyticsLoadingSkeleton() {
  return (
    <LoadingPage title="Analytics" className="analytics-page">
      <div className="figures-strip page-loading__pulse" aria-hidden="true" aria-busy="true">
        {Array.from({ length: 4 }, (_, figure) => (
          <div className="figures-strip__item page-loading__figure" key={figure}>
            <Shape />
            <Shape className="page-loading__number" />
          </div>
        ))}
      </div>
      <div className="analytics-grid page-loading__pulse" aria-hidden="true" aria-busy="true">
        {Array.from({ length: 4 }, (_, panel) => (
          <div
            className={`${panel < 2 ? "analytics-panel" : "analytics-panel--flat"} analytics-panel--half page-loading__report`}
            key={panel}
          >
            <PlaceholderLines />
            <PlaceholderLines />
          </div>
        ))}
      </div>
    </LoadingPage>
  );
}
