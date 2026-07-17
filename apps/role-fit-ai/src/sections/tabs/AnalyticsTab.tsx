import { BarChart3, Sparkles, TrendingUp } from "lucide-react";
import type { Application, ApplicationStatus } from "../../hooks/useApplications";
import {
  BOARD_STATUSES,
  STATUS_LABEL,
  averageFit,
  averageLift,
  displayCompany,
  fitScore,
  fitTone,
  formatCompactDate,
  parseDate,
  statusCount
} from "../../lib/applicationDisplay";

type AnalyticsTabProps = {
  applications: Application[];
  onOpenApplications: () => void;
};

function percent(part: number, whole: number) {
  return whole ? Math.round((part / whole) * 1000) / 10 : 0;
}

function monthBucket(date: Date) {
  // "Jun '26", not "Jun 26" — a bare 2-digit year reads as a day of month.
  return `${date.toLocaleDateString([], { month: "short" })} '${String(date.getFullYear()).slice(-2)}`;
}

function monthlyActivity(applications: Application[]) {
  // Keyed by sortable YYYY-MM (applications arrive in storage order, not
  // date order) so "last 6 months" means calendar-recent, oldest to newest.
  const buckets = new Map<string, { label: string; applications: number; responses: number; interviews: number; offers: number }>();
  for (const app of applications) {
    const date = parseDate(app.appliedAt || app.createdAt) ?? new Date();
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const row = buckets.get(key) ?? { label: monthBucket(date), applications: 0, responses: 0, interviews: 0, offers: 0 };
    row.applications += 1;
    if (app.status !== "interested" && app.status !== "applied") row.responses += 1;
    if (app.status === "interviewing" || app.status === "offer") row.interviews += 1;
    if (app.status === "offer") row.offers += 1;
    buckets.set(key, row);
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6);
}

function topCompanies(applications: Application[]) {
  const counts = new Map<string, number>();
  for (const app of applications) counts.set(displayCompany(app), (counts.get(displayCompany(app)) ?? 0) + 1);
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
}

