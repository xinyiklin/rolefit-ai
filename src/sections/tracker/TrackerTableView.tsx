import { BriefcaseBusiness, ChevronRight } from "lucide-react";
import type { Application } from "../../hooks/useApplications";
import {
  STATUS_LABEL,
  companyInitials,
  displayCompany,
  displayRole,
  appFitVerdict,
  formatCompactDate,
  nextAction,
  priorityFor
} from "../../lib/applicationDisplay";

type TrackerTableViewProps = {
  visible: Application[];
  allCount: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDoubleClick: (app: Application) => void;
};

// Returns "June 2026" for an ISO datetime/date string using local time.
function monthLabel(iso: string): string {
  if (!iso) return "";
  try {
    const [y, m] = iso.slice(0, 10).split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString([], { month: "long", year: "numeric" });
  } catch {
    return iso.slice(0, 7);
  }
}

// Group rows by month label, newest first (caller already sorted newest-first).
function groupByMonth(apps: Application[]): Array<{ month: string; rows: Application[] }> {
  const groups: Array<{ month: string; rows: Application[] }> = [];
  for (const app of apps) {
    const label = monthLabel(app.appliedAt || app.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.month === label) {
      last.rows.push(app);
    } else {
      groups.push({ month: label, rows: [app] });
    }
  }
  return groups;
}

export function TrackerTableView({
  visible,
  allCount,
  selectedId,
  onSelect,
  onDoubleClick
}: TrackerTableViewProps) {
  const groups = groupByMonth(visible);

  return (
    <div className="applications-table" role="table" aria-label="Applications">
      <div className="applications-table__row applications-table__row--head" role="row">
        <span role="columnheader" className="table-eyebrow">Company</span>
        <span role="columnheader" className="table-eyebrow">Role</span>
        <span role="columnheader" className="table-eyebrow">Stage</span>
        <span role="columnheader" className="table-eyebrow">Applied</span>
        <span role="columnheader" className="table-eyebrow">Priority</span>
        <span role="columnheader" className="table-eyebrow">Next action</span>
        <span role="columnheader" className="table-eyebrow">Fit</span>
        <span aria-hidden="true" />
      </div>

      {visible.length ? (
        groups.map(({ month, rows }) => (
          <div key={month} role="rowgroup">
            {/* Month divider — aria-hidden keeps the role=table semantics clean */}
            <div className="applications-table__month-divider" role="presentation" aria-hidden="true">
              <span className="table-eyebrow">{month}</span>
              <span className="applications-table__month-count">{rows.length}</span>
            </div>
            {rows.map((app) => {
              const verdict = appFitVerdict(app);
              const isSelected = selectedId === app.id;
              return (
                <button
                  type="button"
                  role="row"
                  className={`applications-table__row ${isSelected ? "is-selected" : ""}`}
                  key={app.id}
                  title="Double-click to open full details"
                  onClick={() => onSelect(app.id)}
                  onDoubleClick={() => onDoubleClick(app)}
                >
                  <span className="application-company" role="cell">
                    <em data-len={companyInitials(displayCompany(app)).length}>{companyInitials(displayCompany(app))}</em>
                    <strong>{displayCompany(app)}</strong>
                  </span>
                  <span role="cell" className={displayRole(app) === "Role not set" ? "text-placeholder" : ""}>
                    {displayRole(app)}
                  </span>
                  <span role="cell">
                    <span className={`stage-dot stage-dot--${app.status}`} aria-hidden="true" />
                    <span className="stage-dot-label">{STATUS_LABEL[app.status]}</span>
                  </span>
                  <span role="cell" className="table-date">
                    {app.appliedAt ? formatCompactDate(app.appliedAt) : "-"}
                  </span>
                  <span role="cell">
                    {priorityFor(app) === "Medium" ? (
                      <span className="priority-default">{priorityFor(app)}</span>
                    ) : (
                      <>
                        <span className={`priority-dot priority-dot--${priorityFor(app).toLowerCase()}`} aria-hidden="true" />
                        <span className={`priority-label priority-label--${priorityFor(app).toLowerCase()}`}>
                          {priorityFor(app)}
                        </span>
                      </>
                    )}
                  </span>
                  <span role="cell" className={nextAction(app) === "Awaiting response" ? "next-action-default" : ""}>
                    {nextAction(app)}
                  </span>
                  <span role="cell">
                    <span className={`application-fit application-fit--${verdict?.tone ?? "neutral"}`}>
                      {verdict ? verdict.label : "--"}
                    </span>
                  </span>
                  <ChevronRight size={14} aria-hidden="true" />
                </button>
              );
            })}
          </div>
        ))
      ) : (
        <div className="applications-empty" role="row">
          <BriefcaseBusiness size={24} aria-hidden="true" />
          <strong>{allCount ? "No matching applications" : "No applications yet"}</strong>
          <span>
            {allCount
              ? "Clear search or filters to widen the list."
              : "Add a role or apply after polishing a resume."}
          </span>
        </div>
      )}
    </div>
  );
}
