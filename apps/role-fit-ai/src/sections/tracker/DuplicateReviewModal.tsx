import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { Application, ApplicationStatus } from "../../hooks/useApplications";
import type { DuplicateGroup } from "../../lib/jobIdentity";
import { STATUS_LABEL, displayCompany, displayRole, formatCompactDate, hostLabel } from "../../lib/applicationDisplay";
import { useDialog } from "../../hooks/useDialog";
import { useModalFocus } from "@typeset/editor/hooks/useModalFocus.ts";

type DuplicateReviewModalProps = {
  groups: DuplicateGroup<Application>[];
  onClose: () => void;
  onMerge: (memberIds: string[], canonicalId: string) => void;
};

// "Most advanced" rank for defaulting the canonical pick — NOT the same as the
// kanban/pipeline order (BOARD_STATUSES): a rejected/withdrawn entry is always
// the least useful canonical, even though it's a terminal pipeline stage.
const STATUS_RANK: Record<ApplicationStatus, number> = {
  rejected: 0,
  withdrawn: 0,
  interested: 1,
  applied: 2,
  interviewing: 3,
  offer: 4
};

function mostAdvancedId(applications: Application[]): string {
  return applications.reduce((best, app) => {
    const bestRank = STATUS_RANK[best.status];
    const rank = STATUS_RANK[app.status];
    if (rank > bestRank) return app;
    if (rank < bestRank) return best;
    // Tie-break: earliest createdAt (the original entry). ISO timestamps sort
    // lexically, so a plain string comparison is enough.
    return app.createdAt < best.createdAt ? app : best;
  }, applications[0]).id;
}

function GroupCard({
  group,
  onMerge
}: {
  group: DuplicateGroup<Application>;
  onMerge: (memberIds: string[], canonicalId: string) => void;
}) {
  const { confirm } = useDialog();
  const memberIds = group.applications.map((a) => a.id);
  const defaultCanonical = mostAdvancedId(group.applications);

  async function handleMerge(canonicalId: string) {
    const canonical = group.applications.find((a) => a.id === canonicalId);
    if (!canonical) return;
    const label = `${displayCompany(canonical)} · ${displayRole(canonical)}`;
    const removedCount = group.applications.length - 1;
    const proceed = await confirm({
      title: "Merge duplicate applications?",
      message: `Merge ${label} entries: this removes ${removedCount} ${removedCount === 1 ? "entry" : "entries"} and keeps the selected one.`,
      confirmLabel: "Merge",
      tone: "danger"
    });
    if (!proceed) return;
    onMerge(memberIds, canonicalId);
  }

  // Uncontrolled radio group (name scoped to this group) — the default is set
  // via defaultChecked so re-renders after a merge in another card don't fight
  // the user's in-progress selection here.
  return (
    <div className="application-doc-card duplicate-group-card">
      <div className="application-doc-card__head">
        <h4>
          {displayCompany(group.applications[0])} · {group.applications.length} entries
        </h4>
        <span className={`application-fit application-fit--${group.confidence === "exact" ? "strong" : group.confidence === "high" ? "stretch" : "neutral"}`}>
          {group.confidence}
        </span>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          const picked = new FormData(event.currentTarget).get("canonical");
          if (typeof picked === "string" && picked) void handleMerge(picked);
        }}
      >
        <ul className="duplicate-group-card__members">
          {group.applications.map((app) => {
            const host = hostLabel(app.jobUrl ?? "");
            return (
              <li key={app.id} className="duplicate-group-card__member">
                <label className="duplicate-group-card__radio">
                  <input type="radio" name="canonical" value={app.id} defaultChecked={app.id === defaultCanonical} />
                  <span>Keep this one</span>
                </label>
                <span className="duplicate-group-card__member-info">
                  <span className="duplicate-group-card__member-title">
                    {displayCompany(app)} · {displayRole(app)}
                  </span>
                  <span className="duplicate-group-card__member-meta">
                    {STATUS_LABEL[app.status]}
                    {app.appliedAt ? ` · ${formatCompactDate(app.appliedAt)}` : ""}
                    {host ? (
                      <>
                        {" · "}
                        <a href={app.jobUrl} target="_blank" rel="noreferrer">
                          {host}
                        </a>
                      </>
                    ) : null}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>

        {group.edges.length ? (
          <div className="application-chip-list duplicate-group-card__evidence">
            {group.edges.map((edge, index) => (
              <span key={index}>{edge.evidence.join(" · ")}</span>
            ))}
          </div>
        ) : null}

        <button type="submit" className="secondary-button is-compact danger-button">
          Merge {group.applications.length} into 1
        </button>
      </form>
    </div>
  );
}

export function DuplicateReviewModal({ groups, onClose, onMerge }: DuplicateReviewModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const handleKeyDown = useModalFocus({
    active: groups.length > 0,
    containerRef: panelRef,
    initialFocusRef: closeBtnRef,
    onClose
  });

  // Auto-close once every group has been merged away.
  useEffect(() => {
    if (groups.length === 0) onClose();
  }, [groups.length, onClose]);

  if (groups.length === 0) return null;

  return (
    <div className="application-modal" role="dialog" aria-modal="true" aria-labelledby="duplicate-review-title" onKeyDown={handleKeyDown}>
      <div className="application-modal__scrim" aria-hidden="true" onMouseDown={onClose} />
      <section className="application-modal__panel duplicate-review-modal" ref={panelRef} tabIndex={-1}>
        <header className="application-modal__head">
          <div>
            <h2 id="duplicate-review-title" className="page-serif">
              Review duplicates
            </h2>
            <p>{groups.length} {groups.length === 1 ? "group" : "groups"} of likely duplicate applications.</p>
          </div>
          <div className="application-modal__actions">
            <button type="button" className="ghost-button is-icon" aria-label="Close" onClick={onClose} ref={closeBtnRef}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="duplicate-review-modal__body">
          {groups.map((group, index) => (
            <GroupCard key={group.applications.map((a) => a.id).join(",") || index} group={group} onMerge={onMerge} />
          ))}
        </div>
      </section>
    </div>
  );
}
