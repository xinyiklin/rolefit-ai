import { ChevronDown, ListIndentIncrease } from "lucide-react";
import { useId } from "react";

import { Popover } from "../Popover";
import type { DocStyleControls } from "../../hooks/useDocStyle";
import { DOC_STYLE_BOUNDS, type AlignmentScope, type BodyAlign } from "@typeset/engine/lib/documentStyle.ts";
import { ToolbarButton } from "./ToolbarButton";
import { StyleRange } from "./StyleRange";
import {
  ALIGNMENT_OPTIONS,
  NON_JUSTIFIED_ALIGNMENT_OPTIONS,
  type AlignmentOption
} from "./styleOptions";

export type ParagraphStylePopoverProps = {
  docStyle: DocStyleControls;
  disabled?: boolean;
  globalAlignments?: Record<AlignmentScope, BodyAlign | null>;
  onGlobalAlignmentChange?: (scope: AlignmentScope, alignment: BodyAlign) => void;
  // A letter has no section headings or entries, so its menu shows only the
  // body and header alignment.
  documentKind?: "resume" | "cover-letter";
};

function AlignmentPicker({
  label,
  value,
  options = ALIGNMENT_OPTIONS,
  onChange
}: {
  label: string;
  value: BodyAlign | null;
  options?: readonly AlignmentOption[];
  onChange: (value: BodyAlign) => void;
}) {
  const labelId = `alignment-${useId()}-label`;

  return (
    <div className="style-popover__alignment-field">
      <span id={labelId} className="style-popover__alignment-label">
        {label}
      </span>
      <div className="style-popover__alignment-picker" role="group" aria-labelledby={labelId}>
        {options.map(({ value: optionValue, label: optionLabel, Icon }) => (
          <button
            key={optionValue}
            type="button"
            className={value === optionValue ? "is-selected" : ""}
            aria-label={`${label}: ${optionLabel}`}
            aria-pressed={value === optionValue}
            title={optionLabel}
            onClick={() => onChange(optionValue)}
          >
            <Icon size={16} aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  );
}

// The toolbar's "Paragraph" menu: document-wide alignment per scope and the
// two entry indents. Global alignment state is derived in App (null = mixed).
export function ParagraphStylePopover({
  docStyle,
  disabled = false,
  globalAlignments,
  onGlobalAlignmentChange,
  documentKind = "resume"
}: ParagraphStylePopoverProps) {
  const isResume = documentKind === "resume";
  const { style } = docStyle;
  const idPrefix = `paragraph-style-${useId()}`;
  const alignmentId = `${idPrefix}-alignment`;

  return (
    <Popover
      ariaLabel="Paragraph settings"
      align="start"
      className="text-style-popover"
      trigger={(triggerProps, open) => (
        <ToolbarButton
          {...triggerProps}
          className={open ? "is-active" : ""}
          label="Paragraph"
          tooltip="Paragraph settings"
          icon={<ListIndentIncrease size={16} />}
          trailingIcon={<ChevronDown size={13} />}
          showLabel
          disabled={disabled}
        />
      )}
    >
      {() => (
        <div className="style-popover style-popover--text">
          <div className="style-popover__body">
            <section className="style-popover__section" aria-labelledby={alignmentId}>
              <h3 id={alignmentId} className="style-popover__section-title">
                Alignment
              </h3>
              <div className="style-popover__alignment-list">
                <AlignmentPicker
                  label="Body"
                  value={globalAlignments?.body ?? null}
                  onChange={(value) => onGlobalAlignmentChange?.("body", value)}
                />
                <AlignmentPicker
                  label="Header"
                  value={globalAlignments?.header ?? null}
                  options={NON_JUSTIFIED_ALIGNMENT_OPTIONS}
                  onChange={(value) => onGlobalAlignmentChange?.("header", value)}
                />
                {isResume && (
                  <AlignmentPicker
                    label="Section headings"
                    value={globalAlignments?.heading ?? null}
                    options={NON_JUSTIFIED_ALIGNMENT_OPTIONS}
                    onChange={(value) => onGlobalAlignmentChange?.("heading", value)}
                  />
                )}
              </div>
            </section>

            {isResume && <section className="style-popover__section" aria-label="Entry indents">
              <h3 className="style-popover__section-title">Indents</h3>
              <div className="style-popover__range-list">
                <StyleRange
                  id={`${idPrefix}-entry-indent`}
                  label="Entry start"
                  value={style.entryIndentPt}
                  min={DOC_STYLE_BOUNDS.entryIndentPt.min}
                  max={DOC_STYLE_BOUNDS.entryIndentPt.max}
                  step={DOC_STYLE_BOUNDS.entryIndentPt.step}
                  unit="pt"
                  onChange={(value) => docStyle.set("entryIndentPt", value)}
                />
                <StyleRange
                  id={`${idPrefix}-entry-end-indent`}
                  label="Entry end"
                  value={style.entryEndIndentPt}
                  min={DOC_STYLE_BOUNDS.entryEndIndentPt.min}
                  max={DOC_STYLE_BOUNDS.entryEndIndentPt.max}
                  step={DOC_STYLE_BOUNDS.entryEndIndentPt.step}
                  unit="pt"
                  onChange={(value) => docStyle.set("entryEndIndentPt", value)}
                />
                <StyleRange
                  id={`${idPrefix}-bullet-indent`}
                  label="Bullets"
                  value={style.bulletIndentPt}
                  min={DOC_STYLE_BOUNDS.bulletIndentPt.min}
                  max={DOC_STYLE_BOUNDS.bulletIndentPt.max}
                  step={DOC_STYLE_BOUNDS.bulletIndentPt.step}
                  unit="pt"
                  onChange={(value) => docStyle.set("bulletIndentPt", value)}
                />
              </div>
            </section>}
          </div>
        </div>
      )}
    </Popover>
  );
}
