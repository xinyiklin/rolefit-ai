const SELECTED_LINE_CLASS = "tsd-line--selected";
const LEFT_PROPERTY = "--tsd-selection-left";
const WIDTH_PROPERTY = "--tsd-selection-width";

// Stub shown for a selected EMPTY paragraph, as a fraction of its line box —
// roughly one space, so a blank line still reads as selected.
const EMPTY_LINE_STUB = 0.2;

type LineGeometry = {
  element: HTMLElement;
  rect: DOMRect;
  // Horizontal extent of the line's real text, relative to the line element.
  // The line element spans the whole sheet, so this is what bounds a highlight.
  textLeft: number;
  textRight: number;
  textHeight: number;
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
//
// Horizontally the rectangle is bounded by the line's TEXT, not by the line
// element: a browser stretches the client rect of a fragment in the middle of a
// multi-line selection out to its containing block, and each line block spans
// the entire sheet, so Select All otherwise painted the page margins as well.
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
    const boxes = Array.from(element.children)
      .filter(
        (child): child is HTMLElement =>
          child instanceof HTMLElement &&
          child.tagName !== "DIV" &&
          !child.hasAttribute("data-tsdm") &&
          !child.hasAttribute("data-tsds")
      )
      .map((child) => child.getBoundingClientRect());
    return {
      element,
      rect,
      textLeft: boxes.length ? Math.min(...boxes.map((box) => box.left)) - rect.left : 0,
      textRight: boxes.length
        ? Math.max(...boxes.map((box) => box.right)) - rect.left
        : rect.width,
      textHeight: boxes.length ? Math.max(...boxes.map((box) => box.height)) : rect.height,
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

  // An empty paragraph contributes no client rect, so it would drop out of a
  // selection that plainly contains it. Every line between the first and last
  // line that did get a fragment is inside the selection by definition; give it
  // the stub a word processor shows for a selected blank line.
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

  for (const line of lines) {
    if (!Number.isFinite(line.left) || !Number.isFinite(line.right)) continue;
    const left = Math.min(Math.max(line.left, line.textLeft), line.textRight);
    const right = Math.max(left, Math.min(line.right, line.textRight));
    // An empty paragraph has no text extent of its own, so keep a visible stub.
    const width = Math.max(right - left, line.textHeight * EMPTY_LINE_STUB);
    line.element.style.setProperty(LEFT_PROPERTY, `${left}px`);
    line.element.style.setProperty(WIDTH_PROPERTY, `${width}px`);
    line.element.classList.add(SELECTED_LINE_CLASS);
  }
}
