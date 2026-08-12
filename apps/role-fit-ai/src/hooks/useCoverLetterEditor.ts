import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction
} from "react";

import { useResumeEditor as useTypesetResumeEditor } from "@typeset/editor/hooks/useResumeEditor.ts";
import type { DocStyleControls } from "@typeset/editor/hooks/useDocStyle.ts";
import {
  COVER_LETTER_STYLE_DEFAULTS,
  CoverLetterFileError,
  MAX_COVER_LETTER_FILE_BYTES,
  coverLetterFileName,
  coverLetterParagraphs,
  coverLetterPlainText,
  coverLetterResumeData,
  coverLetterStyleToDocumentStyle,
  documentStyleToCoverLetterStyle,
  parseCoverLetterFile,
  parseCoverLetterStyle,
  parseCoverLetterText,
  serializeCoverLetterFile
} from "@typeset/engine/lib/coverLetter.ts";
import { downloadBlob } from "@typeset/engine/lib/download.ts";
import { DOC_STYLE_DEFAULTS, type DocStyle, type DocumentStyle } from "@typeset/engine/lib/documentStyle.ts";
import type { ResumeData } from "@typeset/engine/lib/resumeData.ts";
import { clearCoverLetterAutosaveDraft } from "./useCoverLetterAutosaveDraft";
import {
  coverLetterStartupIsCurrent,
  loadLastCoverLetterName,
  resolveCoverLetterStartup,
  saveLastCoverLetterName
} from "../lib/coverLetterPrefs.ts";
import {
  readCoverLetterVariantCandidates,
  readCoverLetterWorkspace,
  restoreCoverLetterWorkspaceDocument,
  saveCoverLetterWorkspace,
  selectCoverLetterWorkspaceDocument,
  type CoverLetterWorkspaceDocument,
  type CoverLetterHistoryGroup,
  type CoverLetterOption,
  type CoverLetterWorkspaceSnapshot
} from "../lib/coverLetterWorkspaceRepository.ts";
import {
  coverLetterPdfFailureMessage,
  createCoverLetterDocumentUpload,
  renderCoverLetterPdfBytes
} from "../lib/coverLetterExport.ts";
import {
  applyCoverLetterSaveCompletion,
  coverLetterDocumentVersion,
  createCoverLetterReplacementOwnership,
  createCoverLetterSaveOwnership
} from "../lib/coverLetterWorkspaceOwnership.ts";
import { useCoverLetterDocumentIdentity } from "./useCoverLetterDocumentIdentity.ts";
import { useCoverLetterPreTailorSnapshot } from "./useCoverLetterPreTailorSnapshot.ts";

const STYLE_STORAGE_KEY = "rolefit:coverLetterStyle.v1";
const WORKSPACE_REPLACEMENT_PRESERVED_STATUS =
  "The cover letter changed while that workspace version was loading. The current draft was preserved.";
// Spell-check is a view preference: it never enters a .cover file, but it is
// the writer's choice and must survive a reload rather than snapping back on.
const SPELL_CHECK_STORAGE_KEY = "rolefit:coverLetterSpellCheck.v1";
const COVER_LETTER_STARTER = `[Date]

Dear [Hiring manager],

[Name the role and explain, in your own words, why it interests you.]

[Connect one or two verified experiences from your resume to the role. Focus on what you did and the outcome.]

[Explain why this company or team is a fit, using details from the job posting.]

Sincerely,
[Your name]`;

// The starter's header is placeholder text for the same reason its body is:
// a letter opens with the letterhead already in place, ready to be typed over
// rather than added from a menu the writer has to find.
const COVER_LETTER_STARTER_HEADER = {
  visible: true,
  name: "[Your name]",
  contact: ["[email]", "[phone]", "[city, state]"]
};

function loadSpellCheck(): boolean {
  try {
    return window.localStorage.getItem(SPELL_CHECK_STORAGE_KEY) === "on";
  } catch {
    // Storage unavailable: fall back to the default, which is off.
    return DOC_STYLE_DEFAULTS.spellCheck;
  }
}

function loadStyle(): DocStyle {
  const view = { zoom: DOC_STYLE_DEFAULTS.zoom, spellCheck: loadSpellCheck() };
  try {
    const raw = window.localStorage.getItem(STYLE_STORAGE_KEY);
    if (raw) {
      const parsed = parseCoverLetterStyle(JSON.parse(raw) as unknown);
      return coverLetterStyleToDocumentStyle(parsed, view);
    }
  } catch {
    // Corrupt or unavailable browser storage falls back to the professional default.
  }
  return coverLetterStyleToDocumentStyle(COVER_LETTER_STYLE_DEFAULTS, view);
}

