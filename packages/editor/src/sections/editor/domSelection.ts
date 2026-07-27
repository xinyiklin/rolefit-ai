// DOM-only mapping between engine-painted field spans and display offsets.
// The text model intentionally has no dependency on HTMLElement, Selection, or
// the renderer's data attributes.

function fieldSpans(host: HTMLElement, key: string): HTMLElement[] {
  return Array.from(host.querySelectorAll<HTMLElement>(`[data-tsdf="${CSS.escape(key)}"]:not([data-tsdm])`));
}

function isEmptyEditableSpan(span: HTMLElement): boolean {
  return span.hasAttribute("data-tsde");
}

// The field key of the painted span containing a DOM node (a selection
// endpoint, a clicked element), with the span element itself.
export function keyOfNode(node: Node | null): { key: string; el: HTMLElement } | null {
  const el = node instanceof HTMLElement ? node : node?.parentElement ?? null;
  const target = el?.closest<HTMLElement>("[data-tsdf]");
  const key = target?.getAttribute("data-tsdf");
  return key && target ? { key, el: target } : null;
}

// Fieldless line-end carets resolve to the preceding painted content span.
export function fieldCaretOf(
  host: HTMLElement,
  node: Node,
  offset: number
): { key: string; node: Node; offset: number } | null {
  const named = keyOfNode(node);
  if (named && host.contains(named.el)) return { key: named.key, node, offset };
  const element = node instanceof HTMLElement ? node : node.parentElement;
  const line = element?.closest<HTMLElement>(".tsd-line");
  if (!line || !host.contains(line)) return null;
  const spans = contentSpansOf(line);
  if (!spans.length) return null;
  const children = Array.from(line.childNodes);
  // A non-field child with a nonzero offset places the caret after that child.
  const boundary =
    node === line
      ? offset
      : (() => {
          const index = children.indexOf(element as ChildNode);
          return index < 0 ? children.length : index + (offset > 0 ? 1 : 0);
        })();
  let chosen: HTMLElement | null = null;
  for (const span of spans) {
    if (children.indexOf(span) < boundary) chosen = span;
    else break;
  }
  const target = chosen ?? spans[0];
  const key = target.getAttribute("data-tsdf");
  const text = target.firstChild;
  if (!key || !text) return null;
  // Authored trailing spaces remain content at a chosen span's end.
  const at = chosen
    ? isEmptyEditableSpan(target)
      ? 0
      : (text.textContent ?? "").length
    : 0;
  return { key, node: text, offset: at };
}

// A field's spans are split by BOTH inline style boundaries and line breaks. At
// a line break the engine consumes the interword glue (or the authored newline)
// into the break itself, so that display character has no DOM character on
// either side of it. Walking spans naively desynchronizes there — the mapping
// then fails outright, or resolves to the end of the previous line — which makes
// every wrapped continuation line uneditable. Skip exactly one break character
// when the walk crosses into a new line.
const BREAK_CHARS = new Set([" ", "\n"]);

function lineElementOf(span: HTMLElement): HTMLElement | null {
  return span.closest<HTMLElement>(".tsd-line");
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
  let previousLine: HTMLElement | null = null;
  for (const span of spans) {
    const textNode = span.firstChild;
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) continue;
    // Crossing is resolved for EVERY span, blank lines included: a blank line
    // stands for an authored break that consumed its own display character, and
    // skipping it here would desynchronize everything after it.
    const line = lineElementOf(span);
    const crossed = previousLine !== null && line !== previousLine;
    previousLine = line;
    if (crossed && BREAK_CHARS.has(display[displayIndex])) displayIndex += 1;
    if (isEmptyEditableSpan(span)) {
      if (textNode === node || span === node) return displayIndex;
      continue;
    }
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
  let previousLine: HTMLElement | null = null;
  for (const span of spans) {
    const textNode = span.firstChild;
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) continue;
    const line = lineElementOf(span);
    const crossed = previousLine !== null && line !== previousLine;
    previousLine = line;
    if (crossed && BREAK_CHARS.has(display[displayIndex])) {
      // A caret AT the break belongs to the end of the line that was broken;
      // past it, the caret opens the next line.
      if (target <= displayIndex) return last;
      displayIndex += 1;
    }
    if (isEmptyEditableSpan(span)) {
      if (target <= displayIndex) return { node: textNode, offset: 0 };
      continue;
    }
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
      // The line-separator span holds no field text; a caret there maps nowhere.
      !element.hasAttribute("data-tsds") &&
      element.firstChild?.nodeType === Node.TEXT_NODE
  );
  if (!spans.length) return null;
  if (edge === "start") return { node: spans[0].firstChild!, offset: 0 };
  const last = spans[spans.length - 1].firstChild as Text;
  if (isEmptyEditableSpan(spans[spans.length - 1])) return { node: last, offset: 0 };
  const text = last.textContent ?? "";
  // The last editable span has no copy-only field separator after it. Any
  // whitespace at its edge is authored content, so End and blank-area clicks
  // must land after it rather than snapping to the last visible glyph.
  return { node: last, offset: text.length };
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

