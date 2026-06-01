import type { ReactNode } from "react";
import { BriefcaseBusiness, FilePlus2, FileText, FolderOpen, Sparkles } from "lucide-react";
import type { ScoreSource } from "./shared";

type MastheadProps = {
  resumeReady: boolean;
  jobReady: boolean;
  outputReady: boolean;
  resumeBulletCount: number;
  scoreSource: ScoreSource;
  baseResumeName: string;
  onLoadResume: () => void | Promise<void>;
  onNextRole: () => void;
  nextRoleDisabled: boolean;
  aiControl?: ReactNode;
  polishControl?: ReactNode;
};

export function Masthead({
  resumeReady,
  jobReady,
  outputReady,
  resumeBulletCount,
  scoreSource,
  baseResumeName,
  onLoadResume,
  onNextRole,
  nextRoleDisabled,
  aiControl,
  polishControl
}: MastheadProps) {
  return (
    <header className="masthead" aria-label="Workspace header">
      <div className="masthead__brand">
        <h1>RoleFit AI</h1>
      </div>
      <div className="masthead__meta">
        <div
          className={`status-chip ${resumeReady ? "is-ready" : "is-pending"}`}
          title={resumeReady ? `${resumeBulletCount} bullets ready` : "Resume pending"}
        >
          <FileText size={13} aria-hidden="true" />
          <em>{resumeReady ? resumeBulletCount : "—"}</em>
        </div>
        <div
          className={`status-chip ${jobReady ? "is-ready" : "is-pending"}`}
          title={jobReady ? "Job target ready" : "Job target pending"}
        >
          <BriefcaseBusiness size={13} aria-hidden="true" />
          <em>{jobReady ? "✓" : "—"}</em>
        </div>
        <div
          className={`status-chip ${outputReady ? "is-ready" : "is-pending"}`}
          title={outputReady ? `Fit ${scoreSource?.score.overall ?? "--"}` : "No polished draft yet"}
        >
          <Sparkles size={13} aria-hidden="true" />
          <em>{outputReady ? scoreSource?.score.overall ?? "—" : "—"}</em>
        </div>
        {aiControl}
        {polishControl}
        <button
          className="ghost-button"
          type="button"
          onClick={onLoadResume}
          disabled={!baseResumeName}
          title={baseResumeName ? `Load ${baseResumeName}` : "No base resume saved"}
        >
          <FolderOpen size={14} aria-hidden="true" />
          <span>{baseResumeName ? "Load base" : "No base"}</span>
        </button>
        <button
          className="ghost-button"
          type="button"
          onClick={onNextRole}
          disabled={nextRoleDisabled}
          title="Clear job target + result, keep resume"
        >
          <FilePlus2 size={14} aria-hidden="true" />
          <span>Next role</span>
        </button>
      </div>
    </header>
  );
}
