import type { ChangeEvent } from "react";
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  FolderOpen,
  History,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
  Upload
} from "lucide-react";
import { NavMenu } from "./NavMenu";

type HistoryEntry = {
  key: string;
  originalName: string;
  kind: string;
  date: string;
};

type BaseResumeOption = {
  fileName: string;
  label: string;
  kind: string;
};

type ResumeMenuProps = {
  baseResumeName: string;
  baseResumeOptions: BaseResumeOption[];
  baseResumeHistory: HistoryEntry[];
  workspaceStatus: string;
  isSavingBaseResume: boolean;
  fileName: string;
  fileError: string;
  fileStatus: string;
  resumeText: string;
  resumeReady: boolean;
  onSaveCurrentAsBase: () => void;
  onLoadBaseResumeVersion: (fileName: string) => void;
  onRemoveBaseResume: () => void;
  onRestoreBaseResume: (key: string) => void;
  onLoadWorkspace: (apply: boolean) => Promise<void>;
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
  fileName,
  fileError,
  fileStatus,
  resumeText,
  resumeReady,
  onSaveCurrentAsBase,
  onLoadBaseResumeVersion,
  onRemoveBaseResume,
  onRestoreBaseResume,
  onLoadWorkspace,
  onFileUpload
}: ResumeMenuProps) {
  const activeBaseResume = baseResumeOptions.find((option) => option.fileName === baseResumeName);
  const baseResumeDisplayName = activeBaseResume?.label ?? baseResumeName;

  return (
    <NavMenu
      icon={<FileText size={13} aria-hidden={true} />}
      ariaLabel="Resume source"
      label={
        <>
          <span className="nav-menu__label">Resume</span>
          <span className={`nav-menu__sub ${resumeReady ? "is-ready" : "is-empty"}`}>
            {resumeReady ? "ready" : "empty"}
          </span>
        </>
      }
    >
      <div className="workspace-card">
        <div className="workspace-card__heading">
          <FolderOpen size={14} aria-hidden="true" />
          <span>
            <strong>{baseResumeDisplayName || "No base saved"}</strong>
            {baseResumeName ? <span>{baseResumeName}</span> : null}
          </span>
        </div>
        <div className="workspace-actions">
          <button
            className="secondary-button is-compact"
            type="button"
            disabled={resumeText.trim().length < 80 || isSavingBaseResume}
            onClick={onSaveCurrentAsBase}
            title="Save current resume as workspace base"
          >
            <Save size={12} aria-hidden="true" />
            Save
          </button>
          <button
            className="secondary-button is-compact"
            type="button"
            disabled={!baseResumeName}
            onClick={() => onLoadWorkspace(true)}
            title="Reload base from workspace"
          >
            <RefreshCw size={12} aria-hidden="true" />
            Reload
          </button>
          <button
            className="secondary-button is-compact"
            type="button"
            disabled={!baseResumeName || isSavingBaseResume}
            onClick={onRemoveBaseResume}
            title="Remove the saved base resume from the workspace"
          >
            <Trash2 size={12} aria-hidden="true" />
            Remove
          </button>
        </div>
        {workspaceStatus ? <p className="workspace-status">{workspaceStatus}</p> : null}
      </div>

      {baseResumeOptions.length > 1 ? (
        <div className="resume-versions">
          <div className="resume-history__heading">
            <FileText size={12} aria-hidden="true" />
            <span>Base versions</span>
          </div>
          <ul className="resume-history__list">
            {baseResumeOptions.map((option) => {
              const isActive = option.fileName === baseResumeName;
              return (
                <li key={option.fileName} className={`resume-history__item resume-version${isActive ? " is-active" : ""}`}>
                  <span className="resume-history__name">
                    {option.label}
                    <small>{option.fileName}</small>
                  </span>
                  <span className="resume-history__date">{option.kind.toUpperCase()}</span>
                  <button
                    className="ghost-button is-compact"
                    type="button"
                    disabled={isActive || isSavingBaseResume}
                    onClick={() => onLoadBaseResumeVersion(option.fileName)}
                    title={`Load ${option.fileName}`}
                  >
                    {isActive ? "Loaded" : "Load"}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {baseResumeHistory.length > 0 ? (
        <div className="resume-history">
          <div className="resume-history__heading">
            <History size={12} aria-hidden="true" />
            <span>Recent versions</span>
          </div>
          <ul className="resume-history__list">
            {baseResumeHistory.map((entry) => (
              <li key={entry.key} className="resume-history__item">
                <span className="resume-history__name">{entry.originalName}</span>
                <span className="resume-history__date">{formatHistoryDate(entry.date)}</span>
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
        </div>
      ) : null}

      <label className="upload-box">
        <Upload size={18} aria-hidden="true" />
        <span>{fileName || "Upload resume (.docx · .tex · .txt · .md · .csv)"}</span>
        <input accept=".docx,.txt,.md,.csv,.tex" type="file" onChange={onFileUpload} />
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
    </NavMenu>
  );
}
