import type { CSSProperties } from "react";
import { Type } from "lucide-react";
import { NavMenu } from "./NavMenu";
import {
  DOC_SPACING_PRESETS,
  type DocSpacingKey,
  type DocSpacingPreset,
  type DocStyleControls,
  type PageMargins
} from "../hooks/useDocStyle";

// Page-margin presets: 0.4in / 0.5in (Jake default) / 0.75in on all four sides.
// A preset (not a slider) because the layout engine is calibrated at these stops.
const MARGIN_OPTIONS: { value: PageMargins; label: string }[] = [
  { value: "narrow", label: "Narrow" },
  { value: "normal", label: "Normal" },
  { value: "wide", label: "Wide" }
];

type SliderSpec = {
  key: DocSpacingKey;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
};

// Sliders grouped by where on the page they act, so the (otherwise long) list is
// scannable. Every spacing field in DocStyle is exposed here; page font size is
// intentionally fixed by the Jake template (margins are the preset row below).
const SLIDER_GROUPS: { label: string; sliders: SliderSpec[] }[] = [
  {
    label: "Page",
    sliders: [{ key: "lineHeight", label: "Line height", min: 1, max: 1.6, step: 0.01, unit: "" }]
  },
  {
    label: "Header",
    sliders: [
      { key: "nameContactGap", label: "Name → contact", min: 0, max: 0.5, step: 0.01, unit: "em" },
      { key: "contactGap", label: "Contact gap", min: 0.5, max: 3, step: 0.01, unit: "em" },
      { key: "headerSectionGap", label: "Header → section", min: 0, max: 2, step: 0.01, unit: "em" }
    ]
  },
  {
    label: "Sections",
    sliders: [
      { key: "sectionGap", label: "Section gap", min: 0, max: 1.6, step: 0.01, unit: "em" },
      { key: "sectionEntryGap", label: "Heading → entry", min: 0, max: 1.2, step: 0.01, unit: "em" }
    ]
  },
  {
    label: "Entries",
    sliders: [
      { key: "entryGap", label: "Entry gap", min: 0, max: 1.2, step: 0.01, unit: "em" },
      { key: "titleSubGap", label: "Title → subtitle", min: 0, max: 0.4, step: 0.01, unit: "em" },
      { key: "headBulletGap", label: "Entry → bullets", min: 0, max: 1.2, step: 0.01, unit: "em" }
    ]
  },
  {
    label: "Lists",
    sliders: [
      { key: "bulletGap", label: "Bullet gap", min: 0, max: 1, step: 0.01, unit: "em" },
      { key: "skillsRowGap", label: "Skill-row gap", min: 0, max: 0.8, step: 0.01, unit: "em" }
    ]
  }
];

const ALL_SLIDERS = SLIDER_GROUPS.flatMap((group) => group.sliders);

// Spacing/layout controls for the resume page (presets + per-region gaps). Text
// styling — emphasis, heading case/rule, contact divider — lives in StyleMenu.
// Applies live to the editor and the read-only print mirror, and is consumed by
// the owned editor/preview/PDF engine.
export function FormatMenu({ docStyle }: { docStyle: DocStyleControls }) {
  const { style, set, reset, applySpacingPreset, saveCustomPreset, customPreset, isDefault } = docStyle;

  function matchesPreset(values: DocSpacingPreset) {
    return ALL_SLIDERS.every(({ key }) => Math.abs(style[key] - values[key]) < 0.005);
  }

  return (
    <NavMenu
      icon={<Type size={13} aria-hidden={true} />}
      ariaLabel="Resume formatting"
      label={<span className="nav-menu__label">Format</span>}
      className="format-menu"
    >
      <div className="format-presets" role="group" aria-label="Spacing presets">
        {Object.entries(DOC_SPACING_PRESETS).map(([key, preset]) => {
          const active = matchesPreset(preset.values);
          return (
            <button
              type="button"
              className={`format-preset${active ? " is-active" : ""}`}
              aria-pressed={active}
              onClick={() => applySpacingPreset(preset.values)}
              key={key}
            >
              {preset.label}
            </button>
          );
        })}
        <button
          type="button"
          className={`format-preset${customPreset && matchesPreset(customPreset) ? " is-active" : ""}`}
          aria-pressed={Boolean(customPreset) && matchesPreset(customPreset!)}
          onClick={() => customPreset && applySpacingPreset(customPreset)}
          disabled={!customPreset}
          title={customPreset ? "Apply your saved spacing" : "Save a preset below to enable"}
        >
          Custom
        </button>
      </div>

      <div className="format-slider-groups">
        {SLIDER_GROUPS.map((group) => (
          <div className="format-slider-group" key={group.label}>
            <span className="format-slider-group__label">{group.label}</span>
            {group.label === "Page" ? (
              <div className="format-emphasis">
                <div className="format-emphasis__row">
                  <span className="format-emphasis__kind">Margins</span>
                  <div className="format-emphasis__chips">
                    {MARGIN_OPTIONS.map((opt) => (
                      <button
                        type="button"
                        className={`format-chip${style.pageMargins === opt.value ? " is-on" : ""}`}
                        aria-pressed={style.pageMargins === opt.value}
                        onClick={() => set("pageMargins", opt.value)}
                        key={opt.value}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
            <div className="format-rows">
              {group.sliders.map(({ key, label, min, max, step, unit }) => {
                const value = style[key];
                const fill = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
                return (
                  <label className="format-row" key={key}>
                    <span className="format-row__label">{label}</span>
                    <input
                      type="range"
                      className="format-row__slider"
                      min={min}
                      max={max}
                      step={step}
                      value={value}
                      onChange={(event) => set(key, Number(event.target.value))}
                      aria-label={label}
                      style={{ "--fill": `${fill}%` } as CSSProperties}
                    />
                    <span className="format-row__value">{value.toFixed(2)}{unit}</span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="format-menu__foot">
        <button type="button" className="secondary-button is-compact" onClick={saveCustomPreset}>
          {customPreset && matchesPreset(customPreset) ? "Custom saved ✓" : customPreset ? "Update Custom" : "Save as Custom"}
        </button>
        <button type="button" className="secondary-button is-compact" onClick={reset} disabled={isDefault}>
          Reset to defaults
        </button>
      </div>
    </NavMenu>
  );
}
