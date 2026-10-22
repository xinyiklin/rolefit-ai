import { useId } from "react";
import { ArrowUpRight } from "lucide-react";
import type { ApplicationStatus } from "../../hooks/useApplications";
import { COHORT_STAGES, type CohortStage } from "../../lib/applicationAnalytics";
import { STATUS_LABEL } from "../../lib/applicationDisplay";
import { plural } from "./analyticsFormat";

// Shares this small are left to the key; their label would crowd a neighbour.
const LABEL_MIN_SHARE = 0.04;

// The period's applications by current stage, as one segmented bar with its
// shares and a key. Selecting a stage (bar or key) offers "View in
// Applications" under the key, in a live region that stays mounted so the
// change is read.
export function StageDistribution({
  counts,
  total,
  selected,
  onSelect,
  onViewStage
}: {
  counts: Record<CohortStage, number>;
  total: number;
  selected: ApplicationStatus | null;
  onSelect: (status: ApplicationStatus | null) => void;
  onViewStage: (status: ApplicationStatus) => void;
}) {
  const titleId = useId();
  const present = COHORT_STAGES.filter((stage) => counts[stage]);
  const toggle = (status: ApplicationStatus) => onSelect(selected === status ? null : status);
  const dimmed = (stage: CohortStage) => (selected && selected !== stage ? " is-dimmed" : "");

  return (
    <section className="an-card an-stages" aria-labelledby={titleId}>
      <header className="an-card__head">
        <h3 className="an-card__title" id={titleId}>Current stage distribution</h3>
      </header>
      <div className="an-stagebar-row">
        <div className="an-stagebar-wrap" aria-hidden="true">
          <div className="an-stagebar">
            {present.map((stage) => (
              <i
                key={stage}
                className={`an-stagebar__seg an-stage--${stage}${dimmed(stage)}`}
                style={{ flexGrow: counts[stage] }}
                title={`${STATUS_LABEL[stage]}: ${counts[stage]}`}
                onClick={() => toggle(stage)}
              />
            ))}
          </div>
          <div className="an-stagebar__shares">
            {present.map((stage) => {
              const share = counts[stage] / total;
              return (
                <span
                  key={stage}
                  className={`${share < 0.08 ? "is-small" : ""}${dimmed(stage)}`.trim() || undefined}
                  style={{ flexGrow: counts[stage] }}
                >
                  {share >= LABEL_MIN_SHARE ? `${Math.round(share * 100)}%` : ""}
                </span>
              );
            })}
          </div>
        </div>
        <p className="an-stagebar__total"><b>{total}</b> {total === 1 ? "application" : "applications"}</p>
      </div>
      <div className="an-stagekey" role="group" aria-label="Filter by stage">
        {COHORT_STAGES.map((stage) => (
          <button
            type="button"
            key={stage}
            className="an-stagekey__item"
            aria-pressed={selected === stage}
            disabled={!counts[stage]}
            onClick={() => toggle(stage)}
          >
            <i className={`an-dot an-stage--${stage}`} aria-hidden="true" />
            <span>{STATUS_LABEL[stage]}</span>
            <b>{counts[stage]}</b>
          </button>
        ))}
      </div>
      <div className="an-selection-region" role="status">
        {selected ? (
          <div className="an-selection">
            <span>
              Selected: <b>{STATUS_LABEL[selected]}</b> · {plural(counts[selected as CohortStage] ?? 0, "application")} this period
            </span>
            <button type="button" className="an-selection__go" onClick={() => onViewStage(selected)}>
              View all {STATUS_LABEL[selected]} in Applications <ArrowUpRight size={13} aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
