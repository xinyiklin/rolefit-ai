import { ArrowUpDown, ChevronDown, RotateCcw } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { Popover } from "../Popover";
import type { DocStyleControls } from "../../hooks/useDocStyle";
import { DOC_SPACING_PRESETS, DOC_STYLE_BOUNDS } from "@typeset/engine/lib/documentStyle";
import { ToolbarButton } from "./ToolbarButton";
import { StyleRange } from "./StyleRange";
import {
  SPACING_CONTROL_GROUPS,
  activeSpacingPresetId,
  applySpacingPreset,
  spacingPresetOptions
} from "./styleOptions";

export type SpacingStylePopoverProps = {
  docStyle: DocStyleControls;
  disabled?: boolean;
};

const LINE_HEIGHT_PRESETS = [1, 1.15, 1.5, 2] as const;

const formatLineHeight = (value: number) => Number(value.toFixed(2)).toString();

const formatSpacingValue = (value: number, unit: string) =>
  `${value.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")}${unit}`;

export function SpacingStylePopover({ docStyle, disabled = false }: SpacingStylePopoverProps) {
  const idPrefix = `spacing-style-${useId()}`;
  const customLineHeightId = `${idPrefix}-custom-line-height`;
  const activePreset = activeSpacingPresetId(docStyle);
  const presetOptions = spacingPresetOptions();
  const commonLineHeight = LINE_HEIGHT_PRESETS.find(
    (value) => Math.abs(value - docStyle.style.lineHeight) < 0.005
  );
  // The custom line height is an uncommitted text draft so intermediate states
  // like "1." or an emptied field survive editing; a controlled number input
  // that parsed and clamped every keystroke fought decimal entry and snapped the
  // value back. The draft commits (parse + clamp) on blur, Enter, or a preset.
  const lineHeightBounds = DOC_STYLE_BOUNDS.lineHeight;
  const [lineHeightDraft, setLineHeightDraft] = useState(() => formatLineHeight(docStyle.style.lineHeight));
  useEffect(() => setLineHeightDraft(formatLineHeight(docStyle.style.lineHeight)), [docStyle.style.lineHeight]);
  const commitLineHeightDraft = () => {
    const parsed = Number(lineHeightDraft.trim());
    if (!Number.isFinite(parsed)) {
      setLineHeightDraft(formatLineHeight(docStyle.style.lineHeight));
      return;
    }
    const clamped = Math.min(lineHeightBounds.max, Math.max(lineHeightBounds.min, Math.round(parsed * 100) / 100));
    setLineHeightDraft(formatLineHeight(clamped));
    docStyle.set("lineHeight", clamped);
  };
  const [showCustomSpacing, setShowCustomSpacing] = useState(activePreset === null || activePreset === "custom");
  const spacingIsCustom = showCustomSpacing || activePreset === null || activePreset === "custom";

  return (
    <Popover
      ariaLabel="Line height and spacing"
      align="end"
      className="spacing-style-popover"
      trigger={(triggerProps, open) => (
        <ToolbarButton
          {...triggerProps}
          className={open ? "is-active" : ""}
          label="Spacing"
          tooltip="Line height and spacing"
          icon={<ArrowUpDown size={16} />}
          trailingIcon={<ChevronDown size={13} />}
          showLabel
          disabled={disabled}
        />
      )}
    >
      {() => (
        <div className="style-popover style-popover--spacing">
          <div className="style-popover__body">
            <section className="style-popover__section" aria-labelledby={`${idPrefix}-line-height`}>
              <h3 id={`${idPrefix}-line-height`} className="style-popover__section-title">Line height</h3>
              <div className="style-popover__segmented" role="group" aria-label="Line height">
                {LINE_HEIGHT_PRESETS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={commonLineHeight === value ? "is-selected" : ""}
                    aria-pressed={commonLineHeight === value}
                    onClick={() => docStyle.set("lineHeight", value)}
                  >
                    {value === 1 || value === 2 ? value.toFixed(1) : value.toString()}
                  </button>
                ))}
              </div>
              <div className="style-popover__custom-number">
                <label htmlFor={customLineHeightId}>Custom line height</label>
                <span className="style-popover__number-control">
                  <input
                    id={customLineHeightId}
                    type="text"
                    inputMode="decimal"
                    value={lineHeightDraft}
                    onChange={(event) => setLineHeightDraft(event.target.value)}
                    onBlur={commitLineHeightDraft}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        commitLineHeightDraft();
                        event.currentTarget.select();
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        setLineHeightDraft(formatLineHeight(docStyle.style.lineHeight));
                      }
                    }}
                    aria-label="Custom line height"
                  />
                </span>
              </div>
            </section>

            <section className="style-popover__section" aria-labelledby={`${idPrefix}-preset`}>
              <h3 id={`${idPrefix}-preset`} className="style-popover__section-title">Spacing preset</h3>
              <div className="style-popover__segmented" role="group" aria-label="Spacing preset">
                {presetOptions.map((option) => {
                  const selected = option.value === "custom"
                    ? spacingIsCustom
                    : !spacingIsCustom && activePreset === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={selected ? "is-selected" : ""}
                      aria-pressed={selected}
                      onClick={() => {
                        applySpacingPreset(docStyle, option.value);
                        setShowCustomSpacing(option.value === "custom");
                      }}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </section>

            {showCustomSpacing || spacingIsCustom ? (
              <section className="style-popover__advanced" aria-labelledby={`${idPrefix}-custom`}>
                <h3 id={`${idPrefix}-custom`} className="style-popover__section-title">Custom spacing</h3>
                <div className="style-popover__spacing-groups">
                  {SPACING_CONTROL_GROUPS.map((group) => (
                    <section className="style-popover__section style-popover__section--spacing" key={group.label}>
                      <h3 className="style-popover__section-title">{group.label}</h3>
                      <div className="style-popover__range-list">
                        {group.controls.map((control) => (
                          <StyleRange
                            key={control.key}
                            id={`${idPrefix}-${control.key}`}
                            label={control.label}
                            value={docStyle.style[control.key]}
                            min={control.min}
                            max={control.max}
                            step={control.step}
                            displayValue={formatSpacingValue(docStyle.style[control.key], control.unit)}
                            onChange={(value) => docStyle.set(control.key, value)}
                          />
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              </section>
            ) : null}
          </div>

          <div className="style-popover__footer style-popover__footer--split">
            <button type="button" className="style-popover__secondary" onClick={docStyle.saveCustomPreset}>
              {docStyle.customPreset ? "Update Custom" : "Save as Custom"}
            </button>
            <button
              type="button"
              className="style-popover__reset"
              disabled={activePreset === "balanced"}
              onClick={() => {
                docStyle.applyStyle(DOC_SPACING_PRESETS.balanced.values);
                setShowCustomSpacing(false);
              }}
            >
              <RotateCcw size={14} aria-hidden="true" />
              Balanced spacing
            </button>
          </div>
        </div>
      )}
    </Popover>
  );
}
