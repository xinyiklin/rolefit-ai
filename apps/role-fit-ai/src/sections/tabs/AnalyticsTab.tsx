import { Fragment } from "react";
import type { Application } from "../../hooks/useApplications";
import { BOARD_STATUSES, STATUS_LABEL, statusCount } from "../../lib/applicationDisplay";
import { VERDICT_LABEL } from "../../lib/fitVerdict";
import {
  assessmentCoverage,
  fitVerdictDistribution,
  interviewProgressionByFitVerdict,
  monthlyApplicationsSent,
  recurringAdjacentCoreRequirements,
  recurringMissingCoreRequirements,
  recurringResumeVisibilityGaps,
  resumePolishModeDistribution,
  submissionReadinessDistribution,
  topTrackedCompanies,
  trackingHygiene
} from "../../lib/applicationAnalytics";

type AnalyticsTabProps = { applications: Application[]; onOpenApplications: () => void };

const READINESS_LABEL = {
  READY: "Ready",
  REVISIONS_RECOMMENDED: "Revisions recommended",
  EVIDENCE_NEEDED: "Evidence needed",
  NOT_READY: "Not ready"
} as const;

export function AnalyticsTab({ applications, onOpenApplications }: AnalyticsTabProps) {
  const total = applications.length;
  const months = monthlyApplicationsSent(applications);
  const maxMonthly = Math.max(1, ...months.map(([, row]) => row.applications));
  const verdicts = fitVerdictDistribution(applications);
  const progression = interviewProgressionByFitVerdict(applications);
  const gaps = recurringMissingCoreRequirements(applications);
  const adjacent = recurringAdjacentCoreRequirements(applications);
  const visibilityGaps = recurringResumeVisibilityGaps(applications);
  const companies = topTrackedCompanies(applications);
  const readiness = submissionReadinessDistribution(applications);
  const coverage = assessmentCoverage(applications);
  const polishMode = resumePolishModeDistribution(applications);
  const { missingFollowup, closed, submitted } = trackingHygiene(applications);

  return (
    <section className="workspace-page analytics-page">
      <header className="workspace-page__head"><h2 className="page-serif">Analytics</h2></header>

      <div className="figures-strip" aria-label="Analytics summary">
        {[["Tracked", total], ["Submitted", submitted], ["Interviewing", statusCount(applications, "interviewing")], ["Offers", statusCount(applications, "offer")], ["Assessed", coverage.assessed], ["Ready", readiness.find((row) => row.readiness === "READY")?.count ?? 0]].map(([label, value], index) => (
          <Fragment key={String(label)}>
            {index > 0 ? <span className="figures-strip__divider" aria-hidden="true" /> : null}
            <span className="figures-strip__item"><em>{label}</em><strong>{value}</strong></span>
          </Fragment>
        ))}
      </div>

      <div className="analytics-grid">
        <section className="analytics-panel analytics-panel--funnel analytics-panel--half">
          <header><h3>Current pipeline</h3><span className="analytics-panel__eyebrow">Current stage counts</span></header>
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
          <header><h3>Applications sent</h3><span className="analytics-panel__eyebrow">Last 6 active months</span></header>
          <div className="analytics-timeline" aria-label="Monthly applications sent">
            {months.length ? months.map(([month, row]) => (
              <div className="analytics-tick" key={month}>
                <span style={{ height: `${Math.max(8, Math.round((row.applications / maxMonthly) * 100))}%` }} />
                <strong>{row.applications}</strong><em>{row.label}</em>
              </div>
            )) : <p className="analytics-empty">No submitted applications yet.</p>}
          </div>
        </section>

        <section className="analytics-panel--flat analytics-panel--half">
          <p className="analytics-flat__head">Initial Fit mix</p>
          <dl className="ledger-rows">
            {verdicts.map(({ verdict, count }) => <div className="ledger-row" key={verdict}><dt>{VERDICT_LABEL[verdict]}</dt><span className="ledger-row__leader" aria-hidden="true" /><dd>{count}</dd></div>)}
          </dl>
        </section>

        <section className="analytics-panel--flat analytics-panel--half">
          <p className="analytics-flat__head">Interview progression by Initial Fit</p>
          <dl className="ledger-rows">
            {progression.map(({ verdict, submitted: count, progressed, rate }) => <div className="ledger-row" key={verdict}><dt>{VERDICT_LABEL[verdict]} · {progressed}/{count}</dt><span className="ledger-row__leader" aria-hidden="true" /><dd>{rate === null ? "—" : `${rate}%`}</dd></div>)}
          </dl>
          <p className="analytics-empty">Directional only: small samples and current-stage snapshots can be misleading.</p>
        </section>

        <section className="analytics-panel--flat analytics-panel--half">
          <p className="analytics-flat__head">Missing core requirements</p>
          {gaps.length ? <dl className="ledger-rows">{gaps.map(([requirement, count]) => <div className="ledger-row" key={requirement}><dt>{requirement}</dt><span className="ledger-row__leader" aria-hidden="true" /><dd>{count}</dd></div>)}</dl> : <p className="analytics-empty">No recurring missing core requirements yet.</p>}
        </section>

        <section className="analytics-panel--flat analytics-panel--half">
          <p className="analytics-flat__head">Adjacent core requirements</p>
          {adjacent.length ? <dl className="ledger-rows">{adjacent.map(([requirement, count]) => <div className="ledger-row" key={requirement}><dt>{requirement}</dt><span className="ledger-row__leader" aria-hidden="true" /><dd>{count}</dd></div>)}</dl> : <p className="analytics-empty">No recurring adjacent core requirements yet.</p>}
        </section>

        <section className="analytics-panel--flat analytics-panel--half">
          <p className="analytics-flat__head">Submission readiness</p>
          <dl className="ledger-rows">{readiness.map(({ readiness: value, count }) => <div className="ledger-row" key={value}><dt>{READINESS_LABEL[value]}</dt><span className="ledger-row__leader" aria-hidden="true" /><dd>{count}</dd></div>)}</dl>
        </section>

        <section className="analytics-panel--flat analytics-panel--half">
          <p className="analytics-flat__head">Assessment attention</p>
          <dl className="ledger-rows">
            <div className="ledger-row"><dt>Low-confidence assessments</dt><span className="ledger-row__leader" aria-hidden="true" /><dd>{coverage.lowConfidence}</dd></div>
            <div className="ledger-row"><dt>Unresolved eligibility</dt><span className="ledger-row__leader" aria-hidden="true" /><dd>{coverage.unresolvedEligibility}</dd></div>
            <div className="ledger-row"><dt>Adjacent core requirements</dt><span className="ledger-row__leader" aria-hidden="true" /><dd>{coverage.adjacentCore}</dd></div>
          </dl>
        </section>

        <section className="analytics-panel--flat analytics-panel--half">
          <p className="analytics-flat__head">Resume polish starts</p>
          <dl className="ledger-rows">
            <div className="ledger-row"><dt>Automatic</dt><span className="ledger-row__leader" aria-hidden="true" /><dd>{polishMode.automatic}</dd></div>
            <div className="ledger-row"><dt>Manual</dt><span className="ledger-row__leader" aria-hidden="true" /><dd>{polishMode.manual}</dd></div>
          </dl>
        </section>

        <section className="analytics-panel--flat analytics-panel--half">
          <p className="analytics-flat__head">Resume visibility gaps</p>
          {visibilityGaps.length ? <dl className="ledger-rows">{visibilityGaps.map(([requirement, count]) => <div className="ledger-row" key={requirement}><dt>{requirement}</dt><span className="ledger-row__leader" aria-hidden="true" /><dd>{count}</dd></div>)}</dl> : <p className="analytics-empty">No recurring visibility gaps yet.</p>}
        </section>

        <section className="analytics-panel--flat analytics-panel--half">
          <p className="analytics-flat__head">Tracking hygiene</p>
          <dl className="ledger-rows">
            <div className="ledger-row"><dt>Open roles without follow-up dates</dt><span className="ledger-row__leader" aria-hidden="true" /><dd>{missingFollowup}</dd></div>
            <div className="ledger-row"><dt>Closed roles</dt><span className="ledger-row__leader" aria-hidden="true" /><dd>{closed}</dd></div>
          </dl>
          <p className="analytics-flat__head">Top companies <button type="button" className="ghost-button is-compact" onClick={onOpenApplications}>View all</button></p>
          {companies.length ? <dl className="ledger-rows">{companies.map(([company, count]) => <div className="ledger-row" key={company}><dt>{company}</dt><span className="ledger-row__leader" aria-hidden="true" /><dd>{count}</dd></div>)}</dl> : <p className="analytics-empty">No tracked companies yet.</p>}
        </section>
      </div>
    </section>
  );
}
