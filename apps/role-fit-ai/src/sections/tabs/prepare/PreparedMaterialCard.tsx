import type { ReactNode } from "react";

type PreparedMaterialCardProps = {
  id: string;
  title: string;
  state: string;
  included: boolean;
  onIncludedChange: (included: boolean) => void;
  variantLabel: string;
  variantValue: string;
  variantOptions: Array<{ fileName: string; label: string }>;
  emptyVariantLabel: string;
  variantDisabled: boolean;
  onVariantChange: (fileName: string) => void;
  actions: ReactNode;
  children?: ReactNode;
};

// One stacked material group inside the Application rail: name and state beside
// the Include decision, then the chosen variant and document actions. DOM and
// visual order stay aligned so keyboard users encounter the controls where they
// appear. The selector already names the variant, so state reports only state.
export function PreparedMaterialCard({
  id,
  title,
  state,
  included,
  onIncludedChange,
  variantLabel,
  variantValue,
  variantOptions,
  emptyVariantLabel,
  variantDisabled,
  onVariantChange,
  actions,
  children
}: PreparedMaterialCardProps) {
  return (
    <section className={`prepare-material${included ? "" : " is-excluded"}`} aria-labelledby={`${id}-title`}>
      <div className="prepare-material__row">
        <div className="prepare-material__identity">
          <h4 id={`${id}-title`}>{title}</h4>
          <p>{state}</p>
        </div>
        <label className="prepare-include-toggle">
          <input
            type="checkbox"
            aria-label={`Include ${title.toLowerCase()}`}
            checked={included}
            onChange={(event) => onIncludedChange(event.target.checked)}
          />
          <span className="prepare-include-toggle__track" aria-hidden="true">
            <span />
          </span>
          <span>Include</span>
        </label>
        <select
          aria-label={variantLabel}
          className="prepare-material__variant"
          value={variantValue}
          onChange={(event) => onVariantChange(event.target.value)}
          disabled={variantDisabled}
        >
          {!variantValue ? <option value="">{emptyVariantLabel}</option> : null}
          {variantOptions.map((option) => (
            <option key={option.fileName} value={option.fileName}>
              {option.label}
            </option>
          ))}
        </select>
        <div className="prepare-material__actions">{actions}</div>
      </div>

      {/* Rendered as direct grid children: an all-null fragment produces no DOM
          node, so a row with nothing to disclose costs no extra line or gap. */}
      {children}
    </section>
  );
}
