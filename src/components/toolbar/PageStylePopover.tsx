import { ChevronDown, FileText } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { Popover } from "../Popover";
import type { DocStyleControls } from "../../hooks/useDocStyle";
import { PAGE_MARGIN_BOUNDS_PT, pageMarginValuesFor, type PageMargins } from "../../lib/pageMargins";
import { ToolbarButton } from "./ToolbarButton";

export type PageStylePopoverProps = {
  docStyle: DocStyleControls;
  disabled?: boolean;
};

type MarginField =
  | "pageMarginTopPt"
  | "pageMarginRightPt"
  | "pageMarginBottomPt"
  | "pageMarginLeftPt";

const MARGIN_FIELDS = [
  { field: "pageMarginTopPt", label: "Top" },
  { field: "pageMarginBottomPt", label: "Bottom" },
  { field: "pageMarginLeftPt", label: "Left" },
  { field: "pageMarginRightPt", label: "Right" }
] as const satisfies readonly { field: MarginField; label: string }[];

function formatMarginInches(valuePt: number) {
  return Number((valuePt / 72).toFixed(2)).toString();
}

function MarginInput({
  label,
  valuePt,
  onChange
}: {
  label: string;
  valuePt: number;
  onChange: (valuePt: number) => void;
}) {
  const inputId = `custom-margin-${useId()}`;
  const [draft, setDraft] = useState(formatMarginInches(valuePt));

  useEffect(() => setDraft(formatMarginInches(valuePt)), [valuePt]);

  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(formatMarginInches(valuePt));
      return;
    }
    const clampedPt = Math.min(PAGE_MARGIN_BOUNDS_PT.max, Math.max(PAGE_MARGIN_BOUNDS_PT.min, parsed * 72));
    const nextPt = Math.round(clampedPt * 10) / 10;
    setDraft(formatMarginInches(nextPt));
    onChange(nextPt);
  };

  return (
    <label className="style-popover__margin-field" htmlFor={inputId}>
      <span>{label}</span>
      <input
        id={inputId}
        className="style-popover__margin-input"
        type="number"
        inputMode="decimal"
        min={PAGE_MARGIN_BOUNDS_PT.min / 72}
        max={PAGE_MARGIN_BOUNDS_PT.max / 72}
        step={0.05}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
            event.currentTarget.select();
          } else if (event.key === "Escape") {
            setDraft(formatMarginInches(valuePt));
            event.currentTarget.blur();
          }
        }}
        aria-label={`${label} page margin in inches`}
      />
    </label>
  );
}

export function PageStylePopover({ docStyle, disabled = false }: PageStylePopoverProps) {
  const marginsId = `page-style-${useId()}-margins`;
  const chooseMargins = (value: PageMargins) => {
    if (value !== "custom" || docStyle.style.pageMargins === "custom") {
      docStyle.set("pageMargins", value);
      return;
    }
    const current = pageMarginValuesFor(docStyle.style.pageMargins);
    docStyle.applyStyle({
      pageMargins: "custom",
      pageMarginTopPt: current.top,
      pageMarginRightPt: current.right,
      pageMarginBottomPt: current.bottom,
      pageMarginLeftPt: current.left
    });
  };

  return (
    <Popover
      ariaLabel="Page settings"
      align="end"
      className="page-style-popover"
      trigger={(triggerProps, open) => (
        <ToolbarButton
          {...triggerProps}
          className={open ? "is-active" : ""}
          label="Page"
          tooltip="Page settings"
          icon={<FileText size={16} />}
          trailingIcon={<ChevronDown size={13} />}
          showLabel
          disabled={disabled}
        />
      )}
    >
      {() => (
        <div className="style-popover style-popover--page">
          <div className="style-popover__body">
            <section className="style-popover__section" aria-labelledby={marginsId}>
              <h3 id={marginsId} className="style-popover__section-title">Page margins (inches)</h3>
              <div className="style-popover__segmented" role="group" aria-label="Page margins">
                {([
                  ["narrow", "Narrow"],
                  ["normal", "Normal"],
                  ["wide", "Wide"],
                  ["custom", "Custom"]
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={docStyle.style.pageMargins === value ? "is-selected" : ""}
                    aria-pressed={docStyle.style.pageMargins === value}
                    onClick={() => chooseMargins(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {docStyle.style.pageMargins === "custom" ? (
                <div className="style-popover__margin-grid">
                  {MARGIN_FIELDS.map(({ field, label }) => (
                    <MarginInput
                      key={field}
                      label={label}
                      valuePt={docStyle.style[field]}
                      onChange={(valuePt) => docStyle.set(field, valuePt)}
                    />
                  ))}
                </div>
              ) : null}
            </section>
          </div>
        </div>
      )}
    </Popover>
  );
}
