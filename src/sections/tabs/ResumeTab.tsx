import { useEffect, useState, type ReactNode } from "react";

import type { PolishedResume, ResumeDiff } from "../../resumeEngine";
import type { ResumeData } from "../../lib/resumeData";
import type { TailorMode } from "../../lib/tailorScope";
import type { ResumeEditorActions } from "../../hooks/useResumeEditor";
import type { TailorChangeTarget } from "../../resume/types";
import { DOC_ZOOM_OPTIONS, type DocStyleControls } from "../../hooks/useDocStyle";
import { verdictPillClass, type FitVerdict } from "../../hooks/useResumeAnalysis";
import type { JobConstraint } from "../../lib/jobConstraints";
import type { AutosavedDraft } from "../../hooks/useAutosaveDraft";
import { FormatMenu } from "../FormatMenu";
import { ResumeEditor } from "../editor/ResumeEditor";
import { ReviewRail } from "../ReviewRail";

type ResumeTabProps = {
  editedResume: ResumeData | null;
  actions: ResumeEditorActions;
  dirty: boolean;
  // Whether a polish has produced a tailored draft; before that the editor
  // holds the untailored source, so the heading shouldn't claim "tailored".
  hasResult: boolean;
  resultSourceLabel: string;
  scoreContext: string;
  // Qualitative fit band (Strong fit / Reasonable fit / Stretch / Don't apply)
  // + provenance. Null until a resume and job are loaded. Replaces the raw score
  // number: the user wants the verdict, not a figure.
  fitVerdict: FitVerdict | null;
  // JD lifestyle/logistical conditions for the pre-apply advisory (not fit).
  jobConstraints?: JobConstraint[];
  result: PolishedResume | null;
  resumeDiff: ResumeDiff | null;
  docStyle: DocStyleControls;
  tailorModes: Record<string, TailorMode>;
  onSetTailorMode: (sectionId: string, mode: TailorMode) => void;
  exportControl?: ReactNode;
  onAddHonestContext?: (keyword: string) => void;
  // Autosave recovery: non-null when a draft from a previous session was found.
  pendingAutosaveDraft?: AutosavedDraft | null;
  onRestoreAutosaveDraft?: (draft: AutosavedDraft) => void;
  onDismissAutosaveDraft?: () => void;
  // True when the JD changed since the last polish — the ReviewRail describes
  // an old posting and should be flagged as stale.
  reviewStale?: boolean;
};

