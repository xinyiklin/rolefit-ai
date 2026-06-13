import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Application, ApplicationStatus } from "../../hooks/useApplications";
import {
  dateKey,
  displayCompany,
  displayRole
} from "../../lib/applicationDisplay";
import { TrackerCalendarRail } from "./TrackerCalendarRail";

// Exported so TrackerCalendarRail can import it for its prop type.
export type CalendarEvent = {
  id: string;
  app: Application;
  date: Date;
  label: string;
  type: "applied" | "interview" | "followup" | "offer" | "other";
};

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function monthLabel(date: Date) {
  return date.toLocaleDateString([], { month: "long", year: "numeric" });
}

function buildCalendarDays(month: Date) {
  const first = startOfMonth(month);
  const firstDay = first.getDay();
  const start = new Date(first);
  start.setDate(first.getDate() - firstDay);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

function applicationEvents(applications: Application[]): CalendarEvent[] {
  return applications.flatMap((app) => {
    const events: CalendarEvent[] = [];
    const applied = app.appliedAt ? new Date(app.appliedAt) : null;
    const followup = app.followupAt ? new Date(app.followupAt) : null;
    if (applied && !Number.isNaN(applied.getTime())) {
      events.push({
        id: `${app.id}-applied`,
        app,
        date: applied,
        label: "Application submitted",
        type: "applied"
      });
    }
    if (followup && !Number.isNaN(followup.getTime())) {
      events.push({
        id: `${app.id}-followup`,
        app,
        date: followup,
        label:
          app.status === "interviewing"
            ? "Interview prep"
            : app.status === "offer"
            ? "Offer review"
            : "Follow-up",
        type:
          app.status === "interviewing"
            ? "interview"
            : app.status === "offer"
            ? "offer"
            : "followup"
      });
    }
    return events;
  });
}

type TrackerCalendarViewProps = {
  applications: Application[];
  query: string;
  stageFilter: "all" | ApplicationStatus;
  selectedApplicationId: string | null;
  setSelectedApplicationId: (id: string | null) => void;
  onOpenApplication: (app: Application) => void;
  onLoad: (app: Application) => void;
};

export function TrackerCalendarView({
  applications,
  query,
  stageFilter,
  selectedApplicationId,
  setSelectedApplicationId,
  onOpenApplication,
  onLoad
}: TrackerCalendarViewProps) {
  const today = new Date();
  const todayKey = dateKey(today);
  const [month, setMonth] = useState(startOfMonth(today));
  const [selectedDate, setSelectedDate] = useState(todayKey);

  const events = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return applicationEvents(applications).filter((event) => {
      // Apply stage filter
      if (stageFilter !== "all" && event.app.status !== stageFilter) return false;
      // Apply search
      if (!needle) return true;
      return [displayCompany(event.app), displayRole(event.app), event.label].some((value) =>
        value.toLowerCase().includes(needle)
      );
    });
  }, [applications, query, stageFilter]);

  const eventsByDate = useMemo(() => {
    const grouped = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      const key = dateKey(event.date);
      grouped.set(key, [...(grouped.get(key) ?? []), event]);
    }
    return grouped;
  }, [events]);

  const days = buildCalendarDays(month);
  const selectedEvents = eventsByDate.get(selectedDate) ?? [];
  const selectedApp =
    applications.find((app) => app.id === selectedApplicationId) ??
    selectedEvents[0]?.app ??
    null;
  const upcoming = events
    .filter((event) => event.date.getTime() >= new Date(today.toDateString()).getTime())
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(0, 5);

  return (
    <>
      {/* Month navigation sits directly above the grid — only relevant in calendar view */}
      <div className="tracker-calendar-nav" aria-label="Month navigation">
        <button
          type="button"
          className="secondary-button is-compact"
          onClick={() => {
            setMonth(startOfMonth(today));
            setSelectedDate(todayKey);
          }}
        >
          Today
        </button>
        <div className="calendar-nav" aria-label="Change month">
          <button
            type="button"
            className="ghost-button is-icon"
            aria-label="Previous month"
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
          >
            <ChevronLeft size={15} aria-hidden="true" />
          </button>
          <strong>{monthLabel(month)}</strong>
          <button
            type="button"
            className="ghost-button is-icon"
            aria-label="Next month"
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
          >
            <ChevronRight size={15} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="tracker-layout tracker-layout--calendar">
        <div className="calendar-grid">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
            <span className="calendar-grid__weekday table-eyebrow" key={day}>
              {day}
            </span>
          ))}
          {days.map((day) => {
            const key = dateKey(day);
            const cellEvents = eventsByDate.get(key) ?? [];
            const isOutside = day.getMonth() !== month.getMonth();
            const isToday = key === todayKey;
            const isSelected = key === selectedDate;
            return (
              <button
                type="button"
                className={`calendar-cell ${isOutside ? "is-outside" : ""} ${isToday ? "is-today" : ""} ${isSelected ? "is-selected" : ""}`}
                key={key}
                onClick={() => setSelectedDate(key)}
              >
                <span>{day.getDate()}</span>
                <div>
                  {cellEvents.slice(0, 3).map((event) => (
                    <em className={`calendar-event calendar-event--${event.type}`} key={event.id}>
                      <span className="event-dot" aria-hidden="true" />
                      {displayCompany(event.app)}
                    </em>
                  ))}
                  {cellEvents.length > 3 ? <small>+{cellEvents.length - 3} more</small> : null}
                </div>
              </button>
            );
          })}
        </div>

        <TrackerCalendarRail
          selectedDate={selectedDate}
          todayKey={todayKey}
          selectedEvents={selectedEvents}
          upcoming={upcoming}
          selectedApp={selectedApp}
          onSelectDate={setSelectedDate}
          onSetSelectedApplicationId={setSelectedApplicationId}
          onOpenApplication={onOpenApplication}
          onLoad={onLoad}
        />
      </div>
    </>
  );
}
