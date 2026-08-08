import type { ReactNode } from "react";

export type DocumentWorkflowPhase =
  | "ready"
  | "working"
  | "proposal"
  | "blocked"
  | "applied"
  | "stale";

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

type DocumentWorkflowRailProps = {
  ariaLabel: string;
  phase: DocumentWorkflowPhase;
  target: string;
  description?: string;
  checks?: DocumentWorkflowCheck[];
  failure?: DocumentWorkflowFailure | null;
  children?: ReactNode;
  footer?: ReactNode;
  status?: string;
};

const PHASE_LABELS: Record<DocumentWorkflowPhase, string> = {
  ready: "Ready",
  working: "Working",
  proposal: "Proposal ready",
  blocked: "Blocked",
  applied: "Applied",
  stale: "Stale"
};

export function DocumentWorkflowRail({
  ariaLabel,
  phase,
  target,
  description,
  checks = [],
  failure,
  children,
  footer,
  status
}: DocumentWorkflowRailProps) {
  return (
    <aside className={`workflow-rail workflow-rail--${phase}`} aria-label={ariaLabel}>
      <header className="workflow-rail__intro">
        <p className="workflow-rail__eyebrow">{PHASE_LABELS[phase]}</p>
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
      <p className="workflow-rail__status" role="status" aria-live="polite" aria-atomic="true">
        {status}
      </p>
    </aside>
  );
}
