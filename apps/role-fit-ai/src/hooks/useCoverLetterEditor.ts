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
import type { DocStyle, DocumentStyle } from "@typeset/engine/lib/documentStyle.ts";
import { toTypesetSchema } from "@typeset/engine/typeset/schema.ts";

const STYLE_STORAGE_KEY = "rolefit:coverLetterStyle.v1";
const TITLE_STORAGE_KEY = "rolefit:coverLetterTitle.v1";

function loadStyle(): DocStyle {
  try {
    const raw = window.localStorage.getItem(STYLE_STORAGE_KEY);
    if (raw) {
      const parsed = parseCoverLetterStyle(JSON.parse(raw) as unknown);
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

function pdfFailureMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : "";
  if (/font|Unknown font format/i.test(detail)) {
    return "PDF export failed because the bundled document fonts could not be loaded.";
  }
  return "PDF export failed. Try again.";
}

export function useCoverLetterEditor() {
  const [style, setStyle] = useState<DocStyle>(loadStyle);
  const [initialData] = useState(() => parseCoverLetterText(""));
  const editor = useTypesetResumeEditor(initialData);
  const [documentTitle, setDocumentTitle] = useState(loadTitle);
  const [status, setStatus] = useState("");
  const [isRenderingPdf, setIsRenderingPdf] = useState(false);
  const [sourceBeforeTailor, setSourceBeforeTailor] = useState("");
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
      set,
      applyStyle,
      replaceDocumentStyle,
      saveCustomPreset: () => undefined,
      customPreset: null,
      isStyleDefault:
        JSON.stringify(documentStyleToCoverLetterStyle(style)) ===
        JSON.stringify(COVER_LETTER_STYLE_DEFAULTS)
    }),
    [applyStyle, replaceDocumentStyle, set, style]
  );

  const loadSourceText = useCallback(
    (source: string, title?: string) => {
      const data = parseCoverLetterText(source);
      editor.seedData(data);
      editor.markClean();
      setPersistedFingerprint(
        serializeCoverLetterFile(data, documentStyleToCoverLetterStyle(styleRef.current))
      );
      setSourceBeforeTailor(coverLetterPlainText(data));
      if (title?.trim()) setDocumentTitle(title.trim());
      setStatus("Cover letter loaded. Tailor it when the job description is ready.");
    },
    [editor.markClean, editor.seedData]
  );

  const applyExternalText = useCallback(
    (source: string) => {
      if (!source.trim()) {
        const data = parseCoverLetterText("");
        editor.seedData(data);
        editor.markClean();
        setPersistedFingerprint(
          serializeCoverLetterFile(data, documentStyleToCoverLetterStyle(styleRef.current))
        );
        setSourceBeforeTailor("");
        setStatus("");
        return;
      }
      const data = parseCoverLetterText(source);
      editor.seedData(data);
      editor.markClean();
      setPersistedFingerprint(
        serializeCoverLetterFile(data, documentStyleToCoverLetterStyle(styleRef.current))
      );
      setSourceBeforeTailor(coverLetterPlainText(data));
      setStatus("Cover letter restored.");
    },
    [editor.markClean, editor.seedData]
  );

  const captureTailorSource = useCallback(() => {
    setSourceBeforeTailor(text);
  }, [text]);

  const applyTailoredText = useCallback(
    (tailored: string) => {
      const data = parseCoverLetterText(tailored);
      editor.seedData(data);
      setStatus("Tailored draft loaded. Review it in your own voice before sending.");
    },
    [editor.seedData]
  );

  const restoreTailorSource = useCallback(() => {
    if (!sourceBeforeTailor) return;
    editor.seedData(parseCoverLetterText(sourceBeforeTailor));
    setStatus("Restored the pre-tailoring cover letter.");
  }, [editor.seedData, sourceBeforeTailor]);

  const startBlank = useCallback(() => {
    const data = parseCoverLetterText("");
    editor.seedData(data);
    editor.markClean();
    setPersistedFingerprint(null);
    setSourceBeforeTailor("");
    setDocumentTitle("Cover letter");
    setStatus("Blank cover letter ready.");
  }, [editor.markClean, editor.seedData]);

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
          editor.seedData(parsed.data);
          editor.markClean();
          setStyle((current) => ({
            ...coverLetterStyleToDocumentStyle(parsed.style),
            zoom: current.zoom,
            spellCheck: current.spellCheck
          }));
          setPersistedFingerprint(serializeCoverLetterFile(parsed.data, parsed.style));
          const restored = coverLetterPlainText(parsed.data);
          setSourceBeforeTailor(restored);
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
    [editor.markClean, editor.seedData, loadSourceText]
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
    setStatus(`Saved ${fileName}.`);
  }, [documentTitle, editor.editedResume, editor.markClean]);

  const downloadPdf = useCallback(async () => {
    if (!editor.editedResume) {
      setStatus("Open or start a cover letter before exporting.");
      return;
    }
    setIsRenderingPdf(true);
    setStatus("Typesetting cover-letter PDF…");
    try {
      const [{ layoutCoverLetter }, { emitPdf, fetchFontBytes }] = await Promise.all([
        import("@typeset/engine/typeset/layout.ts"),
        import("@typeset/engine/typeset/pdf/emit.ts")
      ]);
      const document = layoutCoverLetter(
        toTypesetSchema(editor.editedResume),
        styleRef.current
      );
      const publicBase = import.meta.env.BASE_URL.replace(/\/$/, "");
      const fonts = await fetchFontBytes(document, `${publicBase}/fonts`);
      const bytes = await emitPdf(document, fonts, {
        title: documentTitle.trim() || "Cover letter"
      });
      const fileName = coverLetterFileName(documentTitle).replace(/\.cover$/i, ".pdf");
      downloadBlob(new Blob([bytes as BlobPart], { type: "application/pdf" }), fileName);
      setStatus(`Downloaded ${fileName}.`);
    } catch (error) {
      setStatus(pdfFailureMessage(error));
    } finally {
      setIsRenderingPdf(false);
    }
  }, [documentTitle, editor.editedResume]);

  return {
    data: editor.editedResume ?? initialData,
    actions: editor.actions,
    canUndo: editor.canUndo,
    canRedo: editor.canRedo,
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
    saveCoverFile,
    downloadPdf,
    loadSourceText,
    applyExternalText,
    captureTailorSource,
    applyTailoredText,
    restoreTailorSource,
    canRestoreTailorSource: Boolean(sourceBeforeTailor && sourceBeforeTailor !== text)
  };
}

export type CoverLetterEditorState = ReturnType<typeof useCoverLetterEditor>;
