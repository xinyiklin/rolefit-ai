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
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type { ResumeData } from "@typeset/engine/lib/resumeData.ts";
import { DOC_STYLE_DEFAULTS, toDocumentStyle } from "@typeset/engine/lib/documentStyle.ts";
import { parseResumeFile, serializeResumeFile } from "@typeset/engine/lib/resumeFile.ts";
import type { DocStyleControls } from "@typeset/editor/hooks/useDocStyle.ts";
import type { ConfirmOptions } from "./useDialog";
import { loadLastBaseResumeName, saveLastBaseResumeName } from "../lib/baseResumePrefs.ts";
import { serializeResumeData } from "../lib/resumeText.ts";
import type { PolishedResume } from "../resumeEngine";
import type { VariantCandidate } from "../lib/variantRecommendation";
import { fetchBaseResumeCandidates } from "../lib/baseResumeWorkspaceRepository.ts";
// The document's origin is a domain fact about the resume, not workspace
// plumbing; it lives beside the resolution rules that consume it.
import type { PreparedResumeAdoption, ResumeOrigin } from "../lib/preparedResume.ts";
export type { ResumeOrigin };
import { createBlankResumeData } from "../lib/blankResume.ts";

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
  starterResume?: WorkspaceBaseResume;
  baseResumeOptions?: BaseResumeOption[];
  baseResumeHistory?: BaseResumeHistoryGroup[];
  files: string[];
};

type PreparedResumeCandidate =
  | {
      kind: "resume";
      parsed: ReturnType<typeof parseResumeFile>;
    }
  | {
      kind: "text";
      text: string;
    };

type UploadFileLike = {
  name: string;
  text: () => Promise<string>;
};

export type DocumentReplacementGuard = {
  isDirtyNow: () => boolean;
  currentVersion: () => string;
  confirmReplacement: () => Promise<boolean>;
  onReplacementCommitted: () => void;
};

function prepareResumeText(text: string, structured: boolean): PreparedResumeCandidate {
  return structured ? { kind: "resume", parsed: parseResumeFile(text) } : { kind: "text", text };
}

/** Validate the extension and fully read/parse an upload without mutating UI state. */
export async function prepareResumeUpload(file: UploadFileLike): Promise<PreparedResumeCandidate> {
  if (/\.pdf$/i.test(file.name)) {
    throw new Error(
      "PDF uploads are text-only and cannot preserve layout. Upload a .resume file for format-preserving edits, or paste extracted PDF text."
    );
  }
  const structured = /\.resume$/i.test(file.name);
  if (!structured && !/\.(txt|md|csv)$/i.test(file.name)) {
    throw new Error("Upload a .resume file to restore a saved editor state, or TXT, MD, or CSV for text-only polishing.");
  }

  let text: string;
  try {
    text = await file.text();
  } catch {
    throw new Error("The file could not be read. Try pasting the resume text instead.");
  }
  return prepareResumeText(text, structured);
}

type UseWorkspaceResumeArgs = {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  replacementGuard: DocumentReplacementGuard;
  seedResumeEditor: (text: string, sourceText?: string) => void;
  fileName: string;
  setResumeText: (text: string) => void;
  setFileName: (name: string) => void;
  setDocumentTitle: (title: string) => void;
  setResult: (updater: PolishedResume | null | ((prev: PolishedResume | null) => PolishedResume | null)) => void;
  resetCoverWorkflow: () => void;
  setFileError: (value: string) => void;
  setFileStatus: (value: string) => void;
  setPolishStatus: (value: string) => void;
  resetExportStatuses: () => void;
  setExportStatus: (value: string) => void;
  // Seeds the structured editor directly from a ResumeData object (bypasses
  // the plain-text parser) — used when loading a `.resume` file, whose
  // content is already the structured model.
  seedResumeData: (data: ResumeData) => void;
  // What the document in the editor actually is. App owns it because the one
  // transition this hook cannot see — restoring a tracked application — seeds
  // the editor directly; every workspace path below reports its own origin.
  setResumeOrigin: (origin: ResumeOrigin) => void;
  currentResumeText: string;
  resumeText: string;
  editedResume: ResumeData;
  docStyle: DocStyleControls;
};

