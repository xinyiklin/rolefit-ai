import type { PresenceEntry, PresencePhase } from "../lib/tabPresence";

// Human label for each phase, shown per-session in the rail.
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

// Persistent session-awareness panel pinned to the bottom of the studio rail.
// Each browser tab is an INDEPENDENT tailoring session (own job, draft, review);
// this lists THIS tab plus any concurrent tabs so the user can see, at a glance,
// what every open session is working on. Read-only ambient awareness — browsers
// can't reliably focus another tab, so it informs rather than controls.
//
// PRIVACY: only the short role · company label and a coarse phase are shown — the
// same contract the presence registry enforces (never the JD body or resume text).
export function SessionsRail({
  self,
  others
}: {
  self: { jobLabel: string; phase: PresencePhase };
  others: PresenceEntry[];
}) {
  const rows: SessionRow[] = [
    { key: "self", label: self.jobLabel || "This tab", phase: self.phase, isSelf: true },
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
    // role="group" (not "status"/aria-live): ambient awareness, not an alert, so
    // it must not be announced on every presence change.
    <section className="sessions-rail" role="group" aria-label="Tailoring sessions">
      <div className="sessions-rail__head">
        <span className="sessions-rail__eyebrow">Sessions</span>
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
  );
}
