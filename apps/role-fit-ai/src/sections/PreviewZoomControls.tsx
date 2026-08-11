import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";

export const PREVIEW_ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
export const DEFAULT_PREVIEW_ZOOM_INDEX = 2;

export function usePreviewZoom(active: boolean, resetKey: string) {
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_PREVIEW_ZOOM_INDEX);

  useEffect(() => {
    setZoomIndex(DEFAULT_PREVIEW_ZOOM_INDEX);
  }, [resetKey]);

  useEffect(() => {
    if (!active) return;
    function onKeyDown(event: KeyboardEvent) {
      // A literal "+" normally requires Shift, so rejecting Shift makes the
      // documented Ctrl/Cmd + shortcut impossible on common keyboards.
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.key === "=" || event.key === "+") {
        event.preventDefault();
        setZoomIndex((index) => Math.min(index + 1, PREVIEW_ZOOM_STEPS.length - 1));
      } else if (event.key === "-") {
        event.preventDefault();
        setZoomIndex((index) => Math.max(index - 1, 0));
      } else if (event.key === "0") {
        event.preventDefault();
        setZoomIndex(DEFAULT_PREVIEW_ZOOM_INDEX);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [active]);

  return {
    zoom: PREVIEW_ZOOM_STEPS[zoomIndex],
    zoomIndex,
    setZoomIndex
  };
}

export function PreviewZoomControls({
  zoomIndex,
  setZoomIndex
}: {
  zoomIndex: number;
  setZoomIndex: Dispatch<SetStateAction<number>>;
}) {
  return (
    <div className="preview-overlay__zoom">
      <button
        type="button"
        className="preview-overlay__zoom-btn"
        onClick={() => setZoomIndex((index) => Math.max(index - 1, 0))}
        disabled={zoomIndex === 0}
        aria-label="Zoom out"
        title="Zoom out"
      >
        <Minus size={14} aria-hidden="true" />
      </button>
      <span className="preview-overlay__zoom-label" aria-live="polite" aria-atomic="true">
        {Math.round(PREVIEW_ZOOM_STEPS[zoomIndex] * 100)}%
      </span>
      <button
        type="button"
        className="preview-overlay__zoom-btn"
        onClick={() => setZoomIndex((index) => Math.min(index + 1, PREVIEW_ZOOM_STEPS.length - 1))}
        disabled={zoomIndex === PREVIEW_ZOOM_STEPS.length - 1}
        aria-label="Zoom in"
        title="Zoom in"
      >
        <Plus size={14} aria-hidden="true" />
      </button>
      {zoomIndex !== DEFAULT_PREVIEW_ZOOM_INDEX ? (
        <button
          type="button"
          className="preview-overlay__zoom-btn"
          onClick={() => setZoomIndex(DEFAULT_PREVIEW_ZOOM_INDEX)}
          aria-label="Reset zoom"
          title="Reset zoom"
        >
          <RotateCcw size={12} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
