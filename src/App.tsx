import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { Eye, FileCode2, FileDown, RotateCcw, Upload } from "lucide-react";

import { useResumeEditor } from "./hooks/useResumeEditor";
import { useDocStyle, DOC_ZOOM_OPTIONS, DOC_SPACING_PRESETS, type DocStyle } from "./hooks/useDocStyle";
import { useTemplates } from "./hooks/useTemplates";
import { useResumeExport } from "./hooks/useResumeExport";
import { ResumeEditor } from "./sections/editor/ResumeEditor";
import { ResumePrintLayer } from "./sections/ResumePrintLayer";
import { Modal } from "./components/Modal";
import { buildStarterResume, reidResume } from "./sampleResume";
import { fileToText } from "./lib/importResume";
import type { ResumeData } from "./lib/resumeData";

const STORAGE_KEY = "jakeforge.resume.v1";

function loadSavedResume(): ResumeData | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return reidResume(JSON.parse(raw) as ResumeData);
  } catch {
    return null;
  }
}

// Fine-grained layout/spacing controls — line height + the three vertical gaps.
// Ranges mirror role-fit-ai's Format menu.
const SPACING_SLIDERS: { key: "lineHeight" | "sectionGap" | "entryGap" | "bulletGap"; label: string; min: number; max: number; unit: string }[] = [
  { key: "lineHeight", label: "Line height", min: 1, max: 1.6, unit: "" },
  { key: "sectionGap", label: "Section gap", min: 0, max: 1.6, unit: "em" },
  { key: "entryGap", label: "Entry gap", min: 0, max: 1.2, unit: "em" },
  // Controls the gap between repeated lines inside a section — bullets, skill
  // rows, and summary lines all read from --doc-bullet-gap, so "Line gap" names
  // it honestly rather than implying bullets only.
  { key: "bulletGap", label: "Line gap", min: 0, max: 1, unit: "em" }
];

// Labeled range input for one spacing dimension.
function SpacingSlider({
  label,
  value,
  min,
  max,
  unit,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="ctl-slider">
      <span className="ctl-slider__head">
        {label}
        <small className="ctl-slider__value">
          {value.toFixed(2)}
          {unit}
        </small>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={0.01}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={label}
      />
    </label>
  );
}

