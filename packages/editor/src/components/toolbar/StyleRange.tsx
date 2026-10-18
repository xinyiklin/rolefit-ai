import { useEffect, useRef, useState } from "react";

import { numericDraftCommit } from "./numericDraft";
import { formatSpacingValue } from "./styleOptions";

const stepDecimals = (step: number) => (String(step).split(".")[1] ?? "").length;

// One style-popover row: label, range, and a typeable value. The value box
// commits on blur, Enter, or the menu closing, through the shared numeric-draft
// decision, clamped to the range and snapped to its step.
export function StyleRange({
  id,
  label,
  value,
  min,
  max,
  step,
  unit = "",
  disabled = false,
  onChange
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const display = formatSpacingValue(value, "");
  const [draft, setDraft] = useState(display);
  const commitRef = useRef<() => void>(() => undefined);

  useEffect(() => setDraft(display), [display]);
  // Closing the menu (Escape or an outside click) unmounts the row before its
  // blur reaches React, so a typed value commits here, as preset names do.
  useEffect(() => () => commitRef.current(), []);

  const commit = () => {
    const next = numericDraftCommit(draft, display, value, (parsed) =>
      Number(Math.min(max, Math.max(min, Math.round(parsed / step) * step)).toFixed(stepDecimals(step)))
    );
    if (next === null) {
      setDraft(display);
      return;
    }
    onChange(next);
  };
  commitRef.current = commit;

  return (
    <div className="style-popover__range">
      <label className="style-popover__range-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="style-popover__range-value">
        <input
          type="text"
          inputMode="decimal"
          aria-label={unit ? `${label} in ${unit === "pt" ? "points" : unit}` : `${label} value`}
          value={draft}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            commit();
            event.currentTarget.select();
          }}
        />
        {unit ? <span aria-hidden="true">{unit}</span> : null}
      </span>
    </div>
  );
}
