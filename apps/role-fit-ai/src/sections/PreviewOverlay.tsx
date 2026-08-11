import { useEffect, useRef, useState } from "react";
import { Download, Eye, X } from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";

import { downloadBlob } from "@typeset/engine/lib/download.ts";
import { useModalFocus } from "@typeset/editor/hooks/useModalFocus.ts";
import { PreviewZoomControls, usePreviewZoom } from "./PreviewZoomControls";

// Use the bundled worker so no extra static-asset config is needed.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

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
  const [downloadError, setDownloadError] = useState("");
  const chromeRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const { zoom, zoomIndex, setZoomIndex } = usePreviewZoom(isOpen, pdfUrl);
  const handleModalKeyDown = useModalFocus({
    active: isOpen,
    containerRef: chromeRef,
    initialFocusRef: closeButtonRef,
    onClose
  });

  useEffect(() => {
    setNumPages(null);
    setDownloadError("");
  }, [pdfUrl]);

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
      aria-label={`Saved document PDF preview: ${fileName}`}
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
            <PreviewZoomControls zoomIndex={zoomIndex} setZoomIndex={setZoomIndex} />

            <button
              type="button"
              className="preview-overlay__download"
              onClick={handleDownload}
              disabled={!canDownload}
              aria-label="Download PDF"
              title="Download PDF"
            >
              <Download size={14} aria-hidden="true" />
            </button>

            <button
              ref={closeButtonRef}
              className="preview-overlay__close"
              type="button"
              onClick={onClose}
              aria-label="Close preview"
              title="Close preview"
            >
              <X size={16} aria-hidden="true" />
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
