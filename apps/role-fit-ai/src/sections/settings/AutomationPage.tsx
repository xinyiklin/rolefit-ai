import { useEffect, useState } from "react";
import { AUTO_POLISH_THRESHOLD_OPTIONS, type AutoPolishThreshold } from "../../lib/autoPolishPolicy.ts";
import { MAX_GHOSTED_AFTER_DAYS, MIN_GHOSTED_AFTER_DAYS, normalizeGhostedAfterDays } from "../../lib/ghostedThreshold.ts";
import type { VariantExclusions } from "../../lib/variantPool.ts";
import type { SettingsDialogProps, SettingsVariantOption } from "../SettingsDialog";

type AutomationPageProps = Pick<SettingsDialogProps,
  | "fitAssessmentAuto" | "onFitAssessmentAutoChange"
  | "resumePolishAuto" | "onResumePolishAutoChange"
  | "resumePolishAutoThreshold" | "onResumePolishAutoThresholdChange"
  | "coverPolishAuto" | "onCoverPolishAutoChange"
  | "coverPolishAutoThreshold" | "onCoverPolishAutoThresholdChange"
  | "resumeVariants" | "coverLetterVariants"
  | "excludedResumeVariants" | "excludedCoverLetterVariants" | "onVariantEligibilityChange"
  | "ghostedAfterDays" | "onGhostedAfterDaysChange"
  | "autoMarkGhosted" | "onAutoMarkGhostedChange"
>;

type DocumentRowProps = {
  label: string;
  enabled: boolean;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  threshold: AutoPolishThreshold;
  onThresholdChange: (value: AutoPolishThreshold) => void;
};

