import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  Circle,
  FileSearch,
  FileText,
  LoaderCircle,
  Mail,
  RotateCcw,
  ShieldCheck,
  Sparkles
} from "lucide-react";

import { APPLICATION_SOURCES, JOB_TYPES, type Application } from "../../hooks/useApplications";
import type { BaseResumeOption } from "../../hooks/useWorkspaceResume";
import type { ImportedJobSnapshot } from "../../hooks/useJobIntake";
import type { CoverLetterOption } from "../../lib/coverLetterWorkspaceRepository";
import type { AiStageState, PolishProgressState } from "../../lib/aiWorkflow";
import type { ExtractedJobTracking } from "../../lib/jobExtract";
import type { PreparedJobBriefField } from "../../lib/preparedJobBrief";
import type { PreparationReadiness } from "../../lib/preparationReadiness";
import type { ResumeVariantRecommendation } from "../../lib/resumeVariantRecommendation";
import { PreparedJobBriefListField } from "./prepare/PreparedJobBriefListField";
import { PreparedMaterialCard } from "./prepare/PreparedMaterialCard";
import { PrepareReadinessRail } from "./prepare/PrepareReadinessRail";

type ReviewGap = {
  gap: string;
  severity: string;
  evidence?: string;
};

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
  autoTailorPending: boolean;
  autoTailorNeedsVariantChoice: boolean;
  resumeDirty: boolean;
  resumeReady: boolean;
  isSelectingResume: boolean;
  includeResume: boolean;
  onIncludeResumeChange: (included: boolean) => void;
  baseResumeName: string;
  activeBaseResumeLabel: string;
  baseResumeOptions: BaseResumeOption[];
  onSelectBaseResume: (fileName: string) => void | Promise<unknown>;
  resumeVariantRecommendation: ResumeVariantRecommendation | null;
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
  coverLetterFileName: string;
  activeCoverLetterLabel: string;
  coverLetterOptions: CoverLetterOption[];
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
  autoTailorPending,
  autoTailorNeedsVariantChoice,
  resumeDirty,
  resumeReady,
  isSelectingResume,
  includeResume,
  onIncludeResumeChange,
  baseResumeName,
  activeBaseResumeLabel,
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
  coverLetterFileName,
  activeCoverLetterLabel,
  coverLetterOptions,
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
  linkedApplication,
  readiness,
  isApplying,
  onApply
}: PrepareTabProps) {
  const [sourceMode, setSourceMode] = useState<"collapsed" | "view" | "replace">(jobPrepared ? "collapsed" : "replace");

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
  const preparationHeadline = isReceiving
    ? "Receiving job from browser extension…"
    : progressRunning
      ? "Preparing application…"
      : distillProgress.status === "failed" || distillProgress.status === "stopped"
        ? distillProgress.errorHeadline || "Preparation stopped"
        : jobPrepared
          ? "Application prepared"
          : "Waiting for a job posting";
  const preparationDetail = isReceiving
    ? "RoleFit is waiting for the extension to finish resolving the full posting."
    : distillProgress.error ||
      preparationStatus ||
      (jobPrepared
        ? `${sourceLength.toLocaleString()} source characters are ready for drafting.`
        : "Use the browser extension, fetch a link, or paste the full description.");
  const tailorDone = polishOutputCurrent && polishProgress.tailor.status === "done";
  const reviewDone = polishOutputCurrent && polishProgress.review.status === "done";
  const tailoringHeadline = isPolishing
    ? polishProgress.review.status === "running"
      ? "Reviewing the tailored resume…"
      : "Tailoring the selected resume…"
    : reviewDone
      ? "Resume tailored and reviewed"
      : tailorDone
        ? "Resume tailored"
        : autoTailorPending
          ? "Automatic tailoring is ready to continue"
          : resumeReady
            ? "Resume ready"
            : "Resume needs a document";
  const canFetch = Boolean(jobUrl.trim()) && !isPreparing && distillProviderReady;
  // URL edits invalidate readiness but must not swap the controlled replacement
  // textarea from the captured posting back to the compact tailoring scaffold.
  // Direct textarea edits clear jobRawText in useJobIntake, so this still hands
  // control to the user's replacement on the first keystroke.
  const preparationSourceText = jobRawText || jobDescription;
  const canPreparePaste = preparationSourceText.trim().length >= 80 && !isPreparing && distillProviderReady;
  const fetchHint = !jobUrl.trim()
    ? "Enter a job URL on Prepare first."
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
  const sourceValue = APPLICATION_SOURCES.includes(tracking.source as (typeof APPLICATION_SOURCES)[number])
    ? (tracking.source ?? "")
    : tracking.source
      ? "Other"
      : "";
  const jobTypeIsKnown = JOB_TYPES.includes(tracking.jobType as (typeof JOB_TYPES)[number]);
  const recommendationSelected = resumeVariantRecommendation?.fileName === baseResumeName;
  const recommendationLiveText = isRankingResumeVariants
    ? "Comparing resume variants."
    : resumeVariantRecommendation
      ? `${resumeVariantRecommendation.label} recommended${
          recommendationSelected ? " and selected" : ""
        }. ${resumeVariantRecommendation.detail}`
      : "";
  const recommendationStatus = (
    <>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {recommendationLiveText}
      </span>
      {isRankingResumeVariants ? (
        <div className="prepare-recommendation is-working">
          <LoaderCircle className="spin" size={15} aria-hidden="true" />
          <div>
            <strong>Comparing resume variants</strong>
            <p>RoleFit is checking each saved resume against the prepared job.</p>
          </div>
        </div>
      ) : resumeVariantRecommendation ? (
        <div className={`prepare-recommendation is-${resumeVariantRecommendation.confidence}`}>
          <Sparkles size={15} aria-hidden="true" />
          <div>
            <strong>
              {resumeVariantRecommendation.label} recommended
              {recommendationSelected ? " · selected" : ""}
            </strong>
            <p>{resumeVariantRecommendation.detail}</p>
          </div>
        </div>
      ) : null}
    </>
  );

  return (
    <section className="workspace-page prepare-page">
      <header className="workspace-page__head prepare-page__head">
        <h2 className="page-serif">Prepare</h2>
        <span className={`prepare-page__state${jobPrepared ? " is-ready" : ""}`}>
          {jobPrepared ? <Check size={13} aria-hidden="true" /> : <Circle size={10} aria-hidden="true" />}
          {jobPrepared ? `${role} · ${company}` : "No prepared application"}
        </span>
      </header>

      <div className="prepare-layout">
        <div className="prepare-main">
          <section className="prepare-sheet" aria-labelledby="prepare-source-title">
            <div className="prepare-sheet__head">
              <div>
                <p className="prepare-page__eyebrow">Source</p>
                <h3 id="prepare-source-title">{jobPrepared ? "Posting captured" : "Add a posting manually"}</h3>
              </div>
              {jobPrepared ? (
                <div className="prepare-sheet__actions">
                  <button
                    className="ghost-button is-compact"
                    type="button"
                    onClick={() => setSourceMode((current) => (current === "view" ? "collapsed" : "view"))}
                  >
                    <FileSearch size={13} aria-hidden="true" />
                    {sourceMode === "view" ? "Hide source" : "View source"}
                  </button>
                  <button className="ghost-button is-compact" type="button" onClick={() => setSourceMode("replace")}>
                    Replace source
                  </button>
                  <button
                    className="secondary-button is-compact"
                    type="button"
                    onClick={() => void onPreparePosting(preparationSourceText)}
                    disabled={!canPreparePaste}
                    aria-describedby={!canPreparePaste ? "prepare-source-action-hint" : undefined}
                  >
                    <RotateCcw size={13} aria-hidden="true" />
                    Prepare again
                  </button>
                </div>
              ) : null}
            </div>
            {jobPrepared && !canPreparePaste && prepareHint ? (
              <p className="prepare-action-hint" id="prepare-source-action-hint">
                {prepareHint}
              </p>
            ) : null}

            {sourceMode === "collapsed" && jobPrepared ? (
              <p className="prepare-source-summary">
                {sourceLength.toLocaleString()} characters captured
                {jobUrl.trim() ? " from the linked posting" : " from pasted text"}.
              </p>
            ) : sourceMode === "view" && jobPrepared ? (
              <pre className="prepare-source-preview">{jobRawText || jobDescription}</pre>
            ) : (
              <div className="prepare-source-form">
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
                      className="secondary-button"
                      type="button"
                      onClick={() => void onFetchPosting()}
                      disabled={!canFetch}
                      aria-describedby={!canFetch && fetchHint ? "prepare-fetch-action-hint" : undefined}
                    >
                      {isPreparing ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : null}
                      Fetch posting
                    </button>
                  </span>
                  {!canFetch && fetchHint ? (
                    <span className="prepare-action-hint" id="prepare-fetch-action-hint">
                      {fetchHint}
                    </span>
                  ) : null}
                </label>
                <label className="field">
                  <span>Full job description</span>
                  <textarea
                    className="textarea prepare-source-textarea"
                    value={preparationSourceText}
                    onChange={(event) => onJobDescriptionChange(event.target.value)}
                    placeholder="Paste the complete role description, qualifications, location, compensation, and benefits."
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
                    className="primary-button"
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
                    <Sparkles size={14} aria-hidden="true" />
                    Prepare application
                  </button>
                </div>
                {!jobPrepared && !canPreparePaste && prepareHint ? (
                  <p className="prepare-action-hint" id="prepare-paste-action-hint">
                    {prepareHint}
                  </p>
                ) : null}
              </div>
            )}
          </section>

          <section className="prepare-sheet" aria-labelledby="prepare-brief-title">
            <div className="prepare-sheet__head">
              <div>
                <p className="prepare-page__eyebrow">Prepared brief</p>
                <h3 id="prepare-brief-title">{role}</h3>
                <p>{company}</p>
              </div>
              {jobPrepared ? <span className="prepare-chip">Ready</span> : null}
            </div>

            {jobPrepared && brief ? (
              <>
                <p className="prepare-detail-intro">
                  Correct missing or inaccurate details here. These edits update the prepared job used by Tailor and
                  Apply while the captured source stays unchanged.
                </p>
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

                  <div className="prepare-brief-grid">
                    <label className="field prepare-role-summary">
                      <span>Role summary</span>
                      <textarea
                        className="textarea"
                        value={tracking.roleDescription || ""}
                        onChange={(event) => onJobTrackingChange("roleDescription", event.target.value)}
                        placeholder="Summarize the responsibilities and scope that matter for this application."
                      />
                    </label>
                    <PreparedJobBriefListField
                      label="Company / product context"
                      field="companyContext"
                      value={brief.companyContext}
                      placeholder="What the company or product does and why this role exists."
                      onChange={onJobBriefChange}
                      className="prepare-role-summary"
                      instruction={null}
                    />
                    <PreparedJobBriefListField
                      label="Core responsibilities"
                      field="responsibilities"
                      value={brief.responsibilities}
                      placeholder="Build and maintain…"
                      onChange={onJobBriefChange}
                    />
                    <PreparedJobBriefListField
                      label="Required qualifications"
                      field="requiredQualifications"
                      value={brief.requiredQualifications}
                      placeholder="Required experience, skills, education, or credentials…"
                      onChange={onJobBriefChange}
                    />
                    <PreparedJobBriefListField
                      label="Preferred qualifications"
                      field="preferredQualifications"
                      value={brief.preferredQualifications}
                      placeholder="Nice-to-have experience or skills…"
                      onChange={onJobBriefChange}
                    />
                    <PreparedJobBriefListField
                      label="Tech stack / keywords"
                      field="techKeywords"
                      value={brief.techKeywords}
                      placeholder="TypeScript&#10;AWS&#10;PostgreSQL"
                      onChange={onJobBriefChange}
                    />
                    <PreparedJobBriefListField
                      label="Seniority signals"
                      field="senioritySignals"
                      value={brief.senioritySignals}
                      placeholder="Leadership, ownership, or years-of-experience signals…"
                      onChange={onJobBriefChange}
                    />
                    <PreparedJobBriefListField
                      label="Domain signals"
                      field="domainSignals"
                      value={brief.domainSignals}
                      placeholder="Fintech&#10;Healthcare&#10;Developer tools"
                      onChange={onJobBriefChange}
                    />
                    <PreparedJobBriefListField
                      label="Benefits"
                      field="benefits"
                      value={brief.benefits}
                      placeholder="Health coverage&#10;401(k) match&#10;Paid time off"
                      onChange={onJobBriefChange}
                      className="prepare-brief-list-field--wide"
                    />
                  </div>
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
                      <p>No extracted fields need review.</p>
                    )}
                  </div>
                  <div>
                    <p className="prepare-page__eyebrow">
                      {reviewGapsProvenance === "saved" ? "Saved candidate gaps" : "Candidate gaps"}
                    </p>
                    {reviewGapsProvenance === "saved" ? (
                      <p>
                        Historical Apply snapshot. Rerun Review after changing or replacing the resume.
                      </p>
                    ) : null}
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
                      <p>No candidate gaps were recorded in the saved Apply review.</p>
                    ) : (
                      <p>Run resume Review to compare candidate evidence with the job.</p>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <p className="prepare-sheet__empty">
                Role details, responsibilities, qualifications, skills, benefits, and detected gaps appear here after
                preparation.
              </p>
            )}
          </section>

          <PreparedMaterialCard
            id="prepare-resume"
            icon={<FileText size={17} />}
            title="Resume"
            included={includeResume}
            onIncludedChange={onIncludeResumeChange}
            description={tailoringHeadline}
            variantLabel="Resume variant"
            variantValue={baseResumeName}
            variantOptions={baseResumeOptions}
            emptyVariantLabel={resumeReady ? "Current application draft" : "No saved resume variants"}
            variantDisabled={
              isSelectingResume || isPolishing || isRankingResumeVariants || baseResumeOptions.length === 0
            }
            onVariantChange={(fileName) => void onSelectBaseResume(fileName)}
            variantStatus={
              resumeReady
                ? `Using ${activeBaseResumeLabel || "the resume in the editor"}.`
                : "Choose or create a resume before including it."
            }
            status={recommendationStatus}
            actions={
              <>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void onTailorPreparedResume()}
                  disabled={!canStartTailor}
                  aria-describedby={!canStartTailor && tailorHint ? "prepare-resume-tailor-hint" : undefined}
                >
                  <Sparkles size={14} aria-hidden="true" />
                  {autoTailorPending ? "Use and tailor this resume" : "Tailor prepared resume"}
                </button>
                {tailorDone || reviewDone ? (
                  <button className="ghost-button" type="button" onClick={onReviewResume}>
                    Review resume
                    <ArrowRight size={13} aria-hidden="true" />
                  </button>
                ) : null}
              </>
            }
          >
            {autoTailorPending && autoTailorNeedsVariantChoice ? (
              <div className="prepare-safety-note">
                <ShieldCheck size={16} aria-hidden="true" />
                <div>
                  <strong>Confirm the resume choice.</strong>
                  <p>The comparison did not produce a safe automatic selection.</p>
                </div>
              </div>
            ) : null}
            {autoTailorPending && resumeDirty ? (
              <div className="prepare-safety-note">
                <ShieldCheck size={16} aria-hidden="true" />
                <div>
                  <strong>Your unsaved resume is protected.</strong>
                  <p>Automatic tailoring is paused. Review the current draft, then start tailoring explicitly.</p>
                </div>
              </div>
            ) : null}
            {!canStartTailor && tailorHint ? (
              <p className="prepare-action-hint" id="prepare-resume-tailor-hint">
                {tailorHint}
              </p>
            ) : null}
            {polishStatus ? (
              <p className="prepare-inline-status" role="status">
                {polishStatus}
              </p>
            ) : null}
          </PreparedMaterialCard>

          <PreparedMaterialCard
            id="prepare-cover"
            icon={<Mail size={17} />}
            title="Cover letter"
            included={includeCoverLetter}
            onIncludedChange={onIncludeCoverLetterChange}
            description={
              isTailoringCoverLetter
                ? "Tailoring the selected cover letter…"
                : coverLetterReady
                  ? "Cover letter ready"
                  : "Cover letter needs a completed draft"
            }
            variantLabel="Cover-letter variant"
            variantValue={coverLetterFileName}
            variantOptions={coverLetterOptions}
            emptyVariantLabel={coverLetterReady ? "Current application draft" : "No saved cover-letter variants"}
            variantDisabled={isSelectingCoverLetter || isTailoringCoverLetter || coverLetterOptions.length === 0}
            onVariantChange={(fileName) => void onSelectCoverLetter(fileName)}
            variantStatus={
              coverLetterReady
                ? `Using ${activeCoverLetterLabel || "the cover letter in the editor"}.`
                : "Choose or draft a cover letter before including it."
            }
            actions={
              <>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void onTailorCoverLetter()}
                  disabled={!canTailorCoverLetter}
                  aria-describedby={
                    !canTailorCoverLetter && coverLetterTailorHint ? "prepare-cover-tailor-hint" : undefined
                  }
                >
                  {isTailoringCoverLetter ? (
                    <LoaderCircle className="spin" size={14} aria-hidden="true" />
                  ) : (
                    <Sparkles size={14} aria-hidden="true" />
                  )}
                  {isTailoringCoverLetter ? "Tailoring…" : "Tailor prepared cover letter"}
                </button>
                <button className="ghost-button" type="button" onClick={onOpenCoverLetter}>
                  Review cover letter
                  <ArrowRight size={13} aria-hidden="true" />
                </button>
              </>
            }
          >
            {!canTailorCoverLetter && coverLetterTailorHint ? (
              <p className="prepare-action-hint" id="prepare-cover-tailor-hint">
                {coverLetterTailorHint}
              </p>
            ) : null}
            {coverLetterStatus ? (
              <p className="prepare-inline-status" role="status">
                {coverLetterStatus}
              </p>
            ) : null}
          </PreparedMaterialCard>
        </div>

        <PrepareReadinessRail
          progressRunning={progressRunning}
          preparationHeadline={preparationHeadline}
          preparationDetail={preparationDetail}
          linkedApplication={linkedApplication}
          readiness={readiness}
          isApplying={isApplying}
          onApply={onApply}
        />
      </div>
    </section>
  );
}
