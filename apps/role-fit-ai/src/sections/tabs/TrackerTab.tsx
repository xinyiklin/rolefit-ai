import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertCircle, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Eye, Link, Plus, RefreshCw, Search, Sparkles, SquareArrowOutUpRight, Table2, Trash2 } from "lucide-react";
import type { Application, ApplicationStatus } from "../../hooks/useApplications";
import type { DuplicateGroup } from "../../lib/jobIdentity";
import {
  ACTIVITY_STATUS_GROUPS,
  BOARD_STATUSES,
  STATUS_LABEL,
  activityGroupForFilter,
  activityCount,
  displayCompany,
  displayRole,
  fitScore,
  matchesActivityFilter,
  nextAction,
  priorityFor,
  type ApplicationActivityFilter,
  type ApplicationActivityGroup
} from "../../lib/applicationDisplay";
import { duplicateCandidateKey, groupDuplicateApplications } from "../../lib/jobIdentity";
import { TrackerTableView } from "../tracker/TrackerTableView";
import { TrackerCalendarView } from "../tracker/TrackerCalendarView";
import { TrackerInspector } from "../tracker/TrackerInspector";
import { TrackerRowMenu, type RowMenuItem } from "../tracker/TrackerRowMenu";
import { DuplicateReviewModal } from "../tracker/DuplicateReviewModal";

export type TrackerView = "table" | "calendar";

// Sortable table columns. "applied" is the default and the only sort that keeps
// month grouping (the rows are chronological); any other sort renders a flat list.
export type SortKey =
  | "company"
  | "role"
  | "stage"
  | "applied"
  | "priority"
  | "nextAction"
  | "fit";
export type SortDir = "asc" | "desc";
export type SortState = { key: SortKey; dir: SortDir };

