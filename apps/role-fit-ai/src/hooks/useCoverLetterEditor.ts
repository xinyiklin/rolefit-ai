import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useResumeEditor as useTypesetResumeEditor } from "@typeset/editor/hooks/useResumeEditor.ts";
import type { DocStyleControls } from "@typeset/editor/hooks/useDocStyle.ts";
import {
  COVER_LETTER_STYLE_DEFAULTS,
  CoverLetterFileError,
  MAX_COVER_LETTER_FILE_BYTES,
  coverLetterFileName,
  coverLetterPlainText,
  coverLetterStyleToDocumentStyle,
  documentStyleToCoverLetterStyle,
  parseCoverLetterFile,
  parseCoverLetterStyle,
  parseCoverLetterText,
  serializeCoverLetterFile
} from "@typeset/engine/lib/coverLetter.ts";
import { downloadBlob } from "@typeset/engine/lib/download.ts";

/** Mirrors the server's cover-letter workspace snapshot fields. */
export type CoverLetterOption = { fileName: string; label: string };
export type CoverLetterHistoryEntry = { key: string; originalName: string; date: string };
export type CoverLetterHistoryGroup = {
  variant: string;
  label: string;
  entries: CoverLetterHistoryEntry[];
};
import type { DocStyle, DocumentStyle } from "@typeset/engine/lib/documentStyle.ts";
import type { ResumeData } from "@typeset/engine/lib/resumeData.ts";
import { toTypesetSchema } from "@typeset/engine/typeset/schema.ts";
import { clearCoverLetterAutosaveDraft } from "./useCoverLetterAutosaveDraft";
import {
  coverLetterStartupIsCurrent,
  loadLastCoverLetterName,
  migrateStoredCoverLetterStyle,
  resolveCoverLetterStartup,
  saveLastCoverLetterName
} from "../lib/coverLetterPrefs.ts";

const STYLE_STORAGE_KEY = "rolefit:coverLetterStyle.v1";
const TITLE_STORAGE_KEY = "rolefit:coverLetterTitle.v1";
const COVER_LETTER_STARTER = `[Date]

Dear [Hiring manager],

[Name the role and explain, in your own words, why it interests you.]

[Connect one or two verified experiences from your resume to the role. Focus on what you did and the outcome.]

[Explain why this company or team is a fit, using details from the job posting.]

Sincerely,
[Your name]`;

function loadStyle(): DocStyle {
  try {
    const raw = window.localStorage.getItem(STYLE_STORAGE_KEY);
    if (raw) {
      const parsed = migrateStoredCoverLetterStyle(
        parseCoverLetterStyle(JSON.parse(raw) as unknown)
      );
      return coverLetterStyleToDocumentStyle(parsed);
    }
  } catch {
    // Corrupt or unavailable browser storage falls back to the professional default.
  }
  return coverLetterStyleToDocumentStyle(COVER_LETTER_STYLE_DEFAULTS);
}

function loadTitle(): string {
  try {
    return window.sessionStorage.getItem(TITLE_STORAGE_KEY)?.trim() || "Cover letter";
  } catch {
    return "Cover letter";
  }
}

// Blob → bare base64 (no data: prefix), matching the resume export's encoder.
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      resolve(value.includes(",") ? value.slice(value.indexOf(",") + 1) : "");
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not encode PDF."));
    reader.readAsDataURL(blob);
  });
}

function pdfFailureMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : "";
  if (/font|Unknown font format/i.test(detail)) {
    return "PDF export failed because the bundled document fonts could not be loaded.";
  }
  return "PDF export failed. Try again.";
}

type UseCoverLetterEditorOptions = {
  // Fired when a letter is OPENED — a file, a starter, a blank page, a saved
  // variant, or the pre-tailoring source. The host puts the caret in the
  // document. Deliberately NOT fired for a tailored result: that arrives while
  // the user is reading the review, and taking focus there would interrupt them.
  onOpenDocument?: () => void;
};

