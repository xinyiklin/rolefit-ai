import { ChevronDown, FileText } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { Popover } from "../Popover";
import type { DocStyleControls } from "../../hooks/useDocStyle";
import { PAGE_MARGIN_BOUNDS_PT, pageMarginValuesFor, type PageMargins } from "@typeset/engine/lib/pageMargins.ts";
import { numericDraftCommit } from "./numericDraft";
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
  const commitRef = useRef<() => void>(() => undefined);
  const cancelledRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setDraft(formatMarginInches(valuePt)), [valuePt]);
  // An outside click unmounts the input before its blur reaches React, so a typed
  // margin commits here. The menu closes on Escape in a document capture listener,
  // so a window capture listener marks the draft cancelled before that runs.
  useEffect(() => {
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && event.target === inputRef.current) cancelledRef.current = true;
    };
    window.addEventListener("keydown", cancelOnEscape, true);
    return () => {
      window.removeEventListener("keydown", cancelOnEscape, true);
      commitRef.current();
    };
  }, []);

  const commit = () => {
    if (cancelledRef.current) return;
    const nextPt = numericDraftCommit(draft, formatMarginInches(valuePt), valuePt, (inches) => {
      const clampedPt = Math.min(PAGE_MARGIN_BOUNDS_PT.max, Math.max(PAGE_MARGIN_BOUNDS_PT.min, inches * 72));
      return Math.round(clampedPt * 10) / 10;
    });
    if (nextPt === null) {
      setDraft(formatMarginInches(valuePt));
      return;
    }
    setDraft(formatMarginInches(nextPt));
    onChange(nextPt);
  };
  commitRef.current = commit;

  return (
    <label className="style-popover__margin-field" htmlFor={inputId}>
      <span>{label}</span>
      <input
        ref={inputRef}
        id={inputId}
        className="style-popover__margin-input"
        type="number"
        inputMode="decimal"
        min={PAGE_MARGIN_BOUNDS_PT.min / 72}
        max={PAGE_MARGIN_BOUNDS_PT.max / 72}
        step={0.05}
        value={draft}
        onChange={(event) => {
          cancelledRef.current = false;
          setDraft(event.target.value);
        }}
        onFocus={() => {
          cancelledRef.current = false;
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
            event.currentTarget.select();
          } else if (event.key === "Escape") {
            cancelledRef.current = true;
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
    if (value === "custom") {
      docStyle.set("pageMargins", "custom");
      return;
    }
    const current = pageMarginValuesFor(value);
    docStyle.applyStyle({
      pageMargins: value,
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
              <h3 id={marginsId} className="style-popover__section-title">Margins (inches)</h3>
              <div className="style-popover__segmented" role="group" aria-label="Page margins">
                {([
                  ["narrow", "Narrow"],
                  ["normal", "Normal"],
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

              <div className="style-popover__margin-grid">
                {MARGIN_FIELDS.map(({ field, label }) => (
                  <MarginInput
                    key={field}
                    label={label}
                    valuePt={docStyle.style[field]}
                    onChange={(valuePt) =>
                      docStyle.applyStyle({ pageMargins: "custom", [field]: valuePt })
                    }
                  />
                ))}
              </div>
            </section>
          </div>
        </div>
      )}
    </Popover>
  );
}
