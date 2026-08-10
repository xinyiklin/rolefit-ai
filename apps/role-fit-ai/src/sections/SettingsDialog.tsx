import { useRef, type Ref } from "react";
import { RotateCcw, X } from "lucide-react";

import { useModalFocus } from "@typeset/editor/hooks/useModalFocus.ts";
import { AI_STAGES, type AiStageId } from "../config/aiStages";
import {
  AVAILABILITY_NOTICE_OPTIONS,
  CITIZENSHIP_OPTIONS,
  DECLARED_ANSWER_OPTIONS,
  EDUCATION_LEVEL_OPTIONS,
  MAJOR_MAX_LENGTH,
  type AvailabilityNotice,
  type CandidateExperience,
  type CitizenshipStatus,
  type DeclaredAnswer,
  type EducationLevel
} from "../lib/candidateFacts";
import type { AiProviderValue } from "../config/aiOptions";
import type { StageConfig } from "../lib/aiRequest";
import type {
  AvailableProviderConnection,
  ProviderAvailabilityStatus
} from "../hooks/useAvailableProviders";
import type { WorkspacePreferencesStatus } from "../lib/workspacePreferencesSync.ts";
import { ExperienceProfileFields } from "./ExperienceProfileFields";
import { SettingsStage } from "./SettingsStage";
import {
  AUTO_POLISH_THRESHOLD_OPTIONS,
  type AutoPolishThreshold
} from "../lib/autoPolishPolicy.ts";

export type SettingsSection = "stages" | "about" | "guidance";

export const SETTINGS_SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: "stages", label: "AI stages" },
  { id: "about", label: "About you" },
  { id: "guidance", label: "Guidance" }
];

type SettingsDialogProps = {
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  onClose: () => void;

  // ----- AI stages -----
  stages: Record<AiStageId, StageConfig>;
  onStageChange: (stage: AiStageId, patch: Partial<StageConfig>) => void;
  onStageProviderChange: (stage: AiStageId, provider: AiProviderValue) => void;
  onCopyStage: (from: AiStageId, to: AiStageId) => void;
  providers: readonly AvailableProviderConnection[];
  availabilityStatus: ProviderAvailabilityStatus;
  availabilityMessage: string;
  onRefreshProviders: () => void | Promise<void>;
  runFitAssessment: boolean;
  onRunFitAssessmentChange: (value: boolean) => void;
  autoPolishResume: boolean;
  onAutoPolishResumeChange: (value: boolean) => void;
  resumeAutoPolishThreshold: AutoPolishThreshold;
  onResumeAutoPolishThresholdChange: (value: AutoPolishThreshold) => void;
  autoPolishCoverLetter: boolean;
  onAutoPolishCoverLetterChange: (value: boolean) => void;
  coverLetterAutoPolishThreshold: AutoPolishThreshold;
  onCoverLetterAutoPolishThresholdChange: (value: AutoPolishThreshold) => void;

  // ----- About you -----
  citizenshipStatus: CitizenshipStatus;
  onCitizenshipChange: (value: CitizenshipStatus) => void;
  legallyAuthorizedToWork: DeclaredAnswer;
  onLegallyAuthorizedChange: (value: DeclaredAnswer) => void;
  requiresSponsorship: DeclaredAnswer;
  onRequiresSponsorshipChange: (value: DeclaredAnswer) => void;
  educationLevel: EducationLevel;
  onEducationLevelChange: (value: EducationLevel) => void;
  major: string;
  onMajorChange: (value: string) => void;
  gpa: number | undefined;
  onGpaChange: (value: number | undefined) => void;
  availabilityNotice: AvailabilityNotice;
  onAvailabilityNoticeChange: (value: AvailabilityNotice) => void;
  availabilityDate: string;
  onAvailabilityDateChange: (value: string) => void;
  experienceProfile: CandidateExperience[];
  onExperienceProfileChange: (value: CandidateExperience[]) => void;
  workspacePreferencesStatus: WorkspacePreferencesStatus;

  // ----- Guidance -----
  honestContext: string;
  onHonestContextChange: (value: string) => void;
  honestContextRef?: Ref<HTMLTextAreaElement>;
  customInstructions: string;
  onCustomInstructionsChange: (value: string) => void;
  stageCustomInstructions: Partial<Record<AiStageId, string>>;
  onStageCustomInstructionChange: (stage: AiStageId, value: string) => void;

  // ----- Reset -----
  onReset: () => void | Promise<void>;
};

