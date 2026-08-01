import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  type CoverLetterHistoryGroup,
  type CoverLetterOption,
  type CoverLetterWorkspaceSnapshot
} from "../lib/coverLetterWorkspaceRepository.ts";
import {
  coverLetterPdfFailureMessage,
  createCoverLetterDocumentUpload,
  renderCoverLetterPdfBytes
} from "../lib/coverLetterExport.ts";
import { useCoverLetterDocumentIdentity } from "./useCoverLetterDocumentIdentity.ts";
import { useCoverLetterPreTailorSnapshot } from "./useCoverLetterPreTailorSnapshot.ts";

const STYLE_STORAGE_KEY = "rolefit:coverLetterStyle.v1";
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

export function useCoverLetterEditor(options: UseCoverLetterEditorOptions = {}) {
  const [style, setStyle] = useState<DocStyle>(loadStyle);
  const [initialData] = useState(() => parseCoverLetterText(""));
  const [sourceRevision, setSourceRevision] = useState(0);
  const editor = useTypesetResumeEditor(initialData);
  const onOpenDocumentRef = useRef(options.onOpenDocument);
  onOpenDocumentRef.current = options.onOpenDocument;
  const cancelStartupOpenRef = useRef(false);
  const workspaceOpenGenerationRef = useRef(0);
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
  const {
    documentTitle,
    persistedDocumentTitle,
    setDocumentTitle,
    dirty,
    commitPersistenceBaseline,
    startupFingerprintRef
  } = useCoverLetterDocumentIdentity(
    serializeCoverLetterFile(initialData, documentStyleToCoverLetterStyle(style)),
    currentFingerprint
  );
  // The exact serialized `.cover` immediately before Tailor is a true one-step
  // replacement undo. Its hook retires the snapshot after any subsequent edit.
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
        workspaceOpenGenerationRef.current += 1;
      }
      editor.seedData(data);
      dropPreTailorSnapshot();
      setSourceRevision((current) => current + 1);
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
  const [activeCoverFileName, setActiveCoverFileName] = useState("");

  // Every authoritative workspace response lands here. Names alone cannot reveal
  // that an existing variant was overwritten or restored, so the revision
  // advances with each snapshot and Prepare re-reads the actual saved bytes
  // before recommending a letter.
  const adoptCoverWorkspaceSnapshot = useCallback((snapshot: CoverLetterWorkspaceSnapshot) => {
    setCoverLetterOptions(snapshot.coverLetterOptions ?? []);
    setCoverLetterHistory(snapshot.coverLetterHistory ?? []);
    setCoverLetterCandidatesRevision((revision) => revision + 1);
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
      if (title?.trim()) setDocumentTitle(nextTitle);
      setStatus("Cover letter loaded. Tailor it after preparing the job on Prepare.");
    },
    [commitPersistenceBaseline, documentTitle, editor.markClean, openDocument]
  );

  const applyExternalText = useCallback(
    (source: string) => {
      if (!source.trim()) {
        const data = parseCoverLetterText("");
        openDocument(data);
        editor.markClean();
        commitPersistenceBaseline(
          serializeCoverLetterFile(data, documentStyleToCoverLetterStyle(styleRef.current))
        );
        setActiveCoverFileName("");
        saveLastCoverLetterName("");
        setStatus("");
        return;
      }
      const data = parseCoverLetterText(source);
      openDocument(data);
      editor.markClean();
      commitPersistenceBaseline(
        serializeCoverLetterFile(data, documentStyleToCoverLetterStyle(styleRef.current))
      );
      setActiveCoverFileName("");
      saveLastCoverLetterName("");
      setStatus("Cover letter restored.");
    },
    [commitPersistenceBaseline, editor.markClean, openDocument]
  );

  // Tailoring replaces the document in place. The exact prior `.cover` is kept
  // first so a single Restore is a true undo of the replacement.
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
      setStatus("Tailored letter loaded. Read it once before sending.");
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
      setStatus("Restored the letter from before tailoring.");
      return true;
    } catch {
      dropPreTailorSnapshot();
      setStatus("The letter from before tailoring could not be restored.");
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
        if (title.trim()) setDocumentTitle(nextTitle);
        setStatus("Restored the unsaved cover letter.");
        return true;
      } catch {
        setStatus("That recovered cover-letter draft could not be read.");
        return false;
      }
    },
    [commitPersistenceBaseline, documentTitle, editor.markClean, openDocument]
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
        if (title.trim()) setDocumentTitle(nextTitle);
        setStatus("Loaded the saved application cover letter.");
        return true;
      } catch {
        setStatus("The saved application cover letter could not be read.");
        return false;
      }
    },
    [commitPersistenceBaseline, documentTitle, editor.markClean, openDocument]
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
    setDocumentTitle("Cover letter");
    setStatus("Blank cover letter ready.");
  }, [commitPersistenceBaseline, editor.markClean, openDocument]);

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
    setDocumentTitle("Cover letter");
    setStatus("Starter opened. Complete the tailoring details beside the document.");
  }, [commitPersistenceBaseline, editor.markClean, openDocument]);

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
          setDocumentTitle(fileBase || "Cover letter");
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
    [commitPersistenceBaseline, editor.markClean, openDocument, loadSourceText]
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
      const nextTitle = documentTitle.trim() || (label === "Default" ? "Cover letter" : label);
      commitPersistenceBaseline(
        serializeCoverLetterFile(parsed.data, parsed.style),
        nextTitle
      );
      setActiveCoverFileName(fileName);
      saveLastCoverLetterName(fileName);
      setDocumentTitle(nextTitle);
    },
    [commitPersistenceBaseline, documentTitle, editor.markClean, openDocument]
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
    async (target?: { fileName?: string; variant?: string }) => {
      if (!editor.editedResume) {
        setStatus("Open or start a cover letter before saving.");
        return;
      }
      const payload = serializeCoverLetterFile(
        editor.editedResume,
        documentStyleToCoverLetterStyle(styleRef.current)
      );
      try {
        // `variant` is a LABEL the server slugs; `fileName` is already validated
        // workspace identity. Keeping that distinction here prevents an update
        // from being re-slugged as a new doubly-prefixed variant.
        const data = await saveCoverLetterWorkspace(payload, {
          fileName:
            target?.fileName ?? (target?.variant ? undefined : activeCoverFileName || undefined),
          variant: target?.variant
        });
        adoptCoverWorkspaceSnapshot(data);
        if (data.fileName) {
          setActiveCoverFileName(data.fileName);
          saveLastCoverLetterName(data.fileName);
        }
        editor.markClean();
        commitPersistenceBaseline(payload);
        // The letter is durable in the workspace now, so the recovery draft has
        // nothing left to protect. The next edit re-arms it.
        clearCoverLetterAutosaveDraft();
        setStatus(`Saved ${data.label ?? "cover letter"} to your workspace.`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Cover letter save failed.");
      }
    },
    [activeCoverFileName, adoptCoverWorkspaceSnapshot, commitPersistenceBaseline, editor.editedResume, editor.markClean]
  );

  const openWorkspaceCoverLetter = useCallback(
    async (
      fileName: string,
      mode: boolean | "recommendation" = false,
      shouldCancel?: () => boolean
    ): Promise<boolean> => {
      const background = mode !== false;
      const generation = workspaceOpenGenerationRef.current + 1;
      workspaceOpenGenerationRef.current = generation;
      try {
        const data = await selectCoverLetterWorkspaceDocument(fileName);
        if (
          generation !== workspaceOpenGenerationRef.current ||
          shouldCancel?.() ||
          // Only the one-shot startup open is invalidated by earlier user
          // interaction. A later recommendation has its own live dirty/version
          // guard and may safely replace a clean document.
          (mode === true && cancelStartupOpenRef.current)
        ) {
          return false;
        }
        adoptCoverPayload(
          data.text,
          data.fileName,
          data.label,
          background
        );
        adoptCoverWorkspaceSnapshot(data);
        setStatus(background ? "" : `Opened ${data.label}.`);
        return true;
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Cover letter load failed.");
        return false;
      }
    },
    [adoptCoverPayload, adoptCoverWorkspaceSnapshot]
  );

  useEffect(() => {
    let cancelled = false;
    const initialFingerprint = startupFingerprintRef.current;
    void (async () => {
      const snapshot = await refreshCoverWorkspace();
      if (
        !coverLetterStartupIsCurrent(
          initialFingerprint,
          startupFingerprintRef.current,
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

      // A startup response may adopt a saved letter only while the editor still
      // matches the exact document, style, and title state it began with.
      if (startup.fileName) {
        await openWorkspaceCoverLetter(
          startup.fileName,
          true,
          () =>
            !coverLetterStartupIsCurrent(
              initialFingerprint,
              startupFingerprintRef.current,
              cancelled
            )
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [openWorkspaceCoverLetter, refreshCoverWorkspace]);

  const restoreWorkspaceCoverLetter = useCallback(
    async (key: string) => {
      try {
        const data = await restoreCoverLetterWorkspaceDocument(key);
        adoptCoverPayload(
          data.text,
          data.fileName,
          data.label
        );
        adoptCoverWorkspaceSnapshot(data);
        setStatus(`Restored ${data.label} from history.`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Cover letter restore failed.");
      }
    },
    [adoptCoverPayload, adoptCoverWorkspaceSnapshot]
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
    text,
    sourceRevision,
    documentTitle,
    persistedDocumentTitle,
    setDocumentTitle,
    docStyle,
    status,
    setStatus,
    isRenderingPdf,
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
    applyExternalText,
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
