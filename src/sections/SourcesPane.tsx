import type { ChangeEvent } from "react";
import {
  AlertCircle,
  BriefcaseBusiness,
  CheckCircle2,
  FileText,
  FolderOpen,
  KeyRound,
  RefreshCw,
  Save,
  Settings2,
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
  | "codex-cli";

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
  roleAppliedAs: string;
  setRoleAppliedAs: (v: string) => void;
  honestContext: string;
  setHonestContext: (v: string) => void;
  customInstructions: string;
  setCustomInstructions: (v: string) => void;
  showAdvanced: boolean;
  setShowAdvanced: (next: (v: boolean) => boolean) => void;
  canPolish: boolean;
  isPolishing: boolean;
  polishStatus: string;
  onPolish: () => void | Promise<void>;
  roleAppliedOptions: readonly RoleOption[];

  // AI settings
  aiProvider: AiProviderValue;
  onProviderChange: (provider: AiProviderValue) => void;
  apiKey: string;
  setApiKey: (v: string) => void;
  apiBaseUrl: string;
  setApiBaseUrl: (v: string) => void;
  selectedModel: string;
  setSelectedModel: (v: string) => void;
  cliReasoningEffort: string;
  setCliReasoningEffort: (v: string) => void;
  customModel: string;
  setCustomModel: (v: string) => void;
  providerOptions: readonly ProviderOption[];
  currentModelOptions: readonly ModelOption[];
  currentCliReasoningEffortOptions: readonly ModelOption[];
  selectedProviderOption: ProviderOption | undefined;
  customModelPlaceholder: string;
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
    roleAppliedAs,
    setRoleAppliedAs,
    honestContext,
    setHonestContext,
    customInstructions,
    setCustomInstructions,
    showAdvanced,
    setShowAdvanced,
    canPolish,
    isPolishing,
    polishStatus,
    onPolish,
    roleAppliedOptions,
    aiProvider,
    onProviderChange,
    apiKey,
    setApiKey,
    apiBaseUrl,
    setApiBaseUrl,
    selectedModel,
    setSelectedModel,
    cliReasoningEffort,
    setCliReasoningEffort,
    customModel,
    setCustomModel,
    providerOptions,
    currentModelOptions,
    currentCliReasoningEffortOptions,
    selectedProviderOption
  } = props;

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
        <header className="sources-section__head">
          <Sparkles size={14} aria-hidden="true" />
          <h2>Polish</h2>
          <button
            className="ghost-button is-compact"
            type="button"
            aria-expanded={showAdvanced}
            onClick={() => setShowAdvanced((v) => !v)}
            title={selectedProviderOption?.label ? `AI settings: ${selectedProviderOption.label}` : "AI settings"}
          >
            <Settings2 size={12} aria-hidden="true" />
            <span>{showAdvanced ? "Hide settings" : "AI settings"}</span>
          </button>
        </header>

        <div className="polish-scroll">
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

        {strictReview ? (
          <div className="strict-form">
            <label className="field">
              <span>Role applying as</span>
              <select value={roleAppliedAs} onChange={(event) => setRoleAppliedAs(event.target.value)}>
                {roleAppliedOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>
                Honest context <small>(true facts not on the resume — used only as evidence)</small>
              </span>
              <textarea
                className="textarea"
                value={honestContext}
                onChange={(event) => setHonestContext(event.target.value)}
                placeholder="e.g., shipped a PostgreSQL migration with zero downtime; led a 3-person hackathon team; merged PR to django-rest-framework."
                rows={3}
              />
            </label>
          </div>
        ) : null}

        <label className="field">
          <span>
            Custom instructions <small>(optional — steer the rewrite: tone, length, emphasis)</small>
          </span>
          <textarea
            className="textarea"
            value={customInstructions}
            onChange={(event) => setCustomInstructions(event.target.value)}
            placeholder="e.g., aim for one page; lead each bullet with a metric; use British spelling; don't add a summary section."
            rows={3}
          />
        </label>

        {showAdvanced ? (
          <form className="ai-settings" onSubmit={(event) => event.preventDefault()}>
            <label className="field">
              <span>API key</span>
              <div className="input-with-icon">
                <KeyRound size={15} aria-hidden="true" />
                <input
                  autoComplete="off"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={
                    aiProvider === "claude-cli"
                      ? "Not used — auth via `claude auth login` (Claude Max)"
                      : aiProvider === "codex-cli"
                      ? "Not used — auth via `codex login` (ChatGPT/Codex Plus)"
                      : aiProvider === "openai"
                      ? "Uses OPENAI_API_KEY when blank"
                      : "Uses this provider's .env key when blank"
                  }
                  disabled={aiProvider === "claude-cli" || aiProvider === "codex-cli"}
                  type="password"
                />
              </div>
            </label>
            <div className="settings-grid">
              <label className="field">
                <span>Provider</span>
                <select value={aiProvider} onChange={(event) => onProviderChange(event.target.value as AiProviderValue)}>
                  {providerOptions.map((option) => (
                    <option key={option.value || "server-default"} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Model</span>
                <select value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)}>
                  {currentModelOptions.map((option) => (
                    <option key={option.value || "server-default"} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              {selectedModel === "custom" ? (
                <label className="field field--wide">
                  <span>Custom model</span>
                  <input
                    className="text-input"
                    value={customModel}
                    onChange={(event) => setCustomModel(event.target.value)}
                    placeholder={props.customModelPlaceholder}
                    type="text"
                  />
                </label>
              ) : null}
              {currentCliReasoningEffortOptions.length ? (
                <label className="field">
                  <span>Reasoning effort</span>
                  <select value={cliReasoningEffort} onChange={(event) => setCliReasoningEffort(event.target.value)}>
                    {currentCliReasoningEffortOptions.map((option) => (
                      <option key={option.value || "cli-default-effort"} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {["openrouter", "groq", "together", "mistral", "local"].includes(aiProvider) ? (
                <label className="field field--wide">
                  <span>Base URL</span>
                  <input
                    className="text-input"
                    value={apiBaseUrl}
                    onChange={(event) => setApiBaseUrl(event.target.value)}
                    placeholder="https://provider.example/v1"
                    type="url"
                  />
                </label>
              ) : null}
            </div>
            <p className="micro-status">
              Claude and Gemini use their native APIs. OpenRouter / Groq / Together / Mistral / local use OpenAI-compatible <code>/chat/completions</code>.
            </p>
          </form>
        ) : null}

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
