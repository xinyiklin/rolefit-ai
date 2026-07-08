/**
 * useWorkspaceResume — the local workspace / base-resume cluster, extracted
 * from App.tsx: the workspace + base-resume state, applyWorkspaceBaseResume,
 * updateWorkspaceState, loadWorkspace, saveBaseResume, removeBaseResume,
 * restoreBaseResume, saveCurrentAsBaseResume, loadBaseResumeVersion, and
 * handleFileUpload.
 *
 * State ownership: workspacePath/workspaceFiles/baseResumeName/
 * baseResumeOptions/baseResumeHistory/workspaceStatus/isSavingBaseResume are
 * OWNED here — every mutator of them is one of these functions. App only
 * reads them for render (ResumeMenu's workspace props) and calls
 * loadWorkspace(true) once on mount.
 *
 * Everything this cluster reads or mutates OUTSIDE its own state (the resume
 * editor, export status, autosave draft, dialogs, templates/doc style) stays
 * owned by App and arrives via args, mirroring usePolishPipeline's pattern.
 */
import { useState } from "react";
import type { ChangeEvent } from "react";
import type { ConfirmOptions } from "./useDialog";
import type { DocStyleControls } from "./useDocStyle";
import type { AutosavedDraft } from "./useAutosaveDraft";
import { loadLastBaseResumeName, saveLastBaseResumeName } from "../lib/baseResumePrefs";
import { arrayBufferToBase64 } from "../lib/downloads";
import { toTemplateSchema, type ResumeData, type ResumeTemplateSchema } from "../lib/resumeData";
import type { PolishedResume } from "../resumeEngine";

export type WorkspaceBaseResume = {
  exists: boolean;
  fileName?: string;
  label?: string;
  kind?: string;
  text?: string;
  paragraphs?: number;
  docxBase64?: string;
};

export type BaseResumeOption = {
  fileName: string;
  label: string;
  kind: string;
};

export type BaseResumeHistoryEntry = {
  key: string;
  originalName: string;
  kind: string;
  date: string;
};

// Recent versions are grouped by variant (one expandable group per variant),
// each capped server-side to its most recent entries.
export type BaseResumeHistoryGroup = {
  variant: string;
  label: string;
  entries: BaseResumeHistoryEntry[];
};

export type JobWorkspace = {
  path: string;
  baseResume: WorkspaceBaseResume;
  baseResumeOptions?: BaseResumeOption[];
  baseResumeHistory?: BaseResumeHistoryGroup[];
  files: string[];
};

type UseWorkspaceResumeArgs = {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  confirmReplaceEditor: () => Promise<boolean>;
  resumeEdited: boolean;
  seedResumeEditor: (text: string, sourceText?: string) => void;
  fileName: string;
  setResumeText: (text: string) => void;
  setFileName: (name: string) => void;
  setResult: (updater: PolishedResume | null | ((prev: PolishedResume | null) => PolishedResume | null)) => void;
  applyCoverLetter: (text: string) => void;
  setFileError: (value: string) => void;
  setFileStatus: (value: string) => void;
  setPolishStatus: (value: string) => void;
  resetExportStatuses: () => void;
  setTexStatus: (value: string) => void;
  clearAutosaveDraft: () => void;
  setPendingAutosaveDraft: (draft: AutosavedDraft | null) => void;
  renderTexFromSchema: (
    schema: ResumeTemplateSchema,
    templateId?: string,
    options?: { docStyle?: DocStyleControls["style"] }
  ) => Promise<string>;
  selectedTemplateId: string;
  docStyle: DocStyleControls;
  currentResumeText: string;
  resumeText: string;
  editedResume: ResumeData | null;
};

