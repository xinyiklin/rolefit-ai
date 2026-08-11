import { memo, useMemo } from "react";
import { ArrowRight, FileText } from "lucide-react";
import type { Application } from "../../hooks/useApplications";
import {
  buildPreparedJobBrief,
  removePreparedJobRoleSummary
} from "../../lib/preparedJobBrief";

const VISIBLE_LIST_ITEMS = 4;

function uniqueProse(values: Array<string | undefined>) {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) return [];
    seen.add(key);
    return [text];
  });
}

function SnapshotList({
  title,
  items,
  collapsed = false
}: {
  title: string;
  items: string[];
  collapsed?: boolean;
}) {
  if (!items.length) return null;
  const visibleItems = items.slice(0, VISIBLE_LIST_ITEMS);
  const remainingItems = items.slice(VISIBLE_LIST_ITEMS);
  const fullyCollapsed = collapsed && items.length > VISIBLE_LIST_ITEMS;

  return (
    <section className="application-job-snapshot__part">
      <h4>{title}</h4>
      {fullyCollapsed ? (
        <details className="application-job-snapshot__more">
          <summary>{items.length} saved {items.length === 1 ? "detail" : "details"}</summary>
          <ul>
            {items.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </details>
      ) : (
        <>
          <ul>
            {visibleItems.map((item) => <li key={item}>{item}</li>)}
          </ul>
          {remainingItems.length ? (
            <details className="application-job-snapshot__more">
              <summary>{remainingItems.length} more</summary>
              <ul>
                {remainingItems.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </details>
          ) : null}
        </>
      )}
    </section>
  );
}

export const ApplicationJobSnapshot = memo(function ApplicationJobSnapshot({
  application,
  onViewPosting
}: {
  application: Application;
  onViewPosting: () => void;
}) {
  const snapshot = useMemo(() => {
    const preparedText = application.jobDescription?.trim() ?? "";
    const sourceText = application.rawJobDescription?.trim() || preparedText;
    const brief = removePreparedJobRoleSummary(
      buildPreparedJobBrief(preparedText, preparedText),
      application.roleDescription
    );
    const overview = uniqueProse([application.roleDescription, brief.companyContext]);
    const hasStructuredSections = [
      overview,
      brief.responsibilities,
      brief.requiredQualifications,
      brief.preferredQualifications,
      brief.benefits,
      brief.techKeywords,
      brief.senioritySignals,
      brief.domainSignals
    ].some((section) => section.length);
    const hasListSections = Boolean(
      brief.responsibilities.length
      || brief.requiredQualifications.length
      || brief.preferredQualifications.length
      || brief.benefits.length
    );

    return {
      brief,
      overview,
      hasStructuredSections,
      hasListSections,
      hasPostingText: Boolean(sourceText)
    };
  }, [application.jobDescription, application.rawJobDescription, application.roleDescription]);

  return (
    <section className="application-job-snapshot application-job-card application-job-card--wide" aria-labelledby="application-job-snapshot-title">
      <header className="application-job-snapshot__head">
        <h3 id="application-job-snapshot-title"><FileText size={16} aria-hidden="true" />Job snapshot</h3>
        <div className="application-job-snapshot__actions">
          <button type="button" className="ghost-button is-compact" onClick={onViewPosting}>
            View posting <ArrowRight size={13} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="application-job-snapshot__content">
        {!snapshot.hasStructuredSections ? (
          <p className="application-job-snapshot__empty">
            {snapshot.hasPostingText
              ? "A structured snapshot was not saved. View posting opens the available text."
              : "No job snapshot was saved with this record."}
          </p>
        ) : null}

        {snapshot.overview.length ? (
          <section className="application-job-snapshot__overview">
            <h4>Overview</h4>
            {snapshot.overview.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          </section>
        ) : null}

        {snapshot.hasListSections ? (
          <div className="application-job-snapshot__grid">
            <SnapshotList title="Responsibilities" items={snapshot.brief.responsibilities} />
            <SnapshotList title="Required qualifications" items={snapshot.brief.requiredQualifications} />
            <SnapshotList title="Preferred qualifications" items={snapshot.brief.preferredQualifications} />
            <SnapshotList title="Benefits & policies" items={snapshot.brief.benefits} collapsed />
          </div>
        ) : null}

        {snapshot.brief.techKeywords.length
          || snapshot.brief.senioritySignals.length
          || snapshot.brief.domainSignals.length ? (
          <dl className="application-job-snapshot__signals">
            {snapshot.brief.techKeywords.length ? (
              <div><dt>Tools & keywords</dt><dd>{snapshot.brief.techKeywords.join(" · ")}</dd></div>
            ) : null}
            {snapshot.brief.senioritySignals.length ? (
              <div><dt>Seniority signals</dt><dd>{snapshot.brief.senioritySignals.join(" · ")}</dd></div>
            ) : null}
            {snapshot.brief.domainSignals.length ? (
              <div><dt>Domain signals</dt><dd>{snapshot.brief.domainSignals.join(" · ")}</dd></div>
            ) : null}
          </dl>
        ) : null}

      </div>
    </section>
  );
});
