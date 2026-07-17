import {
  Bold,
  ChevronDown,
  Italic,
  RotateCcw,
  SlidersHorizontal,
  Underline,
  type LucideIcon
} from "lucide-react";
import { useId } from "react";

import { Popover } from "../Popover";
import type { DocStyleControls } from "../../hooks/useDocStyle";
import { FONT_FAMILY_OPTIONS, TEXT_STYLE_DEFAULTS } from "@typeset/engine/lib/documentStyle";
import { FontSizeControl } from "./FontSizeControl";
import { ToolbarButton } from "./ToolbarButton";
import {
  STYLE_FIELD_MARK_DEFAULTS,
  styleFieldDefaultSizePt,
  type FieldFontFamily,
  type StyleFieldFontStates,
  type StyleFieldMarkStates,
  type StyleFieldSizeStates,
  type StyleTextField
} from "@typeset/engine/lib/styleFieldFormatting";
import type { FieldFontState, FieldMark } from "@typeset/engine/lib/inlineMarksText";
import { HEADING_CASE_OPTIONS } from "./styleOptions";

export type TextStylesPopoverProps = {
  docStyle: DocStyleControls;
  disabled?: boolean;
  styleMarkStates?: StyleFieldMarkStates;
  onStyleFieldMarkChange?: (field: StyleTextField, mark: FieldMark, on: boolean) => void;
  styleFontStates?: StyleFieldFontStates;
  onStyleFieldFontChange?: (field: StyleTextField, family: FieldFontFamily) => void;
  styleSizeStates?: StyleFieldSizeStates;
  onStyleFieldSizeChange?: (field: StyleTextField, sizePt: number) => void;
  onResetStyleFormatting?: () => void;
};

// Every text element that gets a font / size / emphasis row, top to bottom:
// section heading, the header contact line, the four entry columns, and skill
// labels. Rendered as one group and reused for the reset-is-default check.
const TEXT_STYLE_ROWS: readonly { field: StyleTextField; label: string }[] = [
  { field: "sectionHeading", label: "Section heading" },
  { field: "contact", label: "Contact" },
  { field: "titleLeft", label: "Title left" },
  { field: "titleRight", label: "Title right" },
  { field: "subtitleLeft", label: "Subtitle left" },
  { field: "subtitleRight", label: "Subtitle right" },
  { field: "skillLabel", label: "Skill labels" }
];

const ENTRY_MARK_OPTIONS: readonly { mark: FieldMark; label: string; Icon: LucideIcon }[] = [
  { mark: "bold", label: "Bold", Icon: Bold },
  { mark: "italic", label: "Italic", Icon: Italic },
  { mark: "underline", label: "Underline", Icon: Underline }
];

