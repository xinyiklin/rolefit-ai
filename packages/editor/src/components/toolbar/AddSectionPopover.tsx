import { LayoutGrid } from "lucide-react";
import { useState } from "react";

import {
  SECTION_TYPE_OPTIONS,
  type ResumeSectionType
} from "@typeset/engine/lib/resumeData.ts";
import { Popover } from "../Popover";
import { ToolbarButton } from "./ToolbarButton";

type AddSectionPopoverProps = {
  disabled: boolean;
  onAddSection: (type: ResumeSectionType, position: "top" | "bottom") => void;
};

export function AddSectionPopover({
  disabled,
  onAddSection
}: AddSectionPopoverProps) {
  const [position, setPosition] = useState<"top" | "bottom">("bottom");

  return (
    <Popover
      ariaLabel="Add section"
      align="start"
      className="structure-control"
      trigger={(triggerProps, open) => (
        <ToolbarButton
          {...triggerProps}
          className={open ? "is-active" : ""}
          label="Section"
          tooltip="Add a section"
          icon={<LayoutGrid size={16} />}
          showLabel
          disabled={disabled}
        />
      )}
    >
      {({ close }) => (
        <div className="structure-popover">
          <div className="structure-popover__head">
            <strong>Add section</strong>
          </div>
          <div className="structure-popover__position" role="group" aria-label="Section position">
            {(["top", "bottom"] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={`structure-popover__position-btn${position === option ? " is-on" : ""}`}
                aria-pressed={position === option}
                disabled={disabled}
                onClick={() => setPosition(option)}
              >
                {option === "top" ? "At top" : "At bottom"}
              </button>
            ))}
          </div>
          {SECTION_TYPE_OPTIONS.map((option) => (
            <button
              key={option.type}
              type="button"
              className="structure-popover__option"
              disabled={disabled}
              onClick={() => {
                onAddSection(option.type, position);
                close();
              }}
            >
              <span>{option.label}</span>
              <small>{option.description}</small>
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}
