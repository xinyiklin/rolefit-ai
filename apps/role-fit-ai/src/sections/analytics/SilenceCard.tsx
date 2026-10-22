import { useId } from "react";
import { Info } from "lucide-react";
import type { SilenceBin } from "../../lib/applicationAnalytics";

const NOTE = "Days since the last activity, among open applications with no follow-up planned.";

// How long open applications have gone quiet. Bins past the threshold take the
// full hue; earlier ones the light step of it.
export function SilenceCard({ bins, open }: { bins: SilenceBin[]; open: number }) {
  const titleId = useId();
  if (!open) return null;
  const max = Math.max(1, ...bins.map((bin) => bin.count));
  return (
    <section className="an-card an-silence" aria-labelledby={titleId}>
      <header className="an-card__head">
        <h3 className="an-card__title" id={titleId}>
          Time without a response
          <span className="an-card__hint" title={NOTE}>
            <Info size={14} aria-hidden="true" />
            <span className="sr-only">{NOTE}</span>
          </span>
        </h3>
        <span className="an-card__meta">{open} awaiting reply</span>
      </header>
      <ul className="an-silence__rows">
        {bins.map((bin) => (
          <li key={bin.id} className={bin.past ? "is-past" : undefined}>
            <span className="an-silence__label">
              {bin.label}
              {bin.past ? <span className="sr-only"> (past the No response threshold)</span> : null}
            </span>
            <span className="an-silence__track" aria-hidden="true">
              {bin.count ? <i style={{ width: `${(bin.count / max) * 100}%` }} /> : null}
            </span>
            <b>{bin.count}</b>
          </li>
        ))}
      </ul>
    </section>
  );
}
