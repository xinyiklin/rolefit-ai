import { memo, useRef } from "react";
import { ExternalLink, ScrollText, X } from "lucide-react";
import { useModalFocus } from "@typeset/editor/hooks/useModalFocus.ts";
import { PreviewZoomControls, usePreviewZoom } from "../PreviewZoomControls";
import type { Application } from "../../hooks/useApplications";
import { safeExternalUrl } from "../../lib/applicationDisplay";

type ApplicationPostingOverlayProps = {
  open: boolean;
  application: Application;
  onClose: () => void;
};

export const ApplicationPostingOverlay = memo(function ApplicationPostingOverlay({
  open,
  application,
  onClose
}: ApplicationPostingOverlayProps) {
  const chromeRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const originalPosting = application.rawJobDescription?.trim() ?? "";
  const preparedPosting = application.jobDescription?.trim() ?? "";
  const postingText = originalPosting || preparedPosting;
  const heading = originalPosting ? "Original posting" : preparedPosting ? "Prepared job text" : "Job posting";
  const helper = originalPosting
    ? "Read-only capture saved with this job."
    : preparedPosting
      ? "The original capture was not saved; this is the prepared job text."
      : "The full posting was not saved with this record.";
  const safeJobUrl = safeExternalUrl(application.jobUrl);
  const { zoom, zoomIndex, setZoomIndex } = usePreviewZoom(open, `${application.id}:${open}`);
  const handleModalKeyDown = useModalFocus({
    active: open,
    containerRef: chromeRef,
    initialFocusRef: closeButtonRef,
    onClose
  });

  if (!open) return null;

  return (
    <div
      className="preview-overlay application-posting-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="application-posting-overlay-title"
      onKeyDown={handleModalKeyDown}
    >
      <div className="preview-overlay__backdrop" aria-hidden="true" onMouseDown={onClose} />

      <div className="preview-overlay__chrome application-posting-overlay__chrome" ref={chromeRef} tabIndex={-1}>
        <div className="preview-overlay__head">
          <span className="preview-overlay__title" id="application-posting-overlay-title">
            <ScrollText size={14} aria-hidden="true" />
            Job posting
          </span>
          <div className="preview-overlay__controls">
            <PreviewZoomControls zoomIndex={zoomIndex} setZoomIndex={setZoomIndex} />
            {safeJobUrl ? (
              <a
                className="application-posting-overlay__external"
                href={safeJobUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="Open job link"
                title="Open job link"
              >
                <span>Open job link</span><ExternalLink size={13} aria-hidden="true" />
              </a>
            ) : null}
            <button
              ref={closeButtonRef}
              className="preview-overlay__close"
              type="button"
              onClick={onClose}
              aria-label="Close job posting"
              title="Close job posting"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="preview-overlay__body application-posting-overlay__body">
          <div className="application-posting-overlay__scroll">
            <article className="application-posting-overlay__document">
              <header className="application-posting-overlay__document-head">
                <h2>{heading}</h2>
                <p>{helper}</p>
              </header>

              {postingText ? (
                <pre
                  className="application-posting-overlay__reader"
                  style={{ fontSize: `${0.78 * zoom}rem` }}
                  tabIndex={0}
                  aria-label={heading}
                >
                  {postingText}
                </pre>
              ) : (
                <div className="application-posting-overlay__empty">
                  <strong>Posting unavailable</strong>
                  <p>No original or prepared posting text is attached to this saved record.</p>
                </div>
              )}
            </article>
          </div>
        </div>
      </div>
    </div>
  );
});
