import { ChevronDown } from "lucide-react";

import type { BodyAlign } from "@typeset/engine/lib/documentStyle.ts";
import { Popover } from "../Popover";
import { ToolbarButton } from "./ToolbarButton";
import { ALIGNMENT_OPTIONS } from "./styleOptions";

export type AlignmentControlProps = {
  /** The effective alignment of the selected paragraph(s). */
  value: BodyAlign;
  onChange: (alignment: BodyAlign) => void;
  disabled?: boolean;
};

/**
 * Selected-paragraph alignment as one trigger plus a menu, the shape Word and
 * Google Docs use. Four always-visible buttons cost ~140px of a 48px row that
 * has no width to spare, and they were the first control the responsive ladder
 * had to throw away; one trigger keeps alignment reachable much further down.
 *
 * The trigger shows the active alignment, so the collapsed control still
 * reports state rather than only accepting input.
 *
 * Opening the menu moves focus off the document, exactly as the link editor
 * does. That is safe because the editor's command target falls back to the last
 * recorded selection, so the alignment command still lands on the paragraph the
 * user had selected.
 */
export function AlignmentControl({ value, onChange, disabled = false }: AlignmentControlProps) {
  const active = ALIGNMENT_OPTIONS.find((option) => option.value === value) ?? ALIGNMENT_OPTIONS[0];

  return (
    <Popover
      ariaLabel="Selected paragraph alignment"
      align="start"
      className="alignment-control"
      initialFocus="first"
      trigger={(triggerProps, open) => (
        <ToolbarButton
          {...triggerProps}
          className={open ? "is-active" : ""}
          label={`Paragraph alignment: ${active.label.toLowerCase()}`}
          tooltip="Paragraph alignment"
          icon={<active.Icon size={16} />}
          trailingIcon={<ChevronDown size={13} />}
          onMouseDown={(event) => event.preventDefault()}
          disabled={disabled}
        />
      )}
    >
      {({ close }) => (
        <div className="alignment-menu" role="group" aria-label="Align selected paragraph">
          {ALIGNMENT_OPTIONS.map(({ value: optionValue, label, Icon }) => (
            <button
              key={optionValue}
              type="button"
              className={`alignment-menu__option${optionValue === value ? " is-selected" : ""}`}
              aria-pressed={optionValue === value}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(optionValue);
                close();
              }}
            >
              <Icon size={15} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}