type UseCoverLetterEditorOptions = {
  // Fired when a letter is OPENED — a file, a starter, a blank page, a saved
  // variant, a recovery draft, or an application source. The host puts the caret in the
  // document. Deliberately NOT fired for a tailored result: that arrives while
  // the user is reading the review, and taking focus there would interrupt them.
  onOpenDocument?: () => void;
};

type WorkspaceCoverLetterOpenOptions = {
  background?: boolean;
  startup?: boolean;
  shouldCancel?: () => boolean;
  confirmReplace?: () => Promise<boolean>;
};

export function useCoverLetterEditor(options: UseCoverLetterEditorOptions = {}) {
  const [style, setStyle] = useState<DocStyle>(loadStyle);
  const [initialData] = useState(() => parseCoverLetterText(""));
  const [sourceRevision, setSourceRevision] = useState(0);
  const sourceRevisionRef = useRef(0);
  const editor = useTypesetResumeEditor(initialData);
  const onOpenDocumentRef = useRef(options.onOpenDocument);
  onOpenDocumentRef.current = options.onOpenDocument;
  const cancelStartupOpenRef = useRef(false);
  const workspaceReplacementOwnershipRef = useRef<
    ReturnType<typeof createCoverLetterReplacementOwnership> | null
  >(null);
  if (workspaceReplacementOwnershipRef.current === null) {
    workspaceReplacementOwnershipRef.current = createCoverLetterReplacementOwnership();
  }
  const workspaceSaveOwnershipRef = useRef<
    ReturnType<typeof createCoverLetterSaveOwnership> | null
  >(null);
  if (workspaceSaveOwnershipRef.current === null) {
    workspaceSaveOwnershipRef.current = createCoverLetterSaveOwnership();
  }
  const workspaceSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const workspaceSavePendingCountRef = useRef(0);
  const workspaceReplacementCountRef = useRef(0);
  // One-shot readiness for the initial options read and optional saved-letter
  // adoption. An explicit user open resolves startup ownership immediately.
  const [isWorkspaceBootstrapping, setIsWorkspaceBootstrapping] = useState(true);
  const [isWorkspaceReplacing, setIsWorkspaceReplacing] = useState(false);
  const [isWorkspaceSaving, setIsWorkspaceSaving] = useState(false);
  const styleRef = useRef(style);
  styleRef.current = style;
  const text = useMemo(
    () => (editor.editedResume ? coverLetterPlainText(editor.editedResume) : ""),
    [editor.editedResume]
  );
  const currentFingerprint = useMemo(
    () =>
      editor.editedResume
        ? serializeCoverLetterFile(editor.editedResume, documentStyleToCoverLetterStyle(style))
        : null,
    [editor.editedResume, style]
  );
  const currentFingerprintRef = useRef(currentFingerprint);
  currentFingerprintRef.current = currentFingerprint;
  const {
    documentTitle,
    persistedDocumentTitle,
    setDocumentTitle: setDocumentTitleValue,
    dirty,
    recoveryDirty,
    commitPersistenceBaseline,
    capturePersistenceBaselineRevision,
    commitPersistenceBaselineIfUnchanged,
    documentTitleRef,
    documentVersion,
    documentVersionRef
  } = useCoverLetterDocumentIdentity(
    serializeCoverLetterFile(initialData, documentStyleToCoverLetterStyle(style)),
    currentFingerprint
  );
  const setDocumentTitle = useCallback<Dispatch<SetStateAction<string>>>((next) => {
    cancelStartupOpenRef.current = true;
    workspaceReplacementOwnershipRef.current?.invalidate();
    setDocumentTitleValue(next);
  }, [setDocumentTitleValue]);
  const setOutputDocumentTitle = setDocumentTitleValue;
  // The exact serialized `.cover` before a polished proposal is applied is a
  // true one-step replacement undo. Its hook retires the snapshot after any
  // subsequent edit.
  const {
    snapshot: preTailorSnapshot,
    capture: capturePreTailorSnapshot,
    drop: dropPreTailorSnapshot
  } = useCoverLetterPreTailorSnapshot(currentFingerprint);
  // Every user-initiated load goes through here instead of `editor.seedData`,
  // so no open path can forget to move the caret into the new document.
  const openDocument = useCallback(
    (data: ResumeData, automatic = false) => {
      if (!automatic) {
        cancelStartupOpenRef.current = true;
        workspaceReplacementOwnershipRef.current?.invalidate();
        setIsWorkspaceBootstrapping(false);
      }
      editor.seedData(data);
      dropPreTailorSnapshot();
      sourceRevisionRef.current += 1;
      setSourceRevision(sourceRevisionRef.current);
      onOpenDocumentRef.current?.();
    },
    [dropPreTailorSnapshot, editor.seedData]
  );
  const [status, setStatus] = useState("");
  const [isRenderingPdf, setIsRenderingPdf] = useState(false);
  // Workspace-resident cover letters. Cover letters gained the same named
  // variants and version history base resumes have. They live under the
  // cover-letters folder; `activeCoverFileName` is the one Save writes over.
  const [coverLetterOptions, setCoverLetterOptions] = useState<CoverLetterOption[]>([]);
  const [coverLetterHistory, setCoverLetterHistory] = useState<CoverLetterHistoryGroup[]>([]);
  const [coverLetterCandidatesRevision, setCoverLetterCandidatesRevision] = useState(0);
  const [activeCoverFileName, setActiveCoverFileNameState] = useState("");
  const activeCoverFileNameRef = useRef(activeCoverFileName);
  const setActiveCoverFileName = useCallback((fileName: string) => {
    activeCoverFileNameRef.current = fileName;
    setActiveCoverFileNameState(fileName);
  }, []);

  // Saved and historical documents share one pending boundary, including the
  // replacement confirmation. The count keeps overlapping reads from clearing
  // the flag while another replacement still owns it.
  const withWorkspaceReplacement = useCallback(
    async <T,>(transaction: () => Promise<T>) => {
      workspaceReplacementCountRef.current += 1;
      setIsWorkspaceReplacing(true);
      try {
        return await transaction();
      } finally {
        workspaceReplacementCountRef.current -= 1;
        if (workspaceReplacementCountRef.current === 0) setIsWorkspaceReplacing(false);
      }
    },
    []
  );

  // Manual reads keep the revision; writes and automatic opens recheck saved bytes.
  const adoptCoverWorkspaceSnapshot = useCallback((
    snapshot: CoverLetterWorkspaceSnapshot,
    advanceCandidateRevision = true
  ) => {
    setCoverLetterOptions(snapshot.coverLetterOptions ?? []);
    setCoverLetterHistory(snapshot.coverLetterHistory ?? []);
    if (advanceCandidateRevision) {
      setCoverLetterCandidatesRevision((revision) => revision + 1);
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        STYLE_STORAGE_KEY,
        JSON.stringify(documentStyleToCoverLetterStyle(style))
      );
    } catch {
      // Style remains usable in memory when storage is unavailable.
    }
  }, [style]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SPELL_CHECK_STORAGE_KEY, style.spellCheck ? "on" : "off");
    } catch {
      // The in-session preference still applies when storage is unavailable.
    }
  }, [style.spellCheck]);

  const set = useCallback(<K extends keyof DocStyle>(key: K, value: DocStyle[K]) => {
    setStyle((current) => ({ ...current, [key]: value }));
  }, []);

  const applyStyle = useCallback((partial: Partial<DocStyle>) => {
    setStyle((current) => ({ ...current, ...partial }));
  }, []);

  const replaceDocumentStyle = useCallback((documentStyle: DocumentStyle) => {
    setStyle((current) => ({
      ...coverLetterStyleToDocumentStyle(documentStyleToCoverLetterStyle(documentStyle)),
      zoom: current.zoom,
      spellCheck: current.spellCheck
    }));
  }, []);

  const docStyle = useMemo<DocStyleControls>(
    () => ({
      style,
      dirty,
      set,
      applyStyle,
      replaceDocumentStyle,
      markClean: () => undefined,
      saveCustomPreset: () => undefined,
      customPreset: null,
      canUndo: false,
      canRedo: false,
      undoSequence: null,
      redoSequence: null,
      undo: () => undefined,
      redo: () => undefined,
      isStyleDefault:
        JSON.stringify(documentStyleToCoverLetterStyle(style)) ===
        JSON.stringify(COVER_LETTER_STYLE_DEFAULTS)
    }),
    [applyStyle, dirty, replaceDocumentStyle, set, style]
  );

  const loadSourceText = useCallback(
    (source: string, title?: string) => {
      const data = parseCoverLetterText(source);
      openDocument(data);
      editor.markClean();
      const nextTitle = title?.trim() || documentTitle;
      commitPersistenceBaseline(
        serializeCoverLetterFile(data, documentStyleToCoverLetterStyle(styleRef.current)),
        nextTitle
      );
      setActiveCoverFileName("");
      saveLastCoverLetterName("");
      if (title?.trim()) setDocumentTitleValue(nextTitle);
      setStatus("Cover letter loaded. Prepare the job, then Polish this letter.");
    },
    [commitPersistenceBaseline, documentTitle, editor.markClean, openDocument, setDocumentTitleValue]
  );

  // Applying a polished proposal replaces the document in place. Keep the
  // exact prior `.cover` first so one Restore is a true undo.
  const applyTailoredText = useCallback(
    (tailored: string) => {
      cancelStartupOpenRef.current = true;
      const parsed = parseCoverLetterText(tailored);
      const data = editor.editedResume
        ? {
            ...parsed,
            header: editor.editedResume.header
              ? {
                  ...editor.editedResume.header,
                  contact: [...editor.editedResume.header.contact]
                }
              : null
          }
        : parsed;
      capturePreTailorSnapshot(
        editor.editedResume
          ? serializeCoverLetterFile(
              editor.editedResume,
              documentStyleToCoverLetterStyle(styleRef.current)
            )
          : null
      );
      editor.seedData(data);
      setStatus("Polished letter loaded. Read it once before sending.");
    },
    [capturePreTailorSnapshot, editor.editedResume, editor.seedData]
  );

  const restorePreTailor = useCallback(() => {
    if (!preTailorSnapshot) return false;
    try {
      const parsed = parseCoverLetterFile(preTailorSnapshot);
      cancelStartupOpenRef.current = true;
      editor.seedData(parsed.data);
      setStyle((current) => ({
        ...coverLetterStyleToDocumentStyle(parsed.style),
        zoom: current.zoom,
        spellCheck: current.spellCheck
      }));
      dropPreTailorSnapshot();
      setStatus("Restored the letter from before polishing.");
      return true;
    } catch {
      dropPreTailorSnapshot();
      setStatus("The letter from before polishing could not be restored.");
      return false;
    }
  }, [dropPreTailorSnapshot, editor.seedData, preTailorSnapshot]);

  // Adopt a recovered autosave draft. Like the resume's restore it seeds CLEAN:
  // the payload is already the durable copy, so the next real edit is what
  // re-arms autosave and the close guard.
  const openRecoveryDraft = useCallback(
    (payload: string, title: string) => {
      try {
        const parsed = parseCoverLetterFile(payload);
        openDocument(parsed.data);
        editor.markClean();
        setStyle((current) => ({
          ...coverLetterStyleToDocumentStyle(parsed.style),
          zoom: current.zoom,
          spellCheck: current.spellCheck
        }));
        const nextTitle = title.trim() || documentTitle;
        commitPersistenceBaseline(
          serializeCoverLetterFile(parsed.data, parsed.style),
          nextTitle
        );
        // A draft is not the workspace copy, so Save must not offer to overwrite
        // whichever saved letter happened to be open before.
        setActiveCoverFileName("");
        saveLastCoverLetterName("");
        if (title.trim()) setDocumentTitleValue(nextTitle);
        setStatus("Restored the unsaved cover letter.");
        return true;
      } catch {
        setStatus("That recovered cover-letter draft could not be read.");
        return false;
      }
    },
    [commitPersistenceBaseline, documentTitle, editor.markClean, openDocument, setDocumentTitleValue]
  );

  // Open the strict source owned by a tracked application. It is not a
  // workspace variant, so later Save must ask for a destination rather than
  // overwriting whichever variant happened to be active beforehand.
  const openApplicationSource = useCallback(
    (payload: string, title: string) => {
      try {
        const parsed = parseCoverLetterFile(payload);
        openDocument(parsed.data);
        editor.markClean();
        setStyle((current) => ({
          ...coverLetterStyleToDocumentStyle(parsed.style),
          zoom: current.zoom,
          spellCheck: current.spellCheck
        }));
        const nextTitle = title.trim() || documentTitle;
        commitPersistenceBaseline(
          serializeCoverLetterFile(parsed.data, parsed.style),
          nextTitle
        );
        setActiveCoverFileName("");
        saveLastCoverLetterName("");
        if (title.trim()) setDocumentTitleValue(nextTitle);
        setStatus("Loaded the saved application cover letter.");
        return true;
      } catch {
        setStatus("The saved application cover letter could not be read.");
        return false;
      }
    },
    [commitPersistenceBaseline, documentTitle, editor.markClean, openDocument, setDocumentTitleValue]
  );

  const startBlank = useCallback(() => {
    const data = parseCoverLetterText("");
    openDocument(data);
    editor.markClean();
    // A blank letter is the same document the page opens with, so New must not
    // leave it permanently "unsaved" — that warned on close and prompted to
    // replace an empty letter that had nothing to lose.
    commitPersistenceBaseline(
      serializeCoverLetterFile(data, documentStyleToCoverLetterStyle(styleRef.current)),
      "Cover letter"
    );
    setActiveCoverFileName("");
    saveLastCoverLetterName("");
    setDocumentTitleValue("Cover letter");
    setStatus("Blank cover letter ready.");
  }, [commitPersistenceBaseline, editor.markClean, openDocument, setDocumentTitleValue]);

  const startStarter = useCallback(() => {
    const data = coverLetterResumeData(
      coverLetterParagraphs(parseCoverLetterText(COVER_LETTER_STARTER)),
      COVER_LETTER_STARTER_HEADER
    );
    openDocument(data);
    editor.markClean();
    commitPersistenceBaseline(
      serializeCoverLetterFile(data, documentStyleToCoverLetterStyle(styleRef.current)),
      "Cover letter"
    );
    setActiveCoverFileName("");
    saveLastCoverLetterName("");
    setDocumentTitleValue("Cover letter");
    setStatus("Starter opened. Complete the details beside the document before polishing.");
  }, [commitPersistenceBaseline, editor.markClean, openDocument, setDocumentTitleValue]);

  const openFile = useCallback(
    async (file: File) => {
      try {
        if (file.size > MAX_COVER_LETTER_FILE_BYTES) {
          throw new CoverLetterFileError(
            "too-large",
            "This cover-letter file is larger than the 2 MB limit."
          );
        }
        const bytes = await file.arrayBuffer();
        const fileBase = file.name.replace(/\.(?:cover|txt|md)$/i, "").trim();
        if (/\.cover$/i.test(file.name)) {
          const parsed = parseCoverLetterFile(bytes);
          openDocument(parsed.data);
          editor.markClean();
          setStyle((current) => ({
            ...coverLetterStyleToDocumentStyle(parsed.style),
            zoom: current.zoom,
            spellCheck: current.spellCheck
          }));
          const nextTitle = fileBase || "Cover letter";
          commitPersistenceBaseline(
            serializeCoverLetterFile(parsed.data, parsed.style),
            nextTitle
          );
          // An uploaded file is not the workspace copy, so Save must not offer to
          // overwrite whichever saved letter happened to be open before.
          setActiveCoverFileName("");
          saveLastCoverLetterName("");
          setDocumentTitleValue(fileBase || "Cover letter");
          setStatus(`Opened ${file.name}.`);
          return;
        }
        const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        loadSourceText(source, fileBase || "Cover letter");
        setStatus(`Opened ${file.name}.`);
      } catch (error) {
        setStatus(
          error instanceof CoverLetterFileError
            ? error.message
            : "Could not open that cover letter. Use a valid .cover, .txt, or .md file."
        );
      }
    },
    [
      commitPersistenceBaseline,
      editor.markClean,
      loadSourceText,
      openDocument,
      setDocumentTitleValue
    ]
  );

  // Adopt a .cover payload read from the workspace. The variant label identifies
  // the source, not the outgoing application file; preserve the editor title so
  // cover-letter naming follows the same contract as resume variant selection.
  const adoptCoverPayload = useCallback(
    (payload: string, fileName: string, label: string, automatic = false) => {
      const parsed = parseCoverLetterFile(payload);
      openDocument(parsed.data, automatic);
      editor.markClean();
      setStyle((current) => ({
        ...coverLetterStyleToDocumentStyle(parsed.style),
        zoom: current.zoom,
        spellCheck: current.spellCheck
      }));
      const nextTitle =
        documentTitleRef.current.trim() || (label === "Default" ? "Cover letter" : label);
      commitPersistenceBaseline(
        serializeCoverLetterFile(parsed.data, parsed.style),
        nextTitle
      );
      setActiveCoverFileName(fileName);
      saveLastCoverLetterName(fileName);
      setDocumentTitleValue(nextTitle);
    },
    [
      commitPersistenceBaseline,
      documentTitleRef,
      editor.markClean,
      openDocument,
      setDocumentTitleValue
    ]
  );

  const refreshCoverWorkspace = useCallback(async () => {
    const snapshot = await readCoverLetterWorkspace();
    if (!snapshot) return null;
    adoptCoverWorkspaceSnapshot(snapshot);
    return snapshot;
  }, [adoptCoverWorkspaceSnapshot]);

  // Write the current letter into the workspace, either over the active file or
  // as a new named variant. The server archives whatever it replaces.
  const saveToWorkspace = useCallback(
    async (target?: { fileName?: string; variant?: string }): Promise<boolean> => {
      if (!editor.editedResume) {
        setStatus("Open or start a cover letter before saving.");
        return false;
      }
      if (workspaceReplacementCountRef.current > 0 || isWorkspaceBootstrapping) {
        setStatus("Wait for the workspace cover letter to finish loading.");
        return false;
      }
      const payload = serializeCoverLetterFile(
        editor.editedResume,
        documentStyleToCoverLetterStyle(styleRef.current)
      );
      const titleAtSaveStart = documentTitleRef.current;
      const activeFileNameAtSaveStart = activeCoverFileNameRef.current;
      const sourceRevisionAtSaveStart = sourceRevisionRef.current;
      const intendedFileName =
        target?.fileName ?? (target?.variant ? "" : activeFileNameAtSaveStart);
      workspaceSavePendingCountRef.current += 1;
      setIsWorkspaceSaving(true);
      let refreshAfterQueueSettles = false;

      const runSave = async (): Promise<boolean> => {
        const saveOwnership = workspaceSaveOwnershipRef.current;
        if (!saveOwnership) return false;
        // Claims are created when the queued mutation is dispatched, so the
        // server receives saves in invocation order and each response owns its
        // publication window until the next queued mutation begins.
        const persistenceBaselineRevision = capturePersistenceBaselineRevision();
        const saveClaim = saveOwnership.claim({
          payload,
          documentTitle: titleAtSaveStart,
          documentVersion: coverLetterDocumentVersion(payload, titleAtSaveStart),
          persistenceBaselineRevision,
          sourceRevision: sourceRevisionAtSaveStart,
          activeFileName: activeFileNameAtSaveStart,
          intendedFileName
        });
        const currentSaveIdentity = () => ({
          documentVersion: documentVersionRef.current,
          sourceRevision: sourceRevisionRef.current,
          activeFileName: activeCoverFileNameRef.current
        });

        try {
          // `variant` is a LABEL the server slugs; `fileName` is already validated
          // workspace identity. Keeping that distinction here prevents an update
          // from being re-slugged as a new doubly-prefixed variant.
          const data = await saveCoverLetterWorkspace(payload, {
            fileName: intendedFileName || undefined,
            variant: target?.variant
          });
          const completion = saveOwnership.evaluate(
            saveClaim,
            currentSaveIdentity()
          );
          if (completion === "superseded") {
            refreshAfterQueueSettles = true;
            return false;
          }
          applyCoverLetterSaveCompletion({
            completion,
            claim: saveClaim,
            snapshot: data,
            effects: {
              publishSnapshot: adoptCoverWorkspaceSnapshot,
              bindActiveFile: (fileName) => {
                setActiveCoverFileName(fileName);
                saveLastCoverLetterName(fileName);
              },
              markClean: editor.markClean,
              commitBaseline: commitPersistenceBaseline,
              commitBaselineIfUnchanged: commitPersistenceBaselineIfUnchanged,
              clearRecovery: clearCoverLetterAutosaveDraft,
              setStatus
            }
          });
          return true;
        } catch (error) {
          const completion = saveOwnership.evaluate(
            saveClaim,
            currentSaveIdentity()
          );
          if (completion === "superseded") {
            refreshAfterQueueSettles = true;
          } else {
            setStatus(error instanceof Error ? error.message : "Cover letter save failed.");
          }
          return false;
        }
      };

      const queuedSave = workspaceSaveQueueRef.current.then(runSave, runSave);
      workspaceSaveQueueRef.current = queuedSave.then(
        () => undefined,
        () => undefined
      );
      try {
        const saved = await queuedSave;
        if (refreshAfterQueueSettles) {
          // This is defensive: the invocation-order queue should make a
          // superseded save impossible. If ownership is ever invalidated by a
          // future path, append one authoritative read after all queued writes.
          const refresh = workspaceSaveQueueRef.current.then(async () => {
            await refreshCoverWorkspace();
          });
          workspaceSaveQueueRef.current = refresh.then(
            () => undefined,
            () => undefined
          );
          try {
            await refresh;
          } catch {
            setStatus(
              "The cover letter was saved, but the workspace list could not be refreshed."
            );
          }
        }
        return saved;
      } finally {
        workspaceSavePendingCountRef.current -= 1;
        if (workspaceSavePendingCountRef.current === 0) setIsWorkspaceSaving(false);
      }
    },
    [
      adoptCoverWorkspaceSnapshot,
      capturePersistenceBaselineRevision,
      commitPersistenceBaseline,
      commitPersistenceBaselineIfUnchanged,
      documentTitleRef,
      documentVersionRef,
      editor.editedResume,
      editor.markClean,
      isWorkspaceBootstrapping,
      refreshCoverWorkspace,
      setActiveCoverFileName
    ]
  );

  const replaceWorkspaceCoverLetter = useCallback(
    async (
      load: () => Promise<CoverLetterWorkspaceDocument>,
      options: WorkspaceCoverLetterOpenOptions,
      successMessage: (data: CoverLetterWorkspaceDocument) => string,
      fallbackError: string,
      advanceCandidateRevision = true
    ): Promise<boolean> => {
      if (workspaceSavePendingCountRef.current > 0) {
        if (!options.background && !options.startup) {
          setStatus("Wait for the workspace save to finish before opening another letter.");
        }
        return false;
      }
      if (
        options.background &&
        !options.startup &&
        workspaceReplacementCountRef.current > 0
      ) {
        return false;
      }
      return withWorkspaceReplacement(async () => {
        if (options.confirmReplace && !(await options.confirmReplace())) return false;

        // A user-owned saved/history action supersedes startup as soon as its
        // confirmation succeeds, not only after its network response arrives.
        if (!options.background && !options.startup) {
          cancelStartupOpenRef.current = true;
          setIsWorkspaceBootstrapping(false);
        }

        const ownership = workspaceReplacementOwnershipRef.current;
        if (!ownership) return false;
        const currentReplacementVersion = () =>
          options.background
            ? currentFingerprintRef.current ?? ""
            : documentVersionRef.current;
        const claim = ownership.claim(currentReplacementVersion());
        try {
          const data = await load();
          const result = ownership.evaluate(claim, currentReplacementVersion());
          if (result === "document-changed") {
            setStatus(WORKSPACE_REPLACEMENT_PRESERVED_STATUS);
            return false;
          }
          if (
            result !== "current" ||
            options.shouldCancel?.() ||
            (options.startup && cancelStartupOpenRef.current)
          ) {
            return false;
          }

          adoptCoverPayload(
            data.text,
            data.fileName,
            data.label,
            options.background === true
          );
          adoptCoverWorkspaceSnapshot(data, advanceCandidateRevision);
          setStatus(options.background ? "" : successMessage(data));
          return true;
        } catch (error) {
          const result = ownership.evaluate(claim, currentReplacementVersion());
          if (result === "current") {
            setStatus(error instanceof Error ? error.message : fallbackError);
          } else if (result === "document-changed") {
            setStatus(WORKSPACE_REPLACEMENT_PRESERVED_STATUS);
          }
          return false;
        }
      });
    },
    [
      adoptCoverPayload,
      adoptCoverWorkspaceSnapshot,
      currentFingerprintRef,
      documentVersionRef,
      withWorkspaceReplacement
    ]
  );

  const openWorkspaceCoverLetter = useCallback(
    async (
      fileName: string,
      options: WorkspaceCoverLetterOpenOptions = {}
    ): Promise<boolean> => {
      return replaceWorkspaceCoverLetter(
        () => selectCoverLetterWorkspaceDocument(fileName),
        options,
        (data) => `Opened ${data.label}.`,
        "Cover letter load failed.",
        options.background === true
      );
    },
    [replaceWorkspaceCoverLetter]
  );

  useEffect(() => {
    let cancelled = false;
    const initialContentFingerprint = currentFingerprintRef.current ?? "";
    void (async () => {
      try {
        const snapshot = await refreshCoverWorkspace();
        if (
          !coverLetterStartupIsCurrent(
            initialContentFingerprint,
            currentFingerprintRef.current ?? "",
            cancelled || cancelStartupOpenRef.current
          ) ||
          !snapshot
        )
          return;

        const available = snapshot.coverLetterOptions ?? [];
        const startup = resolveCoverLetterStartup(
          available.map((option) => option.fileName),
          loadLastCoverLetterName()
        );
        if (startup.stale) saveLastCoverLetterName("");

        // Automatic naming is safe; content edits and explicit opens cancel.
        if (startup.fileName) {
          await openWorkspaceCoverLetter(
            startup.fileName,
            {
              background: true,
              startup: true,
              shouldCancel: () =>
                !coverLetterStartupIsCurrent(
                  initialContentFingerprint,
                  currentFingerprintRef.current ?? "",
                  cancelled
                )
            }
          );
        }
      } finally {
        if (!cancelled) setIsWorkspaceBootstrapping(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentFingerprintRef, openWorkspaceCoverLetter, refreshCoverWorkspace]);

  const restoreWorkspaceCoverLetter = useCallback(
    (key: string, confirmReplace?: () => Promise<boolean>): Promise<boolean> =>
      replaceWorkspaceCoverLetter(
        () => restoreCoverLetterWorkspaceDocument(key),
        { confirmReplace },
        (data) => `Restored ${data.label} from history.`,
        "Cover letter restore failed."
      ),
    [replaceWorkspaceCoverLetter]
  );

  const saveCoverFile = useCallback(() => {
    if (!editor.editedResume) {
      setStatus("Open or start a cover letter before saving.");
      return;
    }
    const fileName = coverLetterFileName(documentTitle);
    const payload = serializeCoverLetterFile(
      editor.editedResume,
      documentStyleToCoverLetterStyle(styleRef.current)
    );
    downloadBlob(new Blob([payload], { type: "application/json" }), fileName);
    editor.markClean();
    commitPersistenceBaseline(payload);
    clearCoverLetterAutosaveDraft();
    setStatus(`Saved ${fileName}.`);
  }, [commitPersistenceBaseline, documentTitle, editor.editedResume, editor.markClean]);

  const saveTextFile = useCallback(() => {
    const source = text.trim();
    if (!source) {
      setStatus("Write or open a cover letter before saving a text copy.");
      return;
    }
    const fileName = coverLetterFileName(documentTitle).replace(/\.cover$/i, ".txt");
    downloadBlob(new Blob([`${source}\n`], { type: "text/plain;charset=utf-8" }), fileName);
    setStatus(`Saved ${fileName}.`);
  }, [documentTitle, text]);

  // One renderer for both the download and the copy saved to an application, so
  // the letter the tracker keeps is byte-for-byte the letter the user exports.
  const renderPdfBytes = useCallback(
    async (data: ResumeData) => {
      const publicBase = import.meta.env.BASE_URL.replace(/\/$/, "");
      return renderCoverLetterPdfBytes({
        data,
        style: styleRef.current,
        title: documentTitle,
        fontBaseUrl: `${publicBase}/fonts`
      });
    },
    [documentTitle]
  );

  // `overrideBase` is the name the rename prompt collected, matching the resume
  // export. Omitted, it falls back to the document title as before.
  // Returns success so the Apply flow — whose status surface has replaced this
  // editor's by the time a download runs — can report a failed export rather
  // than leaving the user with no file and no explanation.
  const downloadPdf = useCallback(
    async (overrideBase?: string): Promise<boolean> => {
      if (!editor.editedResume) {
        setStatus("Open or start a cover letter before exporting.");
        return false;
      }
      setIsRenderingPdf(true);
      setStatus("Typesetting cover-letter PDF…");
      try {
        const bytes = await renderPdfBytes(editor.editedResume);
        const fileName = coverLetterFileName(overrideBase?.trim() || documentTitle).replace(
          /\.cover$/i,
          ".pdf"
        );
        downloadBlob(new Blob([bytes as BlobPart], { type: "application/pdf" }), fileName);
        setStatus(`Downloaded ${fileName}.`);
        return true;
      } catch (error) {
        setStatus(coverLetterPdfFailureMessage(error));
        return false;
      } finally {
        setIsRenderingPdf(false);
      }
    },
    [documentTitle, editor.editedResume, renderPdfBytes]
  );

  // The letter's equivalent of the resume export's getResumeArtifacts: the
  // editable `.cover` source an application keeps. PDF preview/download is
  // rendered from this source on demand.
  const getArtifacts = useCallback(async () => {
    return createCoverLetterDocumentUpload(
      editor.editedResume,
      styleRef.current,
      documentTitle
    );
  }, [documentTitle, editor.editedResume]);

  const markApplicationSaved = useCallback(() => {
    if (!currentFingerprint) return;
    editor.markClean();
    commitPersistenceBaseline(currentFingerprint);
    clearCoverLetterAutosaveDraft();
  }, [commitPersistenceBaseline, currentFingerprint, editor.markClean]);

  return {
    data: editor.editedResume ?? initialData,
    actions: editor.actions,
    canUndo: editor.canUndo,
    canRedo: editor.canRedo,
    undoSequence: editor.undoSequence,
    redoSequence: editor.redoSequence,
    dirty,
    recoveryDirty,
    text,
    sourceRevision,
    documentTitle,
    persistedDocumentTitle,
    documentVersion,
    setDocumentTitle,
    setOutputDocumentTitle,
    docStyle,
    status,
    setStatus,
    isRenderingPdf,
    isWorkspaceBootstrapping,
    isWorkspaceReplacing,
    isWorkspaceSaving,
    openFile,
    startBlank,
    startStarter,
    saveCoverFile,
    saveTextFile,
    downloadPdf,
    coverLetterOptions,
    coverLetterHistory,
    coverLetterCandidatesRevision,
    readCoverLetterVariantCandidates,
    activeCoverFileName,
    activeCoverLabel:
      coverLetterOptions.find((option) => option.fileName === activeCoverFileName)?.label ?? "",
    saveToWorkspace,
    openWorkspaceCoverLetter,
    restoreWorkspaceCoverLetter,
    loadSourceText,
    applyTailoredText,
    canRestorePreTailor: preTailorSnapshot !== null,
    restorePreTailor,
    openRecoveryDraft,
    openApplicationSource,
    getArtifacts,
    markApplicationSaved,
    // The serialized `.cover` payload behind `dirty`, reused as the recovery
    // draft so one definition of "the current document" feeds both.
    draftPayload: currentFingerprint
  };
}

export type CoverLetterEditorState = ReturnType<typeof useCoverLetterEditor>;
