import { useEffect, useState, type KeyboardEvent } from "react";
import { ArrowRight, Check, Circle, LoaderCircle } from "lucide-react";

import { APPLICATION_SOURCES, JOB_TYPES, type Application } from "../../hooks/useApplications";
import type { BaseResumeOption } from "../../hooks/useWorkspaceResume";
import type { ImportedJobSnapshot } from "../../hooks/useJobIntake";
import type { CoverLetterOption } from "../../lib/coverLetterWorkspaceRepository";
import type { AiStageState, PolishProgressState } from "../../lib/aiWorkflow";
import type { ExtractedJobTracking } from "../../lib/jobExtract";
import { preparedJobRoleContext, type PreparedJobBriefField } from "../../lib/preparedJobBrief";
import type { PreparationReadiness } from "../../lib/preparationReadiness";
import type { VariantRecommendation } from "../../lib/variantRecommendation";
import { PreparedJobBriefSections, type PreparedJobBriefSection } from "./prepare/PreparedJobBriefSections";
import { PreparedMaterialCard } from "./prepare/PreparedMaterialCard";
import { PreparedVariantRecommendation } from "./prepare/PreparedVariantRecommendation";
import {
  PrepareApplicationRail,
  type PrepareActivity,
  type PrepareFitAssessment
} from "./prepare/PrepareApplicationRail";

type SourceMethod = "url" | "paste";

const SOURCE_METHODS: readonly SourceMethod[] = ["url", "paste"];

// Prepare owns which multi-item brief sections exist and how they read. Each one
// becomes a tab over an individually editable row list.
const BRIEF_SECTIONS: readonly PreparedJobBriefSection[] = [
  {
    field: "responsibilities",
    label: "Responsibilities",
    placeholder: "Build and maintain…"
  },
  {
    field: "requiredQualifications",
    label: "Required qualifications",
    placeholder: "Required experience, skills, education, or credentials…"
  },
  {
    field: "preferredQualifications",
    label: "Preferred qualifications",
    placeholder: "Nice-to-have experience or skills…"
  },
  {
    field: "techKeywords",
    label: "Tech stack / keywords",
    placeholder: "TypeScript"
  },
  {
    field: "senioritySignals",
    label: "Seniority signals",
    placeholder: "Leadership, ownership, or years-of-experience signals…"
  },
  {
    field: "domainSignals",
    label: "Domain signals",
    placeholder: "Fintech"
  },
  {
    field: "benefits",
    label: "Benefits",
    placeholder: "Health coverage"
  }
];

type ReviewGap = {
  gap: string;
  severity: string;
  evidence?: string;
};

function variantRecommendationLiveText(
  kind: string,
  isRanking: boolean,
  recommendation: VariantRecommendation | null,
  selectedFileName: string
): string {
  if (isRanking) return `Selecting the best ${kind} match.`;
  if (!recommendation) return "";
  return recommendation.fileName === selectedFileName
    ? `${recommendation.label} selected for ${kind}.`
    : `${recommendation.label} recommended for ${kind}.`;
}

