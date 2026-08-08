import { BriefcaseBusiness, ChevronDown, ChevronRight, ChevronUp, Copy } from "lucide-react";
import type { Application } from "../../hooks/useApplications";
import type { SortKey, SortState } from "../tabs/TrackerTab";
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
  grouped: boolean;
  sort: SortState;
  onSort: (key: SortKey) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDoubleClick: (app: Application) => void;
  onRowContextMenu: (app: Application, event: { clientX: number; clientY: number }) => void;
  // Ids that appear in any duplicate group (see TrackerTab's duplicateGroups memo).
  duplicateIds: Set<string>;
};

// Column definitions in render order. `key` marks a sortable column.
const COLUMNS: Array<{ label: string; key: SortKey }> = [
  { label: "Company", key: "company" },
  { label: "Role", key: "role" },
  { label: "Stage", key: "stage" },
  { label: "Applied", key: "applied" },
  { label: "Priority", key: "priority" },
  { label: "Next action", key: "nextAction" },
  { label: "Fit", key: "fit" }
];

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

// Group rows by month label (caller already sorted chronologically).
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

function ApplicationRow({
  app,
  isSelected,
  isDuplicate,
  onSelect,
  onDoubleClick,
  onRowContextMenu
}: {
  app: Application;
  isSelected: boolean;
  isDuplicate: boolean;
  onSelect: (id: string) => void;
  onDoubleClick: (app: Application) => void;
  onRowContextMenu: (app: Application, event: { clientX: number; clientY: number }) => void;
}) {
  const verdict = appFitVerdict(app);
  const appliedLabel = app.appliedAt ? formatCompactDate(app.appliedAt) : "date not set";
  const rowLabel = [
    displayCompany(app),
    displayRole(app),
    `stage ${STATUS_LABEL[app.status]}`,
    `applied ${appliedLabel}`,
    `${priorityFor(app)} priority`,
    nextAction(app),
    verdict ? `fit ${verdict.label}` : "fit not scored"
  ].join(", ");
  return (
    <button
      type="button"
      className={`applications-table__row ${isSelected ? "is-selected" : ""}`}
      aria-label={rowLabel}
      aria-pressed={isSelected}
      title="Right-click for actions. Double-click to open."
      onClick={() => onSelect(app.id)}
      onDoubleClick={() => onDoubleClick(app)}
      onContextMenu={(event) => {
        event.preventDefault();
        onRowContextMenu(app, event);
      }}
    >
      <span className="application-company">
        <em data-len={companyInitials(displayCompany(app)).length}>{companyInitials(displayCompany(app))}</em>
        <strong>{displayCompany(app)}</strong>
        {isDuplicate ? (
          <span
            className="application-duplicate-badge"
            title="Possible duplicate. Review it in Review duplicates."
          >
            <Copy size={12} aria-hidden="true" />
          </span>
        ) : null}
      </span>
      <span className={displayRole(app) === "Role not set" ? "text-placeholder" : ""}>
        {displayRole(app)}
      </span>
      <span>
        <span className={`stage-dot stage-dot--${app.status}`} aria-hidden="true" />
        <span className="stage-dot-label">{STATUS_LABEL[app.status]}</span>
      </span>
      <span className="table-date">
        {app.appliedAt ? formatCompactDate(app.appliedAt) : "-"}
      </span>
      <span className="applications-table__cell--priority">
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
      <span
        className={`applications-table__cell--next-action${
          nextAction(app) === "Awaiting response" ? " next-action-default" : ""
        }`}
      >
        {nextAction(app)}
      </span>
      <span>
        <span className={`application-fit application-fit--${verdict?.tone ?? "neutral"}`}>
          {verdict ? verdict.label : "--"}
        </span>
      </span>
      <ChevronRight size={14} aria-hidden="true" />
    </button>
  );
}

export function TrackerTableView({
  visible,
  allCount,
  grouped,
  sort,
  onSort,
  selectedId,
  onSelect,
  onDoubleClick,
  onRowContextMenu,
  duplicateIds
}: TrackerTableViewProps) {
  const groups = grouped ? groupByMonth(visible) : [];

  return (
    <div className="applications-table" role="region" aria-label="Applications">
      <div className="applications-table__row applications-table__row--head">
        {COLUMNS.map((col) => {
          const isActive = sort.key === col.key;
          return (
            <button
              type="button"
              key={col.key}
              aria-label={`Sort by ${col.label}${isActive ? `, currently ${sort.dir === "asc" ? "ascending" : "descending"}` : ""}`}
              className={`table-eyebrow table-sort ${isActive ? "is-active" : ""}${
                col.key === "priority"
                  ? " applications-table__cell--priority"
                  : col.key === "nextAction"
                    ? " applications-table__cell--next-action"
                    : ""
              }`}
              onClick={() => onSort(col.key)}
            >
              {col.label}
              {isActive ? (
                sort.dir === "asc" ? (
                  <ChevronUp size={12} aria-hidden="true" />
                ) : (
                  <ChevronDown size={12} aria-hidden="true" />
                )
              ) : null}
            </button>
          );
        })}
        <span aria-hidden="true" />
      </div>

      {visible.length ? (
        grouped ? (
          groups.map(({ month, rows }) => (
            <div key={month} role="group" aria-label={month}>
              <div className="applications-table__month-divider" aria-hidden="true">
                <span className="table-eyebrow">{month}</span>
                <span className="applications-table__month-count">{rows.length}</span>
              </div>
              {rows.map((app) => (
                <ApplicationRow
                  key={app.id}
                  app={app}
                  isSelected={selectedId === app.id}
                  isDuplicate={duplicateIds.has(app.id)}
                  onSelect={onSelect}
                  onDoubleClick={onDoubleClick}
                  onRowContextMenu={onRowContextMenu}
                />
              ))}
            </div>
          ))
        ) : (
          <div>
            {visible.map((app) => (
              <ApplicationRow
                key={app.id}
                app={app}
                isSelected={selectedId === app.id}
                isDuplicate={duplicateIds.has(app.id)}
                onSelect={onSelect}
                onDoubleClick={onDoubleClick}
                onRowContextMenu={onRowContextMenu}
              />
            ))}
          </div>
        )
      ) : (
        <div className="applications-empty" role="status">
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
