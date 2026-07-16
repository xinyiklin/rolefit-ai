// DOM-only mapping between engine-painted field spans and display offsets.
// The text model intentionally has no dependency on HTMLElement, Selection, or
// the renderer's data attributes.

function fieldSpans(host: HTMLElement, key: string): HTMLElement[] {
  return Array.from(host.querySelectorAll<HTMLElement>(`[data-tsdf="${CSS.escape(key)}"]:not([data-tsdm])`));
}

// The field key of the painted span containing a DOM node (a selection
// endpoint, a clicked element), with the span element itself.
export function keyOfNode(node: Node | null): { key: string; el: HTMLElement } | null {
  const el = node instanceof HTMLElement ? node : node?.parentElement ?? null;
  const target = el?.closest<HTMLElement>("[data-tsdf]");
  const key = target?.getAttribute("data-tsdf");
  return key && target ? { key, el: target } : null;
}

export function caretToDisplayIndex(
  host: HTMLElement,
  key: string,
  display: string,
  node: Node,
  offset: number
): number | null {
  const spans = fieldSpans(host, key);
  let displayIndex = 0;
  for (const span of spans) {
    const textNode = span.firstChild;
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) continue;
    const text = textNode.textContent ?? "";
    const isTarget = textNode === node || span === node;
    const upTo = !isTarget
      ? text.length
      : span === node
        ? offset === 0 ? 0 : text.length
        : Math.min(offset, text.length);
    for (let index = 0; index < upTo; index += 1) {
      const char = text[index];
      if (displayIndex < display.length && char === display[displayIndex]) displayIndex += 1;
      else if (/\s/.test(char)) {
        if (display[displayIndex] === " ") displayIndex += 1;
      } else return null;
    }
    if (isTarget) return displayIndex;
  }
  return null;
}

export function displayIndexToCaret(
  host: HTMLElement,
  key: string,
  display: string,
  target: number
): { node: Node; offset: number } | null {
  const spans = fieldSpans(host, key);
  let displayIndex = 0;
  let last: { node: Node; offset: number } | null = null;
  for (const span of spans) {
    const textNode = span.firstChild;
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) continue;
    const text = textNode.textContent ?? "";
    for (let index = 0; index < text.length; index += 1) {
      if (displayIndex >= target) return { node: textNode, offset: index };
      const char = text[index];
      if (displayIndex < display.length && char === display[displayIndex]) displayIndex += 1;
      else if (/\s/.test(char)) {
        if (display[displayIndex] === " ") displayIndex += 1;
      } else return last;
      last = { node: textNode, offset: index + 1 };
    }
  }
  return last ?? (spans[0]?.firstChild ? { node: spans[0].firstChild, offset: 0 } : null);
}

// ---- Caret/line geometry for keyboard and pointer navigation ----
// Pure DOM helpers over the engine-painted line/span structure, shared by the
// input-event hook's arrow/Home/End movement and blank-area click placement.

export function lineOf(node: Node | null): HTMLElement | null {
  const element = node instanceof HTMLElement ? node : node?.parentElement ?? null;
  return element?.closest<HTMLElement>(".tsd-line") ?? null;
}

export function lineDivs(host: HTMLElement): HTMLElement[] {
  return Array.from(host.querySelectorAll<HTMLElement>(".tsd-line"));
}

export function lineEdgePosition(
  line: HTMLElement,
  edge: "start" | "end"
): { node: Node; offset: number } | null {
  const spans = Array.from(line.children).filter(
    (element): element is HTMLElement =>
      element instanceof HTMLElement &&
      !element.hasAttribute("data-tsdm") &&
      element.firstChild?.nodeType === Node.TEXT_NODE
  );
  if (!spans.length) return null;
  if (edge === "start") return { node: spans[0].firstChild!, offset: 0 };
  const last = spans[spans.length - 1].firstChild as Text;
  const text = last.textContent ?? "";
  let end = text.length;
  while (end > 0 && /\s/.test(text[end - 1])) end -= 1;
  return { node: last, offset: end };
}