function FieldStyleRow({
  field,
  label,
  states,
  fontStates,
  sizeStates,
  documentFont,
  baseFontSizePt,
  disabled = false,
  onChange,
  onFontChange,
  onSizeChange
}: {
  field: StyleTextField;
  label: string;
  states?: StyleFieldMarkStates;
  fontStates?: StyleFieldFontStates;
  sizeStates?: StyleFieldSizeStates;
  documentFont: FieldFontFamily;
  baseFontSizePt: number;
  disabled?: boolean;
  onChange?: (field: StyleTextField, mark: FieldMark, on: boolean) => void;
  onFontChange?: (field: StyleTextField, family: FieldFontFamily) => void;
  onSizeChange?: (field: StyleTextField, sizePt: number) => void;
}) {
  // Truth per field: the resolved family/size, or null when instances diverge.
  // Presence-check (not ??) so null survives; a missing map falls back to the
  // document font / role default so the control still shows the current value.
  const sizeFallback = styleFieldDefaultSizePt(field, baseFontSizePt);
  const fontState: FieldFontState = fontStates ? fontStates[field] : documentFont;
  const sizeState = sizeStates ? sizeStates[field] : sizeFallback;
  return (
    <div className="style-popover__field-style">
      <span className="style-popover__field-style-label">{label}</span>
      <div className="style-popover__field-style-controls">
        <select
          className="style-popover__entry-font"
          aria-label={`${label}: font`}
          value={fontState ?? ""}
          onChange={(event) => onFontChange?.(field, event.target.value as FieldFontFamily)}
        >
          {fontState === null ? <option value="" disabled aria-label="Mixed" /> : null}
          {FONT_FAMILY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <FontSizeControl
          className="style-popover__field-size"
          value={sizeState}
          ariaLabel={`${label}: size`}
          onChange={(sizePt) => onSizeChange?.(field, sizePt)}
        />
        <div className="style-popover__entry-mark-buttons" role="group" aria-label={`${label} emphasis`}>
          {ENTRY_MARK_OPTIONS.map(({ mark, label: markLabel, Icon }) => {
            // Preserve null (mixed) with a presence check, not ?? false, so a field
            // whose instances diverge reads as mixed rather than plain "off".
            const state = states ? states[field][mark] : false;
            return (
              <button
                key={mark}
                type="button"
                className={state === true ? "is-selected" : state === null ? "is-mixed" : ""}
                aria-label={`${label}: ${markLabel}`}
                aria-pressed={state === null ? "mixed" : state}
                title={disabled ? `${markLabel} is unavailable with Small caps` : state === null ? `${markLabel} (mixed)` : markLabel}
                disabled={disabled}
                onClick={() => onChange?.(field, mark, state !== true)}
              >
                <Icon size={15} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// The toolbar's "Styles" menu: section-heading case, the divider rule, and the
// per-role text-style matrix (font / size / emphasis truth per field kind).
export function TextStylesPopover({
  docStyle,
  disabled = false,
  styleMarkStates,
  onStyleFieldMarkChange,
  styleFontStates,
  onStyleFieldFontChange,
  styleSizeStates,
  onStyleFieldSizeChange,
  onResetStyleFormatting
}: TextStylesPopoverProps) {
  const { style } = docStyle;
  const idPrefix = `text-styles-${useId()}`;
  const headingsId = `${idPrefix}-headings`;
  const entriesId = `${idPrefix}-entries`;
  const styleMarksAreDefault = styleMarkStates
    ? TEXT_STYLE_ROWS.every(({ field }) => ENTRY_MARK_OPTIONS.every(({ mark }) =>
        styleMarkStates[field][mark] === STYLE_FIELD_MARK_DEFAULTS[field][mark]
      ))
    : true;
  // A field font/size defaults to the document font / role size; any divergence
  // (an explicit override or a mixed field) means "Reset text formatting" has
  // something to clear.
  const styleFontsAreDefault = styleFontStates
    ? TEXT_STYLE_ROWS.every(({ field }) => styleFontStates[field] === style.fontFamily)
    : true;
  const styleSizesAreDefault = styleSizeStates
    ? TEXT_STYLE_ROWS.every(({ field }) => {
        const size = styleSizeStates[field];
        return size !== null && Math.abs(size - styleFieldDefaultSizePt(field, style.baseFontSizePt)) < 0.05;
      })
    : true;
  return (
    <Popover
      ariaLabel="Document styles"
      // Styles sits at the toolbar's right edge; open it leftward so its wider
      // per-field rows stay on-screen.
      align="end"
      className="text-style-popover"
      trigger={(triggerProps, open) => (
        <ToolbarButton
          {...triggerProps}
          className={open ? "is-active" : ""}
          label="Styles"
          tooltip="Document styles"
          icon={<SlidersHorizontal size={16} />}
          trailingIcon={<ChevronDown size={13} />}
          showLabel
          disabled={disabled}
        />
      )}
    >
      {() => (
        <div className="style-popover style-popover--text">
          <div className="style-popover__body">
            <section className="style-popover__section" aria-labelledby={headingsId}>
              <h3 id={headingsId} className="style-popover__section-title">
                Section headings
              </h3>
              <div className="style-popover__segmented" role="group" aria-label="Section heading case">
                {HEADING_CASE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={style.headingCase === option.value ? "is-selected" : ""}
                    aria-pressed={style.headingCase === option.value}
                    onClick={() => docStyle.set("headingCase", option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="style-popover__toggle-row">
                <span>Divider rule</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={style.sectionRule}
                  className={`style-popover__switch${style.sectionRule ? " is-on" : ""}`}
                  onClick={() => docStyle.set("sectionRule", !style.sectionRule)}
                >
                  <span className="style-popover__switch-knob" aria-hidden="true" />
                </button>
              </div>
            </section>

            <section className="style-popover__section" aria-labelledby={entriesId}>
              <h3 id={entriesId} className="style-popover__section-title">
                Text styles
              </h3>
              <div className="style-popover__entry-marks" aria-label="Text element formatting">
                {TEXT_STYLE_ROWS.map(({ field, label }) => (
                  <FieldStyleRow
                    key={field}
                    field={field}
                    label={label}
                    states={styleMarkStates}
                    fontStates={styleFontStates}
                    sizeStates={styleSizeStates}
                    documentFont={style.fontFamily}
                    baseFontSizePt={style.baseFontSizePt}
                    disabled={field === "sectionHeading" && style.headingCase === "smallcaps"}
                    onChange={onStyleFieldMarkChange}
                    onFontChange={onStyleFieldFontChange}
                    onSizeChange={onStyleFieldSizeChange}
                  />
                ))}
              </div>
            </section>
          </div>

          <div className="style-popover__footer">
            <button
              type="button"
              className="style-popover__reset"
              disabled={docStyle.isStyleDefault && styleMarksAreDefault && styleFontsAreDefault && styleSizesAreDefault}
              onClick={() => {
                docStyle.applyStyle(TEXT_STYLE_DEFAULTS);
                onResetStyleFormatting?.();
              }}
            >
              <RotateCcw size={14} aria-hidden="true" />
              Reset text formatting
            </button>
          </div>
        </div>
      )}
    </Popover>
  );
}
