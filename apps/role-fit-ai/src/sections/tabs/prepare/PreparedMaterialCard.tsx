import type { ReactNode } from "react";

type PreparedMaterialCardProps = {
  id: string;
  icon: ReactNode;
  title: string;
  included: boolean;
  onIncludedChange: (included: boolean) => void;
  description: string;
  variantLabel: string;
  variantValue: string;
  variantOptions: Array<{ fileName: string; label: string }>;
  emptyVariantLabel: string;
  variantDisabled: boolean;
  onVariantChange: (fileName: string) => void;
  variantStatus: string;
  children?: ReactNode;
  actions: ReactNode;
  status?: ReactNode;
};

export function PreparedMaterialCard({
  id,
  icon,
  title,
  included,
  onIncludedChange,
  description,
  variantLabel,
  variantValue,
  variantOptions,
  emptyVariantLabel,
  variantDisabled,
  onVariantChange,
  variantStatus,
  children,
  actions,
  status
}: PreparedMaterialCardProps) {
  return (
    <section
      className={`prepare-sheet prepare-material-card${included ? "" : " is-excluded"}`}
      aria-labelledby={`${id}-title`}
    >
      <div className="prepare-material-card__head">
        <div className="prepare-material-card__mark" aria-hidden="true">
          {icon}
        </div>
        <div className="prepare-material-card__identity">
          <p className="prepare-page__eyebrow">Material</p>
          <h3 id={`${id}-title`}>{title}</h3>
          <p>{description}</p>
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
      </div>

      <div className="prepare-material-choice">
        <label className="field">
          <span>{variantLabel}</span>
          <select
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
        </label>
        <p>{variantStatus}</p>
      </div>

      {status}
      {children}
      <div className="prepare-material-card__actions">{actions}</div>
    </section>
  );
}
