import type { Application } from "../../hooks/useApplications";
import {
  BOARD_STATUSES,
  STATUS_LABEL,
  averageFit,
  averageLift,
  displayCompany,
  fitScore,
  fitTone,
  formatCompactDate,
  statusCount
} from "../../lib/applicationDisplay";
import {
  highestFitApplication,
  monthlyApplicationsSent,
  recurringSkillGaps,
  topTrackedCompanies,
  trackingHygiene
} from "../../lib/applicationAnalytics";

type AnalyticsTabProps = {
  applications: Application[];
  onOpenApplications: () => void;
};

export function AnalyticsTab({ applications, onOpenApplications }: AnalyticsTabProps) {
  const total = applications.length;
  const interviews = statusCount(applications, "interviewing");
  const offers = statusCount(applications, "offer");
  const avgFit = averageFit(applications);
  const lift = averageLift(applications);
  const months = monthlyApplicationsSent(applications);
  const maxMonthly = Math.max(1, ...months.map(([, row]) => row.applications));
  const bestApp = highestFitApplication(applications);
  const gaps = recurringSkillGaps(applications);
  const companies = topTrackedCompanies(applications);
  const { highFit, missingFollowup, closed, submitted } = trackingHygiene(applications);

  return (
    <section className="workspace-page analytics-page">
      <header className="workspace-page__head">
        <h2 className="page-serif">Analytics</h2>
      </header>

      <div className="figures-strip" aria-label="Analytics summary">
        <span className="figures-strip__item">
          <em>Tracked</em>
          <strong>{total}</strong>
        </span>
        <span className="figures-strip__divider" aria-hidden="true" />
        <span className="figures-strip__item">
          <em>Submitted</em>
          <strong>{submitted}</strong>
        </span>
        <span className="figures-strip__divider" aria-hidden="true" />
        <span className="figures-strip__item">
          <em>Interviewing</em>
          <strong>{interviews}</strong>
        </span>
        <span className="figures-strip__divider" aria-hidden="true" />
        <span className="figures-strip__item">
          <em>Offers</em>
          <strong>{offers}</strong>
        </span>
        <span className="figures-strip__divider" aria-hidden="true" />
        <span className="figures-strip__item">
          <em>Avg fit</em>
          <strong>{avgFit === null ? "--" : `${avgFit}%`}</strong>
        </span>
        <span className="figures-strip__divider" aria-hidden="true" />
        <span className="figures-strip__item">
          <em>Avg lift</em>
          <strong className={lift === null ? "" : lift >= 0 ? "figures-strip__lift--up" : "figures-strip__lift--down"}>
            {lift === null ? "--" : `${lift >= 0 ? "+" : ""}${lift}pt`}
          </strong>
        </span>
      </div>

      <div className="analytics-grid">
        <section className="analytics-panel analytics-panel--funnel analytics-panel--half">
          <header>
            <h3>Current pipeline</h3>
            <span className="analytics-panel__eyebrow">Current stage counts</span>
          </header>
          <div className="analytics-funnel">
            {BOARD_STATUSES.filter((status) => status !== "withdrawn").map((status) => (
              <div className={`analytics-funnel__row analytics-funnel__row--${status}`} key={status}>
                <span>{STATUS_LABEL[status]}</span>
                <i style={{ width: `${Math.max(8, Math.round((statusCount(applications, status) / Math.max(total, 1)) * 100))}%` }} />
                <strong>{statusCount(applications, status)}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="analytics-panel analytics-panel--half">
          <header>
            <h3>Applications sent</h3>
            <span className="analytics-panel__eyebrow">Last 6 active months</span>
          </header>
          <div className="analytics-timeline" aria-label="Monthly applications sent">
            {months.length ? (
              months.map(([month, row]) => (
                <div className="analytics-tick" key={month}>
                  <span style={{ height: `${Math.max(8, Math.round((row.applications / maxMonthly) * 100))}%` }} />
                  <strong>{row.applications}</strong>
                  <em>{row.label}</em>
                </div>
              ))
            ) : (
              <p className="analytics-empty">No submitted applications yet.</p>
            )}
          </div>
        </section>

        <section className="analytics-panel--flat analytics-panel--half">
          <p className="analytics-flat__head">Top companies <button type="button" className="ghost-button is-compact" onClick={onOpenApplications}>View all</button></p>
          {companies.length ? (
            <dl className="ledger-rows">
              {companies.map(([company, count]) => (
                <div className="ledger-row" key={company}>
                  <dt>{company}</dt>
                  <span className="ledger-row__leader" aria-hidden="true" />
                  <dd>{count}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="analytics-empty">Add applications to see company patterns.</p>
          )}
        </section>

        <section className="analytics-panel--flat analytics-panel--half">
          <p className="analytics-flat__head">Gaps to address</p>
          {gaps.length ? (
            <dl className="ledger-rows">
              {gaps.map(([keyword, count]) => (
                <div className="ledger-row" key={keyword}>
                  <dt>{keyword}</dt>
                  <span className="ledger-row__leader" aria-hidden="true" />
                  <dd>{count}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="analytics-empty">Polish roles to collect gap analysis.</p>
          )}
        </section>

        <section className="analytics-panel--flat analytics-panel--half">
          <p className="analytics-flat__head">Best current fit</p>
          {bestApp ? (
            <div className="analytics-best-inline">
              <span className={`application-fit--${fitTone(fitScore(bestApp))} analytics-best-score`}>{fitScore(bestApp)}%</span>
              <div>
                <strong>{displayCompany(bestApp)}</strong>
                <span>{bestApp.role || bestApp.title}</span>
                <em>Updated {formatCompactDate(bestApp.updatedAt)}</em>
              </div>
            </div>
          ) : (
            <p className="analytics-empty">No scored applications yet.</p>
          )}
        </section>

        <section className="analytics-panel--flat analytics-panel--half">
          <p className="analytics-flat__head">Tracking hygiene</p>
          <dl className="ledger-rows">
            <div className="ledger-row">
              <dt>High-fit scored roles</dt>
              <span className="ledger-row__leader" aria-hidden="true" />
              <dd>{highFit}</dd>
            </div>
            <div className="ledger-row">
              <dt>Open roles without follow-up dates</dt>
              <span className="ledger-row__leader" aria-hidden="true" />
              <dd>{missingFollowup}</dd>
            </div>
            <div className="ledger-row">
              <dt>Closed roles</dt>
              <span className="ledger-row__leader" aria-hidden="true" />
              <dd>{closed}</dd>
            </div>
          </dl>
        </section>
      </div>
    </section>
  );
}
