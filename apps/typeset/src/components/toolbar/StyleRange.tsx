// One labeled range-slider row for the style popovers (spacing gaps, entry
// indents): label + live value readout above a native range input. Callers
// format the readout so each popover keeps its own precision and unit.
export function StyleRange({
  id,
  label,
  value,
  min,
  max,
  step,
  displayValue,
  onChange
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="style-popover__range" htmlFor={id}>
      <span className="style-popover__range-head">
        <span>{label}</span>
        <output className="style-popover__range-value" htmlFor={id}>
          {displayValue}
        </output>
      </span>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
