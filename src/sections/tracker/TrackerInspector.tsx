import { BriefcaseBusiness, CalendarClock, ClipboardCheck, Copy, ExternalLink, Eye } from "lucide-react";
import type { Application, ApplicationSource, ApplicationStatus } from "../../hooks/useApplications";
import { APPLICATION_SOURCES } from "../../hooks/useApplications";
import type { DuplicateGroup } from "../../lib/jobIdentity";
import {
  BOARD_STATUSES,
  STATUS_LABEL,
  companyInitials,
  displayCompany,
  displayRole,
  appFitVerdict,
  formatCompactDate,
  hostLabel,
  nextAction
} from "../../lib/applicationDisplay";
import { describeProviderModel } from "../../config/aiOptions";

const AI_USAGE_STAGES: { key: string; label: string }[] = [
  { key: "distill", label: "Distill" },
  { key: "tailor", label: "Tailor" },
  { key: "review", label: "Review" },
  { key: "cover", label: "Cover" }
];

type TrackerInspectorProps = {
  selected: Application | null;
  onUpdateStatus: (id: string, status: ApplicationStatus) => void;
  onUpdateField: (id: string, field: "title" | "company" | "role" | "source" | "notes" | "followupAt" | "jobUrl", value: string) => void;
  onUpdateNotes: (id: string, notes: string) => void;
  onOpenApplication: (app: Application) => void;
  onPreviewResume: (app: Application) => void;
  onLoad: (app: Application) => void;
  onDelete: (id: string, title: string) => void;
  // The duplicate group containing `selected`, if any (undefined when not a member).
  duplicateGroup?: DuplicateGroup<Application>;
  onReviewDuplicates?: () => void;
};

