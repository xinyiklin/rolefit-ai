import { useMemo, useState, type ReactNode } from "react";
import type { Application, ApplicationStatus } from "../../hooks/useApplications";
import {
  ANALYTICS_PERIODS,
  cohortStageCounts,
  dayNumber,
  outcomeBreakdown,
  periodMetrics,
  previousApplications,
  registerRows,
  sentApplications,
  silenceBins,
  trackingHygiene,
  upcomingItems,
  type CohortStage
} from "../../lib/applicationAnalytics";
import { ActivityCard, type ActivityUnit } from "../analytics/ActivityCard";
import { AnalyticsHeadControls } from "../analytics/AnalyticsHeadControls";
import { KpiRow } from "../analytics/KpiRow";
import { NoResponseSection } from "../analytics/NoResponseSection";
import { SilenceCard } from "../analytics/SilenceCard";
import { StageDistribution } from "../analytics/StageDistribution";
import { UpcomingSection } from "../analytics/UpcomingSection";
import { useAnalyticsPeriod } from "../analytics/useAnalyticsPeriod";

type AnalyticsTabProps = {
  applications: Application[];
  loadError: string;
  // >0 while tracker writes are in flight.
  pendingWrites: number;
  // The tracker's current write error, "" when none. Distinct from loadError,
  // which is only the failure to load at all.
  trackerError: string;
  ghostedAfterDays: number;
  onGhostedAfterDaysChange: (days: number) => void;
  autoMarkGhosted: boolean;
  onAutoMarkGhostedChange: (enabled: boolean) => void;
  // One atomic bulk write resolving to how many were marked; null means it
  // failed and trackerError says why.
  onMarkGhosted: (ids: string[]) => Promise<number | null>;
  // Records auto-marked Ghosted this session; 0 shows nothing.
  autoMarkedCount: number;
  onDismissAutoMarked: () => void;
  onOpenApplication: (id: string) => void;
  onOpenApplications: () => void;
  // Opens Applications filtered to one stage.
  onViewStage: (status: ApplicationStatus) => void;
};

function PageHead({ children }: { children?: ReactNode }) {
  return (
    <header className="workspace-page__head an-head">
      <div>
        <h2 className="page-serif">Analytics</h2>
        <p className="an-head__lede">Track your search and find your next best move.</p>
      </div>
      {children}
    </header>
  );
}

const withTotal = (counts: Record<CohortStage, number>, total: number) => ({ ...counts, total });

function AnalyticsReport({
  applications,
  pendingWrites,
  ghostedAfterDays,
  onGhostedAfterDaysChange,
  onOpenApplication,
  onOpenApplications,
  onViewStage,
  ...noResponse
}: Omit<AnalyticsTabProps, "loadError">) {
  const [period, setPeriod] = useAnalyticsPeriod();
  const [traceId, setTraceId] = useState<string | null>(null);
  const [stage, setStage] = useState<ApplicationStatus | null>(null);
  const [unit, setUnit] = useState<ActivityUnit>("week");
  // Re-read the date on each render, but hand the memos a new Date only when
  // the day changes.
  const todayKey = dayNumber(new Date());
  const today = useMemo(() => new Date(), [todayKey]);

  const report = useMemo(() => {
    const cohort = sentApplications(applications, period, today);
    const previous = previousApplications(applications, period, today);
    const windowed = ANALYTICS_PERIODS.find((option) => option.id === period)?.weeks != null;
    const rows = registerRows(applications, period, ghostedAfterDays, today, windowed ? unit : "month");
    const oldest = rows[rows.length - 1];
    const counts = cohortStageCounts(cohort);
    return {
      rows,
      windowed,
      counts,
      total: cohort.length,
      previous: previous ? previous.length : null,
      window: ANALYTICS_PERIODS.find((option) => option.id === period)?.label ?? "",
      totals: periodMetrics(applications, period, today),
      outcomes: outcomeBreakdown(cohort, ghostedAfterDays, today),
      periodStart: oldest?.from ?? null,
      anySent: sentApplications(applications, "all", today).length > 0
    };
  }, [applications, period, unit, ghostedAfterDays, today]);
  const live = useMemo(() => ({
    ...upcomingItems(applications, today),
    silence: silenceBins(applications, ghostedAfterDays, today),
    missingFollowup: trackingHygiene(applications).missingFollowup
  }), [applications, ghostedAfterDays, today]);
  // A selected stage that emptied (its records moved, or the period changed)
  // lets go for good.
  if (stage && !report.counts[stage as CohortStage]) setStage(null);

  if (!report.anySent) {
    return (
      <section className="workspace-page analytics-page">
        <PageHead>
          <AnalyticsHeadControls ghostedAfterDays={ghostedAfterDays} onGhostedAfterDaysChange={onGhostedAfterDaysChange} />
        </PageHead>
        <div className="an-card analytics-blank">
          <p><strong>Nothing sent yet.</strong> Each application you send shows up here by week.</p>
          <button type="button" className="secondary-button is-compact" onClick={onOpenApplications}>
            Open Applications
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="workspace-page analytics-page">
      <PageHead>
        <AnalyticsHeadControls
          ghostedAfterDays={ghostedAfterDays}
          onGhostedAfterDaysChange={onGhostedAfterDaysChange}
          period={period}
          onPeriodChange={setPeriod}
        />
      </PageHead>

      <KpiRow counts={withTotal(report.counts, report.total)} previous={report.previous} window={report.window} />

      {/* One grid of bands so the columns end together: activity beside the
          callout and silence bars; the stage bar across; the attention list
          beside what is coming up. DOM order is the reading order. */}
      <div className="an-grid">
        <ActivityCard
          key={`${period}-${unit}`}
          rows={report.rows}
          unit={report.windowed ? unit : null}
          onUnitChange={setUnit}
          totals={report.totals}
          outcomes={report.outcomes}
          today={today}
          traceId={traceId}
          onOpenApplication={onOpenApplication}
        />
        <NoResponseSection
          {...noResponse}
          applications={applications}
          today={today}
          pendingWrites={pendingWrites}
          ghostedAfterDays={ghostedAfterDays}
          periodStart={report.periodStart}
          onOpenApplication={onOpenApplication}
          onTrace={setTraceId}
          middle={
            <>
              <SilenceCard bins={live.silence.bins} open={live.silence.open} />
              <StageDistribution counts={report.counts} total={report.total} selected={stage} onSelect={setStage} onViewStage={onViewStage} />
            </>
          }
        />
        <UpcomingSection
          interviews={live.interviews}
          followups={live.followups}
          missingFollowup={live.missingFollowup}
          onOpenApplication={onOpenApplication}
          onOpenApplications={onOpenApplications}
        />
      </div>
    </section>
  );
}

export function AnalyticsTab({ loadError, ...report }: AnalyticsTabProps) {
  if (loadError) {
    return (
      <section className="workspace-page analytics-page">
        <PageHead />
        <p className="pipeline-alert" role="status">Could not load applications: {loadError}</p>
        <div className="workspace-page__actions">
          <button type="button" className="secondary-button is-compact" onClick={report.onOpenApplications}>
            Open Applications to retry
          </button>
        </div>
      </section>
    );
  }
  return <AnalyticsReport {...report} />;
}