// One document, one line: its switch, then the threshold that qualifies it.
function DocumentRow({ label, enabled, checked, onCheckedChange, threshold, onThresholdChange }: DocumentRowProps) {
  return (
    <div className="settings-automation__document">
      <label className="check-row">
        <input
          type="checkbox"
          checked={checked}
          disabled={!enabled}
          onChange={(event) => onCheckedChange(event.target.checked)}
        />
        <span><strong>{label}</strong></span>
      </label>
      <label className="field field--inline settings-automation__threshold">
        <span>Minimum fit</span>
        <select
          className="select--compact"
          value={threshold}
          disabled={!enabled || !checked}
          onChange={(event) => onThresholdChange(event.target.value as AutoPolishThreshold)}
        >
          {AUTO_POLISH_THRESHOLD_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

type GhostedAfterFieldProps = {
  days: number;
  onDaysChange: (days: number) => void;
};

// Typing "30" passes through "3", so nothing commits while typing: blur or
// Enter saves a whole number in range, and anything else reverts.
function GhostedAfterField({ days, onDaysChange }: GhostedAfterFieldProps) {
  const [draft, setDraft] = useState(String(days));

  // Adopt an outside change (Reset all settings) without clobbering what is
  // being typed: the draft already reads as the stored value then.
  useEffect(() => {
    setDraft((current) => (Number(current) === days ? current : String(days)));
  }, [days]);

  return (
    <label className="field field--inline settings-automation__days">
      <span>Mark as Ghosted after</span>
      <input
        className="text-input text-input--narrow"
        type="number"
        inputMode="numeric"
        min={MIN_GHOSTED_AFTER_DAYS}
        max={MAX_GHOSTED_AFTER_DAYS}
        step={1}
        value={draft}
        // Commit only a settled whole value: a half-typed "7" on the way to
        // "75" must never become the threshold automatic marking acts on.
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        onBlur={() => {
          const next = normalizeGhostedAfterDays(Number(draft));
          if (draft.trim() === "" || next === null) {
            setDraft(String(days));
            return;
          }
          if (next !== days) onDaysChange(next);
        }}
      />
      <span>days</span>
    </label>
  );
}

type VariantListProps = {
  legend: string;
  emptyText: string;
  variants: SettingsVariantOption[] | null;
  excluded: VariantExclusions;
  onEligibleChange: (fileName: string, eligible: boolean) => void;
};

// One checkbox per saved variant; checked means Prepare may pick it.
function VariantList({ legend, emptyText, variants, excluded, onEligibleChange }: VariantListProps) {
  return (
    <fieldset className="settings-automation__variants">
      <legend>{legend}</legend>
      {variants === null ? (
        <p className="settings-automation__empty">Loading…</p>
      ) : variants.length ? (
        variants.map((variant) => (
          <label key={variant.fileName} className="check-row" title={variant.fileName}>
            <input
              type="checkbox"
              checked={!Object.prototype.hasOwnProperty.call(excluded, variant.fileName)}
              onChange={(event) => onEligibleChange(variant.fileName, event.target.checked)}
            />
            <span>{variant.label}</span>
          </label>
        ))
      ) : (
        <p className="settings-automation__empty">{emptyText}</p>
      )}
    </fieldset>
  );
}

export function AutomationPage({
  fitAssessmentAuto,
  onFitAssessmentAutoChange,
  resumePolishAuto,
  onResumePolishAutoChange,
  resumePolishAutoThreshold,
  onResumePolishAutoThresholdChange,
  coverPolishAuto,
  onCoverPolishAutoChange,
  coverPolishAutoThreshold,
  onCoverPolishAutoThresholdChange,
  resumeVariants,
  coverLetterVariants,
  excludedResumeVariants,
  excludedCoverLetterVariants,
  onVariantEligibilityChange,
  ghostedAfterDays,
  onGhostedAfterDaysChange,
  autoMarkGhosted,
  onAutoMarkGhostedChange
}: AutomationPageProps) {
  return (
    <>
      <p className="settings-panel__intro">What runs on its own after Prepare. Every step can still be run by hand.</p>

      <div className="settings-automation" aria-label="Prepare automation">
        <label className="check-row">
          <input
            type="checkbox"
            checked={fitAssessmentAuto}
            onChange={(event) => onFitAssessmentAutoChange(event.target.checked)}
          />
          <span>
            <strong>Run Fit Assessment after Prepare</strong>
            <small>Assesses the selected resume with Job analysis. You can reassess anytime.</small>
          </span>
        </label>
        <DocumentRow
          label="Automatically Polish resume"
          enabled={fitAssessmentAuto}
          checked={resumePolishAuto}
          onCheckedChange={onResumePolishAutoChange}
          threshold={resumePolishAutoThreshold}
          onThresholdChange={onResumePolishAutoThresholdChange}
        />
        <DocumentRow
          label="Automatically Polish cover letter"
          enabled={fitAssessmentAuto}
          checked={coverPolishAuto}
          onCheckedChange={onCoverPolishAutoChange}
          threshold={coverPolishAutoThreshold}
          onThresholdChange={onCoverPolishAutoThresholdChange}
        />
      </div>

      <section className="settings-automation__pool" aria-labelledby="settings-variant-pool-title">
        <div className="menu-subhead">
          <span className="menu-subhead__title" id="settings-variant-pool-title">Prepare picks from</span>
        </div>
        <p className="settings-automation__note">Unchecked variants still open by hand.</p>
        <div className="settings-automation__variant-lists">
          <VariantList
            legend="Resumes"
            emptyText="No saved resumes."
            variants={resumeVariants}
            excluded={excludedResumeVariants}
            onEligibleChange={(fileName, eligible) => onVariantEligibilityChange("resume", fileName, eligible)}
          />
          <VariantList
            legend="Cover letters"
            emptyText="No saved cover letters."
            variants={coverLetterVariants}
            excluded={excludedCoverLetterVariants}
            onEligibleChange={(fileName, eligible) => onVariantEligibilityChange("cover-letter", fileName, eligible)}
          />
        </div>
      </section>

      <section className="settings-automation settings-automation__applications" aria-labelledby="settings-applications-title">
        <div className="menu-subhead">
          <span className="menu-subhead__title" id="settings-applications-title">Applications</span>
        </div>
        <GhostedAfterField days={ghostedAfterDays} onDaysChange={onGhostedAfterDaysChange} />
        <label className="check-row">
          <input
            type="checkbox"
            checked={autoMarkGhosted}
            onChange={(event) => onAutoMarkGhostedChange(event.target.checked)}
          />
          <span>
            <strong>Mark as Ghosted automatically</strong>
            <small>Silent Applied and Interviewing records move to Ghosted.</small>
          </span>
        </label>
      </section>

      <p className="settings-automation__note">
        Resume Polish uses one proposal request and leaves the current resume unchanged until you accept edits.
      </p>
    </>
  );
}
