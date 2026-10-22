import { useEffect, useId, useRef, useState } from "react";
import { CalendarDays, Info } from "lucide-react";
import { ANALYTICS_PERIODS, type AnalyticsPeriod } from "../../lib/applicationAnalytics";

// Common thresholds; a value saved in Settings outside them is kept as an
// option so the select always shows the real setting.
const THRESHOLD_OPTIONS = [7, 14, 21, 30, 45, 60, 90];

export function AnalyticsHeadControls({
  ghostedAfterDays,
  onGhostedAfterDaysChange,
  period,
  onPeriodChange
}: {
  ghostedAfterDays: number;
  onGhostedAfterDaysChange: (days: number) => void;
  // Absent while nothing has been sent, so there is no period to choose.
  period?: AnalyticsPeriod;
  onPeriodChange?: (period: AnalyticsPeriod) => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const options = [...new Set([...THRESHOLD_OPTIONS, ghostedAfterDays])].sort((a, b) => a - b);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !wrap.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div className="an-head-controls" ref={wrap}>
      <div className="an-head-controls__threshold">
        <label className="an-field">
          <span>Mark as Ghosted after</span>
          <select value={ghostedAfterDays} onChange={(event) => onGhostedAfterDaysChange(Number(event.target.value))}>
            {options.map((days) => <option key={days} value={days}>{days} days</option>)}
          </select>
        </label>
        <button
          type="button"
          className="an-icon-button"
          aria-label="How it works"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={() => setOpen((current) => !current)}
        >
          <Info size={15} aria-hidden="true" />
        </button>
      </div>
      {period && onPeriodChange ? (
        <label className="an-field an-field--period">
          <CalendarDays size={15} aria-hidden="true" />
          <span className="sr-only">Period</span>
          <select value={period} onChange={(event) => onPeriodChange(event.target.value as AnalyticsPeriod)}>
            {ANALYTICS_PERIODS.map((option) => (
              <option key={option.id} value={option.id}>{option.weeks ? `Last ${option.label}` : option.label}</option>
            ))}
          </select>
        </label>
      ) : null}
      {open ? (
        <div className="an-howto" id={panelId} role="note">
          <p>An Applied or Interviewing application with no activity for this many days counts as <b>No response</b>. A follow-up you sent, a reply, or a scheduled interview restarts the count; a follow-up you have planned holds it.</p>
          <p>Mark them <b>Ghosted</b> yourself or turn on automatic marking. Ghosted is an ordinary stage you can move out of.</p>
        </div>
      ) : null}
    </div>
  );
}
