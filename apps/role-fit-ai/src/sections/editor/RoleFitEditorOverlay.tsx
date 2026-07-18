import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import type { TypesetEditorOverlayContext } from "@typeset/editor/sections/editor/TypesetEditor.tsx";
import { PAGE_WIDTH_BP } from "@typeset/engine/typeset/blocks.ts";
import type { EntryTextField } from "@typeset/engine/lib/styleFieldFormatting.ts";
import type { TailorMode } from "../../lib/tailorScope.ts";
import type { TailorChangeTarget } from "../../resume/types.ts";
import type { ResumeEditorActions } from "../../hooks/useResumeEditor.ts";

const TAILOR_MODES: Array<{ mode: TailorMode; label: string }> = [
  { mode: "tailor", label: "Tailor" },
  { mode: "include", label: "Include" },
  { mode: "off", label: "Off" }
];

const ENTRY_FIELDS: Array<{ field: EntryTextField; label: string; placeholder: string }> = [
  { field: "titleLeft", label: "Title", placeholder: "Role, project, school, or award" },
  { field: "titleRight", label: "Right of title", placeholder: "Dates, link, GPA, or detail" },
  { field: "subtitleLeft", label: "Subtitle", placeholder: "Company, stack, degree, or focus" },
  { field: "subtitleRight", label: "Right of subtitle", placeholder: "Location or detail" }
];

function isEntryField(field: TailorChangeTarget["field"]): field is EntryTextField {
  return ENTRY_FIELDS.some((item) => item.field === field);
}

type RoleFitEditorOverlayProps = TypesetEditorOverlayContext & {
  actions: ResumeEditorActions;
  tailorModes: Record<string, TailorMode>;
  onSetTailorMode: (sectionId: string, mode: TailorMode) => void;
  highlightTarget: TailorChangeTarget | null;
};

// The shared editor owns every editing and structure control. This overlay is
// deliberately limited to RoleFit's host chrome: per-section AI scope and the
// entry-details recovery surface for an empty review target that has no painted
// glyph to highlight yet.
export function RoleFitEditorOverlay({
  data,
  anchors,
  anchor,
  pageOrigins,
  zoom,
  geometry,
  actions,
  tailorModes,
  onSetTailorMode,
  highlightTarget
}: RoleFitEditorOverlayProps) {
  const detailsRef = useRef<HTMLDivElement | null>(null);
  const reviewDetailsKeyRef = useRef<string | null>(null);
  const [detailsTarget, setDetailsTarget] = useState<{ sectionId: string; entryId: string } | null>(null);

  useEffect(() => {
    const nextKey =
      highlightTarget?.entryId && isEntryField(highlightTarget.field)
        ? `${highlightTarget.sectionId}:${highlightTarget.entryId}:${highlightTarget.field}`
        : null;
    if (nextKey === reviewDetailsKeyRef.current) return;
    if (reviewDetailsKeyRef.current) setDetailsTarget(null);
    reviewDetailsKeyRef.current = null;
    if (!nextKey || !highlightTarget?.entryId || !isEntryField(highlightTarget.field)) return;
    const entry = data.sections
      .find((item) => item.id === highlightTarget.sectionId)
      ?.items.find((item) => item.id === highlightTarget.entryId);
    if (!entry || entry[highlightTarget.field].trim()) return;
    reviewDetailsKeyRef.current = nextKey;
    setDetailsTarget({ sectionId: highlightTarget.sectionId, entryId: highlightTarget.entryId });
  }, [data, highlightTarget]);

  useEffect(() => {
    if (!detailsTarget) return;
    const closeOutside = (event: globalThis.PointerEvent) => {
      if (!detailsRef.current?.contains(event.target as Node)) setDetailsTarget(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDetailsTarget(null);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [detailsTarget]);

  const heading = anchor && anchors ? anchors.headings.get(anchor.sectionId) ?? null : null;
  const headingOrigin = heading ? pageOrigins[heading.page] ?? null : null;
  const sectionMode = anchor ? tailorModes[anchor.sectionId] ?? "off" : "off";

  const detailsSection = detailsTarget
    ? data.sections.find((section) => section.id === detailsTarget.sectionId)
    : null;
  const detailsEntry = detailsSection?.items.find((entry) => entry.id === detailsTarget?.entryId) ?? null;
  const detailsAnchor = detailsTarget
    ? anchors?.blocks.find((block) => block.kind === "entry" && block.entryId === detailsTarget.entryId)
      ?? anchors?.blocks.find((block) => block.entryId === detailsTarget.entryId)
      ?? null
    : null;
  const detailsOrigin = detailsAnchor ? pageOrigins[detailsAnchor.page] ?? null : null;
  const highlightedField =
    detailsTarget
    && highlightTarget?.entryId === detailsTarget.entryId
    && highlightTarget.sectionId === detailsTarget.sectionId
    && isEntryField(highlightTarget.field)
      ? highlightTarget.field
      : null;

  return (
    <>
      {anchor && heading && headingOrigin ? (
        <div
          className="ts-chrome ts-chrome--chips ts-structure-overlay"
          role="radiogroup"
          aria-label="Section tailor mode"
          style={{
            left: headingOrigin.left,
            top: headingOrigin.top + heading.top * zoom - 2,
            width: PAGE_WIDTH_BP * zoom,
            paddingRight: Math.max(geometry.marginRight * zoom - 4, 0)
          }}
        >
          {TAILOR_MODES.map(({ mode, label }, index) => (
            <button
              key={mode}
              type="button"
              role="radio"
              className={`ts-chip${sectionMode === mode ? " is-on" : ""}`}
              aria-checked={sectionMode === mode}
              tabIndex={sectionMode === mode ? 0 : -1}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSetTailorMode(anchor.sectionId, mode)}
              onKeyDown={(event) => {
                if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
                event.preventDefault();
                const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : TAILOR_MODES.length - 1;
                const next = (index + delta) % TAILOR_MODES.length;
                onSetTailorMode(anchor.sectionId, TAILOR_MODES[next].mode);
                (event.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
              }}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {detailsTarget && detailsEntry && detailsAnchor && detailsOrigin ? (
        <div
          ref={detailsRef}
          className="ts-entry-details ts-structure-overlay"
          style={{
            left: detailsOrigin.left + Math.max(geometry.marginLeft * zoom, 8),
            top: detailsOrigin.top + detailsAnchor.bottom * zoom + 8
          }}
        >
          <div className="ts-entry-details__head">
            <strong>Entry details</strong>
            <button
              type="button"
              className="ts-entry-details__close"
              onClick={() => setDetailsTarget(null)}
              aria-label="Close entry details"
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
          <div className="ts-entry-details__grid">
            {ENTRY_FIELDS.map(({ field, label, placeholder }) => (
              <label className="ts-entry-details__field" key={field}>
                <span>{label}</span>
                <input
                  className={highlightedField === field ? "is-highlighted" : undefined}
                  value={detailsEntry[field]}
                  placeholder={placeholder}
                  onChange={(event) => actions.updateEntry(detailsTarget.sectionId, detailsTarget.entryId, field, event.target.value)}
                />
              </label>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
