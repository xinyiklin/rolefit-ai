import type { ChangeEvent } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  FolderOpen,
  History,
  RotateCcw,
  Upload
} from "lucide-react";

type HistoryEntry = {
  key: string;
  originalName: string;
  kind: string;
  date: string;
};

// Recent versions arrive grouped by variant; each group is an expandable row.
type HistoryGroup = {
  variant: string;
  label: string;
  entries: HistoryEntry[];
};

type BaseResumeOption = {
  fileName: string;
  label: string;
  kind: string;
};

type ResumeMenuProps = {
  baseResumeName: string;
  baseResumeOptions: BaseResumeOption[];
  baseResumeHistory: HistoryGroup[];
  workspaceStatus: string;
  isSavingBaseResume: boolean;
  isWorkspaceBootstrapping: boolean;
  fileName: string;
  fileError: string;
  fileStatus: string;
  onLoadBaseResumeVersion: (fileName: string) => void;
  onRestoreBaseResume: (key: string) => void;
  onFileUpload: (event: ChangeEvent<HTMLInputElement>) => void;
};

function formatHistoryDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay}d ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

export function ResumeMenu({
  baseResumeName,
  baseResumeOptions,
  baseResumeHistory,
  workspaceStatus,
  isSavingBaseResume,
  isWorkspaceBootstrapping,
  fileName,
  fileError,
  fileStatus,
  onLoadBaseResumeVersion,
  onRestoreBaseResume,
  onFileUpload
}: ResumeMenuProps) {
  const activeBaseResume = baseResumeOptions.find((option) => option.fileName === baseResumeName);
  const baseResumeDisplayName = activeBaseResume?.label ?? baseResumeName;

  return (
    <div className="document-action-panel resume-open-menu">
      <div className="resume-source-head" aria-busy={isWorkspaceBootstrapping}>
        <FolderOpen size={14} aria-hidden="true" />
        <div className="resume-source-head__info">
          <strong>{isWorkspaceBootstrapping ? "Checking workspace" : "Open resume"}</strong>
          <small>{baseResumeDisplayName ? `Active base: ${baseResumeDisplayName}` : "No workspace base selected"}</small>
        </div>
      </div>

      {/* Base versions section */}
      {baseResumeOptions.length > 0 ? (
        <div className="resume-section">
          <div className="resume-section__head">
            <FolderOpen size={11} aria-hidden="true" />
            <span>Base versions</span>
          </div>
          <ul className="resume-list">
            {baseResumeOptions.map((option) => {
              const isActive = option.fileName === baseResumeName;
              return (
                <li key={option.fileName} className={`resume-list__item${isActive ? " is-active" : ""}`}>
                  <span className="resume-list__name">
                    {option.label}
                    <small>{option.fileName}</small>
                  </span>
                  <button
                    className="ghost-button is-compact"
                    type="button"
                    disabled={isSavingBaseResume}
                    onClick={() => onLoadBaseResumeVersion(option.fileName)}
                    title={`Load ${option.fileName}`}
                  >
                    Open
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {/* Recent versions — grouped by variant, each group expandable (up to 3 each) */}
      {baseResumeHistory.length > 0 ? (
        <div className="resume-section">
          <div className="resume-section__head">
            <History size={11} aria-hidden="true" />
            <span>Recent</span>
          </div>
          <div className="resume-history">
            {baseResumeHistory.map((group) => {
              const isActiveVariant = baseResumeName.replace(/\.[a-z]+$/i, "") === group.variant;
              return (
                <details
                  key={group.variant}
                  className="resume-history__group"
                  open={isActiveVariant || baseResumeHistory.length === 1}
                >
                  <summary className="resume-history__summary">
                    <ChevronRight size={12} aria-hidden="true" className="resume-history__chevron" />
                    <span className="resume-history__label">{group.label}</span>
                    <span className="resume-history__count">{group.entries.length}</span>
                  </summary>
                  <ul className="resume-list">
                    {group.entries.map((entry) => (
                      <li key={entry.key} className="resume-list__item">
                        <span className="resume-list__name">
                          {formatHistoryDate(entry.date)}
                          <small>{entry.kind.toUpperCase()}</small>
                        </span>
                        <button
                          className="ghost-button is-compact"
                          type="button"
                          disabled={isSavingBaseResume}
                          onClick={() => onRestoreBaseResume(entry.key)}
                          title={`Restore ${entry.originalName} from ${entry.date}`}
                        >
                          <RotateCcw size={11} aria-hidden="true" />
                          Restore
                        </button>
                      </li>
                    ))}
                  </ul>
                </details>
              );
            })}
          </div>
        </div>
      ) : null}

      <label className="upload-box">
        <Upload size={18} aria-hidden="true" />
        <span>{fileName || "Upload resume (.txt · .md · .csv · .resume)"}</span>
        <input accept=".txt,.md,.csv,.resume" type="file" onChange={onFileUpload} />
      </label>

      {fileError ? (
        <div className="notice notice--warn" role="status">
          <AlertCircle size={15} aria-hidden="true" />
          <span>{fileError}</span>
        </div>
      ) : null}
      {fileStatus ? (
        <div className="notice notice--info" role="status">
          <CheckCircle2 size={15} aria-hidden="true" />
          <span>{fileStatus}</span>
        </div>
      ) : null}
      {workspaceStatus ? <p className="micro-status">{workspaceStatus}</p> : null}
    </div>
  );
}
