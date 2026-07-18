import { ChevronLeft, ChevronRight, Clock3, ExternalLink } from "lucide-react";
import type { Application } from "../../hooks/useApplications";
import {
  dateKey,
  displayCompany,
  displayRole,
  formatCompactDate
} from "../../lib/applicationDisplay";
import type { CalendarEvent } from "./TrackerCalendarView";

type TrackerCalendarRailProps = {
  selectedDate: string;
  todayKey: string;
  monthLabelText: string;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onToday: () => void;
  selectedEvents: CalendarEvent[];
  upcoming: CalendarEvent[];
  onSelectDate: (key: string, visibleMonth?: Date) => void;
  onSetSelectedApplicationId: (id: string | null) => void;
  onOpenApplication: (app: Application) => void;
};

export function TrackerCalendarRail({
  selectedDate,
  todayKey,
  monthLabelText,
  onPrevMonth,
  onNextMonth,
  onToday,
  selectedEvents,
  upcoming,
  onSelectDate,
  onSetSelectedApplicationId,
  onOpenApplication
}: TrackerCalendarRailProps) {
  return (
    <aside className="calendar-side" aria-label="Selected day details">
      {/* Inner scroller: the aside is sized by the calendar grid (the layout's
          row height), and this absolutely-positioned child scrolls within it so
          the rail never stretches the calendar taller. */}
      <div className="calendar-side__scroll">
      {/* Month navigation, sticky to the top of the rail (moved out of a
          full-width bar above the grid to reclaim that vertical band). */}
      <div className="calendar-rail-nav" aria-label="Month navigation">
        <div className="calendar-nav" aria-label="Change month">
          <button
            type="button"
            className="ghost-button is-icon"
            aria-label="Previous month"
            onClick={onPrevMonth}
          >
            <ChevronLeft size={15} aria-hidden="true" />
          </button>
          <strong>{monthLabelText}</strong>
          <button
            type="button"
            className="ghost-button is-icon"
            aria-label="Next month"
            onClick={onNextMonth}
          >
            <ChevronRight size={15} aria-hidden="true" />
          </button>
        </div>
        <button type="button" className="ghost-button is-compact" onClick={onToday}>
          Today
        </button>
      </div>

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
              <button
                type="button"
                className="calendar-agenda-card__open ghost-button is-icon"
                aria-label={`Open ${displayCompany(event.app)} application`}
                onClick={() => onOpenApplication(event.app)}
              >
                <ExternalLink size={14} aria-hidden="true" />
              </button>
              <span>{event.label}</span>
              <strong>{displayCompany(event.app)}</strong>
              <em>{displayRole(event.app)}</em>
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
                onSelectDate(dateKey(event.date), event.date);
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
      </div>
    </aside>
  );
}
