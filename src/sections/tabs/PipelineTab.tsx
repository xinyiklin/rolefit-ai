import { AlertCircle, Ban, CheckCircle2, ChevronRight, ClipboardList, Inbox, RefreshCw, Trash2 } from "lucide-react";
import type { ComponentType } from "react";
import { PanelHeading } from "../../ui";
import {
  APPLICATION_SOURCES,
  APPLICATION_STATUSES,
  type Application,
  type ApplicationSource,
  type ApplicationStatus
} from "../../hooks/useApplications";
import { formatRelativeAge, formatShortDate } from "../shared";

const STATUS_LABEL: Record<ApplicationStatus, string> = {
  interested: "Interested",
  applied: "Applied",
  interviewing: "Interviewing",
  offer: "Offer",
  rejected: "Rejected",
  withdrawn: "Withdrawn"
};

// Map an AI verdict to a tone slug + icon so it can render as a semantic pill
// (same vocabulary as the status pills) instead of a one-off banner.
const VERDICT_META: Record<string, { slug: string; Icon: ComponentType<{ size?: number; "aria-hidden"?: boolean }> }> = {
  "STRONG FIT": { slug: "strong-fit", Icon: CheckCircle2 },
  "REASONABLE FIT": { slug: "reasonable-fit", Icon: CheckCircle2 },
  STRETCH: { slug: "stretch", Icon: AlertCircle },
  "DON'T APPLY": { slug: "dont-apply", Icon: Ban }
};

function verdictMeta(verdict: string) {
  return VERDICT_META[verdict.toUpperCase()] ?? { slug: "neutral", Icon: CheckCircle2 };
}

type PipelineTabProps = {
  applications: Application[];
  applicationsPath: string;
  applicationsError: string;
  isApplicationsLoading: boolean;
  pipelineFilter: "all" | ApplicationStatus;
  setPipelineFilter: (v: "all" | ApplicationStatus) => void;
  expandedApplicationId: string | null;
  setExpandedApplicationId: (id: string | null) => void;
  onUpdateStatus: (id: string, status: ApplicationStatus) => void;
  onUpdateField: (id: string, field: "title" | "company" | "role" | "source" | "notes" | "followupAt" | "jobUrl", value: string) => void;
  onUpdateNotes: (id: string, notes: string) => void;
  onLoad: (app: Application) => void;
  onDelete: (id: string, title: string) => void;
};

