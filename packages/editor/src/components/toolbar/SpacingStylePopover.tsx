import { ArrowUpDown, ChevronDown } from "lucide-react";
import { useId } from "react";

import { Popover } from "../Popover";
import type { DocStyleControls } from "../../hooks/useDocStyle";
import { ToolbarButton } from "./ToolbarButton";
import { SpacingPresets } from "./SpacingPresets";
import { StyleRange } from "./StyleRange";
import {
  SPACING_CONTROL_GROUPS,
  spacingKeysOf,
  type SpacingControlGroup
} from "./styleOptions";

export type SpacingStylePopoverProps = {
  docStyle: DocStyleControls;
  disabled?: boolean;
  // The values this document's layout reads; presets match and apply only these.
  groups?: readonly SpacingControlGroup[];
  // Saved presets hold every resume gap, so a host whose groups are a subset
  // (the cover letter) offers the built-in presets only.
  savedPresets?: boolean;
};

export function SpacingStylePopover({
  docStyle,
  disabled = false,
  groups = SPACING_CONTROL_GROUPS,
  savedPresets = true
}: SpacingStylePopoverProps) {
  const idPrefix = `spacing-style-${useId()}`;

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
            <SpacingPresets
              docStyle={docStyle}
              idPrefix={idPrefix}
              disabled={disabled}
              keys={spacingKeysOf(groups)}
              savedPresets={savedPresets}
            />
            {groups.map((group, index) => (
              <section
                className="style-popover__section"
                key={group.label}
                aria-labelledby={`${idPrefix}-group-${index}`}
              >
                <h3 id={`${idPrefix}-group-${index}`} className="style-popover__section-title">
                  {group.label}
                </h3>
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
                      unit={control.unit}
                      disabled={disabled}
                      onChange={(value) => docStyle.set(control.key, value)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}
    </Popover>
  );
}
