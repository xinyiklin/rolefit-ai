import {
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import {
  AlertCircle,
  BriefcaseBusiness,
  CheckCircle2,
  FileText,
  FolderOpen,
  GripHorizontal,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  Upload
} from "lucide-react";
import { blockKindLabel, type ResumeBlock, type ResumeBlockKind, type SourceDocx } from "./shared";
import type { PolishedResume } from "../resumeEngine";

export type AiProviderValue =
  | "openai"
  | "anthropic"
  | "gemini"
  | "openrouter"
  | "groq"
  | "together"
  | "mistral"
  | "local"
  | "claude-cli"
  | "codex-cli"
  | "gemini-cli";

export type ProviderOption = {
  readonly value: AiProviderValue;
  readonly label: string;
  readonly baseUrl: string;
  readonly model: string;
};

export type ModelOption = { value: string; label: string };

export type RoleOption = { value: string; label: string };

type SourcesPaneProps = {
  // Job target
  jobDescription: string;
  setJobDescription: (v: string) => void;
  linkStatus: string;
  jobReady: boolean;

  // Resume source
  baseResumeName: string;
  workspacePath: string;
  workspaceStatus: string;
  isSavingBaseResume: boolean;
  fileName: string;
  fileError: string;
  fileStatus: string;
  sourceDocx: SourceDocx | null;
  resumeBlocks: ResumeBlock[];
  blockStats: Record<ResumeBlockKind, number>;
  resumeText: string;
  setResumeText: (v: string) => void;
  setResult: (v: PolishedResume | null) => void;
  resumeReady: boolean;
  onBaseResumeUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onSaveCurrentAsBase: () => void;
  onRemoveBaseResume: () => void;
  onLoadWorkspace: (apply: boolean) => Promise<void>;
  onFileUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onUpdateResumeBlock: (id: string, text: string) => void;
  onSyncBlocksFromText: () => void;

  // Polish
  includeCoverLetter: boolean;
  setIncludeCoverLetter: (v: boolean) => void;
  strictReview: boolean;
  setStrictReview: (v: boolean) => void;
  preserveFormat: boolean;
  setPreserveFormat: (v: boolean) => void;
  resumeSourceFormat: string;
  canPolish: boolean;
  isPolishing: boolean;
  polishStatus: string;
  onPolish: () => void | Promise<void>;
};

export function SourcesPane(props: SourcesPaneProps) {
  const {
    jobDescription,
    setJobDescription,
    linkStatus,
    jobReady,
    baseResumeName,
    workspacePath,
    workspaceStatus,
    isSavingBaseResume,
    fileName,
    fileError,
    fileStatus,
    sourceDocx,
    resumeBlocks,
    blockStats,
    resumeText,
    setResumeText,
    setResult,
    resumeReady,
    onBaseResumeUpload,
    onSaveCurrentAsBase,
    onRemoveBaseResume,
    onLoadWorkspace,
    onFileUpload,
    onUpdateResumeBlock,
    onSyncBlocksFromText,
    includeCoverLetter,
    setIncludeCoverLetter,
    strictReview,
    setStrictReview,
    preserveFormat,
    setPreserveFormat,
    resumeSourceFormat,
    canPolish,
    isPolishing,
    polishStatus,
    onPolish
  } = props;

  // Drag-to-resize for the Polish panel: null = use the CSS default height.
  const [polishHeight, setPolishHeight] = useState<number | null>(null);
  const polishScrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  function onResizeStart(event: ReactPointerEvent<HTMLDivElement>) {
    const el = polishScrollRef.current;
    if (!el) return;
    dragRef.current = { startY: event.clientY, startH: el.getBoundingClientRect().height };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onResizeMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    // Dragging the handle up grows the panel; down shrinks it.
    const delta = dragRef.current.startY - event.clientY;
    const next = Math.max(96, Math.min(window.innerHeight * 0.72, dragRef.current.startH + delta));
    setPolishHeight(next);
  }

  function onResizeEnd(event: ReactPointerEvent<HTMLDivElement>) {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  // Keyboard operability for the separator: Arrow Up/Down nudges the panel height.
  function onResizeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const step = event.key === "ArrowUp" ? 24 : event.key === "ArrowDown" ? -24 : 0;
    if (step === 0) return;
    event.preventDefault();
    const el = polishScrollRef.current;
    const current = polishHeight ?? (el ? el.getBoundingClientRect().height : 240);
    setPolishHeight(Math.max(96, Math.min(window.innerHeight * 0.72, current + step)));
  }

  return (
    <aside className="sources-pane" aria-label="Inputs">
      {/* Job target */}
      <section className="sources-section">
        <header className="sources-section__head">
          <BriefcaseBusiness size={14} aria-hidden="true" />
          <h2>Job target</h2>
          <span
            className={`section-dot ${jobReady ? "is-ready" : "is-pending"}`}
            aria-label={jobReady ? "Ready" : "Pending"}
          />
        </header>
        <label className="field">
          <span>
            Job posting <small>(paste the full description; links alone are tracking-only)</small>
          </span>
          <textarea
            className="textarea textarea--job"
            value={jobDescription}
            onChange={(event) => setJobDescription(event.target.value)}
            placeholder="Paste responsibilities, qualifications, and preferred skills. A bare link can be tracked, but not polished by itself."
          />
        </label>
        {linkStatus ? <p className="micro-status">{linkStatus}</p> : null}
      </section>

      {/* Resume source */}
      <section className="sources-section">
        <header className="sources-section__head">
          <FileText size={14} aria-hidden="true" />
          <h2>Resume</h2>
          <span
            className={`section-dot ${resumeReady ? "is-ready" : "is-pending"}`}
            aria-label={resumeReady ? "Ready" : "Pending"}
          />
        </header>

        <div className="workspace-card">
          <div className="workspace-card__heading">
            <FolderOpen size={14} aria-hidden="true" />
            <strong>{baseResumeName || "No base saved"}</strong>
          </div>
          <div className="workspace-actions">
            <label className="secondary-button is-compact workspace-upload">
              <Upload size={12} aria-hidden="true" />
              Upload
              <input accept=".docx,.txt,.md,.csv,.tex" type="file" onChange={onBaseResumeUpload} />
            </label>
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

        <label className="upload-box">
          <Upload size={18} aria-hidden="true" />
          <span>{fileName || "Choose resume file (.docx · .tex · .txt · .md · .csv)"}</span>
          <input accept=".docx,.pdf,.txt,.md,.csv,.tex" type="file" onChange={onFileUpload} />
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

        {sourceDocx && resumeBlocks.length ? (
          <div className="resume-block-editor">
            <div className="resume-block-editor__bar">
              <div>
                <span>Resume blocks</span>
                <strong>
                  {resumeBlocks.length} paragraphs · {blockStats.bullet} bullets
                </strong>
              </div>
              <button className="secondary-button is-compact" type="button" onClick={onSyncBlocksFromText}>
                <RefreshCw size={14} aria-hidden="true" />
                Sync
              </button>
            </div>
            <div className="resume-block-list" aria-label="DOCX resume paragraph editor">
              {resumeBlocks.map((block, index) => (
                <label className={`resume-block resume-block--${block.kind}`} key={block.id}>
                  <span className="resume-block__meta">
                    <strong>{blockKindLabel(block.kind)}</strong>
                    <small>{String(index + 1).padStart(2, "0")}</small>
                  </span>
                  <textarea
                    value={block.text}
                    onChange={(event) => onUpdateResumeBlock(block.id, event.target.value)}
                    aria-label={`${blockKindLabel(block.kind)} block ${index + 1}`}
                    rows={block.kind === "bullet" ? 3 : 2}
                  />
                </label>
              ))}
            </div>
          </div>
        ) : (
          <label className="field">
            <span>
              Resume text{" "}
              {fileName ? <small>(from {fileName}; edit text here as needed)</small> : null}
            </span>
            <textarea
              className="textarea textarea--resume"
              value={resumeText}
              onChange={(event) => {
                setResumeText(event.target.value);
                setResult(null);
              }}
              placeholder="Paste the resume content here."
            />
          </label>
        )}
      </section>

      {/* Polish — one sticky panel: only the header stays fixed; toggles, inputs, and button scroll inside the capped region */}
      <section className="sources-section sources-section--action">
        <div
          className="polish-resize"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize Polish panel (arrow keys to resize, double-click to reset)"
          title="Drag to resize · double-click to reset"
          tabIndex={0}
          onPointerDown={onResizeStart}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeEnd}
          onPointerCancel={onResizeEnd}
          onKeyDown={onResizeKeyDown}
          onDoubleClick={() => setPolishHeight(null)}
        >
          <GripHorizontal size={14} aria-hidden="true" />
        </div>
        <header className="sources-section__head">
          <Sparkles size={14} aria-hidden="true" />
          <h2>Polish</h2>
        </header>

        <div
          className="polish-scroll"
          ref={polishScrollRef}
          style={polishHeight != null ? { maxHeight: polishHeight } : undefined}
        >
        <label className="toggle-row">
          <input
            checked={preserveFormat}
            onChange={(event) => setPreserveFormat(event.target.checked)}
            type="checkbox"
          />
          <span>
            <strong>Preserve format</strong>
            <small>Keep source structure and order where possible. Source: {resumeSourceFormat}.</small>
          </span>
        </label>

        <label className="toggle-row">
          <input
            checked={includeCoverLetter}
            onChange={(event) => setIncludeCoverLetter(event.target.checked)}
            type="checkbox"
          />
          <span>
            <strong>Cover letter</strong>
          </span>
        </label>

        <label className="toggle-row">
          <input
            checked={strictReview}
            onChange={(event) => setStrictReview(event.target.checked)}
            type="checkbox"
          />
          <span>
            <strong>Strict review</strong>
            <small>Adds recruiter audit: verdict, gaps, rewrites, risk flags.</small>
          </span>
        </label>

        </div>

        <div className="polish-actions">
          <button
            className="primary-button"
            type="button"
            disabled={!canPolish || isPolishing}
            onClick={onPolish}
          >
            <Sparkles size={14} aria-hidden="true" />
            {isPolishing
              ? "Working…"
              : strictReview && includeCoverLetter
              ? "Polish + review + cover"
              : strictReview
              ? "Polish + review"
              : includeCoverLetter
              ? "Polish + cover"
              : "Polish"}
          </button>

          {polishStatus ? (
            <div className="notice notice--info" role="status">
              <Sparkles size={15} aria-hidden="true" />
              <span>{polishStatus}</span>
            </div>
          ) : null}
        </div>
      </section>
    </aside>
  );
}
