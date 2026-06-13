import { useMemo, useState } from "react";
import { AlertCircle, Plus, Search } from "lucide-react";
import type { Application, ApplicationStatus } from "../../hooks/useApplications";
import {
  BOARD_STATUSES,
  STATUS_LABEL,
  buildDocket,
  displayCompany,
  displayRole,
  statusCount
} from "../../lib/applicationDisplay";
import { TrackerTableView } from "../tracker/TrackerTableView";
import { TrackerBoardView } from "../tracker/TrackerBoardView";
import { TrackerCalendarView } from "../tracker/TrackerCalendarView";
import { TrackerInspector } from "../tracker/TrackerInspector";

export type TrackerView = "table" | "board" | "calendar";

type TrackerTabProps = {
  applications: Application[];
  applicationsPath: string;
  applicationsError: string;
  isApplicationsLoading: boolean;
  pipelineFilter: "all" | ApplicationStatus;
  setPipelineFilter: (v: "all" | ApplicationStatus) => void;
  expandedApplicationId: string | null;
  setExpandedApplicationId: (id: string | null) => void;
  trackerView: TrackerView;
  setTrackerView: (v: TrackerView) => void;
  onUpdateStatus: (id: string, status: ApplicationStatus) => void;
  onUpdateField: (
    id: string,
    field: "title" | "company" | "role" | "source" | "notes" | "followupAt" | "jobUrl",
    value: string
  ) => void;
  onUpdateNotes: (id: string, notes: string) => void;
  onLoad: (app: Application) => void;
  onOpenApplication: (app: Application) => void;
  onDelete: (id: string, title: string) => void;
  onAddApplication: () => void;
};

const VIEWS: TrackerView[] = ["table", "board", "calendar"];
const VIEW_LABELS: Record<TrackerView, string> = {
  table: "Table",
  board: "Board",
  calendar: "Calendar"
};

