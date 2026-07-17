import { useEffect, useState, type ReactNode } from "react";
import { SpellCheck } from "lucide-react";

import type { PolishedResume, ResumeDiff } from "../../resumeEngine";
import type { ResumeData } from "../../lib/resumeData";
import { isFieldFullyMarked, type FieldMark } from "../../lib/inlineMarksText";
import type { TailorMode } from "../../lib/tailorScope";
import type { ResumeEditorActions } from "../../hooks/useResumeEditor";
import type { TailorChangeTarget } from "../../resume/types";
import { DOC_PAGE_WIDTH_PX, DOC_ZOOM_OPTIONS, type DocStyleControls } from "../../hooks/useDocStyle";
import type { EditorPrefsControls } from "../../hooks/useEditorPrefs";
import { verdictPillClass, type FitVerdict } from "../../hooks/useResumeAnalysis";
import type { JobConstraint } from "../../lib/jobConstraints";
import type { AutosavedDraft } from "../../hooks/useAutosaveDraft";
import { FormatMenu } from "../FormatMenu";
import { StyleMenu } from "../StyleMenu";
import { TypesetEditor } from "../editor/TypesetEditor";
import { ReviewRail } from "../ReviewRail";

// Standard-entry title/subtitle values that carry text (skills/summary items
// reuse those columns for other meanings, so they're excluded).
function entryFieldValues(data: ResumeData | null, field: "title" | "subtitle"): string[] {
  if (!data) return [];
  const key = field === "title" ? "titleLeft" : "subtitleLeft";
  return data.sections
    .filter((section) => section.type !== "skills" && section.type !== "summary")
    .flatMap((section) => section.items.map((entry) => entry[key]))
    .filter((value) => value.trim());
}

// Chip state: once any entry carries the mark, "on" means EVERY entry does;
// before that the whole-field render flag stands in (untouched resumes).
function entriesMarkOn(
  data: ResumeData | null,
  field: "title" | "subtitle",
  mark: FieldMark,
  flag: boolean
): boolean {
  const values = entryFieldValues(data, field);
  if (!values.length) return flag;
  const marked = new RegExp(`<${mark === "bold" ? "b" : "i"}>`, "i");
  if (!values.some((value) => marked.test(value))) return flag;
  return values.every((value) => isFieldFullyMarked(value, mark));
}

type ResumeTabProps = {
  editedResume: ResumeData | null;
  actions: ResumeEditorActions;
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
  // True only for the first workspace check. Manual Reload actions do not
  // replace the live editor with this arrival state.
  isWorkspaceBootstrapping: boolean;
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
  // Editor-only display prefs (spellcheck). Separate from docStyle: never
  // affects layout/export, and Format's "Reset to defaults" must not touch it.
  editorPrefs: EditorPrefsControls;
  tailorModes: Record<string, TailorMode>;
  onSetTailorMode: (sectionId: string, mode: TailorMode) => void;
  exportControl?: ReactNode;
  onAddHonestContext?: (keyword: string) => void;
  // Autosave recovery: non-null when a draft from a previous session was found.
  pendingAutosaveDraft?: AutosavedDraft | null;
  onRestoreAutosaveDraft?: (draft: AutosavedDraft) => void;
  onDismissAutosaveDraft?: () => void;
  // Job target context: displayed in the header so the user knows which role
  // the resume is being tailored for.
  jobTarget?: { role?: string; company?: string } | null;
  // True when the JD changed since the last polish — the review describes an
  // old posting and should be flagged as stale.
  reviewStale?: boolean;
};

