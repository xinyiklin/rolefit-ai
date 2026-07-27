// Selections that cross field boundaries — Select All, or a drag from one
// paragraph into the next. The single-field path in TypesetEditor owns one
// mapped field; this module resolves the SAME DOM selection into the ordered
// list of fields it touches, so delete, typing, and formatting behave the way
// they do in a word processor instead of silently doing nothing.
//
// It is DOM-reading and pure: callers turn the returned ranges into structured
// actions. Structural consequences (paragraphs merging, emptied rows leaving)
// belong to the caller, which owns the document model.

import type { FieldSrc } from "@typeset/engine/typeset/types.ts";
import { parseFieldKey } from "@typeset/engine/typeset/types.ts";

import { caretToDisplayIndex, keyOfNode } from "./domSelection.ts";
import type { DisplayMap } from "./inlineTextEditing.ts";

export type FieldRange = {
  src: FieldSrc;
  key: string;
  map: DisplayMap;
  value: string;
  dStart: number;
  dEnd: number;
};

// Field keys in document order, deduplicated. A field can paint several spans
// (one per wrapped line); the first occurrence fixes its position.
//
// Exported because the painted order IS document order for every host: the
// caret's "start of the document" reads `[0]` from here rather than asking the
// model, which would need one answer for a resume's name field and another for
// a cover letter's first paragraph.
export function orderedFieldKeys(host: HTMLElement): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const span of host.querySelectorAll<HTMLElement>("[data-tsdf]:not([data-tsdm])")) {
    const key = span.getAttribute("data-tsdf");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

function paintedSpansOf(host: HTMLElement, key: string): HTMLElement[] {
  return Array.from(
    host.querySelectorAll<HTMLElement>(`[data-tsdf="${CSS.escape(key)}"]:not([data-tsdm])`)
  ).filter((span) => span.firstChild?.nodeType === Node.TEXT_NODE);
}

function collapsedPoint(range: Range, edge: "start" | "end"): Range {
  const point = document.createRange();
  if (edge === "start") point.setStart(range.startContainer, range.startOffset);
  else point.setStart(range.endContainer, range.endOffset);
  point.collapse(true);
  return point;
}

// Resolve fieldless endpoints against the painted span on the boundary's side.
function boundaryFieldIndex(
  host: HTMLElement,
  keys: readonly string[],
  range: Range,
  edge: "start" | "end"
): number {
  const point = collapsedPoint(range, edge);
  let resolved = -1;
  for (let index = 0; index < keys.length; index += 1) {
    const spans = paintedSpansOf(host, keys[index]);
    if (!spans.length) continue;
    if (edge === "end") {
      // The last field that begins at or before the point.
      if (point.comparePoint(spans[0], 0) <= 0) resolved = index;
    } else if (resolved < 0) {
      // The first field that still has content at or after the point.
      const last = spans[spans.length - 1];
      if (point.comparePoint(last, last.childNodes.length) >= 0) resolved = index;
    }
  }
  return resolved;
}

// Fieldless endpoints use painted-span offsets instead of expanding to the whole field.
function boundaryDisplayIndex(
  host: HTMLElement,
  key: string,
  display: string,
  range: Range,
  edge: "start" | "end"
): number | null {
  const spans = paintedSpansOf(host, key);
  if (!spans.length) return null;
  const point = collapsedPoint(range, edge);
  if (edge === "end") {
    let chosen: HTMLElement | null = null;
    for (const span of spans) {
      if (point.comparePoint(span, 0) <= 0) chosen = span;
    }
    if (!chosen) return null;
    const text = chosen.firstChild as Text;
    return caretToDisplayIndex(host, key, display, text, (text.textContent ?? "").length);
  }
  for (const span of spans) {
    if (point.comparePoint(span, span.childNodes.length) >= 0) {
      return caretToDisplayIndex(host, key, display, span.firstChild!, 0);
    }
  }
  return null;
}

// Every field the current selection covers, in document order, with the display
// range covered inside each. Null when nothing in the host is selected.
//
// A DOM selection is ONE contiguous range, so the fields it touches are a
// contiguous slice of document order: resolving its two endpoints to field
// positions is enough, and no per-span containment test is needed. That matters
// for portability — `Selection.containsNode` and boundary-point comparisons
// disagree between engines at exactly the edges Select All produces, and
// browsers put a select-all range's endpoints in different places (text nodes in
// one, the editing host with child offsets in another).
// `maxFields` lets a caller that only cares about a small selection bail before
// any display map is built — resolving a map per field is the expensive part, and
// the single-field path asks only whether exactly one field is covered.
export function readFieldRanges(
  host: HTMLElement,
  resolve: (src: FieldSrc) => { map: DisplayMap; value: string },
  maxFields = Number.POSITIVE_INFINITY
): FieldRange[] | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  // Gecko is the one engine that can hold several ranges. Span from the first
  // range's start to the last one's end rather than editing only a fragment.
  const first = selection.getRangeAt(0);
  const last = selection.getRangeAt(selection.rangeCount - 1);
  const range = document.createRange();
  range.setStart(first.startContainer, first.startOffset);
  range.setEnd(last.endContainer, last.endOffset);
  const inHost = (node: Node | null) => Boolean(node && host.contains(node));
  // Either the selection lives inside the page, or it swallowed the page whole
  // (a document-wide Select All from outside the editable host).
  if (!inHost(range.startContainer) || !inHost(range.endContainer)) {
    if (!range.intersectsNode(host)) return null;
  }

  const keys = orderedFieldKeys(host);
  if (!keys.length) return null;

  const startKey = inHost(range.startContainer) ? keyOfNode(range.startContainer)?.key : undefined;
  const endKey = inHost(range.endContainer) ? keyOfNode(range.endContainer)?.key : undefined;
  // An endpoint often names no field: a select-all anchors on the editing host,
  // and a triple-click ends on a line container. Resolve those by DOCUMENT
  // POSITION — assuming the document's first or last field instead would let a
  // paragraph-sized selection report the whole document.
  const startIndex =
    startKey && keys.includes(startKey)
      ? keys.indexOf(startKey)
      : boundaryFieldIndex(host, keys, range, "start");
  const endIndex =
    endKey && keys.includes(endKey)
      ? keys.indexOf(endKey)
      : boundaryFieldIndex(host, keys, range, "end");
  if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) return null;
  if (endIndex - startIndex + 1 > maxFields) return null;

  const ranges: FieldRange[] = [];
  for (const key of keys.slice(startIndex, endIndex + 1)) {
    const src = parseFieldKey(key);
    if (!src) continue;
    const { map, value } = resolve(src);
    const length = map.chars.length;
    // Only the boundary fields can be partially covered, and only when the
    // boundary actually sits inside one of them.
    const isFirst = key === keys[startIndex];
    const isLast = key === keys[endIndex];
    const rawStart =
      key === startKey
        ? caretToDisplayIndex(host, key, map.display, range.startContainer, range.startOffset) ?? 0
        : isFirst
          // Null means the point sits past this field entirely; it is then a
          // field the selection only grazes, and the trim below drops it.
          ? boundaryDisplayIndex(host, key, map.display, range, "start") ?? length
          : 0;
    const rawEnd =
      key === endKey
        ? caretToDisplayIndex(host, key, map.display, range.endContainer, range.endOffset) ?? length
        : isLast
          ? boundaryDisplayIndex(host, key, map.display, range, "end") ?? 0
          : length;
    const dStart = Math.max(0, Math.min(rawStart, length));
    const dEnd = Math.max(dStart, Math.min(rawEnd, length));
    ranges.push({ src, key, map, value, dStart, dEnd });
  }
  // A boundary field the selection only grazes (it ends exactly where that field
  // begins) carries no characters; drop it so an edit cannot rewrite a field the
  // user did not actually select into.
  while (ranges.length > 1 && ranges[ranges.length - 1].dEnd === ranges[ranges.length - 1].dStart) {
    ranges.pop();
  }
  while (ranges.length > 1 && ranges[0].dEnd === ranges[0].dStart) ranges.shift();
  return ranges.length ? ranges : null;
}