export function TrackerTab({
  applications,
  applicationsPath,
  applicationsError,
  isApplicationsLoading,
  pipelineFilter,
  setPipelineFilter,
  expandedApplicationId,
  setExpandedApplicationId,
  trackerView,
  setTrackerView,
  onUpdateStatus,
  onUpdateField,
  onUpdateNotes,
  onLoad,
  onOpenApplication,
  onDelete,
  onAddApplication
}: TrackerTabProps) {
  const [query, setQuery] = useState("");

  // Filtered list used by Table and Board (Calendar does its own event filtering internally)
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return applications
      .filter((app) => pipelineFilter === "all" || app.status === pipelineFilter)
      .filter((app) => {
        if (!needle) return true;
        return [
          displayCompany(app),
          displayRole(app),
          app.title,
          app.roleDescription,
          app.notes,
          app.jobDescription
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle));
      })
      .slice()
      .sort((a, b) => (b.appliedAt || b.createdAt).localeCompare(a.appliedAt || a.createdAt));
  }, [applications, pipelineFilter, query]);

  const selected =
    applications.find((app) => app.id === expandedApplicationId) ?? filtered[0] ?? null;

  const docket = useMemo(() => buildDocket(applications, new Date()), [applications]);

  return (
    <section className="workspace-page applications-page">
      {/* Page header */}
      <header className="workspace-page__head">
        <div className="workspace-page__title-row">
          <h2 className="page-serif">Applications</h2>
          {applicationsPath ? (
            <span className="workspace-page__path">
              {applicationsPath.replace(/^.*?job-search-workspace\//, "job-search-workspace/")}
            </span>
          ) : null}
        </div>
        <button type="button" className="primary-button is-compact" onClick={onAddApplication}>
          <Plus size={14} aria-hidden="true" />
          Add application
        </button>
      </header>

      {/* Loading + error feedback */}
      {isApplicationsLoading ? (
        <p className="pipeline-note">Loading saved applications...</p>
      ) : null}
      {applicationsError ? (
        <div className="pipeline-alert" role="status">
          <AlertCircle size={14} aria-hidden="true" />
          <span>Application changes may not be saved: {applicationsError}</span>
        </div>
      ) : null}

      {/* Up next — docket of actionable items. Omit entirely when no applications exist. */}
      {applications.length > 0 ? (
        <div className="tracker-docket" aria-label="Up next">
          <span className="tracker-docket__eyebrow">Up next</span>
          {docket.length > 0 ? (
            docket.map((item) => (
              <button
                key={item.app.id}
                type="button"
                className={`tracker-docket__row tracker-docket__row--${item.kind}`}
                onClick={() => setExpandedApplicationId(item.app.id)}
                aria-label={`${displayCompany(item.app)}, ${displayRole(item.app)}: ${item.label}`}
              >
                <span className="tracker-docket__date">{item.dateTag}</span>
                <span
                  className={`tracker-docket__dot tracker-docket__dot--${item.kind}`}
                  aria-hidden="true"
                />
                <span className="tracker-docket__identity">
                  <strong>{displayCompany(item.app)}</strong>
                  {" "}
                  <span className="tracker-docket__role">{displayRole(item.app)}</span>
                </span>
                <span className="tracker-docket__leader" aria-hidden="true" />
                <span className="tracker-docket__label">{item.label}</span>
              </button>
            ))
          ) : (
            <span className="tracker-docket__empty">Nothing due.</span>
          )}
        </div>
      ) : null}

      {/* Shared toolbar: search + stage filter + view switcher */}
      <div className="workspace-toolbar">
        <label className="workspace-search">
          <Search size={15} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search applications, companies, roles..."
            aria-label="Search applications"
          />
        </label>
        <div className="pipeline-filters" role="group" aria-label="Filter by stage">
          <button
            type="button"
            className={`pipeline-filter ${pipelineFilter === "all" ? "is-active" : ""}`}
            aria-pressed={pipelineFilter === "all"}
            onClick={() => setPipelineFilter("all")}
          >
            All <em>{applications.length}</em>
          </button>
          {BOARD_STATUSES.map((status) => (
            <button
              type="button"
              key={status}
              className={`pipeline-filter pipeline-filter--${status} ${pipelineFilter === status ? "is-active" : ""}`}
              aria-pressed={pipelineFilter === status}
              onClick={() => setPipelineFilter(status)}
            >
              {STATUS_LABEL[status]} <em>{statusCount(applications, status)}</em>
            </button>
          ))}
        </div>
        {/* View switcher: quiet segmented group, not accent-filled */}
        <div className="view-toggle" role="group" aria-label="Switch view">
          {VIEWS.map((view) => (
            <button
              type="button"
              key={view}
              className={`view-toggle__btn ${trackerView === view ? "is-active" : ""}`}
              aria-pressed={trackerView === view}
              onClick={() => setTrackerView(view)}
            >
              {VIEW_LABELS[view]}
            </button>
          ))}
        </div>
      </div>

      {/* Calendar view: full-width with its own nav and side rail */}
      {trackerView === "calendar" ? (
        <TrackerCalendarView
          applications={applications}
          query={query}
          stageFilter={pipelineFilter}
          selectedApplicationId={expandedApplicationId}
          setSelectedApplicationId={setExpandedApplicationId}
          onOpenApplication={onOpenApplication}
          onLoad={onLoad}
        />
      ) : null}

      {/* Table and Board views: shared two-column layout with the inspector */}
      {trackerView !== "calendar" ? (
        <div className="tracker-layout">
          {trackerView === "table" ? (
            <TrackerTableView
              visible={filtered}
              allCount={applications.length}
              selectedId={selected?.id ?? null}
              onSelect={setExpandedApplicationId}
              onDoubleClick={onOpenApplication}
            />
          ) : (
            <TrackerBoardView
              filtered={filtered}
              allApplications={applications}
              selectedId={selected?.id ?? null}
              onSelect={setExpandedApplicationId}
              onDoubleClick={onOpenApplication}
              onUpdateStatus={onUpdateStatus}
            />
          )}

          <aside className="pipeline-inspector" aria-label="Selected application">
            <TrackerInspector
              selected={selected}
              onUpdateStatus={onUpdateStatus}
              onUpdateField={onUpdateField}
              onUpdateNotes={onUpdateNotes}
              onOpenApplication={onOpenApplication}
              onLoad={onLoad}
              onDelete={onDelete}
            />
          </aside>
        </div>
      ) : null}
    </section>
  );
}