export function setCaret(position: { node: Node; offset: number }, extend: boolean): void {
  const selection = window.getSelection();
  if (!selection) return;
  if (extend && selection.rangeCount) {
    selection.extend(position.node, position.offset);
  } else {
    const range = document.createRange();
    range.setStart(position.node, position.offset);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  (position.node.parentElement ?? undefined)?.scrollIntoView({ block: "nearest" });
}

export function caretClientX(): number | null {
  const selection = window.getSelection();
  if (!selection?.focusNode) return null;
  try {
    const range = document.createRange();
    range.setStart(selection.focusNode, selection.focusOffset);
    range.collapse(true);
    const rects = range.getClientRects();
    if (rects.length) return rects[0].left;
  } catch {
    // Fall through to the containing span's left edge.
  }
  const element =
    selection.focusNode instanceof HTMLElement ? selection.focusNode : selection.focusNode.parentElement;
  return element ? element.getBoundingClientRect().left : null;
}

export function positionFromPoint(x: number, y: number): { node: Node; offset: number } | null {
  const caretDocument = document as Document & {
    caretPositionFromPoint?: (clientX: number, clientY: number) => {
      offsetNode: Node;
      offset: number;
    } | null;
    caretRangeFromPoint?: (clientX: number, clientY: number) => Range | null;
  };
  if (caretDocument.caretPositionFromPoint) {
    const position = caretDocument.caretPositionFromPoint(x, y);
    return position ? { node: position.offsetNode, offset: position.offset } : null;
  }
  const range = caretDocument.caretRangeFromPoint?.(x, y);
  return range ? { node: range.startContainer, offset: range.startOffset } : null;
}

export function nearestLineByPoint(host: HTMLElement, clientX: number, clientY: number): HTMLElement | null {
  let best: HTMLElement | null = null;
  let distance = Infinity;
  for (const line of lineDivs(host)) {
    const rect = line.getBoundingClientRect();
    if (clientX < rect.left - 4 || clientX > rect.right + 4) continue;
    const nextDistance =
      clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0;
    if (nextDistance < distance) {
      distance = nextDistance;
      best = line;
    }
  }
  return distance <= 200 ? best : null;
}

export function contentSpansOf(line: HTMLElement): HTMLElement[] {
  return Array.from(line.querySelectorAll<HTMLElement>("[data-tsdf]:not([data-tsdm])")).filter(
    (element) => element.firstChild?.nodeType === Node.TEXT_NODE
  );
}

export function spanEndPosition(span: HTMLElement): { node: Node; offset: number } {
  const textNode = span.firstChild as Text;
  const text = textNode.textContent ?? "";
  let end = text.length;
  while (end > 0 && /\s/.test(text[end - 1])) end -= 1;
  return { node: textNode, offset: end };
}

export function placeInLine(line: HTMLElement, clientX: number): { node: Node; offset: number } | null {
  const spans = contentSpansOf(line);
  if (!spans.length) return lineEdgePosition(line, "start");
  const firstRect = spans[0].getBoundingClientRect();
  if (clientX <= firstRect.left) return { node: spans[0].firstChild!, offset: 0 };
  let prev: HTMLElement | null = null;
  for (const span of spans) {
    const rect = span.getBoundingClientRect();
    if (clientX < rect.left) {
      // In the empty space before this span. Between two fields on one row
      // (title | date, subtitle | location) snap to whichever side is
      // nearer, instead of always jumping into the right-hand field.
      if (prev) {
        const midpoint = (prev.getBoundingClientRect().right + rect.left) / 2;
        if (clientX < midpoint) return spanEndPosition(prev);
      }
      return { node: span.firstChild!, offset: 0 };
    }
    if (clientX <= rect.right) {
      const position = positionFromPoint(clientX, rect.top + rect.height / 2);
      if (position && position.node.nodeType === Node.TEXT_NODE && lineOf(position.node) === line) {
        return position;
      }
      return { node: span.firstChild!, offset: 0 };
    }
    prev = span;
  }
  return lineEdgePosition(line, "end");
}