// The resume surface is edit-and-check: the owned typeset page is the editor
// and export layout, and once a recruiter
// review exists it docks beside the editor as an actionable rail — accept,
// modify, or apply-all the suggested edits without leaving the document.
export function ResumeTab({
  editedResume,
  actions,
  canUndo,
  canRedo,
  dirty,
  isWorkspaceBootstrapping,
  hasResult,
  resultSourceLabel,
  scoreContext,
  fitVerdict,
  jobConstraints,
  result,
  resumeDiff,
  docStyle,
  editorPrefs,
  tailorModes,
  onSetTailorMode,
  exportControl,
  onAddHonestContext,
  jobTarget,
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

  // Entry emphasis is real inline formatting, applied in bulk from the Style
  // menu and overridable per entry. The whole-field flag stays as the fallback
  // for entries with no marks (and clears once marks become authoritative).
  const titlesBold = entriesMarkOn(editedResume, "title", "bold", docStyle.style.boldTitles);
  const subtitlesItalic = entriesMarkOn(editedResume, "subtitle", "italic", docStyle.style.italicSubtitles);
  const handleEntriesMark = (field: "title" | "subtitle", mark: FieldMark, on: boolean) => {
    actions.setEntriesMark(field, mark, on);
    if (field === "title" && mark === "bold") docStyle.set("boldTitles", false);
    else if (field === "subtitle" && mark === "italic") docStyle.set("italicSubtitles", false);
  };

  const hasReview = Boolean(result?.strictReview || result?.suggestedChanges?.length);
  const hasSuggestions = Boolean(result?.suggestedChanges?.length);
  const title = hasSuggestions || result?.source === "local" ? "Resume draft" : hasResult ? "Tailored resume" : "Resume draft";
  const sourceLabel = hasSuggestions ? "AI suggestions" : result?.source === "local" ? "Local analysis" : resultSourceLabel;
  const jobTargetLabel = [jobTarget?.role, jobTarget?.company].filter(Boolean).join(" at ");
  return (
    <section className="studio-card studio-card--flush">
      <div className="studio-card__head">
        <h2>
          {title}
          {(sourceLabel || dirty || jobTargetLabel) ? (
            <span className="studio-card__head-meta">
              {sourceLabel ? ` · ${sourceLabel}` : ""}
              {dirty ? " · edited" : ""}
              {jobTargetLabel ? ` · ${jobTargetLabel}` : ""}
            </span>
          ) : null}
        </h2>
        <div className="studio-card__tools">
          <label className="doc-zoom" title="Page zoom (100% = actual size)">
            <span className="doc-zoom__label">Zoom</span>
            <select
              value={String(docStyle.style.zoom)}
              onChange={(event) => {
                if (event.target.value === "fit") {
                  // One-shot Fit: size the fixed 816px logical page to the
                  // editor pane's content width (like Docs' Fit).
                  const pane = document.querySelector(".resume-workbench__editor");
                  if (pane) {
                    const cs = window.getComputedStyle(pane);
                    const content = pane.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
                    const fit = Math.max(0.4, Math.min(2, content / DOC_PAGE_WIDTH_PX));
                    docStyle.set("zoom", Math.floor(fit * 100) / 100);
                  }
                  return;
                }
                docStyle.set("zoom", Number(event.target.value));
              }}
              aria-label="Page zoom"
            >
              <option value="fit">Fit</option>
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
          <button
            type="button"
            className={`doc-toggle${editorPrefs.prefs.spellCheck ? " is-on" : ""}`}
            aria-pressed={editorPrefs.prefs.spellCheck}
            onClick={() => editorPrefs.set("spellCheck", !editorPrefs.prefs.spellCheck)}
            title={
              editorPrefs.prefs.spellCheck
                ? "Spell check on — hiding it removes the red typo underlines"
                : "Spell check off — turn on to underline possible typos"
            }
          >
            <SpellCheck size={14} aria-hidden={true} />
            <span className="doc-toggle__label">Spell check</span>
          </button>
          <FormatMenu docStyle={docStyle} />
          <StyleMenu
            docStyle={docStyle}
            titlesBold={titlesBold}
            subtitlesItalic={subtitlesItalic}
            onEntriesMark={handleEntriesMark}
          />
          <span className="studio-card__tool-divider" aria-hidden="true" />
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

      <div className={`resume-workbench${hasReview ? " has-rail" : ""}`}>
        {/* Floated as an overlay so appearing/dismissing never reflows the
            editor (it sits over the desk margin above the page). */}
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

        <div
          className="resume-workbench__editor"
          onDragStart={(e) => {
            if (!(e.target as HTMLElement).closest?.(".resume-doc")) e.preventDefault();
          }}
        >
          {editedResume ? (
            <TypesetEditor
              data={editedResume}
              actions={actions}
              canUndo={canUndo}
              canRedo={canRedo}
              docStyle={docStyle}
              spellCheck={editorPrefs.prefs.spellCheck}
              tailorModes={tailorModes}
              onSetTailorMode={onSetTailorMode}
              highlightTarget={highlightTarget}
            />
          ) : isWorkspaceBootstrapping ? (
            <p className="resume-doc__boot" role="status" aria-live="polite">
              Opening workspace…
            </p>
          ) : (
            <div className="resume-doc__empty">
              <strong>Bring a resume to the desk</strong>
              <span>Open Resume above to upload a source file.</span>
            </div>
          )}
        </div>

        {hasReview && result ? (
          <div className="resume-workbench__rail">
            <ReviewRail
              result={result}
              resume={editedResume}
              actions={actions}
              resumeDiff={resumeDiff}
              jobConstraints={jobConstraints}
              reviewStale={reviewStale}
              onHighlight={setHighlightTarget}
              onAddHonestContext={onAddHonestContext}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}