// The single home for every RoleFit preference. It replaced the masthead's "AI
// provider and model" and "Options" popovers: those were two separate menus over
// one settings hook, and adding a fourth and fifth AI stage to them would have
// made the taller one unusable. Opened from the bottom of the studio sidebar.
export function SettingsDialog({
  section,
  onSectionChange,
  onClose,
  stages,
  onStageChange,
  onStageProviderChange,
  onCopyStage,
  providers,
  availabilityStatus,
  availabilityMessage,
  onRefreshProviders,
  runFitAssessment,
  onRunFitAssessmentChange,
  autoPolishResume,
  onAutoPolishResumeChange,
  resumeAutoPolishThreshold,
  onResumeAutoPolishThresholdChange,
  autoPolishCoverLetter,
  onAutoPolishCoverLetterChange,
  coverLetterAutoPolishThreshold,
  onCoverLetterAutoPolishThresholdChange,
  citizenshipStatus,
  onCitizenshipChange,
  legallyAuthorizedToWork,
  onLegallyAuthorizedChange,
  requiresSponsorship,
  onRequiresSponsorshipChange,
  educationLevel,
  onEducationLevelChange,
  major,
  onMajorChange,
  gpa,
  onGpaChange,
  availabilityNotice,
  onAvailabilityNoticeChange,
  availabilityDate,
  onAvailabilityDateChange,
  experienceProfile,
  onExperienceProfileChange,
  workspacePreferencesStatus,
  honestContext,
  onHonestContextChange,
  honestContextRef,
  customInstructions,
  onCustomInstructionsChange,
  stageCustomInstructions,
  onStageCustomInstructionChange,
  onReset
}: SettingsDialogProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const handleKeyDown = useModalFocus({
    active: true,
    containerRef: cardRef,
    initialFocusRef: closeRef,
    onClose
  });

  return (
    <div
      className="settings-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="RoleFit settings"
      onKeyDown={handleKeyDown}
    >
      <div className="settings-dialog__backdrop" aria-hidden="true" onMouseDown={onClose} />
      <div className="settings-dialog__card" ref={cardRef} tabIndex={-1}>
        <header className="settings-dialog__head">
          <h2>Settings</h2>
          {/* Settings has no Save button because it autosaves. Say so once, here,
              rather than leaving a dialog with no obvious commit. */}
          <span
            className={`settings-dialog__autosave${workspacePreferencesStatus === "error" ? " is-error" : ""}`}
            role="status"
            aria-live="polite"
          >
            {workspacePreferencesStatus === "saving"
              ? "Saving to this workspace…"
              : workspacePreferencesStatus === "error"
                ? "Workspace save failed; reconnect the companion to retry."
                : "Changes save to this workspace."}
          </span>
          <button
            ref={closeRef}
            type="button"
            className="settings-dialog__close"
            aria-label="Close settings"
            onClick={onClose}
          >
            <X size={15} aria-hidden="true" />
          </button>
        </header>

        <div className="settings-dialog__body">
          <nav className="settings-nav" aria-label="Settings sections">
            {SETTINGS_SECTIONS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={`settings-nav__item${section === entry.id ? " is-active" : ""}`}
                aria-current={section === entry.id || undefined}
                onClick={() => onSectionChange(entry.id)}
              >
                {entry.label}
              </button>
            ))}

            {/* Pinned to the foot of this rail, the same way Settings itself is
                pinned to the foot of the studio rail that opens it. Not a section
                — it is an action, so it stays out of the section list above and
                is reachable from whichever section is open. */}
            <div className="settings-nav__foot">
              <button
                type="button"
                className="ghost-button is-compact settings-reset"
                onClick={() => void onReset()}
              >
                <RotateCcw size={13} aria-hidden="true" />
                Reset all settings
              </button>
            </div>
          </nav>

          {/* The open section is on the element so a panel's own row rhythm can
              be styled without every section inventing a wrapper. */}
          <div className="settings-panel" data-section={section}>
            {section === "stages" ? (
              <>
                <p className="settings-panel__intro">
                  Each stage runs on its own provider and model. Add providers in RoleFit
                  Companion; your API keys never reach the browser.
                </p>

                <div className="settings-automation-group">
                  <div className="settings-automation" aria-label="Prepare automation">
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={runFitAssessment}
                        onChange={(event) => onRunFitAssessmentChange(event.target.checked)}
                      />
                      <span>
                        <strong>Run Fit Assessment after Prepare</strong>
                        <small>Assesses the selected resume with Job analysis. You can reassess anytime.</small>
                      </span>
                    </label>
                    {/* One row per document. The checkbox label already names the
                        document, so a Resume / Cover letter subhead over it was a
                        second row saying the same word. */}
                    <div className="settings-automation__document">
                      <label className="check-row">
                        <input
                          type="checkbox"
                          checked={autoPolishResume}
                          disabled={!runFitAssessment}
                          onChange={(event) => onAutoPolishResumeChange(event.target.checked)}
                        />
                        <span><strong>Automatically Polish resume</strong></span>
                      </label>
                      <label className="field field--inline settings-automation__threshold">
                        <span>Minimum fit</span>
                        <select
                          className="select--compact"
                          value={resumeAutoPolishThreshold}
                          disabled={!runFitAssessment || !autoPolishResume}
                          onChange={(event) => onResumeAutoPolishThresholdChange(
                            event.target.value as AutoPolishThreshold
                          )}
                        >
                          {AUTO_POLISH_THRESHOLD_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="settings-automation__document">
                      <label className="check-row">
                        <input
                          type="checkbox"
                          checked={autoPolishCoverLetter}
                          disabled={!runFitAssessment}
                          onChange={(event) => onAutoPolishCoverLetterChange(event.target.checked)}
                        />
                        <span><strong>Automatically Polish cover letter</strong></span>
                      </label>
                      <label className="field field--inline settings-automation__threshold">
                        <span>Minimum fit</span>
                        <select
                          className="select--compact"
                          value={coverLetterAutoPolishThreshold}
                          disabled={!runFitAssessment || !autoPolishCoverLetter}
                          onChange={(event) => onCoverLetterAutoPolishThresholdChange(
                            event.target.value as AutoPolishThreshold
                          )}
                        >
                          {AUTO_POLISH_THRESHOLD_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>

                  <p className="settings-automation__note">
                    Resume Polish uses one proposal request and leaves the current resume unchanged until you accept edits.
                  </p>
                </div>

                <div className="settings-stages">
                  {AI_STAGES.map((stage) => (
                    <SettingsStage
                      key={stage.id}
                      stage={stage.id}
                      title={stage.title}
                      blurb={stage.blurb}
                      config={stages[stage.id]}
                      providers={providers}
                      availabilityStatus={availabilityStatus}
                      availabilityMessage={availabilityMessage}
                      onRefreshProviders={onRefreshProviders}
                      onChange={(patch) => onStageChange(stage.id, patch)}
                      onProviderChange={(provider) => onStageProviderChange(stage.id, provider)}
                      onCopyFrom={(from) => onCopyStage(from, stage.id)}
                      instructions={stageCustomInstructions[stage.id] ?? ""}
                      onInstructionsChange={(value) => onStageCustomInstructionChange(stage.id, value)}
                      supportsInstructions={stage.supportsInstructions}
                    />
                  ))}
                </div>
              </>
            ) : null}

            {section === "about" ? (
              <>
                <p className="settings-panel__intro">
                  Optional facts that clarify evidence on or beyond your resume. Nothing here is
                  sent to the AI until you fill it in.
                </p>

                <label className="field field--inline">
                  <span><strong>Citizenship</strong></span>
                  <select
                    className="select--compact"
                    value={citizenshipStatus}
                    onChange={(event) => onCitizenshipChange(event.target.value as CitizenshipStatus)}
                  >
                    {/* Neutral default: shown until a concrete status is picked, but not a
                        selectable menu entry (anti-fabrication opt-in gate). */}
                    <option value="unspecified" disabled hidden>Not specified</option>
                    {CITIZENSHIP_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>

                <label className="field field--inline">
                  <span><strong>Authorized to work in the U.S.</strong></span>
                  <select
                    className="select--compact"
                    value={legallyAuthorizedToWork}
                    onChange={(event) => onLegallyAuthorizedChange(event.target.value as DeclaredAnswer)}
                  >
                    {DECLARED_ANSWER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>

                <label className="field field--inline">
                  <span><strong>Requires visa sponsorship</strong></span>
                  <select
                    className="select--compact"
                    value={requiresSponsorship}
                    onChange={(event) => onRequiresSponsorshipChange(event.target.value as DeclaredAnswer)}
                  >
                    {DECLARED_ANSWER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>

                <div className="menu-subhead">
                  <span className="menu-subhead__title">Education</span>
                </div>

                <label className="field field--inline">
                  <span><strong>Highest completed level</strong></span>
                  <select
                    className="select--compact"
                    value={educationLevel}
                    onChange={(event) => onEducationLevelChange(event.target.value as EducationLevel)}
                  >
                    {/* Same opt-in gate as citizenship: a degree is one of the easiest
                        things for a resume model to invent, so the default claims none. */}
                    <option value="unspecified" disabled hidden>Not specified</option>
                    {EDUCATION_LEVEL_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>

                {educationLevel === "unspecified" ? (
                  <p className="micro-status">Choose a level to include your education as evidence.</p>
                ) : (
                  <>
                    <label className="field field--inline">
                      <span>Field of study <small>(optional)</small></span>
                      <input
                        className="text-input"
                        type="text"
                        maxLength={MAJOR_MAX_LENGTH}
                        value={major}
                        placeholder="e.g. Mechanical Engineering"
                        onChange={(event) => onMajorChange(event.target.value)}
                      />
                    </label>
                    <label className="field field--inline" htmlFor="candidate-gpa">
                      <span>GPA <small>(optional)</small></span>
                      <input
                        id="candidate-gpa"
                        className="text-input text-input--narrow"
                        type="number"
                        min={0}
                        max={4}
                        step={0.01}
                        inputMode="decimal"
                        value={gpa ?? ""}
                        placeholder="e.g. 3.8"
                        onChange={(event) => {
                          const value = event.target.value;
                          onGpaChange(value === "" ? undefined : Number(value));
                        }}
                      />
                    </label>
                  </>
                )}

                <div className="menu-subhead">
                  <span className="menu-subhead__title">Availability</span>
                </div>

                <label className="field field--inline">
                  <span><strong>Earliest start</strong></span>
                  <select
                    className="select--compact"
                    value={availabilityNotice}
                    onChange={(event) => {
                      const next = event.target.value as AvailabilityNotice;
                      onAvailabilityNoticeChange(next);
                      if (next !== "specific-date") onAvailabilityDateChange("");
                    }}
                  >
                    {AVAILABILITY_NOTICE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>

                {availabilityNotice === "specific-date" ? (
                  <label className="field field--inline" htmlFor="candidate-availability-date">
                    <span>Earliest available date</span>
                    <input
                      id="candidate-availability-date"
                      className="text-input text-input--narrow"
                      type="date"
                      value={availabilityDate}
                      onChange={(event) => onAvailabilityDateChange(event.target.value)}
                    />
                  </label>
                ) : null}

                <div className="menu-subhead">
                  <span className="menu-subhead__title">Experience evidence</span>
                </div>

                <p className="settings-panel__supporting-copy">
                  Break experience down by source so a strict professional-years requirement is not
                  treated the same as academic or personal work. Relevance remains job-specific.
                </p>

                <ExperienceProfileFields
                  value={experienceProfile}
                  onChange={onExperienceProfileChange}
                />
              </>
            ) : null}

            {section === "guidance" ? (
              <>
                <p className="settings-panel__intro">
                  Applies to every AI stage. A stage with its own instructions overrides the
                  custom instructions below.
                </p>

                <label className="field">
                  <span>
                    Honest context <small>(real experience not on your resume — cited as evidence, never invented)</small>
                  </span>
                  <textarea
                    ref={honestContextRef}
                    className="textarea"
                    value={honestContext}
                    onChange={(event) => onHonestContextChange(event.target.value)}
                    placeholder="e.g., shipped a PostgreSQL migration with zero downtime; led a 3-person hackathon team; merged PR to django-rest-framework."
                    rows={8}
                  />
                </label>

                <label className="field">
                  <span>
                    Custom instructions <small>(optional — steer tone, length, and emphasis)</small>
                  </span>
                  <textarea
                    className="textarea"
                    value={customInstructions}
                    onChange={(event) => onCustomInstructionsChange(event.target.value)}
                    placeholder="e.g., aim for one page; lead each bullet with a metric; use British spelling; don't add a summary section."
                    rows={8}
                  />
                </label>
              </>
            ) : null}

            {/* Deliberately no runtime diagnostics section (local server address,
                workspace path, provider counts). Those describe the machine the
                companion runs, not a browser preference, and RoleFit Companion is
                where they belong. Per-stage readiness is not repeated either — a
                blocked stage says so in its own row, next to the control that
                fixes it. */}
          </div>
        </div>
      </div>
    </div>
  );
}
