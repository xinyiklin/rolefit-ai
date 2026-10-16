import { useEffect, useState, type ReactNode } from "react";

import { formatElapsed } from "../../lib/aiWorkflow";
import {
  documentWorkflowLabel,
  type DocumentWorkflowStatus
} from "../../../shared/documentWorkflowContract.ts";

// Visual tone, not vocabulary: the shared contract owns which states exist and
// what they are called, and the rail only needs to know which ones read as a
// problem. Keeping this map small is what stops ten states from becoming ten
// bespoke rail treatments.
const TONES: Record<DocumentWorkflowStatus["state"], "neutral" | "working" | "attention"> = {
  blocked: "attention",
  "ready-to-polish": "neutral",
  polishing: "working",
  proposal: "neutral",
  reviewing: "working",
  stale: "attention"
};

export type DocumentWorkflowCheck = {
  label: string;
  detail: string;
  state: "ready" | "blocked" | "pending";
};

export type DocumentWorkflowFailure = {
  title: string;
  message: string;
  details?: ReactNode;
  items?: string[];
};

// What an in-flight Polish is working on, as ledger rows above its elapsed time.
export type DocumentWorkflowRun = {
  startedAt?: number;
  details?: { label: string; value: string }[];
};

type DocumentWorkflowRailProps = {
  ariaLabel: string;
  status: DocumentWorkflowStatus;
  target: string;
  description?: string;
  checks?: DocumentWorkflowCheck[];
  failure?: DocumentWorkflowFailure | null;
  run?: DocumentWorkflowRun | null;
  children?: ReactNode;
  footer?: ReactNode;
  // Visible status and hidden-only announcements share one live region.
  statusLine?: string;
  statusAnnouncement?: string;
};

export function DocumentWorkflowRail({
  ariaLabel,
  status: workflow,
  target,
  description,
  checks = [],
  failure,
  run,
  children,
  footer,
  statusLine,
  statusAnnouncement
}: DocumentWorkflowRailProps) {
  const liveStatus = statusLine || statusAnnouncement;
  const runDetails = run?.details ?? [];
  const showRun = runDetails.length > 0 || run?.startedAt !== undefined;

  return (
    <aside
      className={`workflow-rail workflow-rail--${workflow.state} is-${TONES[workflow.state]}`}
      aria-label={ariaLabel}
    >
      <header className="workflow-rail__intro">
        <p className="workflow-rail__eyebrow">{documentWorkflowLabel(workflow)}</p>
        <h2>{target}</h2>
        {description ? <p className="workflow-rail__description">{description}</p> : null}
      </header>

      {failure ? (
        <section className="workflow-rail__failure" aria-label={failure.title} role="alert">
          <strong>{failure.title}</strong>
          <p>{failure.message}</p>
          {failure.details}
          {failure.items?.length ? (
            <ul>
              {failure.items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
            </ul>
          ) : null}
        </section>
      ) : null}

      {showRun ? (
        <dl className="ledger-rows workflow-rail__run" aria-label="Polish run">
          {runDetails.map((detail) => (
            <div key={detail.label} className="ledger-row">
              <dt>{detail.label}</dt>
              <span className="ledger-row__leader" aria-hidden="true" />
              <dd>{detail.value}</dd>
            </div>
          ))}
          {run?.startedAt !== undefined ? (
            <div className="ledger-row">
              <dt>Elapsed</dt>
              <span className="ledger-row__leader" aria-hidden="true" />
              <dd><ElapsedTime startedAt={run.startedAt} /></dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {checks.length > 0 ? (
        <ul className="workflow-rail__checks" aria-label="Workflow readiness">
          {checks.map((check) => (
            <li key={check.label} className={`is-${check.state}`}>
              <span>{check.label}</span>
              <small>{check.detail}</small>
            </li>
          ))}
        </ul>
      ) : null}

      {children ? <div className="workflow-rail__body">{children}</div> : null}
      {footer ? <footer className="workflow-rail__footer">{footer}</footer> : null}
      {liveStatus ? (
        <p
          className={statusLine ? "workflow-rail__status" : "sr-only"}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {liveStatus}
        </p>
      ) : null}
    </aside>
  );
}

function ElapsedTime({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);
  return <>{formatElapsed(now - startedAt)}</>;
}
