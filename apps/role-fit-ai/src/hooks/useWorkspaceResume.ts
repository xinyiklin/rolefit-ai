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
 * editor, export status, autosave draft, dialogs) stays owned by App and
 * arrives via args, mirroring usePolishPipeline's pattern.
 */
import { useState } from "react";
import type { ChangeEvent } from "react";
import type { ConfirmOptions } from "./useDialog";
import type { AutosavedDraft } from "./useAutosaveDraft";
import { loadLastBaseResumeName, saveLastBaseResumeName } from "../lib/baseResumePrefs";
import { serializeResumeData, type ResumeData } from "../lib/resumeData";
import { parseResumeFile, serializeResumeFile } from "../lib/resumeFile";
import type { PolishedResume } from "../resumeEngine";

export type WorkspaceBaseResume = {
  exists: boolean;
  fileName?: string;
  label?: string;
  kind?: string;
  text?: string;
  paragraphs?: number;
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
  setExportStatus: (value: string) => void;
  clearAutosaveDraft: () => void;
  setPendingAutosaveDraft: (draft: AutosavedDraft | null) => void;
  // Seeds the structured editor directly from a ResumeData object (bypasses
  // the plain-text parser) — used when loading a `.resume` file, whose
  // content is already the structured model.
  seedResumeData: (data: ResumeData | null) => void;
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
  setExportStatus,
  clearAutosaveDraft,
  setPendingAutosaveDraft,
  seedResumeData,
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
  // This is the one-shot startup check, not a generic loading flag. It begins
  // true so the first paint does not claim the workspace is empty, then only
  // ever settles to false. Explicit Reload actions keep the current editor on
  // screen while their request runs.
  const [isWorkspaceBootstrapping, setIsWorkspaceBootstrapping] = useState(true);

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
    setFileName(baseResume.fileName ?? "base-resume");
    setBaseResumeName(baseResume.fileName ?? "");
    setResult(null);
    applyCoverLetter("");
    setFileError("");
    setPolishStatus("");
    resetExportStatuses();
    setExportStatus("");
    // A `.resume` base is a lossless structured save — parse it and seed the
    // editor directly from the ResumeData (mirrors restoring a tracked
    // application's resumeData) rather than round-tripping through the
    // plain-text parser.
    if (baseResume.kind === "resume") {
      try {
        const parsed = parseResumeFile(baseResume.text);
        setResumeText(serializeResumeData(parsed));
        seedResumeData(parsed);
      } catch (error) {
        setFileStatus(error instanceof Error ? error.message : "This .resume file could not be read.");
        return;
      }
    } else {
      // Make the loaded base resume editable straight away (pre-polish).
      setResumeText(baseResume.text);
      seedResumeEditor(baseResume.text, "");
    }
    setFileStatus(status);
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
          // The bundled starter is a `.resume` envelope (kind "resume"); parse
          // it structurally, exactly like a saved base resume. Falling through to
          // the plain-text seeder would render the raw JSON as resume content.
          const starterText = workspace.baseResume.text;
          try {
            if (workspace.baseResume.kind === "resume") {
              const parsed = parseResumeFile(starterText);
              setResumeText(serializeResumeData(parsed));
              seedResumeData(parsed);
            } else {
              setResumeText(starterText);
              seedResumeEditor(starterText, "");
            }
            setFileStatus("Loaded the starter template. Replace it with your own resume to get started.");
          } catch {
            // Corrupt bundled starter — leave the editor empty rather than seed
            // garbage; the workspace status still guides the user to add a resume.
          }
        }
      }
    } catch (error) {
      setWorkspaceStatus(error instanceof Error ? error.message : "Local workspace could not be checked.");
    } finally {
      setIsWorkspaceBootstrapping(false);
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
    let targetName = baseResumeName || fileName || "base-resume.txt";
    // A `.resume`-named base saves the lossless structured JSON. If we only have
    // plain text (no structured model yet — e.g. a text-only polish result),
    // retarget to `.txt` so we never write non-JSON into a `.resume` file, which
    // would fail to parse on reload.
    let text: string;
    if (/\.resume$/i.test(targetName)) {
      if (editedResume) {
        text = serializeResumeFile(editedResume);
      } else {
        targetName = targetName.replace(/\.resume$/i, ".txt");
        text = currentResumeText || resumeText;
      }
    } else {
      text = currentResumeText || resumeText;
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
        "PDF uploads are text-only and cannot preserve layout. Upload a .resume file for format-preserving edits, or paste extracted PDF text."
      );
      return;
    }

    if (/\.resume$/i.test(file.name)) {
      // A `.resume` file is the lossless structured save — parse it straight
      // into the editor's ResumeData (ids are remapped on load, see resumeFile.ts).
      try {
        const text = await file.text();
        const parsed = parseResumeFile(text);
        setResumeText(serializeResumeData(parsed));
        seedResumeData(parsed);
        setFileStatus(".resume file loaded into the editor.");
      } catch (error) {
        setFileError(error instanceof Error ? error.message : "This .resume file could not be read.");
      }
      return;
    }

    if (!/\.(txt|md|csv)$/i.test(file.name)) {
      setFileError("Upload a .resume file to restore a saved editor state, or TXT, MD, or CSV for text-only polishing.");
      return;
    }

    try {
      const text = await file.text();
      setResumeText(text);
      seedResumeEditor(text, "");
      setFileStatus("Text file loaded. Export as PDF, or save as .resume to keep editing it later.");
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
    isWorkspaceBootstrapping,
    loadWorkspace,
    removeBaseResume,
    restoreBaseResume,
    saveCurrentAsBaseResume,
    loadBaseResumeVersion,
    handleFileUpload
  };
}