// The resume surface is edit-and-check: the structured editor carries the
// document (the HTML page mirrors the export typography), and once a recruiter
// review exists it docks beside the editor as an actionable rail — accept,
// modify, or apply-all the suggested edits without leaving the document.
export function ResumeTab({
  editedResume,
  actions,
  dirty,
  hasResult,
  resultSourceLabel,
  scoreContext,
  fitVerdict,
  jobConstraints,
  result,
  resumeDiff,
  docStyle,
  tailorModes,
  onSetTailorMode,
  exportControl,
  onAddHonestContext,
  pendingAutosaveDraft,
  onRestoreAutosaveDraft,
  onDismissAutosaveDraft,
  reviewStale
}: ResumeTabProps) {
  // Intercept Ctrl/Cmd +/- to control editor zoom instead of browser zoom.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      const zoomOptions = DOC_ZOOM_OPTIONS as readonly number[];
      const currentIndex = zoomOptions.indexOf(docStyle.style.zoom);
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        const next = currentIndex < zoomOptions.length - 1 ? currentIndex + 1 : currentIndex;
        if (next !== currentIndex) docStyle.set("zoom", zoomOptions[next]);
      } else if (e.key === "-") {
        e.preventDefault();
        const prev = currentIndex > 0 ? currentIndex - 1 : currentIndex;
        if (prev !== currentIndex) docStyle.set("zoom", zoomOptions[prev]);
      } else if (e.key === "0") {
        e.preventDefault();
        docStyle.set("zoom", 1);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [docStyle]);

  const [highlightTarget, setHighlightTarget] = useState<TailorChangeTarget | null>(null);

  const hasReview = Boolean(result?.strictReview || result?.suggestedChanges?.length);
  const hasSuggestions = Boolean(result?.suggestedChanges?.length);
  const title = hasSuggestions || result?.source === "local" ? "Resume draft" : hasResult ? "Tailored resume" : "Resume draft";
  const sourceLabel = hasSuggestions ? "AI suggestions" : result?.source === "local" ? "Local analysis" : resultSourceLabel;
  return (
    <section className="studio-card studio-card--flush">
      <div className="studio-card__head">
        <h2>
          {title}
          {(sourceLabel || dirty) ? (
            <span className="studio-card__head-meta">
              {sourceLabel ? ` · ${sourceLabel}` : ""}
              {dirty ? " · edited" : ""}
            </span>
          ) : null}
        </h2>
        <div className="studio-card__tools">
          <label className="doc-zoom" title="Page zoom">
            <span className="doc-zoom__label">Zoom</span>
            <select
              value={String(docStyle.style.zoom)}
              onChange={(event) => docStyle.set("zoom", Number(event.target.value))}
              aria-label="Page zoom"
            >
              {DOC_ZOOM_OPTIONS.map((z) => (
                <option key={z} value={String(z)}>
                  {Math.round(z * 100)}%
                </option>
              ))}
              {!DOC_ZOOM_OPTIONS.some((z) => z === docStyle.style.zoom) ? (
                <option value={String(docStyle.style.zoom)}>{Math.round(docStyle.style.zoom * 100)}%</option>
              ) : null}
            </select>
          </label>
          <FormatMenu docStyle={docStyle} />
          {exportControl}
          {fitVerdict ? (
            <span className="fit-readout" title={`${fitVerdict.label} — ${fitVerdict.source}`}>
              <strong className={`verdict-pill verdict-pill--inline ${verdictPillClass(fitVerdict.verdict)}`}>
                {fitVerdict.label}
              </strong>
              <span className="fit-readout__source">{fitVerdict.source}</span>
            </span>
          ) : scoreContext ? (
            <span className="studio-card__meta">{scoreContext}</span>
          ) : null}
        </div>
      </div>

      {pendingAutosaveDraft && onRestoreAutosaveDraft && onDismissAutosaveDraft ? (
        <div className="draft-restore-bar" role="alert">
          <span className="draft-restore-bar__text">
            Unsaved draft found
            {pendingAutosaveDraft.jobLabel ? ` · ${pendingAutosaveDraft.jobLabel}` : ""}
            {" "}
            <span className="draft-restore-bar__time">
              {new Date(pendingAutosaveDraft.savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          </span>
          <button
            type="button"
            className="ghost-button is-compact draft-restore-bar__action"
            onClick={() => onRestoreAutosaveDraft(pendingAutosaveDraft)}
          >
            Restore
          </button>
          <button
            type="button"
            className="ghost-button is-compact draft-restore-bar__dismiss"
            aria-label="Dismiss"
            onClick={onDismissAutosaveDraft}
          >
            ×
          </button>
        </div>
      ) : null}

      <div className={`resume-workbench${hasReview ? " has-rail" : ""}`}>
        <div
          className="resume-workbench__editor"
          onDragStart={(e) => {
            if (!(e.target as HTMLElement).closest?.(".resume-doc")) e.preventDefault();
          }}
        >
          {editedResume ? (
            <ResumeEditor
              data={editedResume}
              actions={actions}
              style={docStyle.cssVars}
              tailorModes={tailorModes}
              onSetTailorMode={onSetTailorMode}
              highlightTarget={highlightTarget}
            />
          ) : (
            <p className="resume-doc__empty">
              Load a resume or run a polish to begin. After a polish, the review rail docks here with one-click edits.
            </p>
          )}
        </div>

        {hasReview && result ? (
          <div className="resume-workbench__rail">
            <ReviewRail result={result} resume={editedResume} actions={actions} resumeDiff={resumeDiff} jobConstraints={jobConstraints} reviewStale={reviewStale} onHighlight={setHighlightTarget} onAddHonestContext={onAddHonestContext} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
