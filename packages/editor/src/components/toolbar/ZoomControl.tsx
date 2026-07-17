import { Minus, Plus } from "lucide-react";

import type { DocStyleControls } from "../../hooks/useDocStyle";
import { DOC_ZOOM_OPTIONS, nextZoomOption } from "@typeset/engine/lib/documentStyle.ts";
import { ToolbarButton } from "./ToolbarButton";

export type ZoomControlProps = {
  docStyle: DocStyleControls;
  onFitZoom?: () => void;
};

export function ZoomControl({ docStyle, onFitZoom }: ZoomControlProps) {
  const zoomOptions = DOC_ZOOM_OPTIONS as readonly number[];
  const isPresetZoom = zoomOptions.includes(docStyle.style.zoom);

  return (
    <div className="top-toolbar__zoom" role="group" aria-label="Page zoom">
      <ToolbarButton
        label="Zoom out"
        tooltip="Zoom out"
        icon={<Minus size={15} />}
        onClick={() => docStyle.set("zoom", nextZoomOption(docStyle.style.zoom, -1))}
        disabled={docStyle.style.zoom <= zoomOptions[0]}
      />
      <label className="top-toolbar__zoom-select">
        <span className="sr-only">Page zoom</span>
        <select
          value={String(docStyle.style.zoom)}
          onChange={(event) => {
            if (event.target.value === "fit") onFitZoom?.();
            else docStyle.set("zoom", Number(event.target.value));
          }}
          aria-label="Page zoom"
        >
          {!isPresetZoom ? (
            <option value={String(docStyle.style.zoom)}>{Math.round(docStyle.style.zoom * 100)}%</option>
          ) : null}
          {onFitZoom ? <option value="fit">Fit page</option> : null}
          {zoomOptions.map((zoom) => (
            <option key={zoom} value={String(zoom)}>
              {Math.round(zoom * 100)}%
            </option>
          ))}
        </select>
      </label>
      <ToolbarButton
        label="Zoom in"
        tooltip="Zoom in"
        icon={<Plus size={15} />}
        onClick={() => docStyle.set("zoom", nextZoomOption(docStyle.style.zoom, 1))}
        disabled={docStyle.style.zoom >= zoomOptions[zoomOptions.length - 1]}
      />
    </div>
  );
}
