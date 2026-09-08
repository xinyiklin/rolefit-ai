import { useState } from "react";
import type { useApplicationReview } from "../../../hooks/useApplicationReview";
import { AiWorkflowProgress } from "../../AiWorkflowProgress";

export function ApplicationReview({
  review,
  providerLabel,
  onSettings,
  onOpenDocument,
  pendingProposals,
  disabled
}: {
  review: ReturnType<typeof useApplicationReview>;
  providerLabel: string;
  onSettings: () => void;
  onOpenDocument: (document: "resume" | "coverLetter") => void;
  pendingProposals: boolean;
  disabled: boolean;
}) {
  const [progressHidden, setProgressHidden] = useState(false);
  const { receipt, status, stale } = review;
  const running = status === "running";
  const result = receipt?.result;
  return (
    <section className="prepare-fit" aria-label="Review final application">
      <p className="prepare-page__eyebrow">Review final application</p>
      <p>Review the current included documents before applying. This review is advisory.</p>
      <button type="button" className="ghost-button is-compact" onClick={onSettings}>
        {providerLabel} · Settings
      </button>
      {pendingProposals ? (
        <p className="prepare-note">
          Pending proposals are not included. Accept edits first to review them.
        </p>
      ) : null}
      {running && !progressHidden ? (
        <AiWorkflowProgress
          title="Final application review"
          busy
          stages={[{ key: "final-review", state: { status: "running" }, onStop: review.stop }]}
          onDismiss={() => setProgressHidden(true)}
          suspendExpiry
        />
      ) : null}
      {status === "stopped" ? (
        <p role="status">Review stopped. Run it again for the current materials.</p>
      ) : null}
      {result ? (
        <div aria-live="polite">
          <p className="prepare-fit__meta">
            {stale ? "Previous inputs · " : ""}
            {new Date(result.completedAt).toLocaleString()}
          </p>
          <p>
            {result.reviewedDocuments.length
              ? `Materials: ${result.reviewedDocuments.map((doc) => (doc === "resume" ? "Resume" : "Cover letter")).join(", ")}`
              : "No readable materials reviewed."}
          </p>
          {result.error ? <p className="prepare-note is-warn">{result.error}</p> : null}
          {!result.complete && !running ? (
            <p className="prepare-note is-warn">
              Review incomplete{result.overflow ? "; additional findings remain" : ""}. Check the
              materials yourself or retry.
            </p>
          ) : null}
          {!result.findings.length && result.complete ? (
            <p>No issues found in this review.</p>
          ) : null}
          <ul className="fit-assessment-list">
            {result.findings.map((finding, index) => (
              <li key={index}>
                <strong>{finding.message}</strong>
                {review.findingStale(finding) ? <small>Changed since review</small> : null}
                <p>{finding.recovery}</p>
                {finding.anchor || finding.sourceExcerpt ? (
                  <details>
                    <summary>Source details</summary>
                    {finding.anchor ? <blockquote>{finding.anchor}</blockquote> : null}
                    {finding.sourceExcerpt ? (
                      <blockquote>{finding.sourceExcerpt}</blockquote>
                    ) : null}
                  </details>
                ) : null}
                {finding.document !== "application" ? (
                  <button
                    type="button"
                    className="ghost-button is-compact"
                    onClick={() => onOpenDocument(finding.document as "resume" | "coverLetter")}
                  >
                    Open {finding.document === "resume" ? "Resume" : "Cover letter"}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {review.previous && (status === "failed" || status === "stopped") ? (
        <details>
          <summary>Previous completed review</summary>
          <p>
            {new Date(review.previous.result.completedAt).toLocaleString()} · Previous materials
          </p>
          <ul>
            {review.previous.result.findings.map((finding, index) => (
              <li key={index}>{finding.message}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <button
        type="button"
        className="secondary-button is-compact"
        onClick={running ? review.stop : () => { setProgressHidden(false); void review.run(); }}
        disabled={!running && disabled}
      >
        {running ? "Stop review" : result ? "Review again" : "Review final application"}
      </button>
    </section>
  );
}
