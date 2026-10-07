import { useRef, type Ref } from "react";
import { RotateCcw, X } from "lucide-react";

import { useModalFocus } from "@typeset/editor/hooks/useModalFocus.ts";
import type { AiStageId } from "../config/aiStages";
import type {
  AvailabilityNotice,
  CitizenshipStatus,
  DeclaredAnswer,
  EducationLevel
} from "../lib/candidateFacts";
import type { AiProviderValue } from "../config/aiOptions";
import type { StageConfig } from "../lib/aiRequest";
import type {
  AvailableProviderConnection,
  ProviderAvailabilityStatus
} from "../hooks/useAvailableProviders";
import type { WorkspacePreferencesStatus } from "../lib/workspacePreferencesSync.ts";
import type { ResumeData } from "@typeset/engine/lib/resumeData.ts";
import type { AutoPolishThreshold } from "../lib/autoPolishPolicy.ts";
import type { VariantExclusions, VariantKind } from "../lib/variantPool.ts";
import type { ProfileNoteFocus } from "./settings/ProfileNotes.tsx";
import { AutomationPage } from "./settings/AutomationPage.tsx";
import { BackgroundPage } from "./settings/BackgroundPage.tsx";
import { GuidancePage } from "./settings/GuidancePage.tsx";
import { ModelsPage } from "./settings/ModelsPage.tsx";
import { ProfilePage } from "./settings/ProfilePage.tsx";

export type SettingsSection = "profile" | "background" | "guidance" | "automation" | "models";

// Your own facts and notes first, then how the AI runs.
export const SETTINGS_GROUPS: { label: string; sections: { id: SettingsSection; label: string }[] }[] = [
  { label: "You", sections: [{ id: "profile", label: "Profile" }, { id: "background", label: "Background" }] },
  { label: "AI", sections: [{ id: "guidance", label: "Guidance" }, { id: "automation", label: "Automation" }, { id: "models", label: "Models" }] }
];

export const SETTINGS_SECTIONS = SETTINGS_GROUPS.flatMap((group) => group.sections);

export type SettingsVariantOption = { fileName: string; label: string };

export type SettingsDialogProps = {
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  onClose: () => void;
  workspacePreferencesStatus: WorkspacePreferencesStatus;

  // ----- Models and Automation -----
  stages: Record<AiStageId, StageConfig>;
  onStageChange: (stage: AiStageId, patch: Partial<StageConfig>) => void;
  onStageProviderChange: (stage: AiStageId, provider: AiProviderValue) => void;
  onCopyStage: (from: AiStageId, to: AiStageId) => void;
  providers: readonly AvailableProviderConnection[];
  availabilityStatus: ProviderAvailabilityStatus;
  availabilityMessage: string;
  onRefreshProviders: () => void | Promise<void>;
  fitAssessmentAuto: boolean;
  onFitAssessmentAutoChange: (value: boolean) => void;
  resumePolishAuto: boolean;
  onResumePolishAutoChange: (value: boolean) => void;
  resumePolishAutoThreshold: AutoPolishThreshold;
  onResumePolishAutoThresholdChange: (value: AutoPolishThreshold) => void;
  coverPolishAuto: boolean;
  onCoverPolishAutoChange: (value: boolean) => void;
  coverPolishAutoThreshold: AutoPolishThreshold;
  onCoverPolishAutoThresholdChange: (value: AutoPolishThreshold) => void;
  // Saved variants for "Prepare picks from"; null while that workspace loads.
  resumeVariants: SettingsVariantOption[] | null;
  coverLetterVariants: SettingsVariantOption[] | null;
  excludedResumeVariants: VariantExclusions;
  excludedCoverLetterVariants: VariantExclusions;
  onVariantEligibilityChange: (kind: VariantKind, fileName: string, eligible: boolean) => void;

  // ----- Profile -----
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

  // ----- Background -----
  profileBackground: string;
  onProfileBackgroundChange: (value: string) => void;
  profileBackgroundRef?: Ref<HTMLTextAreaElement>;
  // The open resume whose entries organise the Background; null (no real
  // resume open) falls back to the plain text field.
  profileResume: ResumeData | null;
  // Selects the note starting on a line and focuses its notes, once per nonce.
  profileNoteFocus?: ProfileNoteFocus | null;

  // ----- Guidance -----
  boldBulletKeywords: boolean;
  onBoldBulletKeywordsChange: (value: boolean) => void;
  customInstructions: string;
  onCustomInstructionsChange: (value: string) => void;
  stageCustomInstructions: Partial<Record<AiStageId, string>>;
  onStageCustomInstructionChange: (stage: AiStageId, value: string) => void;

  // ----- Reset -----
  onReset: () => void | Promise<void>;
};

// The single home for every RoleFit preference, opened from the bottom of the
// studio sidebar. The shell owns the rail, autosave status, and focus trap;
// each page renders from the props it names.
export function SettingsDialog(props: SettingsDialogProps) {
  const { section, onSectionChange, onClose, workspacePreferencesStatus, onReset } = props;
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
            {SETTINGS_GROUPS.map((group) => (
              <div className="settings-nav__group" key={group.label} role="group" aria-label={group.label}>
                <span className="settings-nav__group-label" aria-hidden="true">{group.label}</span>
                {group.sections.map((entry) => (
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
              </div>
            ))}

            {/* An action, not a section: pinned to the rail's foot and reachable
                from every page. */}
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

          <div className="settings-panel" data-section={section}>
            {section === "profile" ? <ProfilePage {...props} /> : null}
            {section === "background" ? <BackgroundPage {...props} /> : null}
            {section === "guidance" ? <GuidancePage {...props} /> : null}
            {section === "automation" ? <AutomationPage {...props} /> : null}
            {section === "models" ? <ModelsPage {...props} /> : null}
            {/* Deliberately no runtime diagnostics page (server address,
                workspace path, provider counts): those describe the machine the
                companion runs and belong in RoleFit Companion. */}
          </div>
        </div>
      </div>
    </div>
  );
}
