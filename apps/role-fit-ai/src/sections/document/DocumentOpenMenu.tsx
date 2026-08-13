import { type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import { DocumentActionMenu } from "@typeset/editor/components/toolbar/DocumentActionMenu.tsx";

/** A way to start a document: the bundled starter, a blank one, a file picker. */
export type DocumentOpenAction = {
  key: string;
  icon: ReactNode;
  title: string;
  /** Only when the title is not self-explanatory — most rows need none. */
  description?: string;
  disabled?: boolean;
  /**
   * The menu closes once this resolves, so an async confirm runs first. Resolve
   * `false` to keep the menu open — a cancelled "replace this document?" should
   * leave the user where they were rather than dismissing their choice.
   */
  onSelect: () => void | boolean | Promise<void | boolean>;
};

/** One saved document already in the workspace. */
export type DocumentOpenSavedEntry = {
  key: string;
  title: string;
  meta?: string;
  /** The document currently loaded in the editor. */
  active?: boolean;
  openLabel?: string;
  onOpen: () => void;
};

export type DocumentOpenSavedGroup = {
  key: string;
  label: string;
  icon?: ReactNode;
  entries: DocumentOpenSavedEntry[];
  /** History-style groups collapse; a short list of bases does not. */
  collapsible?: boolean;
  defaultOpen?: boolean;
};

export type DocumentOpenMenuProps = {
  label?: string;
  tooltip: string;
  icon: ReactNode;
  disabled?: boolean;
  /** Panel heading and one line of orientation. */
  title: string;
  description: string;
  actions: DocumentOpenAction[];
  saved?: {
    label: string;
    groups: DocumentOpenSavedGroup[];
    /** Shown in place of the list when there is nothing saved yet. */
    emptyNote?: string;
  };
  /** Host-owned notices (upload errors, workspace status) below everything. */
  footer?: ReactNode;
};

// The one Open menu for both documents. It grew out of the cover letter's menu —
// a heading plus `document-action-row` choices — and gained the saved-documents
// list the resume needs, so the two pages no longer have unrelated Open menus
// that happen to sit in matching action bars.
//
// Starting a document and reopening a saved one are the same job from the user's
// side, so both live here rather than in a separate browse menu.
export function DocumentOpenMenu({
  label = "Open",
  tooltip,
  icon,
  disabled = false,
  title,
  description,
  actions,
  saved,
  footer
}: DocumentOpenMenuProps) {
  const savedGroups = saved?.groups.filter((group) => group.entries.length > 0) ?? [];

  return (
    <DocumentActionMenu label={label} tooltip={tooltip} icon={icon} disabled={disabled}>
      {({ close }) => (
        <div className="document-action-panel document-open-menu">
          <div className="document-action-panel__head">
            <strong>{title}</strong>
            <span>{description}</span>
          </div>

          {actions.map((action) => (
            <button
              key={action.key}
              type="button"
              className="document-action-row"
              disabled={action.disabled}
              onClick={() => {
                void Promise.resolve(action.onSelect()).then((result) => {
                  if (result !== false) close();
                });
              }}
            >
              {action.icon}
              <span>
                <strong>{action.title}</strong>
                {action.description ? <small>{action.description}</small> : null}
              </span>
            </button>
          ))}

          {saved ? (
            <div className="document-open-saved">
              <div className="document-open-saved__head">{saved.label}</div>
              {savedGroups.length === 0 ? (
                <p className="document-open-saved__empty">{saved.emptyNote}</p>
              ) : (
                savedGroups.map((group) =>
                  group.collapsible ? (
                    <details key={group.key} className="document-open-group" open={group.defaultOpen}>
                      <summary>
                        <ChevronRight size={12} aria-hidden="true" />
                        <span>{group.label}</span>
                        <em>{group.entries.length}</em>
                      </summary>
                      <SavedList entries={group.entries} onOpened={close} />
                    </details>
                  ) : (
                    <div key={group.key} className="document-open-group">
                      <p className="document-open-group__label">
                        {group.icon}
                        {group.label}
                      </p>
                      <SavedList entries={group.entries} onOpened={close} />
                    </div>
                  )
                )
              )}
            </div>
          ) : null}

          {footer}
        </div>
      )}
    </DocumentActionMenu>
  );
}

function SavedList({
  entries,
  onOpened
}: {
  entries: DocumentOpenSavedEntry[];
  onOpened: () => void;
}) {
  return (
    <ul className="document-open-list">
      {entries.map((entry) => (
        <li key={entry.key} className={entry.active ? "is-active" : undefined}>
          <span className="document-open-list__name">
            {entry.title}
            {entry.meta ? <small>{entry.meta}</small> : null}
          </span>
          {/* The active document is already open; the row still names it so the
              list reads as a complete inventory rather than hiding one item. */}
          {entry.active ? (
            <span className="document-open-list__current">Open now</span>
          ) : (
            <button
              className="ghost-button is-compact"
              type="button"
              // Every row's button reads "Open" (or "Restore"), so the visible
              // label alone gives a screen reader a list of identical controls.
              // Name each one with the document it acts on.
              aria-label={`${entry.openLabel ?? "Open"} ${entry.title}${entry.meta ? ` (${entry.meta})` : ""}`}
              onClick={() => {
                entry.onOpen();
                onOpened();
              }}
            >
              {entry.openLabel ?? "Open"}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
