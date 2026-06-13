import { Type } from "lucide-react";
import { NavMenu } from "./NavMenu";
import { DOC_SPACING_PRESETS, type DocStyle, type DocStyleControls } from "../hooks/useDocStyle";

type SliderSpec = {
  key: "lineHeight" | "sectionGap" | "entryGap" | "bulletGap";
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
};

const SLIDERS: SliderSpec[] = [
  { key: "lineHeight", label: "Line height", min: 1, max: 1.6, step: 0.01, unit: "" },
  { key: "sectionGap", label: "Section gap", min: 0, max: 1.6, step: 0.01, unit: "em" },
  { key: "entryGap", label: "Entry gap", min: 0, max: 1.2, step: 0.01, unit: "em" },
  { key: "bulletGap", label: "Bullet gap", min: 0, max: 1, step: 0.01, unit: "em" }
];

type ToggleSpec = { key: keyof DocStyle; label: string };

const TOGGLES: ToggleSpec[] = [
  { key: "boldTitles", label: "Bold titles" },
  { key: "boldHeadings", label: "Bold headings" },
  { key: "boldSkillLabels", label: "Bold skills" },
  { key: "italicSubtitles", label: "Italic subtitles" },
  { key: "italicDates", label: "Italic dates" }
];

// Typography controls for the resume page. Applies live to the editor and to the
// read-only print mirror, and is forwarded to the LaTeX renderer for .tex,
// PDF preview, and PDF · LaTeX exports.
export function FormatMenu({ docStyle }: { docStyle: DocStyleControls }) {
  const { style, set, reset, applySpacingPreset, isDefault } = docStyle;
  function matchesPreset(values: (typeof DOC_SPACING_PRESETS)[keyof typeof DOC_SPACING_PRESETS]["values"]) {
    return SLIDERS.every(({ key }) => Math.abs(style[key] - values[key]) < 0.005);
  }
  return (
    <NavMenu
      icon={<Type size={13} aria-hidden={true} />}
      ariaLabel="Resume formatting"
      label={<span className="nav-menu__label">Format</span>}
      className="format-menu"
    >
      <div className="format-presets" aria-label="Spacing presets">
        {Object.entries(DOC_SPACING_PRESETS).map(([key, preset]) => {
          const active = matchesPreset(preset.values);
          return (
            <button
              type="button"
              className={`ghost-button is-compact${active ? " is-active" : ""}`}
              aria-pressed={active}
              onClick={() => applySpacingPreset(preset.values)}
              key={key}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      <div className="format-slider-grid">
        {SLIDERS.map(({ key, label, min, max, step, unit }) => (
          <label className="field format-slider" key={key}>
            <span>
              {label} <small className="format-slider__value">{style[key].toFixed(2)}{unit}</small>
            </span>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={style[key]}
              onChange={(event) => set(key, Number(event.target.value))}
              aria-label={label}
            />
          </label>
        ))}
      </div>

      <div className="format-toggle-grid">
        {TOGGLES.map(({ key, label }) => (
          <label className="toggle-row" key={key}>
            <input
              type="checkbox"
              checked={Boolean(style[key])}
              onChange={(event) => set(key, event.target.checked as DocStyle[typeof key])}
            />
            <span>
              <strong>{label}</strong>
            </span>
          </label>
        ))}
      </div>

      <div className="format-menu__foot">
        <button type="button" className="secondary-button is-compact" onClick={reset} disabled={isDefault}>
          Reset to defaults
        </button>
      </div>
    </NavMenu>
  );
}
