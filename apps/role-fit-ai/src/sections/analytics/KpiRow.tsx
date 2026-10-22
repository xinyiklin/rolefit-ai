import type { CSSProperties } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { periodChange, type CohortStage } from "../../lib/applicationAnalytics";
import { STATUS_LABEL } from "../../lib/applicationDisplay";

type Figure = CohortStage | "total";

// Cards group the stages the way they are read: the total, the live pipeline,
// Ghosted on its own, Rejected, and the ones the applicant closed.
const GROUPS: Figure[][] = [["total"], ["applied", "interviewing", "offer"], ["ghosted"], ["rejected"], ["withdrawn", "not_applying"]];

const LABEL = (figure: Figure) => (figure === "total" ? "Total applications" : STATUS_LABEL[figure]);

// Sends by date compare honestly with the same span one period earlier; more
// sent is good news.
function Change({ current, previous, window }: { current: number; previous: number; window: string }) {
  const change = periodChange(current, previous);
  if (change.kind === "none") {
    return <span className="an-kpi__change is-flat" title={`None in the previous ${window} either`}>—<span className="sr-only">none in the previous {window} either</span></span>;
  }
  if (change.kind === "new") {
    return <span className="an-kpi__change" title={`None in the previous ${window}`}>New<span className="sr-only">, none in the previous {window}</span></span>;
  }
  const { percent } = change;
  const tone = percent > 0 ? " is-good" : percent < 0 ? " is-bad" : "";
  const Arrow = percent > 0 ? ArrowUp : ArrowDown;
  return (
    <span className={`an-kpi__change${tone}`} title={`${previous} in the previous ${window}`}>
      {percent ? <Arrow size={12} aria-hidden="true" /> : null}
      {percent > 0 ? "+" : ""}{percent}%
      <span className="sr-only"> vs the previous {window}</span>
    </span>
  );
}

// The period's applications by where they stand now. Only the total carries a
// change: an older cohort has had longer to be answered, so comparing stage
// counts across periods would read as a trend that is not there. Each stage
// shows its share of the period instead.
export function KpiRow({
  counts,
  previous,
  window
}: {
  counts: Record<Figure, number>;
  // Sent in the previous span; null for All time.
  previous: number | null;
  // "12 weeks": what the change compares against.
  window: string;
}) {
  return (
    <section className="an-kpis" aria-label="Applications this period by stage">
      {GROUPS.map((group) => (
        <dl key={group.join("-")} className={`an-kpi-group${group.length === 1 ? " is-single" : ""}${group[0] === "ghosted" ? " is-ghosted" : ""}`} style={{ flexGrow: group.length, "--n": group.length } as CSSProperties}>
          {group.map((figure) => (
            <div key={figure} className={`an-kpi an-kpi--${figure}`}>
              <dt>{LABEL(figure)}</dt>
              <dd className="an-kpi__value">{counts[figure]}</dd>
              {figure === "total" ? (
                previous === null ? null : <dd><Change current={counts.total} previous={previous} window={window} /></dd>
              ) : counts.total ? (
                <dd>
                  <span className="an-kpi__change is-flat">
                    {Math.round((counts[figure] / counts.total) * 100)}%<span className="sr-only"> of this period's applications</span>
                  </span>
                </dd>
              ) : null}
            </div>
          ))}
        </dl>
      ))}
    </section>
  );
}
