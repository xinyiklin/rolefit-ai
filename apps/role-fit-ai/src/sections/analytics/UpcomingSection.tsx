import { useId } from "react";
import type { UpcomingItem } from "../../lib/applicationAnalytics";
import { companyInitials, displayCompany, displayRole, parseDate } from "../../lib/applicationDisplay";
import { relativeDay } from "./analyticsFormat";

const VISIBLE = 6;

// Scheduled interviews and planned follow-ups as one dated list, soonest (and
// overdue) first. Rows carry no time of day: the tracker records days only.
export function UpcomingSection({
  interviews,
  followups,
  missingFollowup,
  onOpenApplication,
  onOpenApplications
}: {
  interviews: UpcomingItem[];
  followups: UpcomingItem[];
  // Open roles with no follow-up date planned (follow-up hygiene).
  missingFollowup: number;
  onOpenApplication: (id: string) => void;
  onOpenApplications: () => void;
}) {
  const titleId = useId();
  const items = [...interviews, ...followups].sort((a, b) => a.days - b.days || (a.kind === "interview" ? -1 : 1));
  const hidden = items.length - VISIBLE;

  return (
    <section className="an-card an-upcoming" aria-labelledby={titleId}>
      <header className="an-card__head">
        <h3 className="an-card__title" id={titleId}>Coming up</h3>
        <button type="button" className="an-link" onClick={onOpenApplications}>View all</button>
      </header>
      {items.length ? (
        <ul className="an-upcoming__list">
          {items.slice(0, VISIBLE).map((item) => {
            const date = parseDate(item.at);
            const company = displayCompany(item.application);
            const initials = companyInitials(company);
            const overdue = item.days < 0;
            return (
              <li key={item.key}>
                <button type="button" onClick={() => onOpenApplication(item.application.id)}>
                  <span className={`an-upcoming__date${overdue ? " is-overdue" : ""}`}>
                    <small>{date?.toLocaleDateString([], { month: "short" })}</small>
                    <b>{date?.getDate()}</b>
                  </span>
                  <span className="application-company-mark" data-len={initials.length} aria-hidden="true">{initials}</span>
                  <span className="an-upcoming__who">
                    <strong>{company}</strong>
                    <span>{displayRole(item.application)}</span>
                  </span>
                  <span className="an-upcoming__what">
                    <i className={`an-dot ${item.kind === "interview" ? "an-stage--interviewing" : "an-upcoming__followup"}`} aria-hidden="true" />
                    <strong>{item.kind === "interview" ? item.detail ?? "Interview" : "Follow up"}</strong>
                    <span className={overdue ? "is-overdue" : undefined}>{relativeDay(item.days)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="an-empty">No interviews scheduled or follow-ups due this week.</p>
      )}
      {hidden > 0 || missingFollowup ? (
        <p className="an-upcoming__foot">
          {hidden > 0 ? <span>{hidden} more in Applications</span> : null}
          {missingFollowup ? <span><b>{missingFollowup}</b> open without a follow-up date</span> : null}
        </p>
      ) : null}
    </section>
  );
}
