import { useMemo, useState } from "react";
import { ChevronDown, Layers, X } from "lucide-react";
import type { PresenceEntry, PresencePhase } from "../lib/tabPresence";

// Human label for each phase, shown per-session in the expanded list.
const PHASE_LABEL: Record<PresencePhase, string> = {
  idle: "idle",
  editing: "editing",
  distilling: "distilling job",
  tailoring: "tailoring",
  reviewing: "reviewing",
  "tailoring+reviewing": "tailoring + reviewing"
};

// Phases that represent live work — rendered with a spinner so the user can see
// at a glance which other tabs are actually busy versus just open.
const ACTIVE_PHASES = new Set<PresencePhase>(["distilling", "tailoring", "reviewing", "tailoring+reviewing"]);

// Read-only awareness of OTHER browser tabs running their own independent
// tailoring sessions. Lives in the progress dock alongside this tab's own
// progress cards. Browsers can't reliably focus another tab, so this informs
// rather than controls.
export function ActiveSessionsCard({
  sessions,
  onDismiss
}: {
  sessions: PresenceEntry[];
  onDismiss: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const activeCount = useMemo(() => sessions.filter((s) => ACTIVE_PHASES.has(s.phase)).length, [sessions]);

  if (sessions.length === 0) return null;

  const headline =
    sessions.length === 1 ? "1 other session" : `${sessions.length} other sessions`;
  const sub = activeCount > 0 ? `${activeCount} working` : "idle";

  return (
    // role="group" (not "status"/aria-live): this is ambient awareness, not an
    // alert, so it must not be announced on every presence change.
    <div className="active-sessions" role="group" aria-label="Other active tailoring sessions">
      <button
        type="button"
        className="active-sessions__head"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls="active-sessions-list"
      >
        <span className="active-sessions__icon" aria-hidden="true">
          <Layers size={14} />
        </span>
        <span className="active-sessions__title">{headline}</span>
        <span className="active-sessions__sub">{sub}</span>
        <ChevronDown
          size={14}
          className={`active-sessions__chevron${expanded ? " is-open" : ""}`}
          aria-hidden="true"
        />
      </button>

      {expanded ? (
        <ul className="active-sessions__list" id="active-sessions-list">
          {sessions.map((s) => {
            const active = ACTIVE_PHASES.has(s.phase);
            return (
              <li key={s.tabId} className="active-sessions__item">
                <span className="active-sessions__dot" aria-hidden="true">
                  {active ? <span className="polish-spinner" /> : <span className="active-sessions__idle-dot" />}
                </span>
                <span className="active-sessions__job">{s.jobLabel || "Untitled session"}</span>
                <span className="active-sessions__phase">{PHASE_LABEL[s.phase]}</span>
              </li>
            );
          })}
        </ul>
      ) : null}

      <button
        type="button"
        className="active-sessions__dismiss"
        onClick={onDismiss}
        aria-label="Hide other sessions"
      >
        <X size={13} aria-hidden="true" />
      </button>
    </div>
  );
}
