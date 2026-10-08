import { useId, type ReactNode, type RefObject } from "react";
import {
  LEGACY_NOT_APPLYING_REASONS,
  NOT_APPLYING_REASON_GROUPS,
  NOT_APPLYING_REASON_LABEL,
  NOT_APPLYING_REASON_SHORT_LABEL,
  normalizeNotApplyingReasons,
  type NotApplyingReason
} from "../../lib/notApplying";
import type { SkipReasonSuggestion } from "../../lib/skipReasonSuggestions";

type SkipReasonChecklistProps = {
  legend: ReactNode;
  value: readonly NotApplyingReason[];
  // A retired reason stays offered while the decision being edited was saved
  // with it, so unchecking it can still be undone before saving.
  savedReasons: readonly NotApplyingReason[];
  onChange: (reasons: NotApplyingReason[]) => void;
  suggestions?: readonly SkipReasonSuggestion[];
  disabled?: boolean;
  firstInputRef?: RefObject<HTMLInputElement | null>;
};

export function SkipReasonChecklist({
  legend,
  value,
  savedReasons,
  onChange,
  suggestions = [],
  disabled = false,
  firstInputRef
}: SkipReasonChecklistProps) {
  const idPrefix = useId();
  const selected = new Set(value);
  const basisId = (reason: NotApplyingReason) => `${idPrefix}-basis-${reason}`;
  const suggested = new Set(suggestions.map(({ reason }) => reason));
  const legacyReasons = savedReasons.filter((reason) => LEGACY_NOT_APPLYING_REASONS.includes(reason));
  const groups = legacyReasons.length
    ? [...NOT_APPLYING_REASON_GROUPS, { label: "Earlier reason", reasons: legacyReasons }]
    : NOT_APPLYING_REASON_GROUPS;
  const firstReason = groups[0].reasons[0];

  function toggle(reason: NotApplyingReason, checked: boolean) {
    onChange(normalizeNotApplyingReasons(
      checked ? [...value, reason] : value.filter((current) => current !== reason)
    ));
  }

  return (
    <fieldset className="skip-reason-checklist" disabled={disabled}>
      <legend>{legend}</legend>
      {groups.map((group) => (
        <fieldset key={group.label} className="skip-reason-checklist__group">
          <legend>{group.label}</legend>
          <div className="skip-reason-checklist__options">
            {group.reasons.map((reason) => (
              <label key={reason} className="check-row">
                <input
                  ref={reason === firstReason ? firstInputRef : undefined}
                  type="checkbox"
                  checked={selected.has(reason)}
                  onChange={(event) => toggle(reason, event.target.checked)}
                  aria-describedby={suggested.has(reason) ? basisId(reason) : undefined}
                />
                <span>
                  {NOT_APPLYING_REASON_LABEL[reason]}
                  {suggested.has(reason) ? (
                    <span className="skip-reason-checklist__suggested"> · suggested</span>
                  ) : null}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      {suggestions.length ? (
        <ul className="skip-reason-checklist__basis" aria-label="Why these reasons are suggested">
          {suggestions.map(({ reason, basis }) => (
            <li key={reason} id={basisId(reason)}>
              <strong>{NOT_APPLYING_REASON_SHORT_LABEL[reason]}</strong> — {basis}
            </li>
          ))}
        </ul>
      ) : null}
    </fieldset>
  );
}
