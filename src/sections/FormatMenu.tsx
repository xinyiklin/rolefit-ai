import type { CSSProperties } from "react";
import { Type } from "lucide-react";
import { NavMenu } from "./NavMenu";
import {
  DOC_SPACING_PRESETS,
  type DocSpacingKey,
  type DocSpacingPreset,
  type DocStyleControls
} from "../hooks/useDocStyle";

type SliderSpec = {
  key: DocSpacingKey;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
};

// Sliders grouped by where on the page they act, so the (otherwise long) list is
// scannable. Every spacing field in DocStyle is exposed here; page font size and
// margins are intentionally fixed by the Jake template.
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

type EmphasisKey = "boldTitles" | "boldHeadings" | "boldSkillLabels" | "italicSubtitles" | "italicDates";

// Emphasis toggles grouped by the kind of styling, with chips for the parts each
// kind applies to — clearer than five flat on/off switches.
const EMPHASIS: { kind: "Bold" | "Italic"; chips: { key: EmphasisKey; label: string }[] }[] = [
  {
    kind: "Bold",
    chips: [
      { key: "boldTitles", label: "Titles" },
      { key: "boldHeadings", label: "Headings" },
      { key: "boldSkillLabels", label: "Skills" }
    ]
  },
  {
    kind: "Italic",
    chips: [
      { key: "italicSubtitles", label: "Subtitles" },
      { key: "italicDates", label: "Dates" }
    ]
  }
];

// Typography controls for the resume page. Applies live to the editor and to the
// read-only print mirror, and is forwarded to the LaTeX renderer for .tex,
// PDF preview, and PDF · LaTeX exports.
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

        <div className="format-slider-group format-style-group">
          <span className="format-slider-group__label">Style</span>
          <div className="format-emphasis">
            {EMPHASIS.map((row) => (
              <div className="format-emphasis__row" key={row.kind}>
                <span
                  className="format-emphasis__kind"
                  style={row.kind === "Bold" ? { fontWeight: 700 } : { fontStyle: "italic" }}
                >
                  {row.kind}
                </span>
                <div className="format-emphasis__chips">
                  {row.chips.map((chip) => {
                    const on = Boolean(style[chip.key]);
                    return (
                      <button
                        type="button"
                        key={chip.key}
                        className={`format-chip${on ? " is-on" : ""}`}
                        aria-pressed={on}
                        onClick={() => set(chip.key, !on)}
                      >
                        {chip.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
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
