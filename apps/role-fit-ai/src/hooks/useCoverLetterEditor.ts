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

/** Mirrors the server's cover-letter workspace snapshot fields. */
export type CoverLetterOption = { fileName: string; label: string };
export type CoverLetterHistoryEntry = {
  key: string;
  originalName: string;
  date: string;
};
export type CoverLetterHistoryGroup = {
  variant: string;
  label: string;
  entries: CoverLetterHistoryEntry[];
};
import { DOC_STYLE_DEFAULTS, type DocStyle, type DocumentStyle } from "@typeset/engine/lib/documentStyle.ts";
import type { ResumeData } from "@typeset/engine/lib/resumeData.ts";
import { toTypesetSchema } from "@typeset/engine/typeset/schema.ts";
import { clearCoverLetterAutosaveDraft } from "./useCoverLetterAutosaveDraft";
import type { DocumentUpload } from "../lib/applicationDocumentRequests";
import {
  coverLetterStartupIsCurrent,
  loadLastCoverLetterName,
  resolveCoverLetterStartup,
  saveLastCoverLetterName
} from "../lib/coverLetterPrefs.ts";

const STYLE_STORAGE_KEY = "rolefit:coverLetterStyle.v1";
// Spell-check is a view preference: it never enters a .cover file, but it is
// the writer's choice and must survive a reload rather than snapping back on.
const SPELL_CHECK_STORAGE_KEY = "rolefit:coverLetterSpellCheck.v1";
const TITLE_STORAGE_KEY = "rolefit:coverLetterTitle.v1";
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

function loadTitle(): string {
  try {
    return window.sessionStorage.getItem(TITLE_STORAGE_KEY)?.trim() || "Cover letter";
  } catch {
    return "Cover letter";
  }
}

