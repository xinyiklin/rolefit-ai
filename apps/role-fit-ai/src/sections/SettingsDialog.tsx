import { useRef, type Ref } from "react";
import { RotateCcw, X } from "lucide-react";

import { useModalFocus } from "@typeset/editor/hooks/useModalFocus.ts";
import { AI_STAGES, type AiStageId } from "../config/aiStages";
import {
  CITIZENSHIP_OPTIONS,
  EDUCATION_LEVEL_OPTIONS,
  MAJOR_MAX_LENGTH,
  type CitizenshipStatus,
  type EducationLevel
} from "../lib/candidateFacts";
import type { AiProviderValue } from "../config/aiOptions";
import type { StageConfig } from "../lib/aiRequest";
import type {
  AvailableProviderConnection,
  ProviderAvailabilityStatus
} from "../hooks/useAvailableProviders";
import { SettingsStage } from "./SettingsStage";

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
  runInitialFit: boolean;
  runFinalCheck: boolean;
  onRunFinalCheckChange: (value: boolean) => void;
  onRunInitialFitChange: (value: boolean) => void;
  autoCreateResumeProposal: boolean;
  onAutoCreateResumeProposalChange: (value: boolean) => void;
  autoCreateCoverLetterProposal: boolean;
  onAutoCreateCoverLetterProposalChange: (value: boolean) => void;

  // ----- About you -----
  citizenshipStatus: CitizenshipStatus;
  onCitizenshipChange: (value: CitizenshipStatus) => void;
  legallyAuthorizedToWork: boolean;
  onLegallyAuthorizedChange: (value: boolean) => void;
  requiresSponsorship: boolean;
  onRequiresSponsorshipChange: (value: boolean) => void;
  educationLevel: EducationLevel;
  onEducationLevelChange: (value: EducationLevel) => void;
  major: string;
  onMajorChange: (value: string) => void;

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
  runInitialFit,
  runFinalCheck,
  onRunFinalCheckChange,
  onRunInitialFitChange,
  autoCreateResumeProposal,
  onAutoCreateResumeProposalChange,
  autoCreateCoverLetterProposal,
  onAutoCreateCoverLetterProposalChange,
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
          <span className="settings-dialog__autosave">Changes save as you make them.</span>
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

          <div className="settings-panel">
            {section === "stages" ? (
              <>
                <p className="settings-panel__intro">
                  Each stage runs on its own provider and model. Add providers in RoleFit
                  Companion; your API keys never reach the browser.
                </p>

                <div className="settings-default-stages">
                  <div className="settings-automation" aria-label="Prepare automation">
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={runInitialFit}
                        onChange={(event) => onRunInitialFitChange(event.target.checked)}
                      />
                      <span>
                        <strong>Run Initial Fit after Prepare</strong>
                        <small>Checks the selected resume in the same AI request.</small>
                      </span>
                    </label>
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={autoCreateResumeProposal}
                        disabled={!runInitialFit}
                        onChange={(event) => onAutoCreateResumeProposalChange(event.target.checked)}
                      />
                      <span>
                        <strong>Automatically create a resume proposal</strong>
                        <small>Runs after Strong or Reasonable Fit.</small>
                      </span>
                    </label>
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={autoCreateCoverLetterProposal}
                        disabled={!runInitialFit}
                        onChange={(event) => onAutoCreateCoverLetterProposalChange(event.target.checked)}
                      />
                      <span>
                        <strong>Automatically create a cover-letter proposal</strong>
                        <small>Runs independently after Strong or Reasonable Fit.</small>
                      </span>
                    </label>
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={runFinalCheck}
                        onChange={(event) => onRunFinalCheckChange(event.target.checked)}
                      />
                      <span>
                        <strong>Check the document after Polish</strong>
                        <small>Reviews the resulting document once your edit decisions settle.</small>
                      </span>
                    </label>
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
                    />
                  ))}
                </div>
              </>
            ) : null}

            {section === "about" ? (
              <>
                <p className="settings-panel__intro">
                  Optional facts about you that are not on your resume. Nothing here is sent to the
                  AI until you fill it in.
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

                {/* Work-auth facts are sent to the AI only once a citizenship is chosen, so
                    the checkboxes stay hidden (and inert) until then — nothing about
                    citizenship/authorization is asserted by default. */}
                {citizenshipStatus === "unspecified" ? (
                  <p className="micro-status">Choose a status to include your work authorization as evidence.</p>
                ) : (
                  <>
                    <label className="check-row">
                      <input
                        checked={legallyAuthorizedToWork}
                        onChange={(event) => onLegallyAuthorizedChange(event.target.checked)}
                        type="checkbox"
                      />
                      <span><strong>Legally authorized to work in the U.S.</strong></span>
                    </label>
                    <label className="check-row">
                      <input
                        checked={requiresSponsorship}
                        onChange={(event) => onRequiresSponsorshipChange(event.target.checked)}
                        type="checkbox"
                      />
                      <span><strong>Will require visa sponsorship</strong></span>
                    </label>
                  </>
                )}

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
                  <label className="field">
                    <span>Field of study <small>(optional)</small></span>
                    <input
                      className="input"
                      type="text"
                      maxLength={MAJOR_MAX_LENGTH}
                      value={major}
                      placeholder="e.g. Mechanical Engineering"
                      onChange={(event) => onMajorChange(event.target.value)}
                    />
                  </label>
                )}
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
