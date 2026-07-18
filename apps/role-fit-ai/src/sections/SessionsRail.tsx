import { GalleryVerticalEnd } from "lucide-react";

import type { PresenceEntry, PresencePhase } from "../lib/tabPresence";
import { NavMenu } from "./NavMenu";

// Human label for each phase, shown per-session in the menu.
const PHASE_LABEL: Record<PresencePhase, string> = {
  idle: "idle",
  editing: "editing",
  distilling: "distilling job",
  tailoring: "tailoring",
  reviewing: "reviewing",
  "tailoring+reviewing": "tailoring + reviewing"
};

// Phases that represent live work — rendered with a spinner so the user can see
// at a glance which tabs are actually busy versus just open.
const ACTIVE_PHASES = new Set<PresencePhase>(["distilling", "tailoring", "reviewing", "tailoring+reviewing"]);

type SessionRow = { key: string; label: string; phase: PresencePhase; isSelf: boolean };

// Session-awareness menu in the app masthead. Each browser tab remains an
// independent job/draft/review workspace; this is read-only ambient awareness
// because browsers cannot reliably focus another tab.
// Each browser tab is an INDEPENDENT tailoring session (own job, draft, review);
// this lists THIS tab plus any concurrent tabs so the user can see, at a glance,
// what every open session is working on. Read-only ambient awareness — browsers
// can't reliably focus another tab, so it informs rather than controls.
//
// PRIVACY: only the short role · company label and a coarse phase are shown — the
// same contract the presence registry enforces (never the JD body or resume text).
export function SessionsMenu({
  self,
  others
}: {
  self: { jobLabel: string; phase: PresencePhase };
  others: PresenceEntry[];
}) {
  const rows: SessionRow[] = [
    { key: "self", label: self.jobLabel || "Untitled session", phase: self.phase, isSelf: true },
    ...others.map((s) => ({
      key: s.tabId,
      label: s.jobLabel || "Untitled session",
      phase: s.phase,
      isSelf: false
    }))
  ];

  const total = rows.length;
  const activeCount = rows.filter((r) => ACTIVE_PHASES.has(r.phase)).length;

  return (
    <NavMenu
      className="sessions-menu"
      icon={<GalleryVerticalEnd size={15} aria-hidden="true" />}
      label={(
        <>
          <span className="nav-menu__label">Sessions</span>
          <span className={`nav-menu__sub ${activeCount > 0 ? "is-ready" : ""}`}>
            {activeCount > 0 ? `${activeCount} working` : total}
          </span>
        </>
      )}
      ariaLabel="Tailoring sessions"
    >
      {/* role="group" (not status/aria-live): presence is ambient, not an alert. */}
      <section className="sessions-rail" role="group" aria-label="Open tailoring sessions">
        <div className="sessions-rail__head">
          <span className="sessions-rail__eyebrow">Open sessions</span>
          <span className="sessions-rail__count">
            {total}
            {activeCount > 0 ? ` · ${activeCount} working` : ""}
          </span>
        </div>
        <ul className="sessions-rail__list">
          {rows.map((row) => {
            const active = ACTIVE_PHASES.has(row.phase);
            return (
              <li key={row.key} className={`sessions-rail__item${row.isSelf ? " is-self" : ""}`}>
                <span className="sessions-rail__dot" aria-hidden="true">
                  {active ? <span className="polish-spinner" /> : <span className="sessions-rail__idle-dot" />}
                </span>
                <span className="sessions-rail__job" title={row.label}>
                  {row.label}
                  {row.isSelf ? <span className="sessions-rail__you"> · this tab</span> : null}
                </span>
                <span className="sessions-rail__phase">{PHASE_LABEL[row.phase]}</span>
              </li>
            );
          })}
        </ul>
      </section>
    </NavMenu>
  );
}