// A DOM Range over a field's display range [dStart, dEnd). Both endpoints go
// through displayIndexToCaret, so it lands correctly even when the run is split
// across wrapped lines or inline style boundaries. Null when either endpoint
// cannot be resolved, so a caller can decline rather than act on a partial range.
function displayRange(
  host: HTMLElement,
  key: string,
  display: string,
  dStart: number,
  dEnd: number
): Range | null {
  const start = displayIndexToCaret(host, key, display, dStart);
  const end = displayIndexToCaret(host, key, display, dEnd);
  if (!start || !end) return null;
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

// Select a field's display range in the live DOM.
export function selectDisplayRange(
  host: HTMLElement,
  key: string,
  display: string,
  dStart: number,
  dEnd: number
): boolean {
  const range = displayRange(host, key, display, dStart, dEnd);
  const selection = window.getSelection();
  if (!range || !selection) return false;
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

// Viewport rect of a field's display range, WITHOUT touching the selection —
// used to anchor an overlay to painted text the user has not selected. A range
// that wraps across lines reports the union of its line rects, so the caller
// should treat this as "where that text is", not as one line box.
export function displayRangeRect(
  host: HTMLElement,
  key: string,
  display: string,
  dStart: number,
  dEnd: number
): { left: number; top: number; right: number; bottom: number } | null {
  const range = displayRange(host, key, display, dStart, dEnd);
  if (!range) return null;
  // Prefer the FIRST line's rect: an overlay anchored to the union of a wrapped
  // link's rects would float in the middle of the paragraph.
  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 || rect.height > 0);
  const rect = rects[0] ?? range.getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) return null;
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
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

// Clicks stay near the sheet; active drags keep tracking beyond its bounds.
export function nearestLineByPoint(
  host: HTMLElement,
  clientX: number,
  clientY: number,
  reach: "sheet" | "anywhere" = "sheet"
): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestVertical = Infinity;
  let bestHorizontal = Infinity;
  for (const line of lineDivs(host)) {
    const rect = line.getBoundingClientRect();
    const horizontal =
      clientX < rect.left ? rect.left - clientX : clientX > rect.right ? clientX - rect.right : 0;
    if (reach === "sheet" && horizontal > 4) continue;
    const vertical =
      clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0;
    if (vertical < bestVertical || (vertical === bestVertical && horizontal < bestHorizontal)) {
      bestVertical = vertical;
      bestHorizontal = horizontal;
      best = line;
    }
  }
  if (reach === "anywhere") return best;
  return bestVertical <= 200 ? best : null;
}

export function contentSpansOf(line: HTMLElement): HTMLElement[] {
  return Array.from(line.querySelectorAll<HTMLElement>("[data-tsdf]:not([data-tsdm])")).filter(
    (element) => element.firstChild?.nodeType === Node.TEXT_NODE
  );
}

// Drag anchors use field edges, never invisible inline-style boundaries.
// The final edge retains authored trailing whitespace.
export function fieldEdgeAnchors(
  line: HTMLElement,
  key?: string
): { x: number; position: { node: Node; offset: number } }[] {
  const spans = contentSpansOf(line);
  const anchors: { x: number; position: { node: Node; offset: number } }[] = [];
  let index = 0;
  while (index < spans.length) {
    const spanKey = spans[index].getAttribute("data-tsdf");
    let end = index;
    while (end + 1 < spans.length && spans[end + 1].getAttribute("data-tsdf") === spanKey) end += 1;
    if (!key || spanKey === key) {
      const first = spans[index];
      const last = spans[end];
      anchors.push({
        x: first.getBoundingClientRect().left,
        position: { node: first.firstChild!, offset: indentEndOffset(first) }
      });
      const lastText = last.firstChild as Text;
      anchors.push({
        x: last.getBoundingClientRect().right,
        position:
          end === spans.length - 1 && !isEmptyEditableSpan(last)
            ? { node: lastText, offset: (lastText.textContent ?? "").length }
            : spanEndPosition(last)
      });
    }
    index = end + 1;
  }
  return anchors;
}

export type DisplayRange = { dStart: number; dEnd: number };