export function TrackerInspector({
  selected,
  onUpdateStatus,
  onUpdateField,
  onUpdateNotes,
  onOpenApplication,
  onPreviewResume,
  onLoad,
  onDelete,
  duplicateGroup,
  onReviewDuplicates
}: TrackerInspectorProps) {
  if (!selected) {
    return (
      <div className="application-side-empty">
        <BriefcaseBusiness size={24} aria-hidden="true" />
        <strong>Select an application</strong>
        <span>Details, next steps, and fit context will appear here.</span>
      </div>
    );
  }

  const verdict = appFitVerdict(selected);
  const verdictSource = selected.review?.verdict
    ? "AI-judged"
    : verdict
    ? "Estimated"
    : "Not scored";
  const safeJobUrl = /^https?:\/\//i.test(selected.jobUrl.trim()) ? selected.jobUrl.trim() : "";

  // Other members of the selected app's duplicate group, each paired with the
  // edge (evidence) that connects it to the selected app.
  const duplicateOthers = duplicateGroup
    ? duplicateGroup.applications
        .filter((app) => app.id !== selected.id)
        .map((app) => {
          const edge = duplicateGroup.edges.find(
            (e) => (e.a === selected.id && e.b === app.id) || (e.a === app.id && e.b === selected.id)
          );
          return { app, edge };
        })
    : [];

  return (
    <>
      {/* Quick-open pinned to the panel's top-right corner so the header reads as
          a clean mark + title pair. */}
      <button
        type="button"
        className="pipeline-inspector__open ghost-button is-icon"
        aria-label="Open full application details"
        onClick={() => onOpenApplication(selected)}
      >
        <ExternalLink size={14} aria-hidden="true" />
      </button>

      <header className="pipeline-inspector__head">
        <span className="application-company-mark" data-len={companyInitials(displayCompany(selected)).length}>{companyInitials(displayCompany(selected))}</span>
        <div>
          <h3>{displayCompany(selected)}</h3>
          <p>{displayRole(selected)}</p>
        </div>
      </header>

      <div className="application-detail-score application-detail-score--inline">
        <div className="figures-strip figures-strip--compact">
          <span className="figures-strip__item">
            <em>Fit</em>
            <strong className={`application-fit application-fit--${verdict?.tone ?? "neutral"}`}>
              {verdict ? verdict.label : "Not scored"}
            </strong>
          </span>
          <span className="figures-strip__divider" aria-hidden="true" />
          <span className="figures-strip__item">
            <em>Source</em>
            <strong className="is-prose">{verdictSource}</strong>
          </span>
        </div>
        <p className="application-detail-score__reason">
          {selected.review?.verdictReason || "Use Polish to refresh fit, gaps, and interview risks."}
        </p>
      </div>

      <dl className="ledger-rows inspector-facts">
        <div className="ledger-row">
          <dt><CalendarClock size={11} aria-hidden="true" /> Next action</dt>
          <span className="ledger-row__leader" aria-hidden="true" />
          <dd className="is-prose">{nextAction(selected)}</dd>
        </div>
        {selected.source ? (
          <div className="ledger-row">
            <dt>Source</dt>
            <span className="ledger-row__leader" aria-hidden="true" />
            <dd>{selected.source}</dd>
          </div>
        ) : null}
        {selected.appliedAt ? (
          <div className="ledger-row">
            <dt>Applied</dt>
            <span className="ledger-row__leader" aria-hidden="true" />
            <dd>{selected.appliedAt.slice(0, 10)}</dd>
          </div>
        ) : null}
        {safeJobUrl || selected.sourceUrls?.length ? (
          <div className="ledger-row">
            <dt>Found on</dt>
            <span className="ledger-row__leader" aria-hidden="true" />
            <dd className="application-chip-list">
              {[safeJobUrl, ...(selected.sourceUrls ?? []).map((s) => s.url)]
                // hostLabel enforces the http(s)-only rule: "" filters the entry out.
                .map((url) => ({ url, host: url ? hostLabel(url) : "" }))
                .filter(({ host }) => host)
                .map(({ url, host }) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer">
                    {host}
                  </a>
                ))}
            </dd>
          </div>
        ) : null}
      </dl>

      {duplicateOthers.length ? (
        <section className="side-section">
          <p className="side-section__label"><Copy size={11} aria-hidden="true" /> Possible duplicates · {duplicateOthers.length}</p>
          <ul className="inspector-duplicates">
            {duplicateOthers.map(({ app, edge }) => (
              <li key={app.id} className="inspector-duplicates__item">
                <span className="inspector-duplicates__title">
                  {displayCompany(app)} · {displayRole(app)}
                </span>
                <span className="inspector-duplicates__meta">
                  {STATUS_LABEL[app.status]}
                  {app.appliedAt ? ` · ${formatCompactDate(app.appliedAt)}` : ""}
                </span>
                {edge ? (
                  <span className="inspector-duplicates__evidence">
                    {edge.confidence !== "exact" ? "Possibly · " : ""}
                    {edge.evidence.join(" · ")}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {onReviewDuplicates ? (
            <button type="button" className="secondary-button is-compact" onClick={onReviewDuplicates}>
              Review &amp; merge
            </button>
          ) : null}
        </section>
      ) : null}

      {/* Sent dossier — only rendered when any of the three data points exist */}
      {(selected.resumeUsed || (selected.resumeArtifacts?.hasTex || selected.resumeArtifacts?.hasPdf) || selected.coverLetterText || selected.applicationAnswers?.length) ? (
        <>
          <div className="inspector-divider" aria-hidden="true" />
          <p className="inspector-sent__eyebrow">Sent</p>
          <dl className="ledger-rows inspector-facts">
            {(selected.resumeUsed || selected.resumeArtifacts?.hasTex || selected.resumeArtifacts?.hasPdf) ? (
              <div className="ledger-row">
                <dt>Resume</dt>
                <span className="ledger-row__leader" aria-hidden="true" />
                <dd className="inspector-sent__value">
                  <span>
                    {selected.resumeUsed === "tailored" ? "Tailored" : selected.resumeUsed === "base" ? "Base" : "Saved"}
                  </span>
                  {selected.resumeArtifacts?.hasPdf ? (
                    <button
                      type="button"
                      className="inspector-sent__preview"
                      onClick={() => onPreviewResume(selected)}
                      aria-label="Preview resume PDF"
                      title="Preview resume PDF"
                    >
                      <Eye size={14} aria-hidden="true" />
                    </button>
                  ) : null}
                </dd>
              </div>
            ) : null}
            {selected.coverLetterText ? (
              <div className="ledger-row">
                <dt>Cover letter</dt>
                <span className="ledger-row__leader" aria-hidden="true" />
                <dd>Saved</dd>
              </div>
            ) : null}
            {selected.applicationAnswers?.length ? (
              <div className="ledger-row">
                <dt>Answers</dt>
                <span className="ledger-row__leader" aria-hidden="true" />
                <dd>{selected.applicationAnswers.length} saved</dd>
              </div>
            ) : null}
          </dl>
        </>
      ) : null}

      {selected.aiUsage ? (
        <>
          <div className="inspector-divider" aria-hidden="true" />
          <p className="inspector-sent__eyebrow">AI usage</p>
          <dl className="ledger-rows inspector-facts">
            {AI_USAGE_STAGES.filter(({ key }) => selected.aiUsage?.[key]).map(({ key, label }) => {
              const usage = selected.aiUsage![key];
              return (
                <div className="ledger-row" key={key}>
                  <dt>{label}</dt>
                  <span className="ledger-row__leader" aria-hidden="true" />
                  <dd>
                    {usage.source === "ai"
                      ? describeProviderModel(usage.provider ?? "", usage.model ?? "")
                      : usage.source === "local"
                      ? "local fallback"
                      : "not used"}
                  </dd>
                </div>
              );
            })}
          </dl>
        </>
      ) : null}

      <div className="inspector-divider" aria-hidden="true" />

      <label className="field">
        <span>Stage</span>
        <select
          value={selected.status}
          onChange={(event) => onUpdateStatus(selected.id, event.target.value as ApplicationStatus)}
        >
          {BOARD_STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABEL[status]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Source</span>
        <select
          value={selected.source ?? ""}
          onChange={(event) => onUpdateField(selected.id, "source", event.target.value as ApplicationSource)}
        >
          {APPLICATION_SOURCES.map((source) => (
            <option key={source || "blank"} value={source}>
              {source || "-"}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Next date</span>
        <input
          className="text-input"
          type="date"
          value={(selected.followupAt ?? "").slice(0, 10)}
          onChange={(event) => onUpdateField(selected.id, "followupAt", event.target.value)}
        />
      </label>
      <label className="field">
        <span>Notes</span>
        <textarea
          className="textarea"
          value={selected.notes ?? ""}
          onChange={(event) => onUpdateNotes(selected.id, event.target.value)}
          rows={3}
          placeholder="Interview focus, recruiter notes, or follow-up context."
        />
      </label>

      {selected.roleDescription ? (
        <section className="side-section">
          <p className="side-section__label"><ClipboardCheck size={12} aria-hidden="true" /> Role summary</p>
          <p className="side-section__value">{selected.roleDescription}</p>
        </section>
      ) : null}

      {selected.missingRequiredSkills?.length ? (
        <section className="side-section">
          <p className="side-section__label"><ClipboardCheck size={12} aria-hidden="true" /> Required gaps</p>
          <div className="application-chip-list">
            {selected.missingRequiredSkills.slice(0, 5).map((gap) => (
              <span key={gap.keyword}>{gap.keyword}</span>
            ))}
          </div>
        </section>
      ) : null}

      <div className="application-side-actions">
        <button type="button" className="primary-button is-compact" onClick={() => onOpenApplication(selected)}>
          Details
        </button>
        <button type="button" className="secondary-button is-compact" onClick={() => onLoad(selected)}>
          Polish
        </button>
        {safeJobUrl ? (
          <a className="secondary-button is-compact" href={safeJobUrl} target="_blank" rel="noreferrer">
            Job link
          </a>
        ) : null}
        <button
          type="button"
          className="secondary-button is-compact danger-button"
          onClick={() => onDelete(selected.id, selected.title)}
        >
          Delete
        </button>
      </div>
    </>
  );
}
