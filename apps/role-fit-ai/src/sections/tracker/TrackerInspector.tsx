import { BriefcaseBusiness, CalendarClock, ClipboardCheck, Copy, Eye, Files, History } from "lucide-react";
import type { Application } from "../../hooks/useApplications";
import { NOT_APPLYING_REASON_LABEL } from "../../hooks/useApplications";
import type { DuplicateGroup } from "../../lib/jobIdentity";
import {
  STATUS_LABEL,
  applicationActivityDate,
  companyInitials,
  displayCompany,
  displayRole,
  appFitVerdict,
  fitAssessmentRunLabel,
  formatCompactDate,
  hostLabel,
  nextAction,
  postingIdentity,
  safeExternalUrls
} from "../../lib/applicationDisplay";
import { describeProviderModel } from "../../config/aiOptions";
import { copyAiUsage } from "../../lib/aiUsage";
import { ApplicationFitSummary } from "../application/ApplicationFitSummary";

const AI_USAGE_STAGES: { key: string; label: string }[] = [
  { key: "job-analysis", label: "Job analysis" },
  { key: "resume-polish", label: "Resume Polish" },
  { key: "cover", label: "Cover letter" }
];

type TrackerInspectorProps = {
  selected: Application | null;
  onOpenApplication: (app: Application) => void;
  onPreviewResume: (app: Application) => void;
  onLoad: (app: Application) => void;
  onDelete: (id: string, title: string) => void;
  // The duplicate group containing `selected`, if any (undefined when not a member).
  duplicateGroup?: DuplicateGroup<Application>;
  relatedApplications?: Application[];
  onReviewDuplicates?: () => void;
};

