import { useCallback, useRef } from "react";
import { BriefcaseBusiness, ChevronDown, ChevronRight, ChevronUp, Copy, Link2 } from "lucide-react";
import type { Application } from "../../hooks/useApplications";
import type { SortKey, SortState } from "../tabs/TrackerTab";
import {
  STATUS_LABEL,
  applicationActivityDate,
  companyInitials,
  displayCompany,
  displayRole,
  appFitVerdict,
  formatCompactDate,
  nextAction
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
  postingGroupSizes: Map<string, number>;
};

// Column definitions in render order. `key` marks a sortable column.
const COLUMNS: Array<{ label: string; key: SortKey }> = [
  { label: "Company", key: "company" },
  { label: "Role", key: "role" },
  { label: "Stage", key: "stage" },
  { label: "Date", key: "applied" },
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
    const label = monthLabel(applicationActivityDate(app));
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
  postingGroupSize,
  onSelect,
  onDoubleClick,
  onRowContextMenu
}: {
  app: Application;
  isSelected: boolean;
  isDuplicate: boolean;
  postingGroupSize: number;
  onSelect: (id: string) => void;
  onDoubleClick: (app: Application) => void;
  onRowContextMenu: (app: Application, event: { clientX: number; clientY: number }) => void;
}) {
  const verdict = appFitVerdict(app);
  const activityDate = applicationActivityDate(app);
  const activityLabel = activityDate ? formatCompactDate(activityDate) : "date not set";
  // The row carries an aria-label, so badges rendered inside it are invisible to
  // assistive tech unless their meaning is spelled out here.
  const rowLabel = [
    displayCompany(app),
    displayRole(app),
    `stage ${STATUS_LABEL[app.status]}`,
    `date ${activityLabel}`,
    nextAction(app),
    verdict ? `fit ${verdict.label}` : "fit not scored",
    postingGroupSize > 1 ? `${postingGroupSize} records linked to this posting` : "",
    isDuplicate ? "possible duplicate" : ""
  ].filter(Boolean).join(", ");
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
        {postingGroupSize > 1 ? (
          <span
            className="application-posting-group-badge"
            title={`${postingGroupSize} independent records are linked to this posting.`}
          >
            <Link2 size={11} aria-hidden="true" />
            {postingGroupSize}
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
        {activityDate ? formatCompactDate(activityDate) : "-"}
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
  duplicateIds,
  postingGroupSizes
}: TrackerTableViewProps) {
  const groups = grouped ? groupByMonth(visible) : [];
  const headRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // The header is outside the vertical scroller so the scrollbar starts below it
  // rather than running up alongside the column labels. That costs the free
  // horizontal scrolling the two shared while they were one box, so their
  // offsets are mirrored — written straight to the elements, no state, no
  // re-render per frame.
  //
  // Both directions, not just body -> head: tabbing to an off-screen sort button
  // makes the browser scroll the header's own `overflow: hidden` box to reveal
  // it, and without the return path that silently slides the labels out of
  // register with the rows. The inequality guard is what stops the pair from
  // echoing each other.
  const mirrorScroll = useCallback((from: "head" | "body") => () => {
    const head = headRef.current;
    const body = bodyRef.current;
    if (!head || !body) return;
    const [source, target] = from === "body" ? [body, head] : [head, body];
    if (target.scrollLeft !== source.scrollLeft) target.scrollLeft = source.scrollLeft;
  }, []);

  return (
    <div className="applications-table" role="region" aria-label="Applications">
      <div className="applications-table__head" ref={headRef} onScroll={mirrorScroll("head")}>
        <div className="applications-table__row applications-table__row--head">
          {COLUMNS.map((col) => {
            const isActive = sort.key === col.key;
            return (
              <button
                type="button"
                key={col.key}
                aria-label={`Sort by ${col.label}${isActive ? `, currently ${sort.dir === "asc" ? "ascending" : "descending"}` : ""}`}
                className={`table-eyebrow table-sort ${isActive ? "is-active" : ""}${
                  col.key === "nextAction" ? " applications-table__cell--next-action" : ""
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
      </div>

      <div
        className={`applications-table__body${grouped && visible.length ? " has-month-groups" : ""}`}
        ref={bodyRef}
        onScroll={mirrorScroll("body")}
      >
        {visible.length ? (
          grouped ? (
            groups.map(({ month, rows }) => (
              <div className="applications-table__month-group" key={month} role="group" aria-label={month}>
                <div className="applications-table__month-divider" aria-hidden="true">
                  <span className="table-eyebrow">{month}</span>
                </div>
                {rows.map((app) => (
                  <ApplicationRow
                    key={app.id}
                    app={app}
                    isSelected={selectedId === app.id}
                    isDuplicate={duplicateIds.has(app.id)}
                    postingGroupSize={postingGroupSizes.get(app.id) ?? 0}
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
                  postingGroupSize={postingGroupSizes.get(app.id) ?? 0}
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
    </div>
  );
}
