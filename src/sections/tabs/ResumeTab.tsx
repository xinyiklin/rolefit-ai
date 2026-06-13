import { useEffect, useState, type ReactNode } from "react";

import type { PolishedResume, ResumeDiff } from "../../resumeEngine";
import type { ResumeData } from "../../lib/resumeData";
import type { ResumeEditorActions } from "../../hooks/useResumeEditor";
import type { TailorChangeTarget } from "../../resume/types";
import { DOC_ZOOM_OPTIONS, type DocStyleControls } from "../../hooks/useDocStyle";
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
  result: PolishedResume | null;
  resumeDiff: ResumeDiff | null;
  docStyle: DocStyleControls;
  tailorSectionIds: string[];
  setTailorSectionIds: (ids: string[] | ((current: string[]) => string[])) => void;
  exportControl?: ReactNode;
  onAddHonestContext?: (keyword: string) => void;
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
  result,
  resumeDiff,
  docStyle,
  tailorSectionIds,
  setTailorSectionIds,
  exportControl,
  onAddHonestContext
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
  function toggleTailorSection(sectionId: string, selected: boolean) {
    setTailorSectionIds((current) => {
      if (selected) return current.includes(sectionId) ? current : [...current, sectionId];
      return current.filter((id) => id !== sectionId);
    });
  }
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
          {scoreContext ? <span className="studio-card__meta">{scoreContext}</span> : null}
        </div>
      </div>

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
              tailorSectionIds={tailorSectionIds}
              onToggleTailorSection={toggleTailorSection}
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
            <ReviewRail result={result} resume={editedResume} actions={actions} resumeDiff={resumeDiff} onHighlight={setHighlightTarget} onAddHonestContext={onAddHonestContext} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