export function PipelineTab({
  applications,
  applicationsPath,
  applicationsError,
  isApplicationsLoading,
  pipelineFilter,
  setPipelineFilter,
  expandedApplicationId,
  setExpandedApplicationId,
  onUpdateStatus,
  onUpdateField,
  onUpdateNotes,
  onLoad,
  onDelete
}: PipelineTabProps) {
  const counts = APPLICATION_STATUSES.reduce(
    (acc, status) => {
      acc[status] = applications.filter((a) => a.status === status).length;
      return acc;
    },
    {} as Record<ApplicationStatus, number>
  );

  const visible = applications
    .filter((a) => pipelineFilter === "all" || a.status === pipelineFilter)
    .slice()
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));

  return (
    <section className="studio-card pipeline-card">
      <PanelHeading
        icon={<ClipboardList size={15} aria-hidden="true" />}
        title="Pipeline"
        description={
          applicationsPath
            ? `On disk · ${applicationsPath.replace(/^.*?job-search-workspace\//, "job-search-workspace/")}`
            : undefined
        }
      />
      {isApplicationsLoading ? <p className="pipeline-note">Loading saved roles...</p> : null}
      {applicationsError ? (
        <div className="pipeline-alert" role="status">
          <AlertCircle size={14} aria-hidden="true" />
          <span>Pipeline change was not saved: {applicationsError}</span>
        </div>
      ) : null}
      <div className="pipeline-filters" role="tablist" aria-label="Pipeline status filter">
        <button
          type="button"
          className={`pipeline-filter ${pipelineFilter === "all" ? "is-active" : ""}`}
          onClick={() => setPipelineFilter("all")}
        >
          All <em>{applications.length}</em>
        </button>
        {APPLICATION_STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            className={`pipeline-filter pipeline-filter--${status} ${pipelineFilter === status ? "is-active" : ""}`}
            onClick={() => setPipelineFilter(status)}
          >
            {STATUS_LABEL[status]} <em>{counts[status]}</em>
          </button>
        ))}
      </div>

      {visible.length ? (
        <div className="pipeline-list">
          {visible.map((app) => {
            const isExpanded = expandedApplicationId === app.id;
            return (
              <article
                className={`pipeline-row pipeline-row--${app.status} ${isExpanded ? "is-expanded" : ""}`}
                key={app.id}
              >
                <button
                  type="button"
                  className="pipeline-row__summary"
                  onClick={() => setExpandedApplicationId(isExpanded ? null : app.id)}
                  aria-expanded={isExpanded}
                >
                  <ChevronRight size={14} aria-hidden="true" className="pipeline-row__chevron" />
                  <div className="pipeline-row__main">
                    <div className="pipeline-row__head">
                      <strong>{app.title}</strong>
                      <span className="pipeline-row__signals">
                        {app.review?.verdict
                          ? (() => {
                              const { slug, Icon } = verdictMeta(app.review.verdict);
                              return (
                                <span
                                  className={`verdict-pill verdict-pill--${slug}`}
                                  title={app.review?.verdictReason || undefined}
                                >
                                  <Icon size={11} aria-hidden={true} />
                                  {app.review.verdict}
                                </span>
                              );
                            })()
                          : null}
                        {typeof app.fitScore === "number" ? (
                          <span className="pipeline-row__fit">Fit {app.fitScore}</span>
                        ) : null}
                      </span>
                    </div>
                    <div className="pipeline-row__sub">
                      {app.company ? <span>{app.company}</span> : null}
                      {app.role ? <span>· {app.role}</span> : null}
                      {app.source ? <span>· {app.source}</span> : null}
                    </div>
                    <div className="pipeline-row__meta">
                      <span className={`pipeline-row__pill pipeline-row__pill--${app.status}`}>
                        {STATUS_LABEL[app.status]}
                      </span>
                      {app.appliedAt ? <span>Applied {formatShortDate(app.appliedAt)}</span> : null}
                      <span>Last activity {formatRelativeAge(app.updatedAt)}</span>
                      {app.followupAt ? (
                        <span className="pipeline-row__followup">Follow up {formatShortDate(app.followupAt)}</span>
                      ) : null}
                    </div>
                  </div>
                </button>

                {isExpanded ? (
                  <div className="pipeline-detail">
                    <div className="pipeline-detail__grid">
                      <label className="field">
                        <span>Status</span>
                        <select
                          className={`pipeline-status pipeline-status--${app.status}`}
                          value={app.status}
                          onChange={(event) => onUpdateStatus(app.id, event.target.value as ApplicationStatus)}
                        >
                          {APPLICATION_STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {STATUS_LABEL[status]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>Source</span>
                        <select
                          value={app.source ?? ""}
                          onChange={(event) => onUpdateField(app.id, "source", event.target.value as ApplicationSource)}
                        >
                          {APPLICATION_SOURCES.map((src) => (
                            <option key={src || "blank"} value={src}>
                              {src || "—"}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>Company</span>
                        <input
                          className="text-input"
                          value={app.company ?? ""}
                          onChange={(event) => onUpdateField(app.id, "company", event.target.value)}
                          placeholder="e.g., Stripe"
                        />
                      </label>
                      <label className="field">
                        <span>Role</span>
                        <input
                          className="text-input"
                          value={app.role ?? ""}
                          onChange={(event) => onUpdateField(app.id, "role", event.target.value)}
                          placeholder="e.g., Software Engineer I"
                        />
                      </label>
                      <label className="field">
                        <span>Follow up date</span>
                        <input
                          className="text-input"
                          type="date"
                          value={(app.followupAt ?? "").slice(0, 10)}
                          onChange={(event) => onUpdateField(app.id, "followupAt", event.target.value)}
                        />
                      </label>
                      <label className="field">
                        <span>Job link</span>
                        <input
                          className="text-input"
                          value={app.jobUrl ?? ""}
                          onChange={(event) => onUpdateField(app.id, "jobUrl", event.target.value)}
                          placeholder="https://…"
                        />
                      </label>
                    </div>

                    <label className="field">
                      <span>Notes</span>
                      <textarea
                        className="textarea"
                        value={app.notes ?? ""}
                        onChange={(event) => onUpdateNotes(app.id, event.target.value)}
                        placeholder="Recruiter contact, interview rounds, what you talked about, why you might withdraw, etc."
                        rows={4}
                      />
                    </label>

                    <div className="pipeline-detail__meta">
                      <span>Tracked {formatShortDate(app.createdAt)}</span>
                      {app.appliedAt ? <span>Applied {formatShortDate(app.appliedAt)}</span> : null}
                      <span>Last activity {formatShortDate(app.updatedAt)}</span>
                      {app.resumeUsed ? (
                        <span className="pipeline-tag">
                          Sent {app.resumeUsed === "base" ? "original" : "tailored"} resume
                        </span>
                      ) : null}
                      {app.templateId ? <span>Template · {app.templateId}</span> : null}
                    </div>

                    {app.review ? (
                      <section className="pipeline-review" aria-label="Recruiter review">
                        <p className="pipeline-review__head">
                          {(() => {
                            const { slug, Icon } = verdictMeta(app.review.verdict);
                            return (
                              <span className={`verdict-pill verdict-pill--${slug}`}>
                                <Icon size={12} aria-hidden={true} />
                                {app.review.verdict || "Reviewed"}
                              </span>
                            );
                          })()}
                          {app.review.verdictReason ? (
                            <span className="pipeline-review__reason">{app.review.verdictReason}</span>
                          ) : null}
                        </p>
                        {app.review.riskFlags.length ? (
                          <details className="pipeline-snapshot" open>
                            <summary>Interview risks ({app.review.riskFlags.length})</summary>
                            <ul className="pipeline-review__list">
                              {app.review.riskFlags.map((r, i) => (
                                <li className="pipeline-review__item" key={i}>
                                  <span className="pipeline-review__item-main">{r.risk}</span>
                                  {r.suggestion ? (
                                    <span className="pipeline-review__item-sub">{r.suggestion}</span>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          </details>
                        ) : null}
                        {app.review.gaps.length ? (
                          <details className="pipeline-snapshot">
                            <summary>Gaps ({app.review.gaps.length})</summary>
                            <ul className="pipeline-review__list">
                              {app.review.gaps.map((g, i) => (
                                <li className="pipeline-review__gap" key={i}>
                                  <span className={`gap-sev gap-sev--${(g.severity || "low").toLowerCase()}`}>
                                    {g.severity || "LOW"}
                                  </span>
                                  <span>{g.gap}</span>
                                </li>
                              ))}
                            </ul>
                          </details>
                        ) : null}
                        {app.review.recommendation.coverLetterAngle ? (
                          <p className="pipeline-review__angle">
                            <span className="pipeline-review__angle-label">Cover-letter angle</span>
                            {app.review.recommendation.coverLetterAngle}
                          </p>
                        ) : null}
                      </section>
                    ) : null}

                    {app.polishedText ? (
                      <details className="pipeline-snapshot">
                        <summary>
                          Resume sent
                          {app.resumeUsed ? ` · ${app.resumeUsed === "base" ? "original" : "tailored"}` : ""} (
                          {app.polishedText.split("\n").length} lines)
                        </summary>
                        <textarea className="resume-output" readOnly value={app.polishedText} />
                      </details>
                    ) : null}
                    {app.coverLetterText ? (
                      <details className="pipeline-snapshot">
                        <summary>Cover letter sent</summary>
                        <textarea className="resume-output cover-letter-output" readOnly value={app.coverLetterText} />
                      </details>
                    ) : null}

                    <div className="pipeline-detail__actions">
                      <button type="button" className="secondary-button is-compact" onClick={() => onLoad(app)}>
                        <RefreshCw size={12} aria-hidden="true" />
                        Load into Polish
                      </button>
                      {app.status !== "applied" ? (
                        <button
                          type="button"
                          className="secondary-button is-compact"
                          onClick={() => onUpdateStatus(app.id, "applied")}
                        >
                          <CheckCircle2 size={12} aria-hidden="true" />
                          Mark applied
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="secondary-button is-compact danger-button"
                        onClick={() => onDelete(app.id, app.title)}
                      >
                        <Trash2 size={12} aria-hidden="true" />
                        Delete
                      </button>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="pipeline-empty">
          <Inbox size={24} aria-hidden="true" />
          {applications.length ? (
            <>
              <p className="pipeline-empty__title">
                No {STATUS_LABEL[pipelineFilter as ApplicationStatus].toLowerCase()} roles
              </p>
              <p className="pipeline-empty__hint">Switch the filter above, or track another role.</p>
            </>
          ) : (
            <>
              <p className="pipeline-empty__title">Your pipeline is empty</p>
              <p className="pipeline-empty__hint">
                Polish a resume against a job, then hit Track to save the role, its fit score, and the recruiter
                review here.
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
