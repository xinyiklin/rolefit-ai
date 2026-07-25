import { AlignVerticalSpaceAround, ChevronDown } from "lucide-react";
import { useId } from "react";

import { Popover } from "@typeset/editor/components/Popover.tsx";
import { ToolbarButton } from "@typeset/editor/components/toolbar/ToolbarButton.tsx";
import type { DocStyleControls } from "@typeset/editor/hooks/useDocStyle.ts";

type LineHeightPopoverProps = {
  docStyle: DocStyleControls;
  disabled?: boolean;
};

const LINE_HEIGHT_OPTIONS = [
  { value: 1, label: "Single" },
  { value: 1.15, label: "1.15" },
  { value: 1.5, label: "1.5" },
  { value: 2, label: "Double" }
] as const;

export function LineHeightPopover({
  docStyle,
  disabled = false
}: LineHeightPopoverProps) {
  const groupId = `cover-line-height-${useId()}`;

  return (
    <Popover
      ariaLabel="Cover letter line height"
      align="end"
      className="text-style-popover"
      trigger={(triggerProps, open) => (
        <ToolbarButton
          {...triggerProps}
          className={open ? "is-active" : ""}
          label="Line height"
          tooltip="Set cover letter line height"
          icon={<AlignVerticalSpaceAround size={16} />}
          trailingIcon={<ChevronDown size={13} />}
          showLabel
          disabled={disabled}
        />
      )}
    >
      {() => (
        <div className="style-popover cover-line-height-popover">
          <div className="style-popover__body">
            <section className="style-popover__section" aria-labelledby={groupId}>
              <h3 id={groupId} className="style-popover__section-title">
                Line height
              </h3>
              <div
                className="style-popover__segmented"
                role="group"
                aria-labelledby={groupId}
              >
                {LINE_HEIGHT_OPTIONS.map((option) => {
                  const selected =
                    Math.abs(docStyle.style.lineHeight - option.value) < 0.005;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={selected ? "is-selected" : ""}
                      aria-pressed={selected}
                      disabled={disabled}
                      onClick={() => docStyle.set("lineHeight", option.value)}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        </div>
      )}
    </Popover>
  );
}
