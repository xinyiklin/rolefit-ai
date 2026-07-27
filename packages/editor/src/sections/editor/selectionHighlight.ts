const SELECTED_LINE_CLASS = "tsd-line--selected";
const LEFT_PROPERTY = "--tsd-selection-left";
const WIDTH_PROPERTY = "--tsd-selection-width";
const BOTTOM_PROPERTY = "--tsd-selection-bottom";

// Stub shown for a selected EMPTY paragraph, as a fraction of its line box —
// roughly one space, so a blank line still reads as selected.
const EMPTY_LINE_STUB = 0.2;

// Selection bands include engine-owned leading, exclude paragraph gaps, and tile overlaps.
export function selectionBandBottomOffset(
  line: { top: number; bottom: number; leading: number | null },
  next: { top: number; selected: boolean; samePage: boolean } | null
): number {
  const ink = Math.max(0, line.bottom - line.top);
  const box = line.leading !== null && line.leading > 0 ? line.leading : ink;
  const capped =
    next && next.selected && next.samePage ? Math.min(box, Math.max(0, next.top - line.top)) : box;
  return capped - ink;
}

type LineGeometry = {
  element: HTMLElement;
  rect: DOMRect;
  // Horizontal extent of the line's real text, relative to the line element.
  // The line element spans the whole sheet, so this is what bounds a highlight.
  textLeft: number;
  textRight: number;
  textHeight: number;
  // The line spacing this line owns, published by the engine's painter.
  leading: number | null;
  left: number;
  right: number;
};

// The painter publishes the leading in the same CSS length the rest of the page
// uses, so it is directly comparable with client-rect pixels.
function readLeading(line: HTMLElement): number | null {
  const raw = line.style.getPropertyValue("--tsd-line-leading").trim();
  if (!raw) return null;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function clearSelectionHighlights(host: HTMLElement): void {
  for (const line of host.querySelectorAll<HTMLElement>(`.${SELECTED_LINE_CLASS}`)) {
    line.classList.remove(SELECTED_LINE_CLASS);
    line.style.removeProperty(LEFT_PROPERTY);
    line.style.removeProperty(WIDTH_PROPERTY);
    line.style.removeProperty(BOTTOM_PROPERTY);
  }
}

// Replace fragmented native highlights with text-bounded rectangles per engine line.
export function paintSelectionHighlights(host: HTMLElement): void {
  clearSelectionHighlights(host);
  const selection = window.getSelection();
  if (
    !selection ||
    selection.rangeCount === 0 ||
    selection.isCollapsed ||
    !selection.anchorNode ||
    !selection.focusNode ||
    !host.contains(selection.anchorNode) ||
    !host.contains(selection.focusNode)
  ) {
    return;
  }

  const fragments = Array.from(selection.getRangeAt(0).getClientRects()).filter(
    (rect) => rect.width > 0 && rect.height > 0
  );
  if (!fragments.length) return;

  const lines: LineGeometry[] = Array.from(
    host.querySelectorAll<HTMLElement>(".tsd-line")
  ).map((element) => {
    const rect = element.getBoundingClientRect();
    // Inline text boxes only. Rules are absolutely positioned divs (a section
    // rule spans the whole column), and the bullet marker sits outside the
    // selectable value — the same exclusion the mapping in domSelection makes.
    const contentElements = Array.from(element.children)
      .filter(
        (child): child is HTMLElement =>
          child instanceof HTMLElement &&
          child.tagName !== "DIV" &&
          !child.hasAttribute("data-tsdm") &&
          !child.hasAttribute("data-tsds")
      );
    const boxes = contentElements.map((child) => child.getBoundingClientRect());
    return {
      element,
      rect,
      textLeft: boxes.length ? Math.min(...boxes.map((box) => box.left)) - rect.left : 0,
      textRight: boxes.length
        ? Math.max(...boxes.map((box) => box.right)) - rect.left
        : rect.width,
      textHeight: boxes.length ? Math.max(...boxes.map((box) => box.height)) : rect.height,
      leading: readLeading(element),
      left: Number.POSITIVE_INFINITY,
      right: Number.NEGATIVE_INFINITY
    };
  });

  for (const fragment of fragments) {
    let target: LineGeometry | null = null;
    let greatestOverlap = 0;
    for (const line of lines) {
      const overlap =
        Math.min(fragment.bottom, line.rect.bottom) -
        Math.max(fragment.top, line.rect.top);
      if (overlap > greatestOverlap) {
        greatestOverlap = overlap;
        target = line;
      }
    }
    if (!target) continue;
    target.left = Math.min(target.left, fragment.left - target.rect.left);
    target.right = Math.max(target.right, fragment.right - target.rect.left);
  }

  // Blank lines between selected fragments receive a visible selection stub.
  const withFragment = lines
    .map((line, index) => (Number.isFinite(line.left) ? index : -1))
    .filter((index) => index >= 0);
  if (withFragment.length) {
    for (let index = withFragment[0]; index <= withFragment[withFragment.length - 1]; index += 1) {
      const line = lines[index];
      if (Number.isFinite(line.left)) continue;
      line.left = line.textLeft;
      line.right = line.textRight;
    }
  }

  const isSelected = (line: LineGeometry | undefined): boolean =>
    Boolean(line && Number.isFinite(line.left) && Number.isFinite(line.right));
  const sharePage = (left: LineGeometry, right: LineGeometry): boolean =>
    left.element.closest(".tsd-page") === right.element.closest(".tsd-page");

  for (const [index, line] of lines.entries()) {
    if (!isSelected(line)) continue;
    const left = Math.min(Math.max(line.left, line.textLeft), line.textRight);
    const right = Math.max(left, Math.min(line.right, line.textRight));
    // An empty paragraph has no text extent of its own, so keep a visible stub.
    const width = Math.max(right - left, line.textHeight * EMPTY_LINE_STUB);
    const next = lines[index + 1];
    // A line never reaches UP: the spacing above it belongs to the line above,
    // which paints it downward. Never bridge a page break.
    const bottom = selectionBandBottomOffset(
      { top: line.rect.top, bottom: line.rect.bottom, leading: line.leading },
      next
        ? { top: next.rect.top, selected: isSelected(next), samePage: sharePage(line, next) }
        : null
    );
    line.element.style.setProperty(LEFT_PROPERTY, `${left}px`);
    line.element.style.setProperty(WIDTH_PROPERTY, `${width}px`);
    line.element.style.setProperty(BOTTOM_PROPERTY, `${bottom}px`);
    line.element.classList.add(SELECTED_LINE_CLASS);
  }
}