export type PrepareTabProps = {
  jobUrl: string;
  onJobUrlChange: (value: string) => void;
  jobDescription: string;
  onJobDescriptionChange: (value: string) => void;
  jobRawText: string;
  importedJob: ImportedJobSnapshot | null;
  onJobTrackingChange: (field: keyof ExtractedJobTracking, value: string | number | null) => void;
  onJobBriefChange: (field: PreparedJobBriefField, value: string) => void;
  jobPrepared: boolean;
  isPreparing: boolean;
  extensionImportPhase: "receiving" | "preparing" | null;
  distillProgress: AiStageState;
  preparationStatus: string;
  distillProviderReady: boolean;
  distillProviderMessage: string;
  onFetchPosting: () => void | Promise<void>;
  onPreparePosting: (sourceOverride?: string) => void | Promise<void>;
  resumeReady: boolean;
  isSelectingResume: boolean;
  includeResume: boolean;
  onIncludeResumeChange: (included: boolean) => void;
  baseResumeName: string;
  baseResumeOptions: BaseResumeOption[];
  onSelectBaseResume: (fileName: string) => void | Promise<unknown>;
  resumeVariantRecommendation: VariantRecommendation | null;
  isRankingResumeVariants: boolean;
  canTailor: boolean;
  isPolishing: boolean;
  polishProgress: PolishProgressState;
  polishOutputCurrent: boolean;
  polishStatus: string;
  onTailorPreparedResume: () => void | Promise<void>;
  onReviewResume: () => void;
  includeCoverLetter: boolean;
  onIncludeCoverLetterChange: (included: boolean) => void;
  coverLetterReady: boolean;
  coverLetterWordCount: number;
  coverLetterPlaceholderCount: number;
  coverLetterFileName: string;
  coverLetterOptions: CoverLetterOption[];
  coverLetterVariantRecommendation: VariantRecommendation | null;
  isRankingCoverLetterVariants: boolean;
  isSelectingCoverLetter: boolean;
  onSelectCoverLetter: (fileName: string) => void | Promise<unknown>;
  canTailorCoverLetter: boolean;
  coverLetterTailorHint: string;
  isTailoringCoverLetter: boolean;
  coverLetterStatus: string;
  onTailorCoverLetter: () => void | Promise<void>;
  onOpenCoverLetter: () => void;
  reviewGaps: ReviewGap[];
  reviewGapsProvenance: "none" | "current" | "saved";
  fitAssessment: PrepareFitAssessment | null;
  linkedApplication: Application | null;
  readiness: PreparationReadiness;
  isApplying: boolean;
  onApply: () => void | Promise<void>;
};

