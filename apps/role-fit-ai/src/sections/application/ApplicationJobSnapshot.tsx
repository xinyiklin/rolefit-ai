import { memo, useMemo } from "react";
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

  return (
    <section className="application-job-snapshot__part">
      <h5>{title}</h5>
      {collapsed ? (
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
  application
}: {
  application: Application;
}) {
  const snapshot = useMemo(() => {
    const preparedText = application.jobDescription?.trim() ?? "";
    const sourceText = application.rawJobDescription?.trim() || preparedText;
    const brief = removePreparedJobRoleSummary(
      buildPreparedJobBrief(preparedText, preparedText),
      application.roleDescription
    );
    const overview = uniqueProse([application.roleDescription, brief.companyContext]);
    const sectionCount = [
      overview,
      brief.responsibilities,
      brief.requiredQualifications,
      brief.preferredQualifications,
      brief.benefits,
      brief.techKeywords,
      brief.senioritySignals,
      brief.domainSignals
    ].filter((section) => section.length).length;
    const hasListSections = Boolean(
      brief.responsibilities.length
      || brief.requiredQualifications.length
      || brief.preferredQualifications.length
      || brief.benefits.length
    );

    return {
      brief,
      overview,
      sectionCount,
      hasListSections,
      fullText: sourceText,
      fullTextLabel: application.rawJobDescription?.trim()
        ? "Full source posting"
        : "Full prepared text"
    };
  }, [application.jobDescription, application.rawJobDescription, application.roleDescription]);

  if (!snapshot.sectionCount && !snapshot.fullText) return null;

  if (!snapshot.sectionCount) {
    return (
      <details className="application-job-snapshot application-job-snapshot--source-only application-job-card application-job-card--wide">
        <summary aria-label={`Job snapshot, ${snapshot.fullTextLabel}`}>
          <span>Job snapshot</span>
          <small>{snapshot.fullTextLabel}</small>
        </summary>
        <pre tabIndex={0} role="region" aria-label={snapshot.fullTextLabel}>
          {snapshot.fullText}
        </pre>
      </details>
    );
  }

  return (
    <details className="application-job-snapshot application-job-card application-job-card--wide">
      <summary aria-label={`Job snapshot, ${snapshot.sectionCount} ${snapshot.sectionCount === 1 ? "section" : "sections"}`}>
        <span>Job snapshot</span>
        <small>{snapshot.sectionCount} {snapshot.sectionCount === 1 ? "section" : "sections"}</small>
      </summary>
      <div className="application-job-snapshot__content">
        {snapshot.overview.length ? (
          <section className="application-job-snapshot__overview">
            <h5>Overview</h5>
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

        {snapshot.fullText ? (
          <details className="application-job-snapshot__source">
            <summary>{snapshot.fullTextLabel}</summary>
            <pre tabIndex={0} role="region" aria-label={snapshot.fullTextLabel}>
              {snapshot.fullText}
            </pre>
          </details>
        ) : null}
      </div>
    </details>
  );
});