// Ranges worth transforming: an empty range carries no characters, so applying a
// mark, family, or size to it would only rewrite the value identically.
export function formattableRanges(ranges: readonly FieldRange[]): FieldRange[] {
  return ranges.filter((range) => range.dEnd > range.dStart);
}

// Word's rule for a toggle over a mixed selection: if EVERY covered character
// already carries the mark, turn it off; otherwise turn it on everywhere. The
// decision is made once for the whole selection so fields cannot disagree.
export function markStateAcross(
  ranges: readonly FieldRange[],
  mark: "bold" | "italic" | "underline"
): boolean {
  let sawCharacter = false;
  for (const range of ranges) {
    for (let index = range.dStart; index < range.dEnd; index += 1) {
      const char = range.map.chars[index];
      if (!char) continue;
      sawCharacter = true;
      if (!char[mark]) return false;
    }
  }
  return sawCharacter;
}

// A single value shared by every covered character, or null when they differ —
// the toolbar leaves its control blank for a mixed selection.
export function uniformAcross<T>(
  ranges: readonly FieldRange[],
  read: (char: DisplayMap["chars"][number]) => T | null | undefined,
  fallback: (range: FieldRange) => T
): T | null {
  let value: T | null = null;
  let seen = false;
  for (const range of ranges) {
    for (let index = range.dStart; index < range.dEnd; index += 1) {
      const char = range.map.chars[index];
      if (!char) continue;
      const current = read(char) ?? fallback(range);
      if (!seen) {
        value = current;
        seen = true;
      } else if (current !== value) return null;
    }
  }
  return seen ? value : null;
}
