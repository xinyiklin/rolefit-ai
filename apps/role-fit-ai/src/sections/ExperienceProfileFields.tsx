import { Trash2 } from "lucide-react";

import {
  EXPERIENCE_CATEGORY_OPTIONS,
  EXPERIENCE_DETAILS_MAX_LENGTH,
  EXPERIENCE_MAX_COUNT,
  EXPERIENCE_MAX_YEAR,
  EXPERIENCE_MAX_YEARS,
  EXPERIENCE_MIN_YEAR,
  type CandidateExperience,
  type ExperienceCategory
} from "../lib/candidateFacts";

type ExperienceProfileFieldsProps = {
  value: CandidateExperience[];
  onChange: (value: CandidateExperience[]) => void;
};

function optionalNumber(raw: string): number | undefined {
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

export function ExperienceProfileFields({ value, onChange }: ExperienceProfileFieldsProps) {
  const used = new Set(value.map((item) => item.category));
  const available = EXPERIENCE_CATEGORY_OPTIONS.filter((option) => !used.has(option.value));

  function addCategory(category: ExperienceCategory) {
    if (!category || used.has(category)) return;
    onChange([...value, { category }]);
  }

  function updateCategory(category: ExperienceCategory, patch: Partial<CandidateExperience>) {
    onChange(value.map((item) => item.category === category ? { ...item, ...patch } : item));
  }

  function removeCategory(category: ExperienceCategory) {
    onChange(value.filter((item) => item.category !== category));
  }

  return (
    <div className="experience-profile">
      <div className="experience-profile__add">
        <label className="field field--inline">
          <span><strong>Add experience source</strong></span>
          <select
            className="select--compact"
            value=""
            disabled={!available.length}
            onChange={(event) => addCategory(event.target.value as ExperienceCategory)}
          >
            <option value="" disabled>
              {available.length ? "Choose a category…" : "All categories added"}
            </option>
            {available.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>

      {!value.length ? (
        <p className="micro-status">
          Add only sources you can support. RoleFit decides which ones count for each job.
        </p>
      ) : (
        <div className="experience-profile__rows">
          {value.map((item) => {
            const option = EXPERIENCE_CATEGORY_OPTIONS.find((entry) => entry.value === item.category);
            if (!option) return null;
            const inputId = `experience-${item.category}`;
            return (
              <fieldset className="experience-profile__row" key={item.category}>
                <legend>{option.label}</legend>
                <button
                  type="button"
                  className="experience-profile__remove"
                  aria-label={`Remove ${option.label}`}
                  onClick={() => removeCategory(item.category)}
                >
                  <Trash2 size={13} aria-hidden="true" />
                  Remove
                </button>

                <div className="experience-profile__metrics">
                  <label className="field" htmlFor={`${inputId}-years`}>
                    <span>Years <small>(optional)</small></span>
                    <input
                      id={`${inputId}-years`}
                      className="text-input"
                      type="number"
                      min={0}
                      max={EXPERIENCE_MAX_YEARS}
                      step={0.25}
                      inputMode="decimal"
                      value={item.years ?? ""}
                      placeholder="e.g. 2.5"
                      onChange={(event) => updateCategory(item.category, { years: optionalNumber(event.target.value) })}
                    />
                  </label>
                  <label className="field" htmlFor={`${inputId}-count`}>
                    <span>Roles / projects <small>(optional)</small></span>
                    <input
                      id={`${inputId}-count`}
                      className="text-input"
                      type="number"
                      min={1}
                      max={EXPERIENCE_MAX_COUNT}
                      step={1}
                      inputMode="numeric"
                      value={item.count ?? ""}
                      placeholder="e.g. 3"
                      onChange={(event) => updateCategory(item.category, { count: optionalNumber(event.target.value) })}
                    />
                  </label>
                  <label className="field" htmlFor={`${inputId}-recent`}>
                    <span>Most recent year <small>(optional)</small></span>
                    <input
                      id={`${inputId}-recent`}
                      className="text-input"
                      type="number"
                      min={EXPERIENCE_MIN_YEAR}
                      max={EXPERIENCE_MAX_YEAR}
                      step={1}
                      inputMode="numeric"
                      value={item.mostRecentYear ?? ""}
                      placeholder="e.g. 2026"
                      onChange={(event) => updateCategory(item.category, { mostRecentYear: optionalNumber(event.target.value) })}
                    />
                  </label>
                </div>

                <label className="field" htmlFor={`${inputId}-details`}>
                  <span>Scope <small>(optional — domain, tools, responsibility, or production use)</small></span>
                  <input
                    id={`${inputId}-details`}
                    className="text-input"
                    type="text"
                    maxLength={EXPERIENCE_DETAILS_MAX_LENGTH}
                    value={item.details ?? ""}
                    placeholder="e.g. backend APIs in production; TypeScript, PostgreSQL, AWS"
                    onChange={(event) => updateCategory(item.category, { details: event.target.value })}
                  />
                </label>
              </fieldset>
            );
          })}
        </div>
      )}
      <p className="experience-profile__note">
        Categories may overlap. RoleFit will not add their years or counts together automatically.
      </p>
    </div>
  );
}
