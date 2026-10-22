import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowRight, BellRing, CircleCheck, Ghost, MoreHorizontal, PanelRightOpen, X } from "lucide-react";
import type { Application } from "../../hooks/useApplications";
import { companyInitials, displayCompany, displayRole, parseDate } from "../../lib/applicationDisplay";
import { noResponseCandidates } from "../../lib/noResponse";
import { TrackerRowMenu } from "../tracker/TrackerRowMenu";
import { formatDay } from "./analyticsFormat";

// Longer lists show their first rows and a control for the rest, so the bulk
// action never moves a record the user has not seen.
const FIRST_ROWS = 8;

type NoResponseSectionProps = {
  applications: Application[];
  today: Date;
  pendingWrites: number;
  // The tracker's current write error, "" when none; explains a refused mark.
  trackerError: string;
  ghostedAfterDays: number;
  autoMarkGhosted: boolean;
  onAutoMarkGhostedChange: (enabled: boolean) => void;
  onMarkGhosted: (ids: string[]) => Promise<number | null>;
  autoMarkedCount: number;
  onDismissAutoMarked: () => void;
  // The period's first day: rows sent earlier say so, since the charts leave
  // them out.
  periodStart: Date | null;
  onOpenApplication: (id: string) => void;
  // Highlights the week holding this application while its row is hovered.
  onTrace: (id: string | null) => void;
  // Rendered between the callout and the list (the silence bars and the
  // stage distribution, so the grid keeps reading order).
  middle?: ReactNode;
};

// A follow-up sent after the employer's last word and still nothing back:
// Ghosted is the honest next step. Otherwise nudge first.
function nextStep(application: Application) {
  const latest = (types: string[]) =>
    Math.max(-Infinity, ...(application.stageHistory ?? [])
      .filter((entry) => types.includes(entry.type))
      .map((entry) => parseDate(entry.at)?.getTime() ?? -Infinity));
  const followup = latest(["followup"]);
  return followup > -Infinity && followup > latest(["response", "interview"]) ? "Consider Ghosted" : "Send a follow-up";
}