// Wrapped fields contribute one display range per painted line.
export function visualLineRanges(
  host: HTMLElement,
  key: string,
  display: string
): DisplayRange[] {
  const ranges: DisplayRange[] = [];
  for (const line of lineDivs(host)) {
    const spans = contentSpansOf(line).filter(
      (span) => span.getAttribute("data-tsdf") === key
    );
    if (!spans.length) continue;
    const first = spans[0];
    const last = spans[spans.length - 1];
    const start = caretToDisplayIndex(host, key, display, first.firstChild!, 0);
    const lastText = last.firstChild?.textContent ?? "";
    let end = caretToDisplayIndex(
      host,
      key,
      display,
      last.firstChild!,
      isEmptyEditableSpan(last) ? 0 : lastText.length
    );
    if (start === null || end === null) continue;
    // Keep the breaker's consumed separator with the preceding visual line.
    if (end < display.length && BREAK_CHARS.has(display[end])) end += 1;
    ranges.push({ dStart: start, dEnd: Math.max(start, end) });
  }
  return ranges;
}

// A complete-field selection remains the explicit paragraph-wide formatting gesture.
export function selectedVisualLineRanges(
  host: HTMLElement,
  key: string,
  display: string,
  dStart: number,
  dEnd: number
): DisplayRange[] {
  if (dStart === 0 && dEnd >= display.length) {
    return [{ dStart: 0, dEnd: display.length }];
  }
  const lines = visualLineRanges(host, key, display);
  if (dStart === dEnd) {
    const atCaret = lines.find(
      (range, index) =>
        dStart >= range.dStart &&
        (dStart < range.dEnd || index === lines.length - 1 && dStart === range.dEnd)
    );
    return atCaret ? [atCaret] : [];
  }
  return lines.filter(
    (range) => dEnd > range.dStart && dStart < range.dEnd
  );
}

export function spanEndPosition(span: HTMLElement): { node: Node; offset: number } {
  const textNode = span.firstChild as Text;
  if (isEmptyEditableSpan(span)) return { node: textNode, offset: 0 };
  const text = textNode.textContent ?? "";
  let end = text.length;
  while (end > 0 && /\s/.test(text[end - 1])) end -= 1;
  return { node: textNode, offset: end };
}

// Measured substring advances recover a precise caret when browser APIs return null.
function positionInSpanByX(
  span: HTMLElement,
  clientX: number
): { node: Node; offset: number } {
  const textNode = span.firstChild as Text;
  if (isEmptyEditableSpan(span)) return { node: textNode, offset: 0 };
  const text = textNode.textContent ?? "";
  const spanRect = span.getBoundingClientRect();
  if (clientX <= spanRect.left) return { node: textNode, offset: 0 };
  if (clientX >= spanRect.right) return { node: textNode, offset: text.length };

  const range = document.createRange();
  const xAt = (offset: number): number => {
    if (offset === 0) return spanRect.left;
    range.setStart(textNode, 0);
    range.setEnd(textNode, offset);
    const rects = range.getClientRects();
    return rects.length ? rects[rects.length - 1].right : spanRect.left;
  };

  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (xAt(middle) < clientX) low = middle + 1;
    else high = middle;
  }
  const after = low;
  const before = Math.max(0, after - 1);
  const offset =
    Math.abs(clientX - xAt(before)) <= Math.abs(xAt(after) - clientX)
      ? before
      : after;
  return { node: textNode, offset };
}

// Treat first-line indentation as one non-addressable unit before the first glyph.
export function indentEndOffset(span: HTMLElement): number {
  const text = span.firstChild?.textContent ?? "";
  const match = /^ +/.exec(text);
  return match ? Math.min(match[0].length, text.length) : 0;
}

const pastIndent = (
  span: HTMLElement,
  position: { node: Node; offset: number },
  isFirstSpan: boolean
): { node: Node; offset: number } => {
  if (!isFirstSpan) return position;
  const indent = indentEndOffset(span);
  return position.offset < indent ? { node: position.node, offset: indent } : position;
};

export function placeInLine(line: HTMLElement, clientX: number): { node: Node; offset: number } | null {
  const spans = contentSpansOf(line);
  if (!spans.length) return lineEdgePosition(line, "start");
  const firstRect = spans[0].getBoundingClientRect();
  if (clientX <= firstRect.left) {
    return { node: spans[0].firstChild!, offset: indentEndOffset(spans[0]) };
  }
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
      return { node: span.firstChild!, offset: span === spans[0] ? indentEndOffset(span) : 0 };
    }
    if (clientX <= rect.right) {
      const isFirstSpan = span === spans[0];
      const position = positionFromPoint(clientX, rect.top + rect.height / 2);
      if (position && position.node.nodeType === Node.TEXT_NODE && lineOf(position.node) === line) {
        return pastIndent(span, position, isFirstSpan && position.node === span.firstChild);
      }
      return pastIndent(span, positionInSpanByX(span, clientX), isFirstSpan);
    }
    prev = span;
  }
  return lineEdgePosition(line, "end");
}
