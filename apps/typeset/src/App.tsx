import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent
} from "react";
import { FileUp, Info, TriangleAlert, X } from "lucide-react";

import { Modal } from "./components/Modal";
import { TopToolbar, type ToolbarSaveStatus } from "./components/toolbar/TopToolbar";
import { useDocStyle } from "./hooks/useDocStyle";
import {
  DOC_PAGE_WIDTH_PX,
  DOC_STYLE_DEFAULTS,
  nextZoomOption,
  toDocumentStyle,
  type DocumentStyle
} from "@typeset/engine/lib/documentStyle";
import { useResumeEditor } from "./hooks/useResumeEditor";
import {
  downloadResumeFile,
  parseResumeFile,
  readResumeFile,
  resumeFileName,
  serializeResumeFile,
  type ParsedResumeFile
} from "@typeset/engine/lib/resumeFile";
import type { ResumeData } from "@typeset/engine/lib/resumeData";
import { downloadBlob } from "@typeset/engine/lib/download";
import {
  STYLE_FIELD_MARK_DEFAULTS,
  globalAlignmentState,
  styleFieldFontStates,
  styleFieldMarkStates,
  styleFieldSizeStates,
  styleFieldDefaultSizePt
} from "@typeset/engine/lib/styleFieldFormatting";
import { buildStarterResume } from "@typeset/engine/sampleResume";
import { ResumePrintLayer } from "./sections/ResumePrintLayer";
import { layoutResume } from "@typeset/engine/typeset/layout";
import { toTypesetSchema } from "@typeset/engine/typeset/schema";
import {
  TypesetEditor,
  type InlineFormatState,
  type TypesetEditorHandle
} from "./sections/editor/TypesetEditor";

const AUTOSAVE_KEY = "typeset-resume.autosave.v1";
const DOCUMENT_TITLE_KEY = "typeset-resume.documentTitle.v1";
const AUTOSAVE_DELAY_MS = 450;
const UNTITLED_RESUME_TITLE = "Untitled resume";

type Notice = {
  tone: "info" | "error";
  message: string;
};

type Replacement = {
  kind: "new" | "open";
  data: ResumeData;
  documentStyle: DocumentStyle;
  title: string;
};

const EMPTY_INLINE_FORMAT: InlineFormatState = {
  canFormat: false,
  bold: false,
  italic: false,
  underline: false,
  fontFamily: null,
  fontSizePt: null,
  alignment: null,
  alignmentScope: null,
  entryField: null,
  linkHref: null,
  linkText: "",
  linkAutomatic: false,
  canLink: false,
  canClearFormatting: false
};

function titleFromFileName(fileName: string) {
  return fileName.replace(/\.resume$/i, "").trim() || UNTITLED_RESUME_TITLE;
}

function readableError(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong while opening this resume.";
}

function hasDraggedFiles(event: DragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer.types).includes("Files");
}

