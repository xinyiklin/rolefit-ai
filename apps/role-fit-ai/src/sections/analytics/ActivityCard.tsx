import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  COHORT_STAGES,
  dayNumber,
  type CohortStage,
  type PeriodMetrics,
  type RegisterEntry,
  type RegisterRow
} from "../../lib/applicationAnalytics";
import { STATUS_LABEL, displayCompany, displayRole, parseDate } from "../../lib/applicationDisplay";
import { lastActivityAt } from "../../lib/noResponse";
import { formatDay, plural, rowRange } from "./analyticsFormat";
import { outcomeDotClass, type OutcomeCount } from "./registerParts";

export type ActivityUnit = "week" | "month";

type ActivityCardProps = {
  rows: RegisterRow[];
  // null for All time, which is always monthly.
  unit: ActivityUnit | null;
  onUnitChange: (unit: ActivityUnit) => void;
  totals: PeriodMetrics;
  outcomes: OutcomeCount[];
  today: Date;
  traceId: string | null;
  onOpenApplication: (id: string) => void;
};

const PLOT_HEIGHT = 200;

const stageCount = (row: RegisterRow, stage: CohortStage) =>
  row.entries.filter((entry) => entry.application.status === stage).length;

// A clean axis: 0, then whole steps of 1, 2, 5, or 10s up to the tallest column.
function axisTicks(max: number) {
  const top = Math.max(max, 1);
  const step = [1, 2, 5, 10, 20, 50].find((candidate) => top / candidate <= 4) ?? 100;
  const ticks: number[] = [];
  for (let value = 0; value <= top; value += step) ticks.push(value);
  if (ticks[ticks.length - 1] < top) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

// Months name their year in January, so All time over a year never repeats a label.
const columnLabel = (row: RegisterRow) =>
  row.unit !== "month"
    ? formatDay(row.from)
    : row.from.getMonth() === 0
      ? row.from.toLocaleDateString([], { month: "short", year: "2-digit" })
      : row.from.toLocaleDateString([], { month: "short" });

// Words in sans, the figure in mono.
function entryFact(entry: RegisterEntry, today: Date): ReactNode {
  const days = entry.reach.responseDays;
  if (days !== null) return days === 0 ? "Replied same day" : <>Replied in <b>{days} d</b></>;
  if (entry.outcome === "awaiting" || entry.outcome === "noResponse") {
    const last = parseDate(lastActivityAt(entry.application) ?? undefined);
    const quiet = last ? dayNumber(today) - dayNumber(last) : -1;
    return quiet >= 0 ? <>Quiet <b>{quiet} d</b></> : "";
  }
  // A bare Rejected or Withdrawn move says nothing about whether they replied.
  return entry.reach.responded ? "Replied" : "";
}

// An opened week lists its first entries; a month of All time can hold dozens,
// which would stretch the whole first band.
const WEEK_ROWS = 8;

function WeekEntries({ row, outcomes, today, onOpenApplication }: {
  row: RegisterRow;
  outcomes: OutcomeCount[];
  today: Date;
  onOpenApplication: (id: string) => void;
}) {
  const [all, setAll] = useState(false);
  const firstRevealed = useRef<HTMLButtonElement>(null);
  const entries = all ? row.entries : row.entries.slice(0, WEEK_ROWS);
  const more = row.entries.length - entries.length;
  useEffect(() => {
    if (all) firstRevealed.current?.focus();
  }, [all]);
  return (
    <div className="an-week">
      <p className="an-week__head">
        <span>{rowRange(row).filter(Boolean).join(" – ")}</span>
        <span>{plural(row.sent, "application")} · {row.responded} replied</span>
      </p>
      <ul className="register-entries">
        {entries.map((entry, index) => (
          <li key={entry.application.id}>
            <button
              type="button"
              ref={index === WEEK_ROWS ? firstRevealed : undefined}
              onClick={() => onOpenApplication(entry.application.id)}
            >
              <span className="register-entries__sent">{formatDay(entry.sentAt)}</span>
              <span className="register-entries__who">
                <strong>{displayCompany(entry.application)}</strong>
                <span>{displayRole(entry.application)}</span>
              </span>
              <span className="register-entries__stage">
                <i className={outcomeDotClass(entry.outcome)} aria-hidden="true" />
                <span className="stage-dot-label">{outcomes.find((outcome) => outcome.id === entry.outcome)?.label}</span>
              </span>
              <span className={`register-entries__fact${entry.outcome === "noResponse" ? " is-quiet" : ""}`}>
                {entryFact(entry, today)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {more > 0 ? (
        <button type="button" className="an-more an-week__more" onClick={() => setAll(true)}>
          Show {more} more
        </button>
      ) : null}
    </div>
  );
}

// Applications sent per week or month, each column stacked by where those
// applications stand now. A column opens its list.
export function ActivityCard({
  rows,
  unit,
  onUnitChange,
  totals,
  outcomes,
  today,
  traceId,
  onOpenApplication
}: ActivityCardProps) {
  const titleId = useId();
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const columns = [...rows].reverse();
  const ticks = axisTicks(Math.max(0, ...columns.map((row) => row.sent)));
  const top = ticks[ticks.length - 1];
  const labelEvery = columns.length > 14 ? Math.ceil(columns.length / 9) : 1;
  const monthly = columns[0]?.unit === "month";
  const shown = columns.find((row) => row.key === hovered && row.sent);
  const open = columns.find((row) => row.key === selected && row.sent);
  const replyShare = totals.responseRate === null
    ? totals.sent ? `${totals.responded}/${totals.sent}` : "—"
    : `${Math.round(totals.responseRate * 100)}%`;

  return (
    <section className="an-card an-activity" aria-labelledby={titleId}>
      <header className="an-card__head">
        <div>
          <h3 className="an-card__title" id={titleId}>Application activity</h3>
          <p className="an-card__sub">
            {plural(totals.sent, "application")} sent · <b>{replyShare}</b> replied · <b>{totals.interviewed}</b> reached interview
          </p>
        </div>
        <label className="an-field">
          <span className="sr-only">Group by</span>
          <select
            value={unit ?? "month"}
            disabled={!unit}
            title={unit ? undefined : "All time is shown by month"}
            onChange={(event) => onUnitChange(event.target.value as ActivityUnit)}
          >
            <option value="week">Weekly</option>
            <option value="month">Monthly</option>
          </select>
        </label>
      </header>

      <ul className="an-legend" aria-label="Stages">
        {COHORT_STAGES.map((stage) => (
          <li key={stage}><i className={`an-dot an-stage--${stage}`} aria-hidden="true" />{STATUS_LABEL[stage]}</li>
        ))}
      </ul>

      <div className="an-plot" style={{ height: PLOT_HEIGHT }} onMouseLeave={() => setHovered(null)}>
        <div className="an-axis" aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick} style={{ bottom: `${(tick / top) * 100}%` }}><b>{tick}</b></span>
          ))}
        </div>
        <div className="an-columns">
          {columns.map((row) => {
            const traced = Boolean(traceId && row.entries.some((entry) => entry.application.id === traceId));
            const isOpen = open?.key === row.key;
            const summary = COHORT_STAGES
              .map((stage) => [STATUS_LABEL[stage], stageCount(row, stage)] as const)
              .filter(([, count]) => count)
              .map(([label, count]) => `${count} ${label}`)
              .join(", ");
            return (
              <button
                type="button"
                key={row.key}
                className={`an-col${traced ? " is-traced" : ""}${isOpen ? " is-selected" : ""}`}
                aria-label={`${rowRange(row).filter(Boolean).join(" to ")}: ${plural(row.sent, "application")}${summary ? `, ${summary}` : ""}`}
                aria-pressed={isOpen}
                // aria-disabled, not disabled: a disabled button gets no pointer
                // events in Firefox, which would leave the last tooltip up.
                aria-disabled={!row.sent || undefined}
                onMouseEnter={() => setHovered(row.key)}
                onFocus={() => setHovered(row.key)}
                onBlur={() => setHovered(null)}
                onClick={() => {
                  if (row.sent) setSelected((current) => (current === row.key ? null : row.key));
                }}
              >
                <span className="an-col__bar" style={{ height: `${(row.sent / top) * 100}%` }}>
                  {COHORT_STAGES.map((stage) => {
                    const count = stageCount(row, stage);
                    return count ? <i key={stage} className={`an-col__seg an-stage--${stage}`} style={{ flexGrow: count }} /> : null;
                  })}
                </span>
              </button>
            );
          })}
        </div>
        {shown ? (
          <div
            className="an-tooltip"
            aria-hidden="true"
            // Anchored proportionally so edge columns keep their tooltip inside.
            style={(() => {
              const at = (columns.indexOf(shown) + 0.5) / columns.length;
              return { left: `${at * 100}%`, transform: `translateX(-${at * 100}%)` };
            })()}
          >
            <strong>{rowRange(shown).filter(Boolean).join(" – ")}</strong>
            {COHORT_STAGES.map((stage) => {
              const count = stageCount(shown, stage);
              return count ? (
                <span key={stage}><i className={`an-dot an-stage--${stage}`} />{STATUS_LABEL[stage]}<b>{count}</b></span>
              ) : null;
            })}
            <span className="an-tooltip__total">Replied<b>{shown.responded}</b></span>
          </div>
        ) : null}
      </div>
      <div className="an-xlabels" aria-hidden="true">
        {columns.map((row, index) => (
          <span key={row.key}>{(columns.length - 1 - index) % labelEvery === 0 ? columnLabel(row) : ""}</span>
        ))}
      </div>


      <table className="sr-only">
        <caption>Applications sent per {monthly ? "month" : "week"} by current stage</caption>
        <thead>
          <tr>
            <th scope="col">{monthly ? "Month" : "Week"}</th>
            <th scope="col">Sent</th>
            {COHORT_STAGES.map((stage) => <th scope="col" key={stage}>{STATUS_LABEL[stage]}</th>)}
            <th scope="col">Replied</th>
          </tr>
        </thead>
        <tbody>
          {columns.map((row) => (
            <tr key={row.key}>
              <th scope="row">{rowRange(row).filter(Boolean).join(" – ")}</th>
              <td>{row.sent}</td>
              {COHORT_STAGES.map((stage) => <td key={stage}>{stageCount(row, stage)}</td>)}
              <td>{row.responded}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {open ? <WeekEntries key={open.key} row={open} outcomes={outcomes} today={today} onOpenApplication={onOpenApplication} /> : null}
    </section>
  );
}
