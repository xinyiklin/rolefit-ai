import type { CSSProperties, ReactNode } from "react";

function Shape({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return <span className={`page-loading__shape ${className}`} style={style} />;
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

// Shaped like the report's top: the KPI row, then the activity chart beside
// the No response callout and the silence bars.
export function AnalyticsLoadingSkeleton() {
  return (
    <LoadingPage title="Analytics" className="analytics-page">
      <div className="an-kpis page-loading__pulse" aria-hidden="true">
        {[1, 3, 1, 1, 2].map((size, group) => (
          <div className={`an-kpi-group${size === 1 ? " is-single" : ""}`} key={group} style={{ flexGrow: size, "--n": size } as CSSProperties}>
            {Array.from({ length: size }, (_, figure) => (
              <div className="an-kpi" key={figure}>
                <Shape className="page-loading__line--short" />
                <Shape className="page-loading__line--short" />
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="an-grid page-loading__pulse" aria-hidden="true" aria-busy="true">
        <div className="an-card an-activity">
          <Shape className="page-loading__line--short" />
          <PlaceholderLines />
          <div className="page-loading__columns">
            {[30, 45, 20, 60, 75, 40, 55, 90, 65, 35, 80, 25].map((height, column) => (
              <Shape className="page-loading__column" key={column} style={{ height: `${height}%` }} />
            ))}
          </div>
        </div>
        <div className="an-card an-callout is-clear">
          <Shape className="page-loading__line--short" />
          <PlaceholderLines />
        </div>
        <div className="an-card an-silence">
          <Shape className="page-loading__line--short" />
          <PlaceholderLines />
          <PlaceholderLines />
        </div>
      </div>
    </LoadingPage>
  );
}
