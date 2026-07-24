import { useEffect, useRef, useState } from "react";
import { Download, Eye, Minus, Plus, RotateCcw, X } from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";

import { downloadBlob } from "@typeset/engine/lib/download.ts";
import { useModalFocus } from "@typeset/editor/hooks/useModalFocus.ts";

// Use the bundled worker so no extra static-asset config is needed.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
const DEFAULT_ZOOM_INDEX = 2; // 100%

// Views a saved application's stored PDF via react-pdf (react-pdf owns its own
// loading/error UI). The live resume needs no compile preview — the editor is
// its own WYSIWYG surface — so this overlay only ever shows a saved PDF URL.
type PreviewOverlayProps = {
  isOpen: boolean;
  pdfUrl?: string;
  fileName: string;
  onClose: () => void;
};

export default function PreviewOverlay({
  isOpen,
  pdfUrl = "",
  fileName,
  onClose
}: PreviewOverlayProps) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const [downloadError, setDownloadError] = useState("");
  const chromeRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const zoom = ZOOM_STEPS[zoomIndex];
  const handleModalKeyDown = useModalFocus({
    active: isOpen,
    containerRef: chromeRef,
    initialFocusRef: closeButtonRef,
    onClose
  });

  // Reset zoom (and any stale download failure) when a new PDF loads.
  useEffect(() => {
    setNumPages(null);
    setDownloadError("");
    if (pdfUrl) setZoomIndex(DEFAULT_ZOOM_INDEX);
  }, [pdfUrl]);

  // Keyboard zoom: Ctrl/Cmd +/- within the overlay.
  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        setZoomIndex((i) => Math.min(i + 1, ZOOM_STEPS.length - 1));
      } else if (e.key === "-") {
        e.preventDefault();
        setZoomIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "0") {
        e.preventDefault();
        setZoomIndex(DEFAULT_ZOOM_INDEX);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  async function handleDownload() {
    if (!pdfUrl) return;
    setDownloadError("");
    try {
      const response = await fetch(pdfUrl);
      // A 404/500 reply carries a JSON error body, not a PDF — blobbing it
      // would save a corrupt "*.pdf" the user might upload to a real
      // application. Surface the failure instead.
      if (!response.ok) throw new Error(`Download failed (${response.status}).`);
      downloadBlob(await response.blob(), fileName);
    } catch {
      setDownloadError("Download failed — the saved PDF may be missing. Re-save it from Apply, then try again.");
    }
  }
  const canDownload = Boolean(pdfUrl);

  if (!isOpen) return null;

  return (
    <div
      className="preview-overlay"
      role="dialog"
      aria-label="Resume PDF preview"
      aria-modal="true"
      onKeyDown={handleModalKeyDown}
    >
      <div className="preview-overlay__backdrop" aria-hidden="true" onMouseDown={onClose} />

      <div className="preview-overlay__chrome" ref={chromeRef} tabIndex={-1}>
        <div className="preview-overlay__head">
          <span className="preview-overlay__title">
            <Eye size={14} aria-hidden="true" />
            PDF Preview
            {numPages && numPages > 1 ? (
              <em className="preview-overlay__pages">{numPages} pages</em>
            ) : null}
          </span>

          <div className="preview-overlay__controls">
            <div className="preview-overlay__zoom">
              <button
                type="button"
                className="preview-overlay__zoom-btn"
                onClick={() => setZoomIndex((i) => Math.max(i - 1, 0))}
                disabled={zoomIndex === 0}
                aria-label="Zoom out"
                title="Zoom out"
              >
                <Minus size={14} />
              </button>
              <span className="preview-overlay__zoom-label">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                className="preview-overlay__zoom-btn"
                onClick={() => setZoomIndex((i) => Math.min(i + 1, ZOOM_STEPS.length - 1))}
                disabled={zoomIndex === ZOOM_STEPS.length - 1}
                aria-label="Zoom in"
                title="Zoom in"
              >
                <Plus size={14} />
              </button>
              {zoomIndex !== DEFAULT_ZOOM_INDEX ? (
                <button
                  type="button"
                  className="preview-overlay__zoom-btn"
                  onClick={() => setZoomIndex(DEFAULT_ZOOM_INDEX)}
                  aria-label="Reset zoom"
                  title="Reset zoom"
                >
                  <RotateCcw size={12} />
                </button>
              ) : null}
            </div>

            <button
              type="button"
              className="preview-overlay__download"
              onClick={handleDownload}
              disabled={!canDownload}
              aria-label="Download PDF"
              title="Download PDF"
            >
              <Download size={14} />
            </button>

            <button
              ref={closeButtonRef}
              className="preview-overlay__close"
              type="button"
              onClick={onClose}
              aria-label="Close preview"
              title="Close preview"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {downloadError ? (
          <p className="preview-overlay__notice" role="alert">
            {downloadError}
          </p>
        ) : null}

        <div className="preview-overlay__body">
          {pdfUrl ? (
            <div className="preview-overlay__scroll">
              <Document
                className="preview-overlay__document"
                file={pdfUrl}
                onLoadSuccess={({ numPages: n }) => setNumPages(n)}
                loading={
                  <div className="preview-overlay__loading" role="status">
                    <div className="preview-overlay__spinner" />
                    <span>Rendering…</span>
                  </div>
                }
                error={
                  <div className="preview-overlay__error" role="alert">
                    <strong>Render failed</strong>
                    <p>Could not display the PDF.</p>
                  </div>
                }
              >
                {Array.from({ length: numPages ?? 1 }, (_, i) => (
                  <Page
                    key={i + 1}
                    pageNumber={i + 1}
                    className="preview-overlay__page"
                    renderTextLayer={true}
                    renderAnnotationLayer={false}
                    scale={zoom}
                  />
                ))}
              </Document>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