function AnimatedSeg<K extends string>({
  items,
  activeKey,
  onSelect
}: {
  items: { key: K; label: string }[];
  activeKey: K | null;
  onSelect: (key: K) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<Map<K, HTMLButtonElement>>(new Map());
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);

  const measure = useCallback(() => {
    if (!activeKey || !containerRef.current) { setPill(null); return; }
    const btn = btnRefs.current.get(activeKey);
    if (!btn) { setPill(null); return; }
    const cr = containerRef.current.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    setPill({ left: br.left - cr.left, width: br.width });
  }, [activeKey]);

  useLayoutEffect(measure, [measure]);
  useEffect(() => { window.addEventListener("resize", measure); return () => window.removeEventListener("resize", measure); }, [measure]);

  return (
    <div className="seg" ref={containerRef}>
      {pill && (
        <span
          className="seg__pill"
          style={{ transform: `translateX(${pill.left}px)`, width: pill.width }}
        />
      )}
      {items.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          ref={(el) => { if (el) btnRefs.current.set(key, el); else btnRefs.current.delete(key); }}
          className={`seg__opt${activeKey === key ? " is-active" : ""}`}
          onClick={() => onSelect(key)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// Common contact separators offered as one-tap chips (any 1–2 chars still work
// via the custom input).
const COMMON_DIVIDERS = ["|", "•", "·", "–", "/"];

// A pill that toggles a boolean DocStyle flag — filled when active. Reads more
// like a formatting toolbar than a column of checkboxes.
function ToggleChip({
  label,
  active,
  onClick
}: {
  label: string;
  active: boolean;
  onClick: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={`chip${active ? " is-active" : ""}`}
      aria-pressed={active}
      onClick={() => onClick(!active)}
    >
      {label}
    </button>
  );
}

export default function App() {
  const editor = useResumeEditor();
  const docStyle = useDocStyle();
  const templates = useTemplates();
  const [texStatus, setTexStatus] = useState("");

  const selectedTemplate =
    templates.templates.find((t) => t.id === templates.selectedTemplateId) ?? null;

  const exporter = useResumeExport({
    editedResume: editor.editedResume,
    currentResumeText: editor.serializedResume,
    selectedTemplateId: templates.selectedTemplateId,
    selectedTemplate,
    renderTex: templates.renderTex,
    renderPdf: templates.renderPdf,
    renderTexFromSchema: templates.renderTexFromSchema,
    renderPdfFromSchema: templates.renderPdfFromSchema,
    docStyle: docStyle.style,
    tectonic: templates.tectonic,
    setTexStatus
  });

  // Seed once: saved work if present, otherwise the Jake's sample.
  useEffect(() => {
    editor.seedData(loadSavedResume() ?? buildStarterResume());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the structured model (debounced) so a reload keeps the user's work.
  const saveTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!editor.editedResume) return;
    window.clearTimeout(saveTimer.current);
    const snapshot = editor.editedResume;
    saveTimer.current = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
      } catch {
        // Storage unavailable (private mode) — edits still apply this session.
      }
    }, 400);
    return () => window.clearTimeout(saveTimer.current);
  }, [editor.editedResume]);

  // Intercept Ctrl/Cmd +/- (and 0 to reset) to step page zoom instead of the
  // browser's own zoom, matching role-fit-ai.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      const zoomOptions = DOC_ZOOM_OPTIONS as readonly number[];
      const currentIndex = zoomOptions.indexOf(docStyle.style.zoom);
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        const next = currentIndex < zoomOptions.length - 1 ? currentIndex + 1 : currentIndex;
        if (next !== currentIndex) docStyle.set("zoom", zoomOptions[next]);
      } else if (e.key === "-") {
        e.preventDefault();
        const prev = currentIndex > 0 ? currentIndex - 1 : currentIndex;
        if (prev !== currentIndex) docStyle.set("zoom", zoomOptions[prev]);
      } else if (e.key === "0") {
        e.preventDefault();
        docStyle.set("zoom", 1);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [docStyle]);

  // The "PDF · clean" button is gone — users print via ⌘P / Ctrl+P (the print
  // CSS isolates the resume). Seed the browser's suggested filename from the
  // resume on any manual print, restoring the page title afterward.
  useEffect(() => {
    function onBeforePrint() {
      document.title = exporter.resumeDownloadName("pdf").replace(/\.pdf$/i, "");
    }
    function onAfterPrint() {
      document.title = "jakeforge — Jake's-style resume editor";
    }
    window.addEventListener("beforeprint", onBeforePrint);
    window.addEventListener("afterprint", onAfterPrint);
    return () => {
      window.removeEventListener("beforeprint", onBeforePrint);
      window.removeEventListener("afterprint", onAfterPrint);
    };
  }, [exporter]);


  function seedFromText(text: string) {
    editor.seed(text);
    setTexStatus("");
  }

  // Direct drag-and-drop + click-to-browse import on the sidebar zone.
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importDragOver, setImportDragOver] = useState(false);

  async function handleImportFile(file: File | null | undefined) {
    if (!file) return;
    try {
      seedFromText(await fileToText(file));
    } catch (e) {
      setTexStatus(e instanceof Error ? e.message : "Could not read that file.");
    }
  }

  function handleImportDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setImportDragOver(false);
    void handleImportFile(event.dataTransfer.files?.[0]);
  }

  function handleImportChange(event: ChangeEvent<HTMLInputElement>) {
    void handleImportFile(event.target.files?.[0]);
    // Reset so re-selecting the same file fires onChange again.
    event.target.value = "";
  }

  const spacingActive = (values: DocStyle) =>
    docStyle.style.lineHeight === values.lineHeight &&
    docStyle.style.sectionGap === values.sectionGap &&
    docStyle.style.entryGap === values.entryGap &&
    docStyle.style.bulletGap === values.bulletGap;

  const activePresetKey = Object.entries(DOC_SPACING_PRESETS).find(
    ([, p]) => spacingActive({ ...docStyle.style, ...p.values })
  )?.[0] as string | null ?? null;

  const presetItems = Object.entries(DOC_SPACING_PRESETS).map(([key, p]) => ({ key, label: p.label }));

  const tectonicOff = !templates.tectonic.available;

  // Rename-before-download. The export handlers take a base name (no extension);
  // this dialog collects it, pre-filled with the resume-derived default.
  const [renameTarget, setRenameTarget] = useState<{ kind: "pdf" | "tex" } | null>(null);
  const [renameValue, setRenameValue] = useState("");



  // Generic confirm dialog (used by destructive actions like "Load sample").
  const [confirmState, setConfirmState] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    onConfirm: () => void;
  } | null>(null);

  function openRename(kind: "pdf" | "tex") {
    setRenameValue(exporter.resumeDownloadName(kind).replace(/\.(pdf|tex)$/i, ""));
    setRenameTarget({ kind });
  }

  function confirmRename() {
    if (!renameTarget) return;
    const base = renameValue.trim() || undefined;
    if (renameTarget.kind === "pdf") exporter.handleDownloadLatexPdf(base);
    else exporter.handleDownloadTex(base);
    setRenameTarget(null);
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand__mark">jakeforge</span>
          <span className="brand__sub">Jake&apos;s-style resume editor</span>
        </div>

        <div className="sidebar__actions">
          <label
            className={`sidebar__drop${importDragOver ? " is-dragover" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setImportDragOver(true);
            }}
            onDragLeave={() => setImportDragOver(false)}
            onDrop={handleImportDrop}
            title="Click to browse or drop a .txt / .md / .tex / .docx file"
          >
            <input
              ref={importInputRef}
              type="file"
              accept=".txt,.md,.markdown,.tex,.docx"
              hidden
              onChange={handleImportChange}
            />
            <Upload size={15} aria-hidden="true" />
            <span>Import resume</span>
            <small>.txt · .md · .tex · .docx</small>
          </label>
        </div>

        <section className="panel">
          <h2 className="panel__title">Export</h2>
          <div className="export-row">
            <button
              type="button"
              className="btn btn--primary export-row__main"
              onClick={() => openRename("pdf")}
              disabled={tectonicOff || exporter.isRenderingLatexPdf}
              title={tectonicOff ? "Install Tectonic (brew install tectonic) for LaTeX PDF" : "Download PDF (Tectonic)"}
            >
              <FileDown size={15} aria-hidden="true" />
              {exporter.isRenderingLatexPdf ? "Compiling…" : "PDF"}
            </button>
            <button
              type="button"
              className="btn export-row__icon"
              onClick={() => exporter.handlePreview()}
              disabled={tectonicOff || exporter.isPreviewLoading}
              title={tectonicOff ? "Install Tectonic (brew install tectonic) for preview" : "Preview PDF"}
              aria-label="Preview PDF"
            >
              <Eye size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="btn export-row__icon"
              onClick={() => openRename("tex")}
              disabled={exporter.isDownloadingTex}
              title="Download LaTeX source (.tex)"
              aria-label="Download LaTeX source"
            >
              <FileCode2 size={16} aria-hidden="true" />
            </button>
          </div>
          {tectonicOff ? (
            <p className="panel__hint">
              LaTeX PDF &amp; preview need Tectonic. <code>brew install tectonic</code>, then restart. Clean PDF via
              ⌘P / Ctrl+P always works.
            </p>
          ) : null}
          {texStatus ? <p className="panel__status">{texStatus}</p> : null}
        </section>

        <section className="panel">
          <h2 className="panel__title">Layout &amp; spacing</h2>
          <label className="ctl-row">
            <span>Zoom</span>
            <select
              value={docStyle.style.zoom}
              onChange={(event) => docStyle.set("zoom", Number(event.target.value))}
            >
              {DOC_ZOOM_OPTIONS.map((zoom) => (
                <option key={zoom} value={zoom}>
                  {Math.round(zoom * 100)}%
                </option>
              ))}
            </select>
          </label>
          <div className="ctl-row">
            <span>Preset</span>
            <AnimatedSeg
              items={presetItems}
              activeKey={activePresetKey}
              onSelect={(key) => docStyle.applySpacingPreset(DOC_SPACING_PRESETS[key as keyof typeof DOC_SPACING_PRESETS].values)}
            />
          </div>
          <div className="panel__stack">
            {SPACING_SLIDERS.map(({ key, label, min, max, unit }) => (
              <SpacingSlider
                key={key}
                label={label}
                value={docStyle.style[key]}
                min={min}
                max={max}
                unit={unit}
                onChange={(value) => docStyle.set(key, value)}
              />
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel__header">
            <h2 className="panel__title">Typography</h2>
            <button
              type="button"
              className="icon-btn"
              onClick={docStyle.resetTypography}
              disabled={docStyle.isTypographyDefault}
              title="Reset typography"
              aria-label="Reset typography"
            >
              <RotateCcw size={14} aria-hidden="true" />
            </button>
          </div>

          <div className="ctl-group">
            <span className="ctl-group__label">Contact divider</span>
            <div className="chip-row">
              {COMMON_DIVIDERS.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`chip chip--glyph${docStyle.style.contactDivider === d ? " is-active" : ""}`}
                  aria-pressed={docStyle.style.contactDivider === d}
                  aria-label={`Divider ${d}`}
                  onClick={() => docStyle.set("contactDivider", d)}
                >
                  {d}
                </button>
              ))}
              <input
                className="ctl-divider"
                type="text"
                maxLength={2}
                value={docStyle.style.contactDivider}
                placeholder="…"
                aria-label="Custom contact divider (1–2 characters)"
                title="Custom divider"
                onChange={(e) => docStyle.set("contactDivider", e.target.value.slice(0, 2))}
              />
            </div>
          </div>

          <div className="ctl-group">
            <span className="ctl-group__label">Section headings</span>
            <div className="chip-row">
              <ToggleChip label="Uppercase" active={docStyle.style.uppercaseHeadings} onClick={(v) => docStyle.set("uppercaseHeadings", v)} />
              <ToggleChip label="Underline" active={docStyle.style.sectionRule} onClick={(v) => docStyle.set("sectionRule", v)} />
              <ToggleChip label="Bold" active={docStyle.style.boldHeadings} onClick={(v) => docStyle.set("boldHeadings", v)} />
            </div>
          </div>

          <div className="ctl-group">
            <span className="ctl-group__label">Entries &amp; skills</span>
            <div className="chip-row">
              <ToggleChip label="Bold title" active={docStyle.style.boldTitles} onClick={(v) => docStyle.set("boldTitles", v)} />
              <ToggleChip label="Italic subtitle" active={docStyle.style.italicSubtitles} onClick={(v) => docStyle.set("italicSubtitles", v)} />
              <ToggleChip label="Italic date" active={docStyle.style.italicDates} onClick={(v) => docStyle.set("italicDates", v)} />
              <ToggleChip label="Bold skills" active={docStyle.style.boldSkillLabels} onClick={(v) => docStyle.set("boldSkillLabels", v)} />
            </div>
          </div>
        </section>
      </aside>

      <main className="canvas">
        {editor.editedResume ? (
          <ResumeEditor data={editor.editedResume} actions={editor.actions} style={docStyle.cssVars} />
        ) : null}
      </main>

      {editor.editedResume ? (
        <ResumePrintLayer
          resume={editor.editedResume}
          polishedText={editor.serializedResume}
          docStyleVars={docStyle.cssVars}
        />
      ) : null}

      {exporter.isPreviewOpen ? (
        <Modal title="PDF preview" size="lg" onClose={exporter.handleClosePreview}>
          <div className="modal__body modal__body--flush">
            {exporter.isPreviewLoading ? (
              <p className="modal__msg">Compiling with Tectonic…</p>
            ) : exporter.previewError ? (
              <p className="modal__msg modal__msg--error">{exporter.previewError}</p>
            ) : exporter.previewPdfUrl ? (
              <iframe className="modal__frame" title="Resume PDF preview" src={exporter.previewPdfUrl} />
            ) : null}
          </div>
        </Modal>
      ) : null}

      {renameTarget ? (
        <Modal title="Download as" ariaLabel="Rename before download" onClose={() => setRenameTarget(null)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              confirmRename();
            }}
          >
            <div className="modal__body">
              <label className="dialog__field">
                <span>File name</span>
                <span className="dialog__input">
                  <input
                    type="text"
                    value={renameValue}
                    autoFocus
                    onFocus={(event) => event.target.select()}
                    onChange={(event) => setRenameValue(event.target.value)}
                    aria-label="File name (without extension)"
                  />
                  <span className="dialog__ext">.{renameTarget.kind}</span>
                </span>
              </label>
            </div>
            <div className="modal__foot">
              <button type="button" className="btn btn--ghost" onClick={() => setRenameTarget(null)}>
                Cancel
              </button>
              <button type="submit" className="btn btn--primary">
                <FileDown size={15} aria-hidden="true" /> Download
              </button>
            </div>
          </form>
        </Modal>
      ) : null}



      {confirmState ? (
        <Modal title={confirmState.title} onClose={() => setConfirmState(null)}>
          <div className="modal__body">
            <p className="modal__msg">{confirmState.message}</p>
          </div>
          <div className="modal__foot">
            <button type="button" className="btn btn--ghost" onClick={() => setConfirmState(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                confirmState.onConfirm();
                setConfirmState(null);
              }}
            >
              {confirmState.confirmLabel}
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
