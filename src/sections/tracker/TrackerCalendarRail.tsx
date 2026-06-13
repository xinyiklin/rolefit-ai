import { CalendarDays, Clock3, ExternalLink } from "lucide-react";
import type { Application } from "../../hooks/useApplications";
import {
  displayCompany,
  displayRole,
  formatCompactDate,
  nextAction
} from "../../lib/applicationDisplay";
import type { CalendarEvent } from "./TrackerCalendarView";

type TrackerCalendarRailProps = {
  selectedDate: string;
  todayKey: string;
  selectedEvents: CalendarEvent[];
  upcoming: CalendarEvent[];
  selectedApp: Application | null;
  onSelectDate: (key: string) => void;
  onSetSelectedApplicationId: (id: string | null) => void;
  onOpenApplication: (app: Application) => void;
  onLoad: (app: Application) => void;
};

export function TrackerCalendarRail({
  selectedDate,
  todayKey,
  selectedEvents,
  upcoming,
  selectedApp,
  onSelectDate,
  onSetSelectedApplicationId,
  onOpenApplication,
  onLoad
}: TrackerCalendarRailProps) {
  return (
    <aside className="calendar-side" aria-label="Selected day details">
      <section className="calendar-side__today">
        <p className="calendar-side__eyebrow">
          {selectedDate === todayKey ? "Today" : formatCompactDate(selectedDate)}
        </p>
        {selectedEvents.length ? (
          selectedEvents.map((event) => (
            <article
              className={`calendar-agenda-card calendar-agenda-card--${event.type}`}
              key={event.id}
              title="Double-click to open full details"
              onDoubleClick={() => onOpenApplication(event.app)}
            >
              <span>{event.label}</span>
              <strong>{displayCompany(event.app)}</strong>
              <em>{displayRole(event.app)}</em>
              <button
                type="button"
                className="secondary-button is-compact"
                onClick={() => onOpenApplication(event.app)}
              >
                Open application
              </button>
            </article>
          ))
        ) : (
          <p className="calendar-empty-note">No events on this day.</p>
        )}
      </section>

      <div className="calendar-side__rule" aria-hidden="true" />

      <section className="calendar-side__panel">
        <p className="calendar-side__eyebrow">
          <Clock3 size={12} aria-hidden="true" /> Upcoming
        </p>
        {upcoming.length ? (
          upcoming.map((event) => (
            <button
              type="button"
              className="calendar-upcoming"
              key={event.id}
              onClick={() => {
                onSelectDate(
                  `${event.date.getFullYear()}-${String(event.date.getMonth() + 1).padStart(2, "0")}-${String(event.date.getDate()).padStart(2, "0")}`
                );
                onSetSelectedApplicationId(event.app.id);
              }}
            >
              <span>{formatCompactDate(event.date.toISOString())}</span>
              <strong>{event.label}</strong>
              <em>{displayCompany(event.app)}</em>
            </button>
          ))
        ) : (
          <p className="calendar-empty-note">No dated follow-ups yet.</p>
        )}
      </section>

      {selectedApp ? (
        <>
          <div className="calendar-side__rule" aria-hidden="true" />
          <section className="calendar-side__panel">
            <p className="calendar-side__eyebrow">
              <CalendarDays size={12} aria-hidden="true" /> Linked application
            </p>
            <div className="calendar-linked-app">
              <strong>{displayCompany(selectedApp)}</strong>
              <span>{displayRole(selectedApp)}</span>
              <em>{nextAction(selectedApp)}</em>
              <div className="calendar-linked-app__actions">
                <button
                  type="button"
                  className="secondary-button is-compact"
                  onClick={() => onOpenApplication(selectedApp)}
                >
                  Open details
                </button>
                <button
                  type="button"
                  className="secondary-button is-compact"
                  onClick={() => onLoad(selectedApp)}
                >
                  <ExternalLink size={12} aria-hidden="true" />
                  Polish
                </button>
              </div>
            </div>
          </section>
        </>
      ) : null}
    </aside>
  );
}