// Page-size options. Minimum is 20 per the product spec — never smaller.
const PAGE_SIZES = [20, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_SORT: SortState = { key: "applied", dir: "desc" };

// Natural first-click direction per column: dates/fit lead with the most useful
// end (newest / highest), text and ordinal columns lead ascending.
const DEFAULT_DIR: Record<SortKey, SortDir> = {
  company: "asc",
  role: "asc",
  stage: "asc",
  applied: "desc",
  priority: "asc",
  nextAction: "asc",
  fit: "desc"
};

const STAGE_ORDER: Record<ApplicationStatus, number> = BOARD_STATUSES.reduce(
  (acc, status, index) => {
    acc[status] = index;
    return acc;
  },
  {} as Record<ApplicationStatus, number>
);

const PRIORITY_ORDER: Record<string, number> = { High: 0, Medium: 1, Low: 2 };

function appliedKey(app: Application): string {
  return app.appliedAt || app.createdAt || "";
}

// Ascending comparator for a single column; direction + tie-break are applied by
// the caller so this stays a pure "which is smaller" decision.
function compareBy(key: SortKey, a: Application, b: Application): number {
  switch (key) {
    case "company":
      return displayCompany(a).localeCompare(displayCompany(b));
    case "role":
      return displayRole(a).localeCompare(displayRole(b));
    case "stage":
      return STAGE_ORDER[a.status] - STAGE_ORDER[b.status];
    case "applied":
      return appliedKey(a).localeCompare(appliedKey(b));
    case "priority":
      return PRIORITY_ORDER[priorityFor(a)] - PRIORITY_ORDER[priorityFor(b)];
    case "nextAction":
      return nextAction(a).localeCompare(nextAction(b));
    case "fit": {
      // Unknown fit sorts to the bottom of a descending list (the useful default).
      const fa = fitScore(a) ?? -Infinity;
      const fb = fitScore(b) ?? -Infinity;
      return fa - fb;
    }
  }
}

type TrackerTabProps = {
  applications: Application[];
  applicationsPath: string;
  applicationsError: string;
  pendingApplicationWrites: number;
  isApplicationsLoading: boolean;
  statusFilter: ApplicationActivityFilter;
  setStatusFilter: (v: ApplicationActivityFilter) => void;
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
  onPreviewResume: (app: Application) => void;
  onDelete: (id: string, title: string) => void;
  onAddApplication: () => void;
  onRefresh: () => Promise<void>;
  // Merge action for duplicate clusters, threaded from useApplications via
  // App.tsx. The clusters themselves are computed HERE (this component only
  // mounts while the Applications tab is open), not in the hook — the O(n²)
  // scan must not run app-wide on every applications change.
  onMergeApplications: (memberIds: string[], canonicalId: string) => void;
  onDismissDuplicateGroup: (memberIds: string[]) => void;
};

const VIEW_LABELS: Record<TrackerView, string> = {
  table: "Table",
  calendar: "Calendar"
};

const ACTIVITY_GROUP_LABEL: Record<ApplicationActivityGroup, string> = {
  active: "Active",
  inactive: "Inactive"
};

type ActivityFilterMenuProps = {
  applications: Application[];
  group: ApplicationActivityGroup;
  isOpen: boolean;
  value: ApplicationActivityFilter;
  onToggle: () => void;
  onClose: () => void;
  onSelect: (filter: ApplicationActivityFilter) => void;
};

function ActivityFilterMenu({
  applications,
  group,
  isOpen,
  value,
  onToggle,
  onClose,
  onSelect
}: ActivityFilterMenuProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const label = ACTIVITY_GROUP_LABEL[group];
  const isSelectedGroup = activityGroupForFilter(value) === group;

  useEffect(() => {
    if (!isOpen) return;

    const focusFrame = window.requestAnimationFrame(() => {
      const selectedItem = menuRef.current?.querySelector<HTMLButtonElement>(
        '[role="menuitemradio"][aria-checked="true"]'
      );
      const firstItem = menuRef.current?.querySelector<HTMLButtonElement>(
        '[role="menuitemradio"]'
      );
      (selectedItem ?? firstItem)?.focus();
    });

    const handlePointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) onClose();
    };
    const handleFocusIn = (event: FocusEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) onClose();
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("keydown", handleEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, onClose]);

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')
    );
    if (!items.length) return;
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowUp"
            ? (currentIndex - 1 + items.length) % items.length
            : (currentIndex + 1) % items.length;
    items[nextIndex]?.focus();
  };

  const selectFilter = (filter: ApplicationActivityFilter) => {
    onSelect(filter);
    onClose();
    triggerRef.current?.focus();
  };

  return (
    <div className="pipeline-filter-menu-wrap" ref={wrapperRef}>
      {/* Split segment: the label filters to the whole group instantly, the
          caret is the only menu trigger for the per-status drill-down. This
          keeps the primary click predictable instead of a segment that looks
          like a filter but silently opens a popup. */}
      <div className={`pipeline-filter pipeline-filter--split ${isSelectedGroup ? "is-active" : ""}`}>
        <button
          type="button"
          className="pipeline-filter__main"
          aria-pressed={isSelectedGroup}
          onClick={() => {
            onSelect(group);
            onClose();
          }}
        >
          {label}
        </button>
        <button
          ref={triggerRef}
          type="button"
          className="pipeline-filter__disclosure"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          aria-controls={isOpen ? menuId : undefined}
          aria-label={`${label} status options`}
          onClick={onToggle}
        >
          <ChevronDown
            className={`pipeline-filter__chevron ${isOpen ? "is-open" : ""}`}
            size={13}
            aria-hidden="true"
          />
        </button>
      </div>
      {isOpen ? (
        <div
          ref={menuRef}
          id={menuId}
          className="activity-filter-menu"
          role="menu"
          aria-label={`${label} application categories`}
          onKeyDown={handleMenuKeyDown}
        >
          <button
            type="button"
            className="activity-filter-menu__item"
            role="menuitemradio"
            aria-checked={value === group}
            onClick={() => selectFilter(group)}
          >
            <span>All {group}</span>
            <span className="activity-filter-menu__count">
              {activityCount(applications, group)}
            </span>
            {value === group ? <Check size={13} aria-hidden="true" /> : null}
          </button>
          {ACTIVITY_STATUS_GROUPS[group].map((status) => (
            <button
              type="button"
              className="activity-filter-menu__item"
              role="menuitemradio"
              aria-checked={value === status}
              key={status}
              onClick={() => selectFilter(status)}
            >
              <span className={`stage-dot stage-dot--${status}`} aria-hidden="true" />
              <span>{STATUS_LABEL[status]}</span>
              <span className="activity-filter-menu__count">
                {activityCount(applications, status)}
              </span>
              {value === status ? <Check size={13} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function TrackerTab({
  applications,
  applicationsPath,
  applicationsError,
  pendingApplicationWrites,
  isApplicationsLoading,
  statusFilter,
  setStatusFilter,
  expandedApplicationId,
  setExpandedApplicationId,
  trackerView,
  setTrackerView,
  onUpdateStatus,
  onUpdateField,
  onUpdateNotes,
  onLoad,
  onOpenApplication,
  onPreviewResume,
  onDelete,
  onAddApplication,
  onRefresh,
  onMergeApplications,
  onDismissDuplicateGroup
}: TrackerTabProps) {
  const [query, setQuery] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Default sort: most recent application first (by apply time).
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(1);
  const [openActivityMenu, setOpenActivityMenu] =
    useState<ApplicationActivityGroup | null>(null);
  // Right-click context menu: the target app + cursor anchor (viewport coords).
  const [rowMenu, setRowMenu] = useState<{ app: Application; x: number; y: number } | null>(null);
  const [isDuplicateModalOpen, setIsDuplicateModalOpen] = useState(false);

  // Identity of only the dedup-RELEVANT fields (plus status/dates the merge
  // modal ranks and displays), so free-text edits — notes typed per keystroke
  // in the inspector — don't retrigger the O(n²) duplicate scan below.
  const duplicateScanKey = useMemo(
    () =>
      applications
        .map(
          (a) =>
            `${duplicateCandidateKey(a)}|${a.status}|${
              a.appliedAt ?? ""
            }|${a.createdAt}`
        )
        .join("\n"),
    [applications]
  );

  // Tracker-wide duplicate clusters. Computed here — not in useApplications —
  // so the O(n²) fingerprint pass runs only while this tab is mounted, and only
  // when a dedup-relevant field actually changed (see duplicateScanKey).
  const duplicateGroups: DuplicateGroup<Application>[] = useMemo(
    () => groupDuplicateApplications(applications),
    // duplicateScanKey stands in for `applications`: a key change implies a new
    // applications array, so the callback never closes over a stale list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [duplicateScanKey]
  );

  // Every application id that belongs to any duplicate cluster, for the table's
  // quiet inline badge.
  const duplicateIds = useMemo(
    () => new Set(duplicateGroups.flatMap((g) => g.applications.map((a) => a.id))),
    [duplicateGroups]
  );

  // Filtered + sorted list used by the Table view (Calendar filters internally).
  const sorted = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const dirMul = sort.dir === "asc" ? 1 : -1;
    return applications
      .filter((app) => matchesActivityFilter(app, statusFilter))
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
      .sort((a, b) => {
        const primary = compareBy(sort.key, a, b) * dirMul;
        if (primary !== 0) return primary;
        // Stable tie-break: newest application first, regardless of column.
        return appliedKey(b).localeCompare(appliedKey(a));
      });
  }, [applications, statusFilter, query, sort]);

  // Reset to the first page whenever the result set or its ordering changes, so
  // the user is never stranded on a now-empty trailing page.
  useEffect(() => {
    setPage(1);
  }, [query, statusFilter, sort, pageSize]);

  // Next action is intentionally omitted from the compact table. If the user
  // enters that layout while it is the active sort, return to the visible
  // chronological default so the row order never depends on a hidden control.
  useEffect(() => {
    const compactQuery = window.matchMedia("(max-width: 900px)");
    const resetHiddenSort = (isCompact: boolean) => {
      if (!isCompact) return;
      setSort((current) => (current.key === "nextAction" ? DEFAULT_SORT : current));
    };
    const handleCompactChange = (event: MediaQueryListEvent) => resetHiddenSort(event.matches);

    resetHiddenSort(compactQuery.matches);
    compactQuery.addEventListener("change", handleCompactChange);
    return () => compactQuery.removeEventListener("change", handleCompactChange);
  }, []);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * pageSize;
  const visible = sorted.slice(pageStart, pageStart + pageSize);

  // Month dividers only make sense on the chronological default sort.
  const grouped = sort.key === "applied";

  const visibleSelected = expandedApplicationId
    ? visible.find((app) => app.id === expandedApplicationId) ?? null
    : null;
  const selected = visibleSelected ?? visible[0] ?? sorted[0] ?? null;

  // The duplicate group (if any) containing the selected application, for the
  // inspector's "Possible duplicates" section.
  const selectedId = selected?.id;
  const selectedDuplicateGroup = useMemo(
    () => (selectedId ? duplicateGroups.find((g) => g.applications.some((a) => a.id === selectedId)) : undefined),
    [duplicateGroups, selectedId]
  );

  // If the previously-selected application was merged away (it no longer
  // appears in `applications` at all), clear the stale selection so the
  // inspector falls back to the next visible row instead of crashing on an
  // application that no longer exists.
  useEffect(() => {
    if (!expandedApplicationId) return;
    if (applications.some((app) => app.id === expandedApplicationId)) return;
    setExpandedApplicationId(null);
  }, [applications, expandedApplicationId, setExpandedApplicationId]);

  // Keep the inspector tied to the current table page; otherwise paging can
  // leave the rail editing a row that is no longer visible.
  useEffect(() => {
    if (trackerView !== "table" || !selected) return;
    if (expandedApplicationId !== selected.id) setExpandedApplicationId(selected.id);
  }, [expandedApplicationId, selected?.id, setExpandedApplicationId, trackerView]);

  function handleSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: DEFAULT_DIR[key] }
    );
  }

  function handleRowContextMenu(app: Application, event: { clientX: number; clientY: number }) {
    setExpandedApplicationId(app.id);
    setRowMenu({ app, x: event.clientX, y: event.clientY });
  }

  // Context-menu actions for the right-clicked row. Open + Delete are the core;
  // Polish, Preview (when a PDF was saved), and the job posting (when a URL
  // exists) round it out.
  const rowMenuItems: RowMenuItem[] = rowMenu
    ? (() => {
        const app = rowMenu.app;
        const items: RowMenuItem[] = [
          { kind: "action", label: "Open details", icon: SquareArrowOutUpRight, onSelect: () => onOpenApplication(app) },
          { kind: "action", label: "Open in Polish", icon: Sparkles, onSelect: () => onLoad(app) }
        ];
        if (app.resumeArtifacts?.hasPdf) {
          items.push({ kind: "action", label: "Preview resume", icon: Eye, onSelect: () => onPreviewResume(app) });
        }
        // Only offer the link for a real http(s) URL — never open a stored
        // javascript:/data:/protocol-less value.
        if (app.jobUrl && /^https?:\/\//i.test(app.jobUrl)) {
          const jobUrl = app.jobUrl;
          items.push({
            kind: "action",
            label: "Open job posting",
            icon: Link,
            onSelect: () => window.open(jobUrl, "_blank", "noopener,noreferrer")
          });
        }
        items.push({ kind: "separator" });
        items.push({ kind: "header", label: "Move to stage" });
        for (const status of BOARD_STATUSES) {
          items.push({
            kind: "action",
            label: STATUS_LABEL[status],
            dotClass: `stage-dot stage-dot--${status}`,
            active: app.status === status,
            onSelect: () => onUpdateStatus(app.id, status)
          });
        }
        items.push({ kind: "separator" });
        items.push({
          kind: "action",
          label: "Delete",
          icon: Trash2,
          danger: true,
          onSelect: () => onDelete(app.id, app.title)
        });
        return items;
      })()
    : [];

  const rangeStart = sorted.length === 0 ? 0 : pageStart + 1;
  const rangeEnd = Math.min(pageStart + pageSize, sorted.length);

  return (
    <section className="workspace-page applications-page">
      {/* Page header */}
      <header className="workspace-page__head">
        <div className="workspace-page__title-row">
          <h2 className="page-serif">Applications</h2>
          {applicationsPath ? (
            <span className="workspace-page__path">{applicationsPath}</span>
          ) : null}
          {pendingApplicationWrites > 0 ? (
            <span className="workspace-page__saving" role="status" aria-live="polite">
              Saving {pendingApplicationWrites > 1 ? `${pendingApplicationWrites} changes` : "change"}…
            </span>
          ) : null}
        </div>
        <div className="workspace-page__actions">
          <button
            type="button"
            className="ghost-button is-compact is-icon"
            onClick={async () => { setIsRefreshing(true); try { await onRefresh(); } finally { setIsRefreshing(false); } }}
            disabled={isRefreshing}
            title="Refresh applications"
            aria-label="Refresh applications"
          >
            <RefreshCw size={14} className={isRefreshing ? "spin" : ""} aria-hidden="true" />
          </button>
          {duplicateGroups.length > 0 ? (
            <button
              type="button"
              className="secondary-button is-compact"
              onClick={() => setIsDuplicateModalOpen(true)}
            >
              <Copy size={14} aria-hidden="true" />
              Review duplicates · {duplicateGroups.length}
            </button>
          ) : null}
          <button type="button" className="primary-button is-compact" onClick={onAddApplication}>
            <Plus size={14} aria-hidden="true" />
            Add application
          </button>
        </div>
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

      {/* Shared toolbar: search + lifecycle filters align to the view/rail grid. */}
      <div className="workspace-toolbar workspace-toolbar--tracker">
        <label className="workspace-search">
          <Search size={15} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search applications, companies, roles..."
            aria-label="Search applications"
          />
        </label>
        <div className="workspace-toolbar__controls">
          <div className="pipeline-filters" role="group" aria-label="Filter applications by status">
            <button
              type="button"
              className={`pipeline-filter ${statusFilter === "all" ? "is-active" : ""}`}
              aria-pressed={statusFilter === "all"}
              onClick={() => {
                setOpenActivityMenu(null);
                setStatusFilter("all");
              }}
            >
              All
            </button>
            {(["active", "inactive"] as const).map((group) => (
              <ActivityFilterMenu
                applications={applications}
                group={group}
                isOpen={openActivityMenu === group}
                key={group}
                value={statusFilter}
                onClose={() => setOpenActivityMenu(null)}
                onSelect={setStatusFilter}
                onToggle={() => {
                  setOpenActivityMenu((current) => (current === group ? null : group));
                }}
              />
            ))}
          </div>
          <button
            type="button"
            className="view-switch"
            role="switch"
            aria-checked={trackerView === "calendar"}
            aria-label="Calendar view"
            title={`Switch to ${VIEW_LABELS[trackerView === "table" ? "calendar" : "table"]} view`}
            onClick={() => setTrackerView(trackerView === "table" ? "calendar" : "table")}
          >
            <span className={trackerView === "table" ? "is-active" : ""}>
              <Table2 size={13} aria-hidden="true" />
              Table
            </span>
            <span className={trackerView === "calendar" ? "is-active" : ""}>
              <CalendarDays size={13} aria-hidden="true" />
              Calendar
            </span>
          </button>
        </div>
      </div>

      {/* Calendar view: full-width with its own nav and side rail */}
      {trackerView === "calendar" ? (
        <TrackerCalendarView
          applications={applications}
          query={query}
          statusFilter={statusFilter}
          setSelectedApplicationId={setExpandedApplicationId}
          onOpenApplication={onOpenApplication}
        />
      ) : null}

      {/* Table view: table + pagination on the left, inspector on the right */}
      {trackerView === "table" ? (
        <div className="tracker-layout">
          <div className="applications-table-wrap">
            <TrackerTableView
              visible={visible}
              allCount={applications.length}
              grouped={grouped}
              sort={sort}
              onSort={handleSort}
              selectedId={selected?.id ?? null}
              onSelect={setExpandedApplicationId}
              onDoubleClick={onOpenApplication}
              onRowContextMenu={handleRowContextMenu}
              duplicateIds={duplicateIds}
            />

            {sorted.length > 0 ? (
              <div className="applications-pagination" role="group" aria-label="Pagination">
                <span className="applications-pagination__count">
                  <strong>
                    {rangeStart}–{rangeEnd}
                  </strong>{" "}
                  of {sorted.length}
                </span>
                <div className="applications-pagination__controls">
                  <label className="applications-pagination__size">
                    <span>Rows</span>
                    <select
                      value={pageSize}
                      onChange={(event) => setPageSize(Number(event.target.value))}
                      aria-label="Applications per page"
                    >
                      {PAGE_SIZES.map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="applications-pagination__pager">
                    <button
                      type="button"
                      className="applications-pagination__step"
                      onClick={() => setPage(Math.max(1, safePage - 1))}
                      disabled={safePage <= 1}
                      aria-label="Previous page"
                    >
                      <ChevronLeft size={15} aria-hidden="true" />
                    </button>
                    <span className="applications-pagination__page" aria-live="polite">
                      {safePage} / {totalPages}
                    </span>
                    <button
                      type="button"
                      className="applications-pagination__step"
                      onClick={() => setPage(Math.min(totalPages, safePage + 1))}
                      disabled={safePage >= totalPages}
                      aria-label="Next page"
                    >
                      <ChevronRight size={15} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <aside className="pipeline-inspector" aria-label="Selected application">
            <TrackerInspector
              selected={selected}
              onUpdateStatus={onUpdateStatus}
              onUpdateField={onUpdateField}
              onUpdateNotes={onUpdateNotes}
              onOpenApplication={onOpenApplication}
              onPreviewResume={onPreviewResume}
              onLoad={onLoad}
              onDelete={onDelete}
              duplicateGroup={selectedDuplicateGroup}
              onReviewDuplicates={() => setIsDuplicateModalOpen(true)}
            />
          </aside>
        </div>
      ) : null}

      {rowMenu ? (
        <TrackerRowMenu
          x={rowMenu.x}
          y={rowMenu.y}
          items={rowMenuItems}
          onClose={() => setRowMenu(null)}
        />
      ) : null}

      {isDuplicateModalOpen ? (
        <DuplicateReviewModal
          groups={duplicateGroups}
          onClose={() => setIsDuplicateModalOpen(false)}
          onDismiss={onDismissDuplicateGroup}
          onMerge={(memberIds, canonicalId) => {
            onMergeApplications(memberIds, canonicalId);
            // Defensive: if the row currently pinned in the inspector was merged
            // away, clear the selection so it doesn't keep pointing at a deleted
            // id for one frame. App.tsx's own effect self-heals expandedApplicationId
            // too, but this avoids relying solely on that from a child component.
            if (expandedApplicationId && memberIds.includes(expandedApplicationId) && expandedApplicationId !== canonicalId) {
              setExpandedApplicationId(null);
            }
          }}
        />
      ) : null}
    </section>
  );
}
