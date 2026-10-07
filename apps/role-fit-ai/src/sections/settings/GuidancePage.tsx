import { useState } from "react";
import { ChevronDown } from "lucide-react";

import { AI_STAGES, type AiStageDescriptor } from "../../config/aiStages";
import type { SettingsDialogProps } from "../SettingsDialog";

type GuidancePageProps = Pick<SettingsDialogProps,
  | "customInstructions" | "onCustomInstructionsChange"
  | "stageCustomInstructions" | "onStageCustomInstructionChange"
  | "boldBulletKeywords" | "onBoldBulletKeywordsChange"
>;

type StageInstructionsProps = {
  stage: AiStageDescriptor;
  value: string;
  onChange: (value: string) => void;
};

// One stage's override, disclosed. A set override stays legible when collapsed,
// otherwise guidance that is actually being sent would be invisible.
function StageInstructions({ stage, value, onChange }: StageInstructionsProps) {
  const isSet = Boolean(value.trim());
  const [open, setOpen] = useState(isSet);
  return (
    <div className="settings-guidance__stage">
      <button
        type="button"
        className={`settings-stage__disclose${open ? " is-open" : ""}`}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <ChevronDown size={12} aria-hidden="true" />
        <strong>{stage.title}</strong>
        {!isSet ? <span className="settings-guidance__state">Uses custom instructions</span> : null}
      </button>
      {!open && isSet ? <p className="settings-stage__preview">{value.trim()}</p> : null}
      {open ? (
        <label className="field">
          <span className="sr-only">Instructions for {stage.title}</span>
          <textarea
            className="textarea"
            rows={3}
            value={value}
            placeholder="Replaces the custom instructions for this stage. Leave empty to use them."
            onChange={(event) => onChange(event.target.value)}
          />
        </label>
      ) : null}
    </div>
  );
}

export function GuidancePage({
  customInstructions,
  onCustomInstructionsChange,
  stageCustomInstructions,
  onStageCustomInstructionChange,
  boldBulletKeywords,
  onBoldBulletKeywordsChange
}: GuidancePageProps) {
  return (
    <>
      <p className="settings-panel__intro">
        Applies to every AI stage. A stage with its own instructions below uses them instead.
      </p>

      <label className="field">
        <span>
          Custom instructions <small>(optional — steer tone, length, and emphasis)</small>
        </span>
        <textarea
          className="textarea"
          value={customInstructions}
          onChange={(event) => onCustomInstructionsChange(event.target.value)}
          placeholder="e.g., aim for one page; lead each bullet with a metric; use British spelling; don't add a summary section."
          rows={6}
        />
      </label>

      <div className="menu-subhead">
        <span className="menu-subhead__title">Per stage</span>
      </div>
      <div className="settings-guidance__stages">
        {AI_STAGES.filter((stage) => stage.supportsInstructions).map((stage) => (
          <StageInstructions
            key={stage.id}
            stage={stage}
            value={stageCustomInstructions[stage.id] ?? ""}
            onChange={(value) => onStageCustomInstructionChange(stage.id, value)}
          />
        ))}
      </div>

      <div className="menu-subhead">
        <span className="menu-subhead__title">Resume Polish</span>
      </div>
      <label className="check-row">
        <input
          type="checkbox"
          checked={boldBulletKeywords}
          onChange={(event) => onBoldBulletKeywordsChange(event.target.checked)}
        />
        <span>
          <strong>Bold keywords in bullets</strong>
          <small>Off keeps bullets Resume Polish rewrites unbolded.</small>
        </span>
      </label>
    </>
  );
}