// Blob → bare base64 (no data: prefix), matching the resume export's encoder.
function pdfFailureMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : "";
  if (/font|Unknown font format/i.test(detail)) {
    return "PDF export failed because the bundled document fonts could not be loaded.";
  }
  return "PDF export failed. Try again.";
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
  // The exact serialized `.cover` this document held immediately before the last
  // Tailor. Tailoring applies straight to the editor, so one-click undo of the
  // whole replacement — style included — has to be exact, not text-only.
  const [preTailorSnapshot, setPreTailorSnapshot] = useState<string | null>(null);
  const snapshotBaselineRef = useRef<string | null>(null);
  const editor = useTypesetResumeEditor(initialData);
  const onOpenDocumentRef = useRef(options.onOpenDocument);
  onOpenDocumentRef.current = options.onOpenDocument;
  const cancelStartupOpenRef = useRef(false);
  const dropPreTailorSnapshot = useCallback(() => {
    setPreTailorSnapshot(null);
    snapshotBaselineRef.current = null;
  }, []);
  // Every user-initiated load goes through here instead of `editor.seedData`,
  // so no open path can forget to move the caret into the new document.
  const openDocument = useCallback(
    (data: ResumeData, automatic = false) => {
      if (!automatic) cancelStartupOpenRef.current = true;
      editor.seedData(data);
      dropPreTailorSnapshot();
      setSourceRevision((current) => current + 1);
      onOpenDocumentRef.current?.();
    },
    [dropPreTailorSnapshot, editor.seedData]
  );
  const [documentTitle, setDocumentTitle] = useState(loadTitle);
  const [persistedDocumentTitle, setPersistedDocumentTitle] = useState(documentTitle);
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
  const commitPersistenceBaseline = useCallback(
    (fingerprint: string, title = documentTitle) => {
      setPersistedFingerprint(fingerprint);
      setPersistedDocumentTitle(title.trim() || "Cover letter");
    },
    [documentTitle]
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
        ? serializeCoverLetterFile(editor.editedResume, documentStyleToCoverLetterStyle(style))
        : null,
    [editor.editedResume, style]
  );
  const dirty = currentFingerprint !== null && currentFingerprint !== persistedFingerprint;
  const startupFingerprint = `${documentTitle}\u0000${currentFingerprint ?? ""}`;
  const startupFingerprintRef = useRef(startupFingerprint);
  startupFingerprintRef.current = startupFingerprint;

  // Restore stays offered until the document changes again for any reason — an
  // edit, a style change, another Tailor, or opening something else. The first
  // pass after a tailor records the applied document as the baseline.
  useEffect(() => {
    if (!preTailorSnapshot || currentFingerprint === null) return;
    if (snapshotBaselineRef.current === null) {
      snapshotBaselineRef.current = currentFingerprint;
      return;
    }
    if (snapshotBaselineRef.current !== currentFingerprint) dropPreTailorSnapshot();
  }, [currentFingerprint, dropPreTailorSnapshot, preTailorSnapshot]);

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
      const nextTitle = title?.trim() || documentTitle;
      commitPersistenceBaseline(
        serializeCoverLetterFile(data, documentStyleToCoverLetterStyle(styleRef.current)),
        nextTitle
      );
      setActiveCoverFileName("");
      saveLastCoverLetterName("");
      if (title?.trim()) setDocumentTitle(nextTitle);
      setStatus("Cover letter loaded. Tailor it when the job description is ready.");
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
      setPreTailorSnapshot(
        editor.editedResume
          ? serializeCoverLetterFile(
              editor.editedResume,
              documentStyleToCoverLetterStyle(styleRef.current)
            )
          : null
      );
      snapshotBaselineRef.current = null;
      editor.seedData(data);
      setStatus("Tailored letter loaded. Read it once before sending.");
    },
    [editor.editedResume, editor.seedData]
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
      const nextTitle = label === "Default" ? "Cover letter" : label;
      commitPersistenceBaseline(
        serializeCoverLetterFile(parsed.data, parsed.style),
        nextTitle
      );
      setActiveCoverFileName(fileName);
      saveLastCoverLetterName(fileName);
      setDocumentTitle(nextTitle);
    },
    [commitPersistenceBaseline, editor.markClean, openDocument]
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
            fileName:
              target?.fileName ?? (target?.variant ? undefined : activeCoverFileName || undefined),
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
        commitPersistenceBaseline(payload);
        // The letter is durable in the workspace now, so the recovery draft has
        // nothing left to protect. The next edit re-arms it.
        clearCoverLetterAutosaveDraft();
        setStatus(`Saved ${data.label ?? "cover letter"} to your workspace.`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Cover letter save failed.");
      }
    },
    [activeCoverFileName, commitPersistenceBaseline, editor.editedResume, editor.markClean]
  );

  const openWorkspaceCoverLetter = useCallback(
    async (fileName: string, automatic = false, shouldCancel?: () => boolean) => {
      try {
        const response = await fetch("/api/workspace/cover-letter/select", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName })
        });
        const data = (await response.json()) as {
          error?: string;
          text?: string;
          fileName?: string;
          label?: string;
          coverLetterOptions?: CoverLetterOption[];
          coverLetterHistory?: CoverLetterHistoryGroup[];
        };
        if (!response.ok || !data.text)
          throw new Error(data.error ?? "Cover letter version not found.");
        if (automatic && (cancelStartupOpenRef.current || shouldCancel?.())) {
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
        const response = await fetch("/api/workspace/cover-letter/restore", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key })
        });
        const data = (await response.json()) as {
          error?: string;
          text?: string;
          fileName?: string;
          label?: string;
          coverLetterOptions?: CoverLetterOption[];
          coverLetterHistory?: CoverLetterHistoryGroup[];
        };
        if (!response.ok || !data.text)
          throw new Error(data.error ?? "Cover letter restore failed.");
        adoptCoverPayload(
          data.text,
          data.fileName ?? "default.cover",
          data.label ?? "Cover letter"
        );
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
      const [{ layoutCoverLetter }, { emitPdf, fetchFontBytes }] = await Promise.all([
        import("@typeset/engine/typeset/layout.ts"),
        import("@typeset/engine/typeset/pdf/emit.ts")
      ]);
      const document = layoutCoverLetter(toTypesetSchema(data), styleRef.current);
      const publicBase = import.meta.env.BASE_URL.replace(/\/$/, "");
      const fonts = await fetchFontBytes(document, `${publicBase}/fonts`);
      return emitPdf(document, fonts, {
        title: documentTitle.trim() || "Cover letter"
      });
    },
    [documentTitle]
  );

  // `overrideBase` is the name the rename prompt collected, matching the resume
  // export. Omitted, it falls back to the document title as before.
  const downloadPdf = useCallback(
    async (overrideBase?: string) => {
      if (!editor.editedResume) {
        setStatus("Open or start a cover letter before exporting.");
        return;
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
      } catch (error) {
        setStatus(pdfFailureMessage(error));
      } finally {
        setIsRenderingPdf(false);
      }
    },
    [documentTitle, editor.editedResume, renderPdfBytes]
  );

  // The letter's equivalent of the resume export's getResumeArtifacts: the
  // editable `.cover` source an application keeps. PDF preview/download is
  // rendered from this source on demand.
  const getArtifacts = useCallback(async (): Promise<DocumentUpload | null> => {
    const data = editor.editedResume;
    if (!data || !coverLetterPlainText(data).trim()) return null;
    return {
      sourceText: serializeCoverLetterFile(data, documentStyleToCoverLetterStyle(styleRef.current)),
      fileName: coverLetterFileName(documentTitle)
    };
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