export function PrepareTab({
  jobUrl,
  onJobUrlChange,
  jobDescription,
  onJobDescriptionChange,
  jobRawText,
  importedJob,
  onJobTrackingChange,
  onJobBriefChange,
  jobPrepared,
  isPreparing,
  extensionImportPhase,
  distillProgress,
  preparationStatus,
  distillProviderReady,
  distillProviderMessage,
  onFetchPosting,
  onPreparePosting,
  resumeReady,
  isSelectingResume,
  includeResume,
  onIncludeResumeChange,
  baseResumeName,
  baseResumeOptions,
  onSelectBaseResume,
  resumeVariantRecommendation,
  isRankingResumeVariants,
  canTailor,
  isPolishing,
  polishProgress,
  polishOutputCurrent,
  polishStatus,
  onTailorPreparedResume,
  onReviewResume,
  includeCoverLetter,
  onIncludeCoverLetterChange,
  coverLetterReady,
  coverLetterWordCount,
  coverLetterPlaceholderCount,
  coverLetterFileName,
  coverLetterOptions,
  coverLetterVariantRecommendation,
  isRankingCoverLetterVariants,
  isSelectingCoverLetter,
  onSelectCoverLetter,
  canTailorCoverLetter,
  coverLetterTailorHint,
  isTailoringCoverLetter,
  coverLetterStatus,
  onTailorCoverLetter,
  onOpenCoverLetter,
  reviewGaps,
  reviewGapsProvenance,
  fitAssessment,
  linkedApplication,
  readiness,
  isApplying,
  onApply
}: PrepareTabProps) {
  const [sourceMode, setSourceMode] = useState<"collapsed" | "view" | "replace">(jobPrepared ? "collapsed" : "replace");
  const [sourceMethod, setSourceMethod] = useState<SourceMethod>(() =>
    jobUrl.trim() || (!jobRawText.trim() && !jobDescription.trim()) ? "url" : "paste"
  );

  useEffect(() => {
    setSourceMode(jobPrepared ? "collapsed" : "replace");
  }, [jobPrepared]);

  const tracking = jobPrepared ? (importedJob?.tracking ?? {}) : {};
  const brief = importedJob?.brief;
  const role = tracking.role || tracking.title || "Role not identified";
  const company = tracking.company || "Company not identified";
  const manualReviewFields = jobPrepared ? (importedJob?.manualReviewFields ?? []) : [];
  const sourceLength = (jobRawText || jobDescription).trim().length;
  const isReceiving = extensionImportPhase === "receiving";
  const progressRunning = isPreparing || distillProgress.status === "running";
  const preparationStopped = distillProgress.status === "failed" || distillProgress.status === "stopped";
  // Preparation has its own readiness check, so the rail reports it only while
  // work is in flight or a message is outstanding.
  const activity: PrepareActivity | null = isReceiving
    ? { tone: "working", message: "Receiving the posting from the extension…" }
    : progressRunning
      ? {
          tone: "working",
          message: preparationStatus || "Preparing the posting…"
        }
      : preparationStopped
        ? {
            tone: "warn",
            message: distillProgress.error || distillProgress.errorHeadline || "Preparation stopped."
          }
        : preparationStatus
          ? { tone: "info", message: preparationStatus }
          : null;
  const tailorDone = polishOutputCurrent && polishProgress.tailor.status === "done";
  const reviewDone = polishOutputCurrent && polishProgress.review.status === "done";
  const resumeState =
    isRankingResumeVariants || isSelectingResume
      ? "Selecting best match…"
      : isPolishing
        ? polishProgress.review.status === "running"
          ? "Reviewing…"
          : "Tailoring…"
        : reviewDone
          ? "Tailored · reviewed"
          : tailorDone
            ? "Tailored"
            : resumeReady
              ? "Ready"
              : "No document";
  // A saved base letter is a template: it holds real prose and unresolved slots
  // like [Company]. Reporting that as "No draft" hid a document the user could
  // see in the selector, so the state names the actual reason it is not ready.
  const coverState =
    isRankingCoverLetterVariants || isSelectingCoverLetter
      ? "Selecting best match…"
      : isTailoringCoverLetter
        ? "Tailoring…"
        : coverLetterReady
          ? "Ready"
          : coverLetterPlaceholderCount > 0
            ? `Template · ${coverLetterPlaceholderCount} placeholder${coverLetterPlaceholderCount === 1 ? "" : "s"} to fill`
            : coverLetterWordCount > 0
              ? "Draft too short"
              : "No draft";
  const canFetch = Boolean(jobUrl.trim()) && !isPreparing && distillProviderReady;
  // URL edits invalidate readiness but must not swap the controlled replacement
  // textarea from the captured posting back to the compact tailoring scaffold.
  // Direct textarea edits clear jobRawText in useJobIntake, so this still hands
  // control to the user's replacement on the first keystroke.
  const preparationSourceText = jobRawText || jobDescription;
  const canPreparePaste = preparationSourceText.trim().length >= 80 && !isPreparing && distillProviderReady;
  const fetchHint = !jobUrl.trim()
    ? "Enter a job URL first."
    : isPreparing
      ? "Wait for the current preparation to finish."
      : !distillProviderReady
        ? distillProviderMessage
        : "";
  const prepareHint =
    preparationSourceText.trim().length < 80
      ? "Paste at least 80 characters from the job posting."
      : isPreparing
        ? "Wait for the current preparation to finish."
        : !distillProviderReady
          ? distillProviderMessage
          : "";
  const tailorHint = !jobPrepared
    ? "Prepare the job posting first."
    : !resumeReady
      ? "Add a resume before tailoring."
      : isPolishing
        ? "Wait for the current tailoring run to finish."
        : !canTailor
          ? polishStatus || "Finish the resume and AI setup before tailoring."
          : "";
  const canStartTailor = canTailor && !isPolishing && jobPrepared;
  const resumeWorkflowNeedsAttention =
    polishProgress.tailor.status === "failed" ||
    polishProgress.tailor.status === "stopped" ||
    polishProgress.review.status === "failed" ||
    polishProgress.review.status === "stopped";
  // Success receipts duplicate the state line. Keep only blockers and failures.
  const resumeNote = !canStartTailor && tailorHint
    ? tailorHint
    : resumeWorkflowNeedsAttention
      ? polishStatus
      : "";
  const coverNote = !canTailorCoverLetter && coverLetterTailorHint
    ? coverLetterTailorHint
    : coverLetterStatus === "Inputs changed. Tailor the letter again for this context."
      ? "Inputs changed · tailor again."
      : coverLetterStatus;
  const sourceValue = APPLICATION_SOURCES.includes(tracking.source as (typeof APPLICATION_SOURCES)[number])
    ? (tracking.source ?? "")
    : tracking.source
      ? "Other"
      : "";
  const jobTypeIsKnown = JOB_TYPES.includes(tracking.jobType as (typeof JOB_TYPES)[number]);
  const recommendationLiveText = [
    variantRecommendationLiveText("resume", isRankingResumeVariants, resumeVariantRecommendation, baseResumeName),
    variantRecommendationLiveText(
      "cover letter",
      isRankingCoverLetterVariants,
      coverLetterVariantRecommendation,
      coverLetterFileName
    )
  ]
    .filter(Boolean)
    .join(" ");
  // One live region for both comparisons, rendered outside the material rows so
  // it is always present for assistive tech without forcing an empty line onto a
  // compact row.
  const recommendationLiveRegion = (
    <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {recommendationLiveText}
    </span>
  );

  function handleSourceMethodKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const currentIndex = SOURCE_METHODS.indexOf(sourceMethod);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? SOURCE_METHODS.length - 1
          : event.key === "ArrowRight"
            ? (currentIndex + 1) % SOURCE_METHODS.length
            : event.key === "ArrowLeft"
              ? (currentIndex - 1 + SOURCE_METHODS.length) % SOURCE_METHODS.length
              : -1;
    if (nextIndex < 0) return;
    event.preventDefault();
    const nextMethod = SOURCE_METHODS[nextIndex];
    setSourceMethod(nextMethod);
    document.getElementById(`prepare-source-${nextMethod}-tab`)?.focus();
  }

  return (
    <section className="workspace-page prepare-page">
      <header className="workspace-page__head prepare-page__head">
        <h2 className="page-serif">Prepare</h2>
        <span className={`prepare-page__state${jobPrepared ? " is-ready" : ""}`}>
          {jobPrepared ? <Check size={13} aria-hidden="true" /> : <Circle size={10} aria-hidden="true" />}
          {jobPrepared ? `${role} · ${company}` : "No prepared application"}
        </span>
      </header>

      <div className={`prepare-layout ${jobPrepared ? "is-prepared" : "is-intake"}`}>
        <div className="prepare-main">
          <section className="prepare-panel" aria-labelledby="prepare-source-title">
            <div className="prepare-panel__head">
              <h3 id="prepare-source-title">Source</h3>
              {jobPrepared ? (
                <span className="prepare-panel__meta">
                  {sourceLength.toLocaleString()} characters · {jobUrl.trim() ? "linked posting" : "pasted text"}
                </span>
              ) : (
                <span className="prepare-panel__meta">URL or pasted text</span>
              )}
              {jobPrepared ? (
                <div className="prepare-panel__actions">
                  <button
                    className="ghost-button is-compact"
                    type="button"
                    onClick={() => setSourceMode((current) => (current === "view" ? "collapsed" : "view"))}
                  >
                    {sourceMode === "view" ? "Hide" : "View"}
                  </button>
                  <button
                    className="ghost-button is-compact"
                    type="button"
                    onClick={() => {
                      setSourceMethod(jobUrl.trim() ? "url" : "paste");
                      setSourceMode("replace");
                    }}
                  >
                    Replace
                  </button>
                  <button
                    className="secondary-button is-compact"
                    type="button"
                    onClick={() => void onPreparePosting(preparationSourceText)}
                    disabled={!canPreparePaste}
                    aria-describedby={!canPreparePaste ? "prepare-source-action-hint" : undefined}
                  >
                    Prepare again
                  </button>
                </div>
              ) : null}
            </div>
            {jobPrepared && !canPreparePaste && prepareHint ? (
              <p className="prepare-note" id="prepare-source-action-hint">
                {prepareHint}
              </p>
            ) : null}

            {sourceMode === "view" && jobPrepared ? (
              <pre className="prepare-source-preview">{jobRawText || jobDescription}</pre>
            ) : sourceMode === "collapsed" && jobPrepared ? null : (
              <div className="prepare-source-form">
                <div className="prepare-source-methods" role="tablist" aria-label="Job source method">
                  {SOURCE_METHODS.map((method) => {
                    const selected = sourceMethod === method;
                    return (
                      <button
                        id={`prepare-source-${method}-tab`}
                        className="prepare-source-method"
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        aria-controls={`prepare-source-${method}-panel`}
                        tabIndex={selected ? 0 : -1}
                        onClick={() => setSourceMethod(method)}
                        onKeyDown={handleSourceMethodKeyDown}
                        key={method}
                      >
                        {method === "url" ? "Job URL" : "Paste description"}
                      </button>
                    );
                  })}
                </div>

                <div
                  id="prepare-source-url-panel"
                  className="prepare-source-method-panel"
                  role="tabpanel"
                  aria-labelledby="prepare-source-url-tab"
                  hidden={sourceMethod !== "url"}
                >
                  <label className="field">
                    <span>Job URL</span>
                    <span className="prepare-input-action">
                      <input
                        className="text-input"
                        type="url"
                        value={jobUrl}
                        onChange={(event) => onJobUrlChange(event.target.value)}
                        placeholder="https://company.example/jobs/role"
                        disabled={isPreparing}
                      />
                      <button
                        className="primary-button is-compact"
                        type="button"
                        onClick={() => void onFetchPosting()}
                        disabled={!canFetch}
                        aria-describedby={!canFetch && fetchHint ? "prepare-fetch-action-hint" : undefined}
                      >
                        {isPreparing ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : null}
                        Prepare from URL
                      </button>
                    </span>
                    {!canFetch && fetchHint ? (
                      <span className="prepare-action-hint" id="prepare-fetch-action-hint">
                        {fetchHint}
                      </span>
                    ) : null}
                  </label>
                </div>

                <div
                  id="prepare-source-paste-panel"
                  className="prepare-source-method-panel"
                  role="tabpanel"
                  aria-labelledby="prepare-source-paste-tab"
                  hidden={sourceMethod !== "paste"}
                >
                  <label className="field">
                    <span>Job description</span>
                    <textarea
                      className="textarea prepare-source-textarea"
                      value={preparationSourceText}
                      onChange={(event) => onJobDescriptionChange(event.target.value)}
                      placeholder="Paste the role description, qualifications, location, compensation, and benefits."
                      disabled={isPreparing}
                    />
                  </label>
                  <div className="prepare-source-submit">
                    <span>
                      {preparationSourceText.trim().length.toLocaleString()} characters
                      {preparationSourceText.trim().length > 0 && preparationSourceText.trim().length < 80
                        ? " · add more of the posting"
                        : ""}
                    </span>
                    <button
                      className="primary-button is-compact"
                      type="button"
                      onClick={() => void onPreparePosting(preparationSourceText)}
                      disabled={!canPreparePaste}
                      aria-describedby={
                        !canPreparePaste
                          ? jobPrepared
                            ? "prepare-source-action-hint"
                            : "prepare-paste-action-hint"
                          : undefined
                      }
                    >
                      Prepare posting
                    </button>
                  </div>
                  {!jobPrepared && !canPreparePaste && prepareHint ? (
                    <p className="prepare-note" id="prepare-paste-action-hint">
                      {prepareHint}
                    </p>
                  ) : null}
                </div>

                {!jobPrepared && activity ? (
                  <p className={`prepare-note is-${activity.tone}`} role="status">
                    {activity.tone === "working" ? (
                      <LoaderCircle className="spin" size={13} aria-hidden="true" />
                    ) : null}
                    {activity.message}
                  </p>
                ) : null}
              </div>
            )}
          </section>

          <section className="prepare-panel prepare-job-brief" aria-labelledby="prepare-brief-title">
            <div className="prepare-panel__head">
              <h3 id="prepare-brief-title">Job brief</h3>
              <span className="prepare-panel__meta">
                {jobPrepared ? "Edits apply to tailoring and Apply" : "Not prepared"}
              </span>
            </div>

            {jobPrepared && brief ? (
              <>
                <fieldset className="prepare-brief-fields" disabled={isPreparing}>
                  <div className="prepare-detail-grid">
                    <label className="field">
                      <span>Role title</span>
                      <input
                        className="text-input"
                        value={tracking.role || ""}
                        onChange={(event) => onJobTrackingChange("role", event.target.value)}
                      />
                    </label>
                    <label className="field">
                      <span>Company</span>
                      <input
                        className="text-input"
                        value={tracking.company || ""}
                        onChange={(event) => onJobTrackingChange("company", event.target.value)}
                      />
                    </label>
                    <label className="field">
                      <span>Location</span>
                      <input
                        className="text-input"
                        value={tracking.location || ""}
                        onChange={(event) => onJobTrackingChange("location", event.target.value)}
                      />
                    </label>
                    <label className="field">
                      <span>Job type</span>
                      <select
                        value={tracking.jobType || ""}
                        onChange={(event) => onJobTrackingChange("jobType", event.target.value)}
                      >
                        <option value="">Not specified</option>
                        {!jobTypeIsKnown && tracking.jobType ? (
                          <option value={tracking.jobType}>{tracking.jobType}</option>
                        ) : null}
                        {JOB_TYPES.map((jobType) => (
                          <option key={jobType} value={jobType}>
                            {jobType}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>Source</span>
                      <select
                        value={sourceValue}
                        onChange={(event) => onJobTrackingChange("source", event.target.value)}
                      >
                        <option value="">Not specified</option>
                        {APPLICATION_SOURCES.filter(Boolean).map((source) => (
                          <option key={source} value={source}>
                            {source}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>Work authorization</span>
                      <input
                        className="text-input"
                        value={tracking.workAuth || ""}
                        onChange={(event) => onJobTrackingChange("workAuth", event.target.value)}
                      />
                    </label>
                  </div>

                  <fieldset className="prepare-compensation">
                    <legend>Compensation</legend>
                    <label className="field">
                      <span>Minimum</span>
                      <input
                        className="text-input"
                        type="number"
                        min="0"
                        value={tracking.salaryMin ?? ""}
                        onChange={(event) =>
                          onJobTrackingChange(
                            "salaryMin",
                            event.target.value === "" ? null : Number(event.target.value)
                          )
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Maximum</span>
                      <input
                        className="text-input"
                        type="number"
                        min="0"
                        value={tracking.salaryMax ?? ""}
                        onChange={(event) =>
                          onJobTrackingChange(
                            "salaryMax",
                            event.target.value === "" ? null : Number(event.target.value)
                          )
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Currency</span>
                      <input
                        className="text-input"
                        value={tracking.salaryCurrency || ""}
                        onChange={(event) => onJobTrackingChange("salaryCurrency", event.target.value.toUpperCase())}
                        placeholder="USD"
                        maxLength={3}
                      />
                    </label>
                    <label className="field">
                      <span>Period</span>
                      <select
                        value={tracking.salaryPeriod || ""}
                        onChange={(event) => onJobTrackingChange("salaryPeriod", event.target.value)}
                      >
                        <option value="">Not specified</option>
                        <option value="yr">Year</option>
                        <option value="mo">Month</option>
                        <option value="hr">Hour</option>
                      </select>
                    </label>
                  </fieldset>

                  <label className="field prepare-role-context">
                    <span>Role context</span>
                    <textarea
                      className="textarea"
                      value={preparedJobRoleContext(tracking, brief)}
                      onChange={(event) => onJobTrackingChange("roleDescription", event.target.value)}
                      placeholder="What the role covers and why it matters."
                    />
                  </label>

                  <PreparedJobBriefSections sections={BRIEF_SECTIONS} brief={brief} onChange={onJobBriefChange} />
                </fieldset>

                <div className="prepare-gaps">
                  <div>
                    <p className="prepare-page__eyebrow">Extraction gaps</p>
                    {manualReviewFields.length ? (
                      <ul>
                        {manualReviewFields.map((field) => (
                          <li key={field}>{field}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>None.</p>
                    )}
                  </div>
                  <div>
                    <p className="prepare-page__eyebrow">
                      {reviewGapsProvenance === "saved" ? "Candidate gaps · historical" : "Candidate gaps"}
                    </p>
                    {reviewGaps.length ? (
                      <ul>
                        {reviewGaps.map((gap, index) => (
                          <li key={`${index}:${gap.severity}:${gap.gap}`}>
                            <strong>{gap.gap}</strong>
                            <span>{gap.severity.replace(/_/g, " ").toLowerCase()}</span>
                            {gap.evidence ? <p>{gap.evidence}</p> : null}
                          </li>
                        ))}
                      </ul>
                    ) : reviewGapsProvenance === "current" ? (
                      <p>No candidate gaps identified by the current Review.</p>
                    ) : reviewGapsProvenance === "saved" ? (
                      <p>None recorded in the saved Apply review.</p>
                    ) : (
                      <p>Run resume Review to compare your evidence with the job.</p>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <p className="prepare-panel__empty">
                Role facts, responsibilities, qualifications, keywords, benefits, and gaps appear here once a posting is
                prepared.
              </p>
            )}
          </section>

          {recommendationLiveRegion}
        </div>

        {jobPrepared ? (
          <PrepareApplicationRail
            activity={activity}
            fitAssessment={fitAssessment}
            linkedApplication={linkedApplication}
            readiness={readiness}
            isApplying={isApplying}
            onApply={onApply}
          >
            <PreparedMaterialCard
              id="prepare-resume"
              title="Resume"
              state={resumeState}
              included={includeResume}
              onIncludedChange={onIncludeResumeChange}
              variantLabel="Resume variant"
              variantValue={baseResumeName}
              variantOptions={baseResumeOptions}
              emptyVariantLabel={resumeReady ? "Current draft" : "No saved variants"}
              variantDisabled={
                isSelectingResume || isPolishing || isRankingResumeVariants || baseResumeOptions.length === 0
              }
              onVariantChange={(fileName) => void onSelectBaseResume(fileName)}
              actions={
                <>
                  <button
                    className="secondary-button is-compact"
                    type="button"
                    onClick={() => void onTailorPreparedResume()}
                    disabled={!canStartTailor}
                    aria-describedby={!canStartTailor && tailorHint ? "prepare-resume-note" : undefined}
                  >
                    {isPolishing ? <LoaderCircle className="spin" size={13} aria-hidden="true" /> : null}
                    Tailor
                  </button>
                  <button className="ghost-button is-compact" type="button" onClick={onReviewResume}>
                    {tailorDone || reviewDone ? "Review" : "Open"}
                    <ArrowRight size={12} aria-hidden="true" />
                  </button>
                </>
              }
            >
              {resumeNote ? (
                <p className="prepare-note" id="prepare-resume-note" role="status">
                  {resumeNote}
                </p>
              ) : (
                <PreparedVariantRecommendation
                  isRanking={isRankingResumeVariants}
                  recommendation={resumeVariantRecommendation}
                  selectedFileName={baseResumeName}
                  onUse={(fileName) => void onSelectBaseResume(fileName)}
                />
              )}
            </PreparedMaterialCard>

            <PreparedMaterialCard
              id="prepare-cover"
              title="Cover letter"
              state={coverState}
              included={includeCoverLetter}
              onIncludedChange={onIncludeCoverLetterChange}
              variantLabel="Cover-letter variant"
              variantValue={coverLetterFileName}
              variantOptions={coverLetterOptions}
              emptyVariantLabel={coverLetterReady ? "Current draft" : "No saved variants"}
              variantDisabled={
                isSelectingCoverLetter ||
                isTailoringCoverLetter ||
                isRankingCoverLetterVariants ||
                coverLetterOptions.length === 0
              }
              onVariantChange={(fileName) => void onSelectCoverLetter(fileName)}
              actions={
                <>
                  <button
                    className="secondary-button is-compact"
                    type="button"
                    onClick={() => void onTailorCoverLetter()}
                    disabled={!canTailorCoverLetter}
                    aria-describedby={!canTailorCoverLetter && coverLetterTailorHint ? "prepare-cover-note" : undefined}
                  >
                    {isTailoringCoverLetter ? <LoaderCircle className="spin" size={13} aria-hidden="true" /> : null}
                    {isTailoringCoverLetter ? "Tailoring…" : "Tailor"}
                  </button>
                  <button className="ghost-button is-compact" type="button" onClick={onOpenCoverLetter}>
                    Open
                    <ArrowRight size={12} aria-hidden="true" />
                  </button>
                </>
              }
            >
              {coverNote ? (
                <p className="prepare-note" id="prepare-cover-note" role="status">
                  {coverNote}
                </p>
              ) : (
                <PreparedVariantRecommendation
                  isRanking={isRankingCoverLetterVariants}
                  recommendation={coverLetterVariantRecommendation}
                  selectedFileName={coverLetterFileName}
                  onUse={(fileName) => void onSelectCoverLetter(fileName)}
                />
              )}
            </PreparedMaterialCard>
          </PrepareApplicationRail>
        ) : null}
      </div>
    </section>
  );
}