export function useWorkspaceResume({
  confirm,
  confirmReplaceEditor,
  resumeEdited,
  seedResumeEditor,
  fileName,
  setResumeText,
  setFileName,
  setResult,
  applyCoverLetter,
  setFileError,
  setFileStatus,
  setPolishStatus,
  resetExportStatuses,
  setTexStatus,
  clearAutosaveDraft,
  setPendingAutosaveDraft,
  renderTexFromSchema,
  selectedTemplateId,
  docStyle,
  currentResumeText,
  resumeText,
  editedResume
}: UseWorkspaceResumeArgs) {
  const [workspacePath, setWorkspacePath] = useState("");
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);
  const [baseResumeName, setBaseResumeName] = useState("");
  const [baseResumeOptions, setBaseResumeOptions] = useState<BaseResumeOption[]>([]);
  const [baseResumeHistory, setBaseResumeHistory] = useState<BaseResumeHistoryGroup[]>([]);
  const [workspaceStatus, setWorkspaceStatus] = useState("");
  const [isSavingBaseResume, setIsSavingBaseResume] = useState(false);

  // `skipConfirm` is true on paths that PRESERVE the user's work (Save) or are
  // triggered on first mount before the user has made any edits. It is false on
  // explicit Reload, Load-version, and Restore actions where the user could have
  // unsaved edits they'd lose.
  async function applyWorkspaceBaseResume(baseResume: WorkspaceBaseResume, status: string, skipConfirm = false) {
    if (!baseResume.exists || !baseResume.text) return;

    if (!skipConfirm && resumeEdited) {
      if (!(await confirmReplaceEditor())) return;
      // User confirmed the replace — the autosaved draft of the old edits is
      // now superseded; clear it so the restore bar doesn't linger.
      clearAutosaveDraft();
      setPendingAutosaveDraft(null);
    }

    saveLastBaseResumeName(baseResume.fileName ?? "");
    setResumeText(baseResume.text);
    setFileName(baseResume.fileName ?? "base-resume");
    setBaseResumeName(baseResume.fileName ?? "");
    setResult(null);
    applyCoverLetter("");
    setFileError("");
    setPolishStatus("");
    resetExportStatuses();
    setTexStatus("");
    // Make the loaded base resume editable straight away (pre-polish).
    seedResumeEditor(baseResume.text, "");

    if (baseResume.kind === "docx" && baseResume.docxBase64) {
      setFileStatus(`${status} DOCX content parsed into the editor.`);
    } else {
      setFileStatus(status);
    }
  }

  function updateWorkspaceState(workspace: JobWorkspace) {
    setWorkspacePath(workspace.path);
    setWorkspaceFiles(workspace.files ?? []);
    setBaseResumeName(workspace.baseResume?.exists ? workspace.baseResume.fileName ?? "" : "");
    setBaseResumeOptions(workspace.baseResumeOptions ?? []);
    // Only overwrite history when the response actually carries it. A partial
    // response (e.g. a caller that forgets the field) must not silently wipe the
    // Recent list — that was the "history disappears on save" bug.
    if (workspace.baseResumeHistory !== undefined) setBaseResumeHistory(workspace.baseResumeHistory);
  }

  async function loadWorkspace(applyBaseResume = false) {
    try {
      const response = await fetch("/api/workspace");
      const workspace = (await response.json()) as JobWorkspace & { error?: string };
      if (!response.ok) throw new Error(workspace.error ?? "Workspace check failed.");

      updateWorkspaceState(workspace);
      if (workspace.baseResume?.exists) {
        if (applyBaseResume) {
          const rememberedName = loadLastBaseResumeName();
          const availableBaseNames = new Set([
            workspace.baseResume.fileName ?? "",
            ...(workspace.baseResumeOptions ?? []).map((option) => option.fileName)
          ]);
          const rememberedExists = availableBaseNames.has(rememberedName);
          if (
            rememberedName &&
            rememberedExists &&
            rememberedName !== workspace.baseResume.fileName
          ) {
            await loadBaseResumeVersion(rememberedName);
            return;
          }
          if (rememberedName && !rememberedExists) {
            saveLastBaseResumeName("");
          }
          setWorkspaceStatus("");
          await applyWorkspaceBaseResume(workspace.baseResume, "");
          return;
        }
        setWorkspaceStatus("");
      } else {
        saveLastBaseResumeName("");
        setWorkspaceStatus("Local workspace ready. Save a base resume to use it automatically on startup.");
        if (applyBaseResume && workspace.baseResume?.text) {
          setResumeText(workspace.baseResume.text);
          seedResumeEditor(workspace.baseResume.text, "");
          setFileStatus("Loaded the starter template. Replace it with your own resume to get started.");
        }
      }
    } catch (error) {
      setWorkspaceStatus(error instanceof Error ? error.message : "Local workspace could not be checked.");
    }
  }

  async function saveBaseResume(payload: { fileName: string; fileBase64?: string; text?: string }) {
    setIsSavingBaseResume(true);
    setWorkspaceStatus("Saving base resume to the local workspace…");

    try {
      const response = await fetch("/api/workspace/base-resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const workspace = (await response.json()) as Partial<JobWorkspace> & {
        baseResume?: WorkspaceBaseResume;
        error?: string;
      };
      if (!response.ok || !workspace.baseResume) {
        throw new Error(workspace.error ?? "Base resume save failed.");
      }

      updateWorkspaceState({
        path: workspace.path ?? workspacePath,
        baseResume: workspace.baseResume,
        baseResumeOptions: workspace.baseResumeOptions,
        baseResumeHistory: workspace.baseResumeHistory,
        files: workspace.files ?? workspaceFiles
      });
      // Save preserves the user's work — no confirm needed; also clear the
      // autosave since the edits are now persisted to the workspace file.
      clearAutosaveDraft();
      await applyWorkspaceBaseResume(workspace.baseResume, "", true);
      setWorkspaceStatus("Saved.");
    } catch (error) {
      setWorkspaceStatus(error instanceof Error ? error.message : "Base resume save failed.");
    } finally {
      setIsSavingBaseResume(false);
    }
  }

  async function removeBaseResume() {
    if (!baseResumeName) return;
    // Destructive + irreversible-looking action: confirm first. The server keeps
    // a timestamped backup in .trash, so this is recoverable, but a stray click
    // shouldn't wipe a base resume.
    if (
      !(await confirm({
        title: "Remove base resume?",
        message: `Remove the base resume "${baseResumeName}"? A backup is kept in job-search-workspace/.trash, and the resume text stays in the editor.`,
        confirmLabel: "Remove",
        tone: "danger"
      }))
    )
      return;
    setIsSavingBaseResume(true);
    setWorkspaceStatus("Removing the base resume from the local workspace…");
    try {
      const response = await fetch("/api/workspace/base-resume", { method: "DELETE" });
      const workspace = (await response.json()) as Partial<JobWorkspace> & { error?: string };
      if (!response.ok) throw new Error(workspace.error ?? "Base resume removal failed.");
      updateWorkspaceState({
        path: workspace.path ?? workspacePath,
        baseResume: workspace.baseResume ?? { exists: false },
        baseResumeOptions: workspace.baseResumeOptions,
        baseResumeHistory: workspace.baseResumeHistory,
        files: workspace.files ?? workspaceFiles
      });
      // Detach the file from the editor so the resume text is editable again,
      // but keep the current text so the user doesn't lose their draft.
      saveLastBaseResumeName("");
      setFileName("");
      setFileStatus("");
      setWorkspaceStatus("Removed the base resume (backup saved in .trash). Save again to set a new one.");
    } catch (error) {
      setWorkspaceStatus(error instanceof Error ? error.message : "Base resume removal failed.");
    } finally {
      setIsSavingBaseResume(false);
    }
  }

  async function restoreBaseResume(key: string) {
    if (resumeEdited) {
      if (!(await confirmReplaceEditor())) return;
      clearAutosaveDraft();
      setPendingAutosaveDraft(null);
    }
    setIsSavingBaseResume(true);
    setWorkspaceStatus("Restoring from history…");
    try {
      const response = await fetch("/api/workspace/base-resume/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key })
      });
      const workspace = (await response.json()) as Partial<JobWorkspace> & {
        baseResume?: WorkspaceBaseResume;
        baseResumeHistory?: BaseResumeHistoryGroup[];
        error?: string;
      };
      if (!response.ok || !workspace.baseResume) {
        throw new Error(workspace.error ?? "Restore failed.");
      }
      updateWorkspaceState({
        path: workspace.path ?? workspacePath,
        baseResume: workspace.baseResume,
        baseResumeOptions: workspace.baseResumeOptions,
        baseResumeHistory: workspace.baseResumeHistory,
        files: workspace.files ?? workspaceFiles
      });
      await applyWorkspaceBaseResume(workspace.baseResume, "", true); // confirmed above
      setWorkspaceStatus("Restored.");
    } catch (error) {
      setWorkspaceStatus(error instanceof Error ? error.message : "Restore failed.");
    } finally {
      setIsSavingBaseResume(false);
    }
  }

  async function saveCurrentAsBaseResume() {
    const targetName = baseResumeName || fileName || "base-resume.txt";
    let text = currentResumeText || resumeText;

    if (/\.tex$/i.test(targetName) && editedResume) {
      setIsSavingBaseResume(true);
      setWorkspaceStatus("Rendering current resume to LaTeX before saving…");
      try {
        text = await renderTexFromSchema(toTemplateSchema(editedResume), selectedTemplateId, {
          docStyle: docStyle.style
        });
      } catch (error) {
        setWorkspaceStatus(error instanceof Error ? error.message : "Current resume could not be rendered to LaTeX.");
        setIsSavingBaseResume(false);
        return;
      }
    }

    await saveBaseResume({ fileName: targetName, text });
  }

  async function loadBaseResumeVersion(fileName: string) {
    if (resumeEdited) {
      if (!(await confirmReplaceEditor())) return;
      clearAutosaveDraft();
      setPendingAutosaveDraft(null);
    }
    setIsSavingBaseResume(true);
    setWorkspaceStatus("Loading base resume version…");
    try {
      const response = await fetch("/api/workspace/base-resume/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName })
      });
      const workspace = (await response.json()) as Partial<JobWorkspace> & {
        baseResume?: WorkspaceBaseResume;
        error?: string;
      };
      if (!response.ok || !workspace.baseResume) {
        throw new Error(workspace.error ?? "Base resume load failed.");
      }
      updateWorkspaceState({
        path: workspace.path ?? workspacePath,
        baseResume: workspace.baseResume,
        baseResumeOptions: workspace.baseResumeOptions,
        baseResumeHistory: workspace.baseResumeHistory,
        files: workspace.files ?? workspaceFiles
      });
      await applyWorkspaceBaseResume(workspace.baseResume, "", true); // confirmed above
      setWorkspaceStatus("");
    } catch (error) {
      setWorkspaceStatus(error instanceof Error ? error.message : "Base resume load failed.");
    } finally {
      setIsSavingBaseResume(false);
    }
  }

  async function handleFileUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (resumeEdited) {
      // Capture the input element before the await — the synthetic event may be
      // recycled by React and event.target will be null after an async boundary.
      const input = event.target;
      if (!(await confirmReplaceEditor())) {
        // Reset the file input so the same file can be chosen again later.
        input.value = "";
        return;
      }
      clearAutosaveDraft();
      setPendingAutosaveDraft(null);
    }

    setFileName(file.name);
    setFileError("");
    setFileStatus("");
    // Clear any stale "Load a resume before polishing." guard — uploading is
    // exactly the action that resolves it.
    setPolishStatus("");
    setResult(null);
    applyCoverLetter("");

    if (/\.pdf$/i.test(file.name)) {
      setFileError(
        "PDF uploads are text-only and cannot preserve layout. Upload the original DOCX or TEX for format-preserving edits, or paste extracted PDF text."
      );
      return;
    }

    if (/\.docx$/i.test(file.name)) {
      try {
        const base64 = arrayBufferToBase64(await file.arrayBuffer());
        const response = await fetch("/api/import-resume-docx", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ docxBase64: base64 })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "DOCX import failed.");
        setResumeText(String(data.text ?? ""));
        seedResumeEditor(String(data.text ?? ""), "");
        setFileStatus("DOCX parsed into the editor.");
      } catch (error) {
        setFileError(
          error instanceof Error ? error.message : "DOCX import failed. Try saving the resume from Word as a fresh DOCX."
        );
      }
      return;
    }

    if (/\.tex$/i.test(file.name)) {
      // Keep the raw LaTeX as the working text so AI rewrites can preserve it in
      // place as .tex; parse it into the structured editor for interactive edits.
      const texText = await file.text();
      // The local parser bounds input at 200 KB (resumeData.ts MAX_LATEX_INPUT); a
      // larger file would parse to an empty editor while claiming success — surface it.
      if (texText.length > 200_000) {
        setFileError("This .tex file is too large to parse locally (over 200 KB). Paste the resume content directly instead.");
        return;
      }
      setResumeText(texText);
      seedResumeEditor(texText, "");
      setFileStatus("LaTeX source loaded and parsed into the editor. Export as .tex or compile with Tectonic.");
      return;
    }

    if (!/\.(txt|md|csv)$/i.test(file.name)) {
      setFileError("Upload DOCX or TEX for format-preserving edits, or TXT, MD, or CSV for text-only polishing.");
      return;
    }

    try {
      const text = await file.text();
      setResumeText(text);
      seedResumeEditor(text, "");
      setFileStatus("Text file loaded. Export uses the clean ATS PDF template or any LaTeX template.");
    } catch {
      setFileError("The file could not be read. Try pasting the resume text instead.");
    }
  }

  return {
    // workspacePath/workspaceFiles/saveBaseResume are consumed only inside this
    // hook (updateWorkspaceState's `?? workspacePath`/`?? workspaceFiles`
    // fallbacks, saveCurrentAsBaseResume's saveBaseResume call) — nothing in App
    // reads them directly, so they stay off the returned surface.
    baseResumeName,
    baseResumeOptions,
    baseResumeHistory,
    workspaceStatus,
    isSavingBaseResume,
    loadWorkspace,
    removeBaseResume,
    restoreBaseResume,
    saveCurrentAsBaseResume,
    loadBaseResumeVersion,
    handleFileUpload
  };
}