export default function App() {
  const editor = useResumeEditor();
  const docStyle = useDocStyle();
  const editorRef = useRef<TypesetEditorHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const initializedRef = useRef(false);
  const autoFitRef = useRef(false);
  const dragDepthRef = useRef(0);

  const [documentTitle, setDocumentTitle] = useState(UNTITLED_RESUME_TITLE);
  const [saveStatus, setSaveStatus] = useState<ToolbarSaveStatus>("saving");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pendingReplacement, setPendingReplacement] = useState<Replacement | null>(null);
  const [inlineFormat, setInlineFormat] = useState<InlineFormatState>(EMPTY_INLINE_FORMAT);
  const [linkEditorOpen, setLinkEditorOpen] = useState(false);
  const [isSavingFile, setIsSavingFile] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  const resume = editor.editedResume;
  const documentStyleSignature = useMemo(
    () => JSON.stringify(toDocumentStyle(docStyle.style)),
    [docStyle.style]
  );
  const globalAlignments = useMemo(
    () => resume ? globalAlignmentState(resume, docStyle.style) : null,
    [docStyle.style, resume]
  );
  const styleMarkStates = useMemo(
    () => resume ? styleFieldMarkStates(resume) : undefined,
    [resume]
  );
  const styleFontStates = useMemo(
    () => resume ? styleFieldFontStates(resume, docStyle.style.fontFamily) : undefined,
    [resume, docStyle.style.fontFamily]
  );
  const styleSizeStates = useMemo(
    () => resume ? styleFieldSizeStates(resume, docStyle.style.baseFontSizePt) : undefined,
    [resume, docStyle.style.baseFontSizePt]
  );

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    let initialData = buildStarterResume();
    let initialDocumentStyle: DocumentStyle | null = null;
    let initialTitle = UNTITLED_RESUME_TITLE;

    try {
      const autosave = window.localStorage.getItem(AUTOSAVE_KEY);
      if (autosave) {
        // Browser drafts and disk files share one strict validation path so
        // corrupt or manually edited state never reaches the editor reducer.
        const restored = parseResumeFile(autosave);
        initialData = restored.data;
        initialDocumentStyle = restored.documentStyle;
        initialTitle = window.localStorage.getItem(DOCUMENT_TITLE_KEY) || UNTITLED_RESUME_TITLE;
      }
    } catch {
      setNotice({
        tone: "error",
        message: "Your last local draft could not be restored, so a fresh resume was opened instead."
      });
    }

    editor.seedData(initialData);
    docStyle.replaceDocumentStyle(initialDocumentStyle ?? toDocumentStyle(docStyle.style));
    setDocumentTitle(initialTitle);
  }, [editor.seedData]);

  // The editable source is continuously kept in this browser. Saving a file is
  // still a separate, explicit action so users can move or version a resume.
  useEffect(() => {
    if (!initializedRef.current || !resume) return;
    setSaveStatus("saving");

    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(AUTOSAVE_KEY, serializeResumeFile(resume, docStyle.style));
        window.localStorage.setItem(DOCUMENT_TITLE_KEY, documentTitle.trim() || UNTITLED_RESUME_TITLE);
        editor.markClean();
        setSaveStatus("saved");
      } catch {
        setSaveStatus({ state: "error", label: "Local save unavailable" });
      }
    }, AUTOSAVE_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [documentStyleSignature, documentTitle, editor.markClean, resume]);

  useEffect(() => {
    document.title = `${documentTitle.trim() || UNTITLED_RESUME_TITLE} — Typeset`;
  }, [documentTitle]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const state = typeof saveStatus === "string" ? saveStatus : saveStatus.state;
      if (!editor.dirty && state !== "error") return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [editor.dirty, saveStatus]);

  const applyReplacement = useCallback(
    (replacement: Replacement) => {
      editor.seedData(replacement.data);
      docStyle.replaceDocumentStyle(replacement.documentStyle);
      setDocumentTitle(replacement.title);
      setPendingReplacement(null);
      setInlineFormat(EMPTY_INLINE_FORMAT);
      setNotice({
        tone: "info",
        message: replacement.kind === "open" ? `Opened ${replacement.title}.` : "Started a fresh resume."
      });
    },
    [editor.seedData]
  );

  const queueReplacement = useCallback(
    (replacement: Replacement) => {
      if (resume) setPendingReplacement(replacement);
      else applyReplacement(replacement);
    },
    [applyReplacement, resume]
  );

  const newResume = useCallback(() => {
    queueReplacement({
      kind: "new",
      data: buildStarterResume(),
      documentStyle: toDocumentStyle(DOC_STYLE_DEFAULTS),
      title: UNTITLED_RESUME_TITLE
    });
  }, [queueReplacement]);

  const openParsedResume = useCallback(
    (parsed: ParsedResumeFile, fileName: string) => {
      queueReplacement({
        kind: "open",
        data: parsed.data,
        documentStyle: parsed.documentStyle,
        title: titleFromFileName(fileName)
      });
    },
    [queueReplacement]
  );

  const openFile = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith(".resume")) {
        setNotice({ tone: "error", message: "Choose a .resume file. Other import formats are not supported." });
        return;
      }

      try {
        openParsedResume(await readResumeFile(file), file.name);
      } catch (error) {
        setNotice({ tone: "error", message: readableError(error) });
      }
    },
    [openParsedResume]
  );

  const onFileInput = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (file) void openFile(file);
    },
    [openFile]
  );

  const saveResumeFile = useCallback(() => {
    if (!resume) return;
    setIsSavingFile(true);
    try {
      const fileName = downloadResumeFile(resume, docStyle.style, documentTitle);
      editor.markClean();
      setNotice({ tone: "info", message: `Saved ${fileName}.` });
    } catch (error) {
      setNotice({ tone: "error", message: readableError(error) });
    } finally {
      setIsSavingFile(false);
    }
  }, [docStyle.style, documentTitle, editor.markClean, resume]);

  const exportPdf = useCallback(async () => {
    if (!resume || isExporting) return;
    setIsExporting(true);
    try {
      // Dedicated client-side export: the owned typeset engine lays the resume
      // out and pdf-lib serializes those exact glyph positions to PDF bytes —
      // no browser Print dialog, and the resume text never leaves the page.
      // pdf-lib + the emitter load on demand to stay out of the main bundle.
      // Layout is already shared with the on-screen renderer, so it remains a
      // direct import instead of pretending to form a second async chunk.
      const { emitPdf, fetchFontBytes } = await import("@typeset/engine/typeset/pdf/emit");
      const schema = toTypesetSchema(resume);
      const doc = layoutResume(schema, docStyle.style);
      const fonts = await fetchFontBytes(doc);
      const bytes = await emitPdf(doc, fonts, {
        title: schema.name ? `${schema.name} — Resume` : "Resume"
      });
      const fileName = `${resumeFileName(documentTitle).replace(/\.resume$/i, "")}.pdf`;
      downloadBlob(new Blob([bytes as BlobPart], { type: "application/pdf" }), fileName);
      setNotice({ tone: "info", message: `Exported ${fileName}.` });
    } catch (error) {
      setNotice({ tone: "error", message: `PDF export failed. ${readableError(error)}` });
    } finally {
      setIsExporting(false);
    }
  }, [docStyle.style, documentTitle, isExporting, resume]);

  const fitPage = useCallback(() => {
    const width = workspaceRef.current?.clientWidth ?? window.innerWidth;
    const availableWidth = Math.max(320, width - 120);
    const fit = Math.min(1.25, Math.max(0.5, availableWidth / DOC_PAGE_WIDTH_PX));
    docStyle.set("zoom", Math.round(fit * 100) / 100);
  }, [docStyle]);

  // At supported tablet widths, start with the whole sheet visible. Desktop
  // keeps the familiar 100% default, and the choice remains user-adjustable.
  useEffect(() => {
    if (!resume || autoFitRef.current) return;
    autoFitRef.current = true;
    if (window.innerWidth > 720 && window.innerWidth < 900 && docStyle.style.zoom >= 1) fitPage();
  }, [docStyle.style.zoom, fitPage, resume]);

  const undo = useCallback(() => {
    if (editorRef.current) editorRef.current.undo();
    else editor.actions.undo();
  }, [editor.actions]);

  const redo = useCallback(() => {
    if (editorRef.current) editorRef.current.redo();
    else editor.actions.redo();
  }, [editor.actions]);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "s") {
        event.preventDefault();
        saveResumeFile();
      } else if (key === "o") {
        event.preventDefault();
        fileInputRef.current?.click();
      } else if (key === "0") {
        event.preventDefault();
        docStyle.set("zoom", 1);
      } else if (key === "-" || key === "_") {
        event.preventDefault();
        docStyle.set("zoom", nextZoomOption(docStyle.style.zoom, -1));
      } else if (key === "=" || key === "+") {
        event.preventDefault();
        docStyle.set("zoom", nextZoomOption(docStyle.style.zoom, 1));
      }
    };
    document.addEventListener("keydown", onShortcut);
    return () => document.removeEventListener("keydown", onShortcut);
  }, [docStyle, saveResumeFile]);

  const onDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDraggingFile(true);
  }, []);

  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const onDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDraggingFile(false);
  }, []);

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragDepthRef.current = 0;
      setIsDraggingFile(false);
      const file = event.dataTransfer.files[0];
      if (file) void openFile(file);
    },
    [openFile]
  );

  return (
    <div
      className="app"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <TopToolbar
        documentTitle={documentTitle}
        onDocumentTitleChange={setDocumentTitle}
        saveStatus={saveStatus}
        onNew={newResume}
        onOpen={() => fileInputRef.current?.click()}
        onSave={saveResumeFile}
        onExport={() => void exportPdf()}
        documentStructure={{
          name: resume?.name ?? "",
          contact: resume?.contact ?? [],
          disabled: !resume,
          onSetName: editor.actions.setName,
          onUpdateContact: editor.actions.updateContact,
          onAddContact: editor.actions.addContact,
          onRemoveContact: editor.actions.removeContact,
          onAddSection: (type, position) => editorRef.current?.addSection(type, position)
        }}
        saveDisabled={!resume}
        exportDisabled={!resume}
        isSaving={isSavingFile}
        isExporting={isExporting}
        onUndo={undo}
        onRedo={redo}
        canUndo={editor.canUndo}
        canRedo={editor.canRedo}
        formattingDisabled={!resume}
        inlineFormatting={{
          fontFamily: {
            value: inlineFormat.fontFamily,
            onChange: (fontFamily) => editorRef.current?.setFontFamily(fontFamily),
            disabled: false
          },
          fontSize: {
            value: inlineFormat.fontSizePt,
            onChange: (fontSizePt) => editorRef.current?.setFontSize(fontSizePt),
            disabled: false
          },
          alignment: {
            value: inlineFormat.alignment,
            onChange: (alignment) => editorRef.current?.setAlignment(alignment),
            disabled: false
          },
          bold: {
            onToggle: () => editorRef.current?.toggleMark("bold"),
            pressed: inlineFormat.bold,
            disabled: inlineFormat.alignmentScope === "heading" && docStyle.style.headingCase === "smallcaps"
          },
          italic: {
            onToggle: () => editorRef.current?.toggleMark("italic"),
            pressed: inlineFormat.italic,
            disabled: inlineFormat.alignmentScope === "heading" && docStyle.style.headingCase === "smallcaps"
          },
          underline: {
            onToggle: () => editorRef.current?.toggleMark("underline"),
            pressed: inlineFormat.underline,
            disabled: inlineFormat.alignmentScope === "heading" && docStyle.style.headingCase === "smallcaps"
          },
          link: {
            href: inlineFormat.linkHref,
            text: inlineFormat.linkText,
            automatic: inlineFormat.linkAutomatic,
            onApply: ({ text, href }) => editorRef.current?.applyLink(text, href),
            onRemove: () => editorRef.current?.removeLink(),
            disabled: !inlineFormat.canLink,
            open: linkEditorOpen,
            onOpenChange: setLinkEditorOpen
          },
          clearFormatting: {
            onClear: () => editorRef.current?.clearFormatting(),
            disabled: !inlineFormat.canClearFormatting
          }
        }}
        docStyle={docStyle}
        globalAlignments={globalAlignments ?? undefined}
        onGlobalAlignmentChange={(scope, alignment) => {
          editor.actions.clearAlignmentOverrides(scope);
          setInlineFormat((current) =>
            current.alignmentScope === scope ? { ...current, alignment } : current
          );
          if (scope === "body") docStyle.set("bodyAlign", alignment);
          else if (scope === "header") docStyle.set("headerAlign", alignment === "justify" ? "left" : alignment);
          else docStyle.set("headingAlign", alignment === "justify" ? "left" : alignment);
        }}
        styleMarkStates={styleMarkStates}
        onStyleFieldMarkChange={(field, mark, on) => {
          editor.actions.setStyleFieldMark(field, mark, on);
          setInlineFormat((current) =>
            current.entryField === field ? { ...current, [mark]: on } : current
          );
        }}
        styleFontStates={styleFontStates}
        onStyleFieldFontChange={(field, family) => {
          // Picking the document font clears the override so the field keeps
          // inheriting; any other family is stored explicitly.
          editor.actions.setStyleFieldFont(field, family === docStyle.style.fontFamily ? "default" : family);
          setInlineFormat((current) =>
            current.entryField === field ? { ...current, fontFamily: family } : current
          );
        }}
        styleSizeStates={styleSizeStates}
        onStyleFieldSizeChange={(field, sizePt) => {
          // Snapping back to the role default clears the override; otherwise the
          // exact point size is stored on every instance of the field.
          const isDefault = Math.abs(sizePt - styleFieldDefaultSizePt(field, docStyle.style.baseFontSizePt)) < 0.05;
          editor.actions.setStyleFieldSize(field, isDefault ? "default" : sizePt);
          setInlineFormat((current) =>
            current.entryField === field ? { ...current, fontSizePt: sizePt } : current
          );
        }}
        onResetStyleFormatting={() => {
          editor.actions.resetStyleFieldFormatting();
          setInlineFormat((current) => {
            if (!current.entryField) return current;
            return { ...current, ...STYLE_FIELD_MARK_DEFAULTS[current.entryField] };
          });
        }}
        onFitZoom={fitPage}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept=".resume"
        onChange={onFileInput}
        hidden
      />

      {notice ? (
        <div className={`app-notice app-notice--${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
          {notice.tone === "error" ? (
            <TriangleAlert size={16} aria-hidden="true" />
          ) : (
            <Info size={16} aria-hidden="true" />
          )}
          <span>{notice.message}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss message">
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <main className="document-workspace" ref={workspaceRef} aria-label="Resume editor">
        <div className="mobile-gate">
          <strong>Open this editor on a larger screen</strong>
          <p>Typeset is designed for precise desktop and tablet editing. File actions remain available above.</p>
        </div>

        {resume ? (
          <section className="document-canvas" aria-label="Editable resume pages">
            <TypesetEditor
              ref={editorRef}
              data={resume}
              actions={editor.actions}
              canUndo={editor.canUndo}
              canRedo={editor.canRedo}
              docStyle={docStyle}
              onInlineFormatStateChange={setInlineFormat}
              onRequestLinkEditor={() => setLinkEditorOpen(true)}
            />
          </section>
        ) : (
          <div className="document-loading" role="status">
            Preparing your resume…
          </div>
        )}
      </main>

      <div className="workspace-footnote" aria-hidden="true">
        <span>Click the page to edit</span>
        <span>Drag beside an item to reorder</span>
        <span>Saved only in this browser unless you download a .resume file</span>
      </div>

      {resume ? <ResumePrintLayer resume={resume} docStyle={docStyle.style} /> : null}

      {isDraggingFile ? (
        <div className="file-drop-overlay" role="status" aria-live="polite">
          <div className="file-drop-overlay__card">
            <FileUp size={24} aria-hidden="true" />
            <strong>Open .resume file</strong>
            <span>Drop it anywhere in the editor</span>
          </div>
        </div>
      ) : null}

      {pendingReplacement ? (
        <Modal title="Replace the current resume?" onClose={() => setPendingReplacement(null)}>
          <div className="modal__body">
            <p className="modal__message">
              {pendingReplacement.kind === "open"
                ? `Opening ${pendingReplacement.title} will replace the draft currently saved in this browser.`
                : "Starting fresh will replace the draft currently saved in this browser."}
            </p>
            <p className="modal__support">Download a .resume copy first if you want to keep the current version.</p>
          </div>
          <footer className="modal__foot">
            <button type="button" className="button button--quiet" onClick={() => setPendingReplacement(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="button button--primary"
              data-autofocus="true"
              onClick={() => applyReplacement(pendingReplacement)}
            >
              {pendingReplacement.kind === "open" ? "Open resume" : "Start fresh"}
            </button>
          </footer>
        </Modal>
      ) : null}
    </div>
  );
}
