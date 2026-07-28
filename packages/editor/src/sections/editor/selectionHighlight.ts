const SELECTED_LINE_CLASS = "tsd-line--selected";
const LEFT_PROPERTY = "--tsd-selection-left";
const WIDTH_PROPERTY = "--tsd-selection-width";
const TOP_PROPERTY = "--tsd-selection-top";
const BOTTOM_PROPERTY = "--tsd-selection-bottom";

// Stub shown for a selected EMPTY paragraph, as a fraction of its line box —
// roughly one space, so a blank line still reads as selected.
const EMPTY_LINE_STUB = 0.2;

export function selectionBandTopOffset(spaceBefore: number | null): number {
  return spaceBefore !== null && spaceBefore > 0 ? -spaceBefore : 0;
}

// Consecutive selected lines tile through their complete junction, including
// default and authored paragraph gaps. Against an unselected neighbour, a line
// paints only the leading and authored after-space it owns.
export function selectionBandBottomOffset(
  line: {
    top: number;
    bottom: number;
    leading: number | null;
    spaceAfter: number | null;
  },
  next: { top: number; selected: boolean; samePage: boolean } | null
): number {
  const ink = Math.max(0, line.bottom - line.top);
  const box = line.leading !== null && line.leading > 0 ? line.leading : ink;
  const distance = next?.samePage ? Math.max(0, next.top - line.top) : null;
  if (next?.selected && distance !== null) return distance - ink;
  const owned =
    box + ((next === null || next.samePage) && line.spaceAfter !== null && line.spaceAfter > 0
      ? line.spaceAfter
      : 0);
  const capped = distance === null ? owned : Math.min(owned, distance);
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
  spaceBefore: number | null;
  spaceAfter: number | null;
  left: number;
  right: number;
};

// The painter publishes the leading in the same CSS length the rest of the page
// uses, so it is directly comparable with client-rect pixels.
function readLength(line: HTMLElement, property: string): number | null {
  const raw = line.style.getPropertyValue(property).trim();
  if (!raw) return null;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function clearSelectionHighlights(host: HTMLElement): void {
  for (const line of host.querySelectorAll<HTMLElement>(`.${SELECTED_LINE_CLASS}`)) {
    line.classList.remove(SELECTED_LINE_CLASS);
    line.style.removeProperty(LEFT_PROPERTY);
    line.style.removeProperty(WIDTH_PROPERTY);
    line.style.removeProperty(TOP_PROPERTY);
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
      leading: readLength(element, "--tsd-line-leading"),
      spaceBefore: readLength(element, "--tsd-paragraph-space-before"),
      spaceAfter: readLength(element, "--tsd-paragraph-space-after"),
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
    const previous = lines[index - 1];
    const next = lines[index + 1];
    const previousSelectedOnPage =
      previous && isSelected(previous) && sharePage(previous, line);
    const pageRect =
      line.element.closest<HTMLElement>(".tsd-page")?.getBoundingClientRect() ?? null;
    // A selected predecessor fills the whole junction downward. Only the first
    // selected paragraph in a run claims its authored before-space upward.
    // Page-start layout reserves that space; the page edge remains a hard cap.
    const authoredTop = !previousSelectedOnPage
      ? selectionBandTopOffset(line.spaceBefore)
      : 0;
    const top = pageRect
      ? Math.max(authoredTop, pageRect.top - line.rect.top)
      : authoredTop;
    const bottom = selectionBandBottomOffset(
      {
        top: line.rect.top,
        bottom: line.rect.bottom,
        leading: line.leading,
        spaceAfter: line.spaceAfter
      },
      next
        ? { top: next.rect.top, selected: isSelected(next), samePage: sharePage(line, next) }
        : pageRect
          ? { top: pageRect.bottom, selected: false, samePage: true }
          : null
    );
    line.element.style.setProperty(LEFT_PROPERTY, `${left}px`);
    line.element.style.setProperty(WIDTH_PROPERTY, `${width}px`);
    line.element.style.setProperty(TOP_PROPERTY, `${top}px`);
    line.element.style.setProperty(BOTTOM_PROPERTY, `${bottom}px`);
    line.element.classList.add(SELECTED_LINE_CLASS);
  }
}
