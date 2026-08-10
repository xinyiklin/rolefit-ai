import type { ReactNode } from "react";

type ProposalDecisionBarProps = {
  // What the user is deciding, in this document's own unit. The resume counts
  // individual edits; the letter is one replacement. The sentence differs, the
  // place it appears and the controls beside it do not.
  summary: string;
  // Only meaningful when a document's proposal carries more than one decision.
  progress?: { decided: number; total: number };
  children: ReactNode;
};

// The one place either document's accept/discard decision lives. It sits in the
// shared workflow rail's sticky footer so the commit control stays reachable
// while the user scrolls the proposal itself.
export function ProposalDecisionBar({ summary, progress, children }: ProposalDecisionBarProps) {
  const meter = progress && progress.total > 1 ? progress : null;
  return (
    <div className="proposal-decisions">
      <div className="proposal-decisions__state">
        <p>{summary}</p>
        {meter ? (
          <span
            className="proposal-decisions__meter"
            role="progressbar"
            aria-valuenow={meter.decided}
            aria-valuemin={0}
            aria-valuemax={meter.total}
            aria-label="Edits decided"
          >
            <span style={{ inlineSize: `${Math.round((meter.decided / meter.total) * 100)}%` }} />
          </span>
        ) : null}
      </div>
      <div className="proposal-decisions__actions">{children}</div>
    </div>
  );
}
