import { GripVertical } from "lucide-react";
import { useState } from "react";
import type { Application, ApplicationStatus } from "../../hooks/useApplications";
import {
  BOARD_STATUSES,
  STATUS_LABEL,
  companyInitials,
  displayCompany,
  displayRole,
  fitScore,
  fitTone,
  formatCompactDate,
  nextAction
} from "../../lib/applicationDisplay";

type TrackerBoardViewProps = {
  filtered: Application[];
  allApplications: Application[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDoubleClick: (app: Application) => void;
  onUpdateStatus: (id: string, status: ApplicationStatus) => void;
};

export function TrackerBoardView({
  filtered,
  allApplications,
  selectedId,
  onSelect,
  onDoubleClick,
  onUpdateStatus
}: TrackerBoardViewProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);

  function dropOn(status: ApplicationStatus) {
    if (!draggingId) return;
    const dragged = allApplications.find((app) => app.id === draggingId);
    if (dragged && dragged.status !== status) onUpdateStatus(draggingId, status);
    setDraggingId(null);
  }

  return (
    <div className="pipeline-board" aria-label="Application stages">
      {BOARD_STATUSES.map((status) => {
        const cards = filtered
          .filter((app) => app.status === status)
          .sort((a, b) => (b.followupAt || b.updatedAt).localeCompare(a.followupAt || a.updatedAt));
        return (
          <section
            className={`pipeline-column pipeline-column--${status}`}
            key={status}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => dropOn(status)}
          >
            <header>
              <span className="table-eyebrow">{STATUS_LABEL[status]}</span>
              <em>{cards.length}</em>
            </header>
            <div className="pipeline-column__cards">
              {cards.length ? (
                cards.map((app) => {
                  const score = fitScore(app);
                  return (
                    <button
                      type="button"
                      className={`pipeline-cardlet ${selectedId === app.id ? "is-selected" : ""}`}
                      draggable
                      key={app.id}
                      title="Double-click to open full details"
                      onClick={() => onSelect(app.id)}
                      onDoubleClick={() => onDoubleClick(app)}
                      onDragStart={() => setDraggingId(app.id)}
                      onDragEnd={() => setDraggingId(null)}
                    >
                      <span className="pipeline-cardlet__drag">
                        <GripVertical size={13} aria-hidden="true" />
                      </span>
                      <span className="application-company">
                        <em data-len={companyInitials(displayCompany(app)).length}>{companyInitials(displayCompany(app))}</em>
                        <strong>{displayCompany(app)}</strong>
                      </span>
                      <span className="pipeline-cardlet__role">{displayRole(app)}</span>
                      <span className="pipeline-cardlet__meta">
                        <small>{nextAction(app)}</small>
                        <small>
                          {app.followupAt
                            ? formatCompactDate(app.followupAt)
                            : formatCompactDate(app.updatedAt)}
                        </small>
                      </span>
                      <span className="pipeline-cardlet__foot">
                        <span>{app.source || "Local"}</span>
                        <strong className={`application-fit application-fit--${fitTone(score)}`}>
                          {score === null ? "--" : `${score}%`}
                        </strong>
                      </span>
                    </button>
                  );
                })
              ) : (
                <div className="pipeline-column__empty">
                  <span>No roles</span>
                </div>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