export function TrackerInspector({
  selected,
  onOpenApplication,
  onPreviewResume,
  onLoad,
  onDelete,
  duplicateGroup,
  relatedApplications = [],
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
  const fitAssessmentMeta = selected.fitAssessment ? fitAssessmentRunLabel(selected.fitAssessment) : "";
  const foundOnUrls = safeExternalUrls([
    selected.jobUrl,
    ...(selected.sourceUrls ?? []).map((source) => source.url)
  ]);
  const posting = postingIdentity(selected);
  const displayedAiUsage = copyAiUsage(selected.aiUsage);
  const statusDateLabel = selected.status === "not_applying" ? "Decision date" : "Application date";
  const statusDate = selected.status === "not_applying" ? selected.notApplyingAt : selected.appliedAt;
  const statusDetail = selected.status === "not_applying" && selected.notApplyingReason
    ? `${STATUS_LABEL[selected.status]} · ${NOT_APPLYING_REASON_LABEL[selected.notApplyingReason]}`
    : STATUS_LABEL[selected.status];
  const hasPosting = Boolean(selected.rawJobDescription?.trim() || selected.jobDescription?.trim());
  const hasResume = Boolean(selected.resumeArtifacts?.hasPdf || selected.resumeArtifacts?.hasSource);
  const hasCoverLetter = Boolean(selected.coverLetterArtifacts?.hasPdf || selected.coverLetterArtifacts?.hasSource);
  const additionalDocumentCount = selected.attachments?.length ?? 0;

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
      <header className="pipeline-inspector__head">
        <span className="application-company-mark" data-len={companyInitials(displayCompany(selected)).length}>{companyInitials(displayCompany(selected))}</span>
        <div>
          <h3>{displayCompany(selected)}</h3>
          <p>{displayRole(selected)}</p>
          <p className="pipeline-inspector__identity">
            <span className={`stage-dot stage-dot--${selected.status}`} aria-hidden="true" />
            {statusDetail}
            <span aria-hidden="true">·</span>
            {formatCompactDate(statusDate || selected.createdAt)}
          </p>
        </div>
      </header>

      <dl className="ledger-rows inspector-facts" aria-label="Application summary">
        <div className="ledger-row">
          <dt><CalendarClock size={11} aria-hidden="true" /> Next action</dt>
          <span className="ledger-row__leader" aria-hidden="true" />
          <dd className="is-prose">{nextAction(selected)}</dd>
        </div>
        <div className="ledger-row">
          <dt>{statusDateLabel}</dt>
          <span className="ledger-row__leader" aria-hidden="true" />
          <dd>{statusDate ? formatCompactDate(statusDate) : "Not recorded"}</dd>
        </div>
        <div className="ledger-row">
          <dt>Deadline</dt>
          <span className="ledger-row__leader" aria-hidden="true" />
          <dd>{selected.deadline ? formatCompactDate(selected.deadline) : "Not recorded"}</dd>
        </div>
        <div className="ledger-row">
          <dt>Next step</dt>
          <span className="ledger-row__leader" aria-hidden="true" />
          <dd>{selected.followupAt ? formatCompactDate(selected.followupAt) : "Not recorded"}</dd>
        </div>
        <div className="ledger-row">
          <dt>{posting?.label ?? "Posting ID"}</dt>
          <span className="ledger-row__leader" aria-hidden="true" />
          <dd>{posting?.id ?? "Not recorded"}</dd>
        </div>
        <div className="ledger-row">
          <dt>Source</dt>
          <span className="ledger-row__leader" aria-hidden="true" />
          <dd>{selected.source || "Not recorded"}</dd>
        </div>
        {foundOnUrls.length ? (
          <div className="ledger-row">
            <dt>Found on</dt>
            <span className="ledger-row__leader" aria-hidden="true" />
            <dd className="application-chip-list">
              {foundOnUrls
                .map((url) => ({ url, host: hostLabel(url) }))
                .map(({ url, host }) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer">
                    {host}
                  </a>
                ))}
            </dd>
          </div>
        ) : null}
      </dl>

      <section className="application-inspector-fit" aria-labelledby="application-inspector-fit-title">
        <h4 id="application-inspector-fit-title" className="application-match-card__title">Fit assessment</h4>
        <ApplicationFitSummary
          label={verdict?.label ?? "Not checked"}
          tone={verdict?.tone ?? "neutral"}
          summary={selected.fitAssessment?.result.summary ?? "Run a Fit Assessment from Prepare to save this snapshot."}
        />
        {fitAssessmentMeta ? <p className="application-inspector-fit__meta">{fitAssessmentMeta}</p> : null}
      </section>

      {selected.fitAssessment?.result.gaps.length ? (
        <section className="side-section">
          <p className="side-section__label"><ClipboardCheck size={12} aria-hidden="true" /> Top gaps</p>
          <ul className="application-gap-list">
            {selected.fitAssessment.result.gaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="side-section">
        <p className="side-section__label">
          <History size={11} aria-hidden="true" /> Job activity
          <span className="sr-only">
            . Each decision or application keeps its own status, dates, notes, and documents.
          </span>
        </p>
        {relatedApplications.length ? (
          <ul className="application-related-records">
            {relatedApplications.map((application) => (
              <li key={application.id}>
                <span className="application-related-records__marker" aria-hidden="true">
                  <span className={`stage-dot stage-dot--${application.status}`} />
                </span>
                <span className="application-related-records__label">
                  <strong>{STATUS_LABEL[application.status]}</strong>
                  <span>
                    <time className="is-data">{formatCompactDate(applicationActivityDate(application))}</time>
                    {application.status === "not_applying" && application.notApplyingReason
                      ? ` · ${NOT_APPLYING_REASON_LABEL[application.notApplyingReason]}`
                      : ""}
                  </span>
                </span>
                <span className="application-related-records__actions">
                  <button
                    type="button"
                    className="secondary-button is-compact application-related-records__open"
                    onClick={() => onOpenApplication(application)}
                  >
                    Open
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="side-section__empty">No other saved decisions or applications for this job.</p>
        )}
      </section>

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
                  {` · ${formatCompactDate(applicationActivityDate(app))}`}
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

      <section className="side-section">
        <p className="side-section__label"><Files size={11} aria-hidden="true" /> Documents</p>
        <dl className="ledger-rows inspector-facts">
          <div className="ledger-row">
            <dt>Job posting</dt>
            <span className="ledger-row__leader" aria-hidden="true" />
            <dd>{hasPosting ? "Saved" : "Not saved"}</dd>
          </div>
          <div className="ledger-row">
            <dt>Resume</dt>
            <span className="ledger-row__leader" aria-hidden="true" />
            <dd className="inspector-sent__value">
              <span>
                {selected.resumeUsed === "tailored"
                  ? "Tailored"
                  : selected.resumeUsed === "base"
                    ? "Base"
                    : hasResume
                      ? "Saved"
                      : "Not saved"}
              </span>
              {hasResume ? (
                <button
                  type="button"
                  className="inspector-sent__preview"
                  onClick={() => onPreviewResume(selected)}
                  aria-label="Preview resume"
                  title="Preview resume"
                >
                  <Eye size={14} aria-hidden="true" />
                </button>
              ) : null}
            </dd>
          </div>
          <div className="ledger-row">
            <dt>Cover letter</dt>
            <span className="ledger-row__leader" aria-hidden="true" />
            <dd>{hasCoverLetter ? "Saved" : "Not saved"}</dd>
          </div>
          <div className="ledger-row">
            <dt>Additional documents</dt>
            <span className="ledger-row__leader" aria-hidden="true" />
            <dd>{additionalDocumentCount}</dd>
          </div>
        </dl>
      </section>

      {selected.aiUsage ? (
        <section className="side-section">
          <p className="side-section__label">AI usage</p>
          <dl className="ledger-rows inspector-facts">
            {AI_USAGE_STAGES.filter(({ key }) => displayedAiUsage[key]).map(({ key, label }) => {
              const usage = displayedAiUsage[key];
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
        </section>
      ) : null}

      {selected.roleDescription ? (
        <section className="side-section">
          <p className="side-section__label"><ClipboardCheck size={12} aria-hidden="true" /> Role summary</p>
          <p className="side-section__value">{selected.roleDescription}</p>
        </section>
      ) : null}

      <div className="application-side-actions">
        <button type="button" className="primary-button is-compact" onClick={() => onOpenApplication(selected)}>
          Open details
        </button>
        <button type="button" className="secondary-button is-compact" onClick={() => onLoad(selected)}>
          Edit preparation
        </button>
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
