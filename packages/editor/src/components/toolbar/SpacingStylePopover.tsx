import { ArrowUpDown, ChevronDown, RotateCcw } from "lucide-react";
import { useId } from "react";

import { Popover } from "../Popover";
import type { DocStyleControls } from "../../hooks/useDocStyle";
import { DOC_SPACING_PRESETS } from "@typeset/engine/lib/documentStyle.ts";
import { ToolbarButton } from "./ToolbarButton";
import { SpacingPresets } from "./SpacingPresets";
import { StyleRange } from "./StyleRange";
import {
  SPACING_CONTROL_GROUPS,
  activeBuiltInSpacingPresetId,
  formatSpacingValue
} from "./styleOptions";

export type SpacingStylePopoverProps = {
  docStyle: DocStyleControls;
  disabled?: boolean;
};

export function SpacingStylePopover({ docStyle, disabled = false }: SpacingStylePopoverProps) {
  const idPrefix = `spacing-style-${useId()}`;
  const activePreset = activeBuiltInSpacingPresetId(docStyle.style);

  return (
    <Popover
      ariaLabel="Document spacing"
      align="end"
      className="spacing-style-popover"
      trigger={(triggerProps, open) => (
        <ToolbarButton
          {...triggerProps}
          className={open ? "is-active" : ""}
          label="Spacing"
          tooltip="Document spacing"
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
            <SpacingPresets docStyle={docStyle} idPrefix={idPrefix} disabled={disabled} />

            <section className="style-popover__advanced" aria-labelledby={`${idPrefix}-values`}>
              <h3 id={`${idPrefix}-values`} className="style-popover__section-title">Spacing values</h3>
              <div className="style-popover__spacing-groups">
                <section className="style-popover__section style-popover__section--spacing">
                  <h3 className="style-popover__section-title">Lines</h3>
                  <div className="style-popover__range-list">
                    <StyleRange
                      id={`${idPrefix}-line-height`}
                      label="Line spacing"
                      value={docStyle.style.lineHeight}
                      min={1}
                      max={2}
                      step={0.01}
                      disabled={disabled}
                      displayValue={formatSpacingValue(docStyle.style.lineHeight, "")}
                      onChange={(value) => docStyle.set("lineHeight", value)}
                    />
                  </div>
                </section>
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
                          disabled={disabled}
                          displayValue={formatSpacingValue(docStyle.style[control.key], control.unit)}
                          onChange={(value) => docStyle.set(control.key, value)}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </section>
          </div>

          <div className="style-popover__footer">
            <button
              type="button"
              className="style-popover__reset"
              disabled={activePreset === "balanced"}
              onClick={() => {
                docStyle.applyStyle(DOC_SPACING_PRESETS.balanced.values);
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