export function useCoverLetterEditor(options: UseCoverLetterEditorOptions = {}) {
  const [style, setStyle] = useState<DocStyle>(loadStyle);
  const [initialData] = useState(() => parseCoverLetterText(""));
  const editor = useTypesetResumeEditor(initialData);
  const onOpenDocumentRef = useRef(options.onOpenDocument);
  onOpenDocumentRef.current = options.onOpenDocument;
  const cancelStartupOpenRef = useRef(false);
  // Every user-initiated load goes through here instead of `editor.seedData`,
  // so no open path can forget to move the caret into the new document.
  const openDocument = useCallback(
    (data: ResumeData, automatic = false) => {
      if (!automatic) cancelStartupOpenRef.current = true;
      editor.seedData(data);
      onOpenDocumentRef.current?.();
    },
    [editor.seedData]
  );
  const [documentTitle, setDocumentTitle] = useState(loadTitle);
  const [status, setStatus] = useState("");
  const [isRenderingPdf, setIsRenderingPdf] = useState(false);
  // Workspace-resident cover letters. Cover letters gained the same named
  // variants and version history base resumes have. They live under the
  // cover-letters folder; `activeCoverFileName` is the one Save writes over.
  const [coverLetterOptions, setCoverLetterOptions] = useState<CoverLetterOption[]>([]);
  const [coverLetterHistory, setCoverLetterHistory] = useState<CoverLetterHistoryGroup[]>([]);
  const [activeCoverFileName, setActiveCoverFileName] = useState("");
  const [persistedFingerprint, setPersistedFingerprint] = useState<string | null>(() =>
    serializeCoverLetterFile(initialData, documentStyleToCoverLetterStyle(style))
  );
  const styleRef = useRef(style);
  styleRef.current = style;

  const text = useMemo(
    () => (editor.editedResume ? coverLetterPlainText(editor.editedResume) : ""),
    [editor.editedResume]
  );
  const currentFingerprint = useMemo(
    () =>
      editor.editedResume
        ? serializeCoverLetterFile(
            editor.editedResume,
            documentStyleToCoverLetterStyle(style)
          )
        : null,
    [editor.editedResume, style]
  );
  const dirty =
    currentFingerprint !== null && currentFingerprint !== persistedFingerprint;
  const startupFingerprint = `${documentTitle}\u0000${currentFingerprint ?? ""}`;
  const startupFingerprintRef = useRef(startupFingerprint);
  startupFingerprintRef.current = startupFingerprint;

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
      window.sessionStorage.setItem(TITLE_STORAGE_KEY, documentTitle.trim() || "Cover letter");
    } catch {
      // The in-memory title remains authoritative for this session.
    }
  }, [documentTitle]);

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
      setPersistedFingerprint(
        serializeCoverLetterFile(data, documentStyleToCoverLetterStyle(styleRef.current))
      );
      setActiveCoverFileName("");
      saveLastCoverLetterName("");
      if (title?.trim()) setDocumentTitle(title.trim());
      setStatus("Cover letter loaded. Tailor it when the job description is ready.");
    },
    [editor.markClean, openDocument]
  );

  const applyExternalText = useCallback(
    (source: string) => {
      if (!source.trim()) {
        const data = parseCoverLetterText("");
        openDocument(data);
        editor.markClean();
        setPersistedFingerprint(
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
      setPersistedFingerprint(
        serializeCoverLetterFile(data, documentStyleToCoverLetterStyle(styleRef.current))
      );
      setActiveCoverFileName("");
      saveLastCoverLetterName("");
      setStatus("Cover letter restored.");
    },
    [editor.markClean, openDocument]
  );

  const applyTailoredText = useCallback(
    (tailored: string) => {
      cancelStartupOpenRef.current = true;
      const parsed = parseCoverLetterText(tailored);
      const data = editor.editedResume
        ? { ...parsed, name: editor.editedResume.name, contact: editor.editedResume.contact }
        : parsed;
      editor.seedData(data);
      setStatus("Tailored draft loaded. Review it in your own voice before sending.");
    },
    [editor.editedResume, editor.seedData]
  );

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
        setPersistedFingerprint(serializeCoverLetterFile(parsed.data, parsed.style));
        // A draft is not the workspace copy, so Save must not offer to overwrite
        // whichever saved letter happened to be open before.
        setActiveCoverFileName("");
        saveLastCoverLetterName("");
        if (title.trim()) setDocumentTitle(title.trim());
        setStatus("Restored the unsaved cover letter.");
        return true;
      } catch {
        setStatus("That recovered cover-letter draft could not be read.");
        return false;
      }
    },
    [editor.markClean, openDocument]
  );

  const startBlank = useCallback(() => {
    const data = parseCoverLetterText("");
    openDocument(data);
    editor.markClean();
    // A blank letter is the same document the page opens with, so New must not
    // leave it permanently "unsaved" — that warned on close and prompted to
    // replace an empty letter that had nothing to lose.
    setPersistedFingerprint(
      serializeCoverLetterFile(data, documentStyleToCoverLetterStyle(styleRef.current))
    );
    setActiveCoverFileName("");
    saveLastCoverLetterName("");
    setDocumentTitle("Cover letter");
    setStatus("Blank cover letter ready.");
  }, [editor.markClean, openDocument]);

  const startStarter = useCallback(() => {
    const data = parseCoverLetterText(COVER_LETTER_STARTER);
    openDocument(data);
    editor.markClean();
    setPersistedFingerprint(
      serializeCoverLetterFile(data, documentStyleToCoverLetterStyle(styleRef.current))
    );
    setActiveCoverFileName("");
    saveLastCoverLetterName("");
    setDocumentTitle("Cover letter");
    setStatus("Starter opened. Replace every bracketed prompt with your own facts before tailoring.");
  }, [editor.markClean, openDocument]);

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
          setPersistedFingerprint(serializeCoverLetterFile(parsed.data, parsed.style));
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
    [editor.markClean, openDocument, loadSourceText]
  );

  // Adopt a .cover payload read from the workspace. Same seed/style/fingerprint
  // sequence openFile uses for an uploaded .cover — a workspace load and a file
  // open must leave the editor in identical states, including "not dirty".
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
      setPersistedFingerprint(serializeCoverLetterFile(parsed.data, parsed.style));
      setActiveCoverFileName(fileName);
      saveLastCoverLetterName(fileName);
      setDocumentTitle(label === "Default" ? "Cover letter" : label);
    },
    [editor.markClean, openDocument]
  );

  const refreshCoverWorkspace = useCallback(async () => {
    try {
      const response = await fetch("/api/workspace");
      if (!response.ok) return;
      const snapshot = (await response.json()) as {
        coverLetterOptions?: CoverLetterOption[];
        coverLetterHistory?: CoverLetterHistoryGroup[];
      };
      setCoverLetterOptions(snapshot.coverLetterOptions ?? []);
      setCoverLetterHistory(snapshot.coverLetterHistory ?? []);
      return snapshot;
    } catch {
      // The list is an affordance, not the document — a failed refresh must not
      // interrupt editing. The next mutation reports its own error.
      return null;
    }
  }, []);

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
        const response = await fetch("/api/workspace/cover-letter", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // `variant` is a LABEL the server slugs; `fileName` is already a file
          // name it only validates. The active file must go in `fileName` — sent
          // as a variant it was re-slugged, so "Update Growth" wrote
          // cover-letter-cover-letter-growth-cover.cover instead of updating.
          body: JSON.stringify({
            text: payload,
            fileName: target?.fileName ?? (target?.variant ? undefined : activeCoverFileName || undefined),
            variant: target?.variant
          })
        });
        const data = (await response.json()) as {
          error?: string;
          fileName?: string;
          label?: string;
          coverLetterOptions?: CoverLetterOption[];
          coverLetterHistory?: CoverLetterHistoryGroup[];
        };
        if (!response.ok) throw new Error(data.error ?? "Cover letter save failed.");
        setCoverLetterOptions(data.coverLetterOptions ?? []);
        setCoverLetterHistory(data.coverLetterHistory ?? []);
        if (data.fileName) {
          setActiveCoverFileName(data.fileName);
          saveLastCoverLetterName(data.fileName);
        }
        editor.markClean();
        setPersistedFingerprint(payload);
        // The letter is durable in the workspace now, so the recovery draft has
        // nothing left to protect. The next edit re-arms it.
        clearCoverLetterAutosaveDraft();
        setStatus(`Saved ${data.label ?? "cover letter"} to your workspace.`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Cover letter save failed.");
      }
    },
    [activeCoverFileName, editor.editedResume, editor.markClean]
  );

  const openWorkspaceCoverLetter = useCallback(
    async (
      fileName: string,
      automatic = false,
      shouldCancel?: () => boolean
    ) => {
      try {
        const response = await fetch("/api/workspace/cover-letter/select", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName })
        });
        const data = (await response.json()) as {
          error?: string; text?: string; fileName?: string; label?: string;
          coverLetterOptions?: CoverLetterOption[]; coverLetterHistory?: CoverLetterHistoryGroup[];
        };
        if (!response.ok || !data.text) throw new Error(data.error ?? "Cover letter version not found.");
        if (
          automatic &&
          (cancelStartupOpenRef.current || shouldCancel?.())
        ) {
          return;
        }
        adoptCoverPayload(
          data.text,
          data.fileName ?? fileName,
          data.label ?? "Cover letter",
          automatic
        );
        setCoverLetterOptions(data.coverLetterOptions ?? []);
        setCoverLetterHistory(data.coverLetterHistory ?? []);
        setStatus(automatic ? "" : `Opened ${data.label ?? fileName}.`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Cover letter load failed.");
      }
    },
    [adoptCoverPayload]
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
        )
        || !snapshot
      ) return;

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
        const response = await fetch("/api/workspace/cover-letter/restore", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key })
        });
        const data = (await response.json()) as {
          error?: string; text?: string; fileName?: string; label?: string;
          coverLetterOptions?: CoverLetterOption[]; coverLetterHistory?: CoverLetterHistoryGroup[];
        };
        if (!response.ok || !data.text) throw new Error(data.error ?? "Cover letter restore failed.");
        adoptCoverPayload(data.text, data.fileName ?? "default.cover", data.label ?? "Cover letter");
        setCoverLetterOptions(data.coverLetterOptions ?? []);
        setCoverLetterHistory(data.coverLetterHistory ?? []);
        setStatus(`Restored ${data.label ?? "cover letter"} from history.`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Cover letter restore failed.");
      }
    },
    [adoptCoverPayload]
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
    setPersistedFingerprint(payload);
    clearCoverLetterAutosaveDraft();
    setStatus(`Saved ${fileName}.`);
  }, [documentTitle, editor.editedResume, editor.markClean]);

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
  const renderPdfBytes = useCallback(async (data: ResumeData) => {
    const [{ layoutCoverLetter }, { emitPdf, fetchFontBytes }] = await Promise.all([
      import("@typeset/engine/typeset/layout.ts"),
      import("@typeset/engine/typeset/pdf/emit.ts")
    ]);
    const document = layoutCoverLetter(toTypesetSchema(data), styleRef.current);
    const publicBase = import.meta.env.BASE_URL.replace(/\/$/, "");
    const fonts = await fetchFontBytes(document, `${publicBase}/fonts`);
    return emitPdf(document, fonts, { title: documentTitle.trim() || "Cover letter" });
  }, [documentTitle]);

  // `overrideBase` is the name the rename prompt collected, matching the resume
  // export. Omitted, it falls back to the document title as before.
  const downloadPdf = useCallback(async (overrideBase?: string) => {
    if (!editor.editedResume) {
      setStatus("Open or start a cover letter before exporting.");
      return;
    }
    setIsRenderingPdf(true);
    setStatus("Typesetting cover-letter PDF…");
    try {
      const bytes = await renderPdfBytes(editor.editedResume);
      const fileName = coverLetterFileName(overrideBase?.trim() || documentTitle)
        .replace(/\.cover$/i, ".pdf");
      downloadBlob(new Blob([bytes as BlobPart], { type: "application/pdf" }), fileName);
      setStatus(`Downloaded ${fileName}.`);
    } catch (error) {
      setStatus(pdfFailureMessage(error));
    } finally {
      setIsRenderingPdf(false);
    }
  }, [documentTitle, editor.editedResume, renderPdfBytes]);

  // The letter's equivalent of the resume export's getResumeArtifacts: the
  // compiled PDF plus the editable `.cover`, for the copy an application keeps.
  // Returns null when there is nothing to render; a failed PDF still returns the
  // source, so an export problem never costs the saved letter.
  const getArtifacts = useCallback(async () => {
    const data = editor.editedResume;
    if (!data || !coverLetterPlainText(data).trim()) return null;
    const sourceText = serializeCoverLetterFile(data, documentStyleToCoverLetterStyle(styleRef.current));
    let pdfBase64: string | null = null;
    try {
      const bytes = await renderPdfBytes(data);
      pdfBase64 = await blobToBase64(new Blob([bytes as BlobPart]));
    } catch {
      // Fall through: the source alone is still worth saving.
    }
    return {
      pdfBase64,
      sourceText,
      fileName: coverLetterFileName(documentTitle).replace(/\.cover$/i, ".pdf")
    };
  }, [documentTitle, editor.editedResume, renderPdfBytes]);

  return {
    data: editor.editedResume ?? initialData,
    actions: editor.actions,
    canUndo: editor.canUndo,
    canRedo: editor.canRedo,
    undoSequence: editor.undoSequence,
    redoSequence: editor.redoSequence,
    dirty,
    text,
    documentTitle,
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
    activeCoverFileName,
    activeCoverLabel:
      coverLetterOptions.find((option) => option.fileName === activeCoverFileName)?.label ?? "",
    saveToWorkspace,
    openWorkspaceCoverLetter,
    restoreWorkspaceCoverLetter,
    loadSourceText,
    applyExternalText,
    applyTailoredText,
    openRecoveryDraft,
    getArtifacts,
    // The serialized `.cover` payload behind `dirty`, reused as the recovery
    // draft so one definition of "the current document" feeds both.
    draftPayload: currentFingerprint
  };
}

export type CoverLetterEditorState = ReturnType<typeof useCoverLetterEditor>;