// Derived, never stored: Applied or Interviewing records quiet past the
// threshold, longest first, as a callout and the list it points to, with a bulk
// action over the selected rows and a per-row menu. Marking Ghosted is a
// stored, reversible stage change, so there is no confirmation; the list itself
// shows the result.
export function NoResponseSection({
  applications,
  today,
  pendingWrites,
  trackerError,
  ghostedAfterDays,
  autoMarkGhosted,
  onAutoMarkGhostedChange,
  onMarkGhosted,
  autoMarkedCount,
  onDismissAutoMarked,
  periodStart,
  onOpenApplication,
  onTrace,
  middle
}: NoResponseSectionProps) {
  const headingId = useId();
  const listId = useId();
  const listHeading = useRef<HTMLHeadingElement>(null);
  const calloutHeading = useRef<HTMLHeadingElement>(null);
  const selectAll = useRef<HTMLInputElement>(null);
  const [deselected, setDeselected] = useState<ReadonlySet<string>>(() => new Set());
  const [marking, setMarking] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const firstRevealed = useRef<HTMLInputElement>(null);
  const revealing = useRef(false);

  const candidates = useMemo(
    () => noResponseCandidates(applications, ghostedAfterDays, today),
    [applications, ghostedAfterDays, today]
  );
  const shown = showAll ? candidates : candidates.slice(0, FIRST_ROWS);
  const hidden = candidates.length - shown.length;
  const selected = shown.filter(({ application }) => !deselected.has(application.id));
  const allSelected = shown.length > 0 && selected.length === shown.length;
  const busy = marking || pendingWrites > 0;
  const closeMenu = useCallback(() => setMenu(null), []);
  const menuRowShown = Boolean(menu && shown.some(({ application }) => application.id === menu.id));

  // A row that left the list (marked, or no longer quiet) takes its menu, and
  // focus inside it falls back to the list heading.
  useEffect(() => {
    if (!menu || menuRowShown) return;
    setMenu(null);
    if (!document.activeElement || document.activeElement === document.body) listHeading.current?.focus();
  }, [menu, menuRowShown]);

  useEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = selected.length > 0 && !allSelected;
  }, [selected.length, allSelected]);

  // "View all" unmounts itself; focus moves to the first row it revealed.
  useEffect(() => {
    if (showAll && revealing.current) {
      revealing.current = false;
      firstRevealed.current?.focus();
    }
  }, [showAll]);

  function showMore() {
    // Rows revealed under a cleared "Select all" stay cleared.
    if (!selected.length) {
      setDeselected((current) => new Set([...current, ...candidates.slice(FIRST_ROWS).map(({ application }) => application.id)]));
    }
    revealing.current = true;
    setShowAll(true);
  }

  function toggle(id: string) {
    setDeselected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  async function mark(ids: string[]) {
    if (busy || !ids.length) return;
    const from = document.activeElement;
    setAnnouncement("");
    setMarking(true);
    const marked = await onMarkGhosted(ids);
    setMarking(false);
    // The optimistic update can unmount the focused control. Only then, after
    // the re-render, the list heading keeps the place (the callout's when the
    // list emptied); focus the user moved elsewhere meanwhile is left alone.
    setTimeout(() => {
      const lost = !document.activeElement || document.activeElement === document.body || (from && !from.isConnected);
      if (lost) (listHeading.current ?? calloutHeading.current)?.focus();
    }, 0);
    if (marked === null) return;
    onTrace(null);
    setAnnouncement(marked ? `Marked ${marked} as Ghosted.` : "Nothing marked; those applications already changed.");
  }

  const count = candidates.length;
  return (
    <>
      <section className={`an-card an-callout${count ? "" : " is-clear"}`} aria-labelledby={headingId}>
        <span className="an-callout__icon" aria-hidden="true">
          {count ? <BellRing size={20} /> : <CircleCheck size={20} />}
        </span>
        <div className="an-callout__body">
          <h3 className="an-callout__title" id={headingId} ref={calloutHeading} tabIndex={-1}>
            {count ? `${count} ${count === 1 ? "application" : "applications"} may be ghosted` : "Nothing waiting"}
          </h3>
          <p className="an-callout__text">
            {count
              ? `No employer response ${ghostedAfterDays}+ days after the last activity.`
              : `Nothing quiet past ${ghostedAfterDays} days.`}
          </p>
          <div className="an-callout__actions">
            {count ? (
              <button
                type="button"
                className="an-link"
                onClick={() => {
                  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
                  listHeading.current?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
                  listHeading.current?.focus({ preventScroll: true });
                }}
              >
                Review applications <ArrowRight size={14} aria-hidden="true" />
              </button>
            ) : null}
            <label className="check-row an-callout__auto" title="Moves quiet applications to Ghosted on the day they pass the threshold.">
              <input
                type="checkbox"
                checked={autoMarkGhosted}
                onChange={(event) => onAutoMarkGhostedChange(event.target.checked)}
              />
              <span>Mark automatically</span>
            </label>
          </div>
          {/* Mounted while empty, so screen readers announce the note when it fills. */}
          <div className="an-callout__note-region" role="status">
            {autoMarkedCount > 0 ? (
              <p className="an-callout__note">
                <span>{autoMarkedCount} marked Ghosted automatically</span>
                <button type="button" aria-label="Dismiss" onClick={onDismissAutoMarked}>
                  <X size={12} aria-hidden="true" />
                </button>
              </p>
            ) : null}
          </div>
        </div>
      </section>

      {middle}

      {count ? (
        <section className="an-card an-attention" aria-labelledby={listId}>
          <header className="an-card__head an-attention__head">
            <h3 className="an-card__title" id={listId} ref={listHeading} tabIndex={-1}>
              Needs your attention <span className="an-count-pill">{count}</span>
            </h3>
            <div className="an-attention__actions">
              {hidden > 0 ? (
                <button type="button" className="an-link" onClick={showMore}>View all</button>
              ) : null}
              <button
                type="button"
                className="primary-button is-compact"
                disabled={!selected.length}
                aria-disabled={busy || undefined}
                onClick={() => mark(selected.map(({ application }) => application.id))}
              >
                <Ghost size={13} aria-hidden="true" />
                {marking ? "Marking…" : selected.length ? `Mark ${selected.length} as Ghosted` : "Mark as Ghosted"}
              </button>
            </div>
          </header>
          {trackerError ? <p className="pipeline-alert" role="alert">{trackerError}</p> : null}
          <div className="an-attention__cols">
            <input
              ref={selectAll}
              type="checkbox"
              checked={allSelected}
              aria-label="Select all shown"
              onChange={() => setDeselected(allSelected ? new Set(shown.map(({ application }) => application.id)) : new Set())}
            />
            <span aria-hidden="true">Company</span>
            <span aria-hidden="true" className="an-attention__col-role">Role</span>
            <span aria-hidden="true" className="an-attention__col-applied">Applied</span>
            <span aria-hidden="true">Days</span>
            <span aria-hidden="true" className="an-attention__col-status">Status (inferred)</span>
            <span aria-hidden="true" className="an-attention__col-next">Next step</span>
            <span aria-hidden="true" />
          </div>
          <ul
            className="an-attention__list"
            aria-label="Quiet applications"
            onMouseLeave={() => onTrace(null)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) onTrace(null);
            }}
          >
            {shown.map(({ application, silentDays, lastActivityAt }, index) => {
              const company = displayCompany(application);
              const initials = companyInitials(company);
              const last = parseDate(lastActivityAt);
              const sent = parseDate(application.appliedAt);
              const earlier = Boolean(periodStart && sent && sent < periodStart);
              const checked = !deselected.has(application.id);
              return (
                <li
                  key={application.id}
                  className={checked ? "is-selected" : undefined}
                  onMouseEnter={() => onTrace(application.id)}
                  onFocus={() => onTrace(application.id)}
                >
                  <input
                    ref={index === FIRST_ROWS ? firstRevealed : undefined}
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(application.id)}
                    aria-label={`Select ${company}, ${displayRole(application)}`}
                  />
                  <button type="button" className="an-attention__open" onClick={() => onOpenApplication(application.id)}>
                    <span className="an-attention__company">
                      <span className="application-company-mark" data-len={initials.length} aria-hidden="true">{initials}</span>
                      <span className="an-attention__name">
                        <strong>{company}</strong>
                        <small>{displayRole(application)}</small>
                      </span>
                    </span>
                    <span className="an-attention__role">{displayRole(application)}</span>
                    <span
                      className="an-attention__date"
                      title={earlier && periodStart ? `Before ${formatDay(periodStart)}, outside the chart's period` : undefined}
                    >
                      {sent ? formatDay(sent) : "—"}
                    </span>
                    <span className="an-attention__days" title={last ? `Last activity ${formatDay(last)}` : undefined}>
                      {silentDays}<span className="sr-only"> days quiet</span>
                    </span>
                    <span className="an-attention__status"><span className="an-pill">No response</span></span>
                    <span className="an-attention__next">{nextStep(application)}</span>
                  </button>
                  <button
                    type="button"
                    className="an-icon-button an-attention__menu"
                    aria-label={`Actions for ${company}`}
                    aria-haspopup="menu"
                    aria-expanded={menu?.id === application.id}
                    // The open menu closes on any outside press; this one toggles it.
                    onMouseDown={(event) => {
                      if (menu?.id === application.id) event.stopPropagation();
                    }}
                    onClick={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      setMenu((current) => (current?.id === application.id ? null : { id: application.id, x: rect.right - 180, y: rect.bottom + 4 }));
                    }}
                  >
                    <MoreHorizontal size={16} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
          {menu && menuRowShown ? (
            <TrackerRowMenu
              x={menu.x}
              y={menu.y}
              onClose={closeMenu}
              items={[
                { kind: "action", label: "Open details", icon: PanelRightOpen, onSelect: () => onOpenApplication(menu.id) },
                { kind: "action", label: "Mark as Ghosted", icon: Ghost, disabled: busy, onSelect: () => void mark([menu.id]) }
              ]}
            />
          ) : null}
          <p className="sr-only" role="status">{announcement}</p>
        </section>
      ) : (
        <p className="sr-only" role="status">{announcement}</p>
      )}
    </>
  );
}