export function useWorkspaceResume({
  confirm,
  replacementGuard,
  seedResumeEditor,
  fileName,
  setResumeText,
  setFileName,
  setDocumentTitle,
  setResult,
  resetCoverWorkflow,
  setFileError,
  setFileStatus,
  setPolishStatus,
  resetExportStatuses,
  setExportStatus,
  seedResumeData,
  setResumeOrigin,
  currentResumeText,
  resumeText,
  editedResume,
  docStyle
}: UseWorkspaceResumeArgs) {
  const [workspacePath, setWorkspacePath] = useState("");
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);
  const [baseResumeName, setBaseResumeName] = useState("");
  const [baseResumeOptions, setBaseResumeOptions] = useState<BaseResumeOption[]>([]);
  const [baseResumeHistory, setBaseResumeHistory] = useState<BaseResumeHistoryGroup[]>([]);
  // A revision counter, not rendered state: every authoritative snapshot makes
  // the cached candidate bytes stale, and nothing re-renders on that fact.
  const baseResumeCandidatesRevisionRef = useRef(0);
  const baseResumeCandidateCacheRef = useRef<{ key: string; candidates: VariantCandidate[] } | null>(null);
  const [workspaceStatus, setWorkspaceStatus] = useState("");
  const [isSavingBaseResume, setIsSavingBaseResume] = useState(false);
  const workspaceLoadGenerationRef = useRef(0);
  // This is the one-shot startup check, not a generic loading flag. It begins
  // true so the first paint does not claim the workspace is empty, then only
  // ever settles to false. Explicit Reload actions keep the current editor on
  // screen while their request runs.
  const [isWorkspaceBootstrapping, setIsWorkspaceBootstrapping] = useState(true);
  // Callers that must not mistake "still hydrating" for "no resume" await this
  // instead of sampling the boolean: an extension import can reach Prepare
  // before the mount load returns, and a boolean read at that instant is a lie.
  const workspaceBootstrapSettledRef = useRef<{ promise: Promise<void>; settle: () => void }>(null!);
  if (!workspaceBootstrapSettledRef.current) {
    let settle!: () => void;
    const promise = new Promise<void>((resolve) => {
      settle = resolve;
    });
    workspaceBootstrapSettledRef.current = { promise, settle };
  }
  const whenWorkspaceBootstrapped = useCallback(
    () => workspaceBootstrapSettledRef.current.promise,
    []
  );
  // Settled from an EFFECT, never from loadWorkspace's own finally. Resolving
  // there put the callback's microtask ahead of React's commit, so a caller
  // that awaited this promise read the state ref as it was BEFORE hydration —
  // origin "blank", an empty document — and concluded there was no resume. The
  // effect runs after the commit that publishes those values, so awaiting this
  // means the hydrated document is actually readable.
  const [bootstrapResolved, setBootstrapResolved] = useState(false);
  useEffect(() => {
    if (bootstrapResolved) workspaceBootstrapSettledRef.current.settle();
  }, [bootstrapResolved]);
  const detachBaseResumeIdentity = useCallback(() => {
    setBaseResumeName("");
    saveLastBaseResumeName("");
  }, []);

  async function approveCurrentReplacement(
    approvedVersion?: string
  ): Promise<string | null> {
    const version = replacementGuard.currentVersion();
    if (!replacementGuard.isDirtyNow() || version === approvedVersion) return version;
    if (!(await replacementGuard.confirmReplacement())) return null;

    // A dialog is normally modal, but the guard is also used after network/file
    // awaits. If the document changed while approval was pending, approve the
    // state that will actually be replaced rather than the captured render.
    const afterApproval = replacementGuard.currentVersion();
    return replacementGuard.isDirtyNow() && afterApproval !== version
      ? approveCurrentReplacement()
      : afterApproval;
  }

  async function applyWorkspaceBaseResume(
    baseResume: WorkspaceBaseResume,
    status: string,
    approvedVersion?: string,
    skipGuard = false,
    clearRecoveryOnCommit = false,
    shouldCancel?: () => boolean
  ): Promise<{ text: string } | null> {
    if (!baseResume.exists || !baseResume.text) return null;

    let candidate: PreparedResumeCandidate;
    try {
      candidate = prepareResumeText(baseResume.text, baseResume.kind === "resume");
    } catch (error) {
      setFileStatus(error instanceof Error ? error.message : "This .resume file could not be read.");
      return null;
    }

    if (shouldCancel?.()) return null;

    if (!skipGuard) {
      const approved = await approveCurrentReplacement(approvedVersion);
      if (approved === null) return null;
      approvedVersion = approved;

      // This is the final await-free commit boundary. Re-read the live version
      // here so a response that began while clean cannot replace edits made
      // while it was in flight.
      if (
        replacementGuard.isDirtyNow() &&
        replacementGuard.currentVersion() !== approvedVersion
      ) {
        const refreshedApproval = await approveCurrentReplacement();
        if (refreshedApproval === null) return null;
      }
      clearRecoveryOnCommit ||= replacementGuard.isDirtyNow();
    }
    if (shouldCancel?.()) return null;

    // Validation and any required confirmation have both succeeded. Recovery
    // data is superseded only at this commit boundary, never while a file is
    // still unread, malformed, or awaiting user confirmation.
    if (clearRecoveryOnCommit) {
      replacementGuard.onReplacementCommitted();
    }

    saveLastBaseResumeName(baseResume.fileName ?? "");
    setFileName(baseResume.fileName ?? "default");
    setBaseResumeName(baseResume.fileName ?? "");
    setResult(null);
    resetCoverWorkflow();
    setFileError("");
    setPolishStatus("");
    resetExportStatuses();
    setExportStatus("");
    // A `.resume` base is a lossless structured save. It was parsed above,
    // before this commit began, so malformed content cannot partially replace
    // file identity, editor state, AI output, or recovery state.
    if (candidate.kind === "resume") {
      setResumeText(serializeResumeData(candidate.parsed.data));
      seedResumeData(candidate.parsed.data);
      docStyle.replaceDocumentStyle(candidate.parsed.documentStyle);
    } else {
      // Make the loaded base resume editable straight away (pre-polish).
      setResumeText(candidate.text);
      seedResumeEditor(candidate.text, "");
    }
    setFileStatus(status);
    return {
      text: candidate.kind === "resume" ? serializeResumeData(candidate.parsed.data) : candidate.text
    };
  }

  function updateWorkspaceState(workspace: JobWorkspace) {
    setWorkspacePath(workspace.path);
    setWorkspaceFiles(workspace.files ?? []);
    setBaseResumeName(workspace.baseResume?.exists ? workspace.baseResume.fileName ?? "" : "");
    setBaseResumeOptions(workspace.baseResumeOptions ?? []);
    // Names alone cannot reveal that an existing variant was overwritten or
    // restored. Advance the recommendation key for every authoritative
    // workspace snapshot so Prepare re-reads the actual saved bytes.
    baseResumeCandidatesRevisionRef.current += 1;
    baseResumeCandidateCacheRef.current = null;
    // Only overwrite history when the response actually carries it. A partial
    // response (e.g. a caller that forgets the field) must not silently wipe the
    // Recent list — that was the "history disappears on save" bug.
    if (workspace.baseResumeHistory !== undefined) setBaseResumeHistory(workspace.baseResumeHistory);
  }

  async function loadWorkspace(applyBaseResume = false) {
    const generation = workspaceLoadGenerationRef.current + 1;
    workspaceLoadGenerationRef.current = generation;
    try {
      const response = await fetch("/api/workspace");
      const workspace = (await response.json()) as JobWorkspace & { error?: string };
      if (!response.ok) throw new Error(workspace.error ?? "Workspace check failed.");
      if (generation !== workspaceLoadGenerationRef.current) return;

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
            await loadBaseResumeVersion(rememberedName, false);
            return;
          }
          if (rememberedName && !rememberedExists) {
            saveLastBaseResumeName("");
          }
          setWorkspaceStatus("");
          if (await applyWorkspaceBaseResume(workspace.baseResume, "")) setResumeOrigin("saved");
          return;
        }
        setWorkspaceStatus("");
      } else {
        saveLastBaseResumeName("");
        // No ambient instruction here: it rendered as a permanent two-line
        // sentence at the bottom of the Save menu, restating what that menu's
        // own "Save as default base" row already says at the point of action.
        setWorkspaceStatus("");
        if (applyBaseResume && workspace.baseResume?.text) {
          // The bundled starter is a `.resume` envelope (kind "resume"); parse
          // it structurally, exactly like a saved base resume. Falling through to
          // the plain-text seeder would render the raw JSON as resume content.
          const starterText = workspace.baseResume.text;
          try {
            if (workspace.baseResume.kind === "resume") {
              const parsed = parseResumeFile(starterText);
              setResumeText(serializeResumeData(parsed.data));
              seedResumeData(parsed.data);
              docStyle.replaceDocumentStyle(parsed.documentStyle);
            } else {
              setResumeText(starterText);
              seedResumeEditor(starterText, "");
            }
            setResumeOrigin("starter");
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
      // Only the startup load answers "which resume is loaded", and only while
      // it is still the current one — a superseded run (Strict Mode's double
      // mount, a Reload that overtook it) has applied nothing and must not
      // release a waiter onto its empty result. Batched with the document
      // updates above, so one commit publishes both; the effect above turns
      // that commit into the resolved promise. Set on failure too: an
      // unreachable workspace is a terminal answer, not a reason to wait.
      if (applyBaseResume && generation === workspaceLoadGenerationRef.current) {
        setBootstrapResolved(true);
      }
    }
  }

  async function loadStarterTemplate() {
    try {
      const response = await fetch("/api/workspace");
      const workspace = (await response.json()) as JobWorkspace & { error?: string };
      if (!response.ok) throw new Error(workspace.error ?? "Starter template could not be loaded.");
      if (!workspace.starterResume?.text) {
        throw new Error("The bundled starter template is unavailable.");
      }

      const applied = await applyWorkspaceBaseResume(
        workspace.starterResume,
        "Starter template opened. Replace its sample content with your own experience.",
        undefined,
        false,
        true
      );
      if (!applied) return;
      setResumeOrigin("starter");
      saveLastBaseResumeName("");
      setBaseResumeName("");
      updateWorkspaceState(workspace);
      // The starter is intentionally detached from any saved base. Saving it
      // next creates the default base or a named variant instead of silently
      // overwriting whichever base happened to be active before this action.
      setBaseResumeName("");
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "Starter template could not be loaded.");
    }
  }

  async function startBlankResume() {
    const approvedVersion = await approveCurrentReplacement();
    if (approvedVersion === null) return;
    if (
      replacementGuard.isDirtyNow() &&
      replacementGuard.currentVersion() !== approvedVersion
    ) {
      return;
    }

    // Every state change happens at one await-free commit boundary. Saved
    // workspace files are deliberately untouched.
    replacementGuard.onReplacementCommitted();
    detachBaseResumeIdentity();
    setResumeOrigin("blank");
    setFileName("");
    setDocumentTitle("Resume");
    setResumeText("");
    setResult(null);
    resetCoverWorkflow();
    setFileError("");
    setFileStatus("");
    setWorkspaceStatus("");
    setPolishStatus("");
    resetExportStatuses();
    setExportStatus("");
    seedResumeData(createBlankResumeData());
    docStyle.replaceDocumentStyle(toDocumentStyle(DOC_STYLE_DEFAULTS));
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

      // Save preserves the user's work, so no replace confirmation is needed.
      // Validate the server-returned file and commit it before clearing the
      // autosave that is now persisted in the workspace.
      const applied = await applyWorkspaceBaseResume(
        workspace.baseResume,
        "",
        undefined,
        true,
        true
      );
      if (!applied) {
        setWorkspaceStatus("Saved the base resume, but its returned file could not be loaded. The current editor was kept.");
        return;
      }
      // Saving is exactly the act that turns a starter or an upload into the
      // applicant's own base resume.
      setResumeOrigin("saved");
      updateWorkspaceState({
        path: workspace.path ?? workspacePath,
        baseResume: workspace.baseResume,
        baseResumeOptions: workspace.baseResumeOptions,
        baseResumeHistory: workspace.baseResumeHistory,
        files: workspace.files ?? workspaceFiles
      });
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
        message: `Remove the base resume "${baseResumeName}"? A backup is kept in the local workspace's .trash folder, and the resume text stays in the editor.`,
        confirmLabel: "Remove",
        tone: "danger"
      }))
    )
      return;
    setIsSavingBaseResume(true);
    setWorkspaceStatus("Removing the base resume from the local workspace…");
    try {
      const response = await fetch("/api/workspace/base-resume", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: baseResumeName })
      });
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
      setBaseResumeName("");
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
    const approvedVersion = await approveCurrentReplacement();
    if (approvedVersion === null) return;
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
      const applied = await applyWorkspaceBaseResume(
        workspace.baseResume,
        "",
        approvedVersion,
        false,
        true
      );
      if (!applied) {
        setWorkspaceStatus("The restored base resume could not be loaded. The current editor was kept.");
        return;
      }
      setResumeOrigin("saved");
      updateWorkspaceState({
        path: workspace.path ?? workspacePath,
        baseResume: workspace.baseResume,
        baseResumeOptions: workspace.baseResumeOptions,
        baseResumeHistory: workspace.baseResumeHistory,
        files: workspace.files ?? workspaceFiles
      });
      setWorkspaceStatus("Restored.");
    } catch (error) {
      setWorkspaceStatus(error instanceof Error ? error.message : "Restore failed.");
    } finally {
      setIsSavingBaseResume(false);
    }
  }

  async function saveCurrentAsBaseResume(targetFileName?: string) {
    if (isWorkspaceBootstrapping) return;
    const targetName = targetFileName || baseResumeName || fileName || "default.resume";
    // RoleFit always has a structured model, so a detached document defaults to
    // the strict editable format. Explicit text-file identities stay text.
    const text = /\.resume$/i.test(targetName)
      ? serializeResumeFile(editedResume, docStyle.style)
      : currentResumeText || resumeText;

    await saveBaseResume({ fileName: targetName, text });
  }

  async function loadBaseResumeVersion(
    fileName: string,
    clearRecoveryOnCommit = true,
    shouldCancel?: () => boolean
  ): Promise<PreparedResumeAdoption | null> {
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
      const applied = await applyWorkspaceBaseResume(
        workspace.baseResume,
        "",
        undefined,
        false,
        clearRecoveryOnCommit,
        shouldCancel
      );
      if (!applied) {
        if (shouldCancel?.()) {
          setWorkspaceStatus("");
        } else {
          setWorkspaceStatus("The selected base resume could not be loaded. The current editor was kept.");
        }
        return null;
      }
      setResumeOrigin("saved");
      updateWorkspaceState({
        path: workspace.path ?? workspacePath,
        baseResume: workspace.baseResume,
        baseResumeOptions: workspace.baseResumeOptions,
        baseResumeHistory: workspace.baseResumeHistory,
        files: workspace.files ?? workspaceFiles
      });
      setWorkspaceStatus("");
      const adoptedFileName = workspace.baseResume.fileName ?? "";
      const adoptedLabel = workspace.baseResumeOptions?.find((option) => option.fileName === adoptedFileName)?.label
        ?? workspace.baseResume.label
        ?? adoptedFileName;
      return {
        fileName: adoptedFileName,
        label: adoptedLabel,
        text: applied.text
      };
    } catch (error) {
      setWorkspaceStatus(error instanceof Error ? error.message : "Base resume load failed.");
      return null;
    } finally {
      setIsSavingBaseResume(false);
    }
  }

  // Read every saved variant without adopting any of them into the editor.
  // Prepare uses this snapshot only for deterministic recommendation; the
  // existing guarded load path remains the sole document-replacement owner.
  // Results are cached against the authoritative candidate revision, so
  // resolving and then displaying the same ranking costs one request in total.
  const readBaseResumeCandidates = useCallback(
    async (options: BaseResumeOption[]): Promise<VariantCandidate[]> => {
      const fileNames = [...new Set(options.map((option) => option.fileName).filter(Boolean))];
      if (!fileNames.length) return [];
      const cacheKey = `${baseResumeCandidatesRevisionRef.current}|${[...fileNames].sort().join(",")}`;
      const cached = baseResumeCandidateCacheRef.current;
      if (cached?.key === cacheKey) return cached.candidates;

      const candidates = await fetchBaseResumeCandidates(options);
      baseResumeCandidateCacheRef.current = { key: cacheKey, candidates };
      return candidates;
    },
    []
  );
  const readBaseResumeCandidatesRevision = useCallback(
    () => baseResumeCandidatesRevisionRef.current,
    []
  );

  async function handleFileUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    // Capture the input before any await — React may recycle the synthetic
    // event, and failed/cancelled selections must be reset so the same path can
    // be chosen again after the file is repaired.
    const input = event.target;

    let candidate: PreparedResumeCandidate;
    try {
      // Preflight extension, read bytes, and strictly parse `.resume` content
      // before confirmation or any state-clearing commit work begins.
      candidate = await prepareResumeUpload(file);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "The file could not be read. Try pasting the resume text instead.");
      input.value = "";
      return;
    }

    const approvedVersion = await approveCurrentReplacement();
    if (approvedVersion === null) {
      // Reset the file input so the same file can be chosen again later.
      input.value = "";
      return;
    }
    if (
      replacementGuard.isDirtyNow() &&
      replacementGuard.currentVersion() !== approvedVersion
    ) {
      input.value = "";
      return;
    }
    replacementGuard.onReplacementCommitted();

    setResumeOrigin("uploaded");
    setFileName(file.name);
    setFileError("");
    setFileStatus("");
    // Clear any stale "Load a resume before polishing." guard — uploading is
    // exactly the action that resolves it.
    setPolishStatus("");
    setResult(null);
    resetCoverWorkflow();

    if (candidate.kind === "resume") {
      // The strict codec already validated and restored fresh session ids at
      // the preflight boundary; this branch is commit-only.
      setResumeText(serializeResumeData(candidate.parsed.data));
      seedResumeData(candidate.parsed.data);
      docStyle.replaceDocumentStyle(candidate.parsed.documentStyle);
      setFileStatus(".resume file loaded into the editor.");
    } else {
      setResumeText(candidate.text);
      seedResumeEditor(candidate.text, "");
      setFileStatus("Text file loaded. Export as PDF, or save as .resume to keep editing it later.");
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
    whenWorkspaceBootstrapped,
    loadWorkspace,
    loadStarterTemplate,
    startBlankResume,
    removeBaseResume,
    restoreBaseResume,
    saveCurrentAsBaseResume,
    loadBaseResumeVersion,
    readBaseResumeCandidates,
    readBaseResumeCandidatesRevision,
    detachBaseResumeIdentity,
    handleFileUpload
  };
}
