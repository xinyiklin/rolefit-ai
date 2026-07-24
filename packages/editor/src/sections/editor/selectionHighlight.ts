const SELECTED_LINE_CLASS = "tsd-line--selected";
const LEFT_PROPERTY = "--tsd-selection-left";
const WIDTH_PROPERTY = "--tsd-selection-width";

type LineGeometry = {
  element: HTMLElement;
  rect: DOMRect;
  left: number;
  right: number;
};

export function clearSelectionHighlights(host: HTMLElement): void {
  for (const line of host.querySelectorAll<HTMLElement>(`.${SELECTED_LINE_CLASS}`)) {
    line.classList.remove(SELECTED_LINE_CLASS);
    line.style.removeProperty(LEFT_PROPERTY);
    line.style.removeProperty(WIDTH_PROPERTY);
  }
}

// Replace fragmented native run highlights with one rectangle per engine line.
// Its vertical extent is the line element's full ink box, which the DOM painter
// already derives from the largest family/size run on that line.
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
  ).map((element) => ({
    element,
    rect: element.getBoundingClientRect(),
    left: Number.POSITIVE_INFINITY,
    right: Number.NEGATIVE_INFINITY
  }));

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

  for (const line of lines) {
    if (!Number.isFinite(line.left) || !Number.isFinite(line.right)) continue;
    const left = Math.max(0, Math.min(line.left, line.rect.width));
    const right = Math.max(left, Math.min(line.right, line.rect.width));
    line.element.style.setProperty(LEFT_PROPERTY, `${left}px`);
    line.element.style.setProperty(WIDTH_PROPERTY, `${right - left}px`);
    line.element.classList.add(SELECTED_LINE_CLASS);
  }
}