function gapKeywords(applications: Application[]) {
  const counts = new Map<string, number>();
  for (const app of applications) {
    for (const gap of app.missingRequiredSkills ?? []) {
      counts.set(gap.keyword, (counts.get(gap.keyword) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
}

function responseDays(applications: Application[]) {
  const values = applications
    .map((app) => {
      const applied = parseDate(app.appliedAt);
      const updated = parseDate(app.updatedAt);
      if (!applied || !updated || updated <= applied) return null;
      return Math.max(1, Math.round((updated.getTime() - applied.getTime()) / 86_400_000));
    })
    .filter((value): value is number => typeof value === "number");
  if (!values.length) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function statusHeight(applications: Application[], status: ApplicationStatus) {
  const max = Math.max(1, ...BOARD_STATUSES.map((item) => statusCount(applications, item)));
  return Math.max(8, Math.round((statusCount(applications, status) / max) * 100));
}

export function AnalyticsTab({ applications, onOpenApplications }: AnalyticsTabProps) {
  const total = applications.length;
  const responses = applications.filter((app) => !["interested", "applied"].includes(app.status)).length;
  const interviews = applications.filter((app) => app.status === "interviewing" || app.status === "offer").length;
  const offers = statusCount(applications, "offer");
  const avgFit = averageFit(applications);
  const lift = averageLift(applications);
  const avgResponse = responseDays(applications);
  const months = monthlyActivity(applications);
  const maxMonthly = Math.max(1, ...months.map(([, row]) => row.applications));
  const bestApp = applications
    .filter((app) => fitScore(app) !== null)
    .sort((a, b) => Number(fitScore(b)) - Number(fitScore(a)))[0];
  const gaps = gapKeywords(applications);

  return (
    <section className="workspace-page analytics-page">
      <header className="workspace-page__head">
        <h2 className="page-serif">Analytics</h2>
      </header>

      <div className="figures-strip" aria-label="Analytics summary">
        <span className="figures-strip__item">
          <em>Total</em>
          <strong>{total}</strong>
        </span>
        <span className="figures-strip__divider" aria-hidden="true" />
        <span className="figures-strip__item">
          <em>Response rate</em>
          <strong>{percent(responses, total)}%</strong>
        </span>
        <span className="figures-strip__divider" aria-hidden="true" />
        <span className="figures-strip__item">
          <em>Interview rate</em>
          <strong>{percent(interviews, total)}%</strong>
        </span>
        <span className="figures-strip__divider" aria-hidden="true" />
        <span className="figures-strip__item">
          <em>Offer rate</em>
          <strong>{percent(offers, total)}%</strong>
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
        <span className="figures-strip__divider" aria-hidden="true" />
        <span className="figures-strip__item">
          <em>Avg response</em>
          <strong>{avgResponse === null ? "--" : `${avgResponse}d`}</strong>
        </span>
      </div>

      <div className="analytics-grid">
        <section className="analytics-panel analytics-panel--funnel analytics-panel--wide">
          <header>
            <h3>Application pipeline</h3>
            <span className="analytics-panel__eyebrow">Conversion: {percent(offers, Math.max(total, 1))}%</span>
          </header>
          <div className="analytics-funnel">
            {BOARD_STATUSES.filter((status) => status !== "withdrawn").map((status) => (
              <div className={`analytics-funnel__row analytics-funnel__row--${status}`} key={status}>
                <span>{STATUS_LABEL[status]}</span>
                <i style={{ width: `${Math.max(8, percent(statusCount(applications, status), Math.max(total, 1)))}%` }} />
                <strong>{statusCount(applications, status)}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="analytics-panel analytics-panel--narrow">
          <header>
            <h3>Stage distribution</h3>
            <span className="analytics-panel__eyebrow">By count</span>
          </header>
          <div className="analytics-bars" aria-label="Stage distribution">
            {BOARD_STATUSES.map((status) => (
              <div className="analytics-bar" key={status}>
                <span style={{ height: `${statusHeight(applications, status)}%` }} />
                <strong>{statusCount(applications, status)}</strong>
                <em>{STATUS_LABEL[status]}</em>
              </div>
            ))}
          </div>
        </section>

        <section className="analytics-panel analytics-panel--narrow">
          <header>
            <h3>Activity over time</h3>
            <span className="analytics-panel__eyebrow">Last 6 months</span>
          </header>
          <div className="analytics-timeline" aria-label="Monthly application activity">
            {months.length ? (
              months.map(([month, row]) => (
                <div className="analytics-tick" key={month}>
                  <span style={{ height: `${Math.max(8, Math.round((row.applications / maxMonthly) * 100))}%` }} />
                  <strong>{row.applications}</strong>
                  <em>{row.label}</em>
                </div>
              ))
            ) : (
              <p className="analytics-empty">No dated activity yet.</p>
            )}
          </div>
        </section>

        <section className="analytics-panel--flat analytics-panel--half">
          <p className="analytics-flat__head">Top companies <button type="button" className="ghost-button is-compact" onClick={onOpenApplications}>View all</button></p>
          {topCompanies(applications).length ? (
            <dl className="ledger-rows">
              {topCompanies(applications).map(([company, count]) => (
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
          <p className="analytics-flat__head">Recommendations</p>
          <div className="analytics-recs">
            <div><Sparkles size={14} aria-hidden="true" /><span>Tailor saved high-fit roles</span><em>{applications.filter((app) => fitScore(app) !== null && Number(fitScore(app)) >= 80).length} opportunities</em></div>
            <div><TrendingUp size={14} aria-hidden="true" /><span>Add follow-up dates</span><em>{applications.filter((app) => !app.followupAt && !["rejected", "withdrawn"].includes(app.status)).length} missing</em></div>
            <div><BarChart3 size={14} aria-hidden="true" /><span>Review stage drop-off</span><em>{statusCount(applications, "rejected")} rejected</em></div>
          </div>
        </section>
      </div>
    </section>
  );
}
