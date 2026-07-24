import type { FontFamily } from "@typeset/engine/lib/documentStyle.ts";
import { documentFontFamily } from "@typeset/engine/typeset/fontRegistry.ts";
import { faceFor } from "@typeset/engine/typeset/measure.ts";
import { browserFaceBox } from "@typeset/engine/typeset/render/dom.tsx";

import { displayIndexToCaret, lineOf } from "./domSelection.ts";
import type { TypesetSelection } from "./inlineTextEditing.ts";

export type CaretAppearance = {
  fontFamily: FontFamily;
  fontSizePt: number;
  bold: boolean;
  italic: boolean;
};

export type CaretOverlayGeometry = {
  left: number;
  top: number;
  height: number;
};

function caretClientX(node: Node, offset: number): number | null {
  const collapsed = document.createRange();
  try {
    collapsed.setStart(node, offset);
    collapsed.collapse(true);
    const rect = collapsed.getClientRects()[0];
    if (rect && Number.isFinite(rect.left)) return rect.left;
  } catch {
    // Fall through to a neighboring glyph or the containing empty span.
  }

  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    const probe = document.createRange();
    try {
      if (offset < text.length) {
        probe.setStart(node, offset);
        probe.setEnd(node, offset + 1);
        const rect = probe.getClientRects()[0];
        if (rect) return rect.left;
      }
      if (offset > 0) {
        probe.setStart(node, offset - 1);
        probe.setEnd(node, offset);
        const rect = probe.getClientRects()[0];
        if (rect) return rect.right;
      }
    } catch {
      // Use the containing span below.
    }
  }

  const element = node instanceof HTMLElement ? node : node.parentElement;
  return element?.getBoundingClientRect().left ?? null;
}

// Resolve a logical model caret into wrapper-relative pixels. The line exposes
// its engine baseline, while the DOM renderer's measured face box supplies the
// active font's ascent/descent. This keeps the caret aligned and sized even
// when the toolbar owns focus or the next-typing format differs from nearby ink.
export function caretOverlayGeometry(
  host: HTMLElement,
  wrapper: HTMLElement,
  selection: TypesetSelection,
  appearance: CaretAppearance,
  zoom: number
): CaretOverlayGeometry | null {
  if (selection.dStart !== selection.dEnd) return null;
  const position = displayIndexToCaret(
    host,
    selection.key,
    selection.map.display,
    selection.dStart
  );
  if (!position) return null;
  const line = lineOf(position.node);
  if (!line) return null;
  const clientX = caretClientX(position.node, position.offset);
  if (clientX === null) return null;

  const baseline = Number.parseFloat(
    line.style.getPropertyValue("--tsd-line-baseline")
  );
  if (!Number.isFinite(baseline)) return null;
  const family = documentFontFamily(appearance.fontFamily);
  const box = browserFaceBox(family, faceFor(appearance.bold, appearance.italic));
  const sizePx = appearance.fontSizePt * zoom;
  const lineRect = line.getBoundingClientRect();
  const wrapperRect = wrapper.getBoundingClientRect();

  return {
    left: clientX - wrapperRect.left,
    top: lineRect.top - wrapperRect.top + baseline - box.ascent * sizePx,
    height: Math.max(1, (box.ascent + box.descent) * sizePx)
  };
}
