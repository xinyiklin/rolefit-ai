// Pure editing math for the typeset editor (no DOM, no React): the mapping
// between a field's VALUE (inline-marks string, ASCII ligatures, real
// whitespace) and its DISPLAY form (what the engine paints: tags stripped,
// --- → — / -- → – / ' → ’, horizontal whitespace collapsed, and literal
// hard breaks preserved as "\n"). Every edit is expressed in display coordinates
// (where the caret lives) and applied to the value without losing marks,
// ligature sources, or preserved outer whitespace.
//
// The display model mirrors measure.ts exactly: segmentsFromInlineMarks's tag
// grammar (<b>/<i>/<u>, unclosed tolerated) and texLigatures's sequential
// replaces (which a longest-match walker reproduces for any hyphen run).

import { fieldKey, type FieldSrc } from "../../typeset/types.ts";
import type { ResumeData } from "../../lib/resumeData";
import type { ResumeEditorActions } from "../../hooks/useResumeEditor";

export type DisplayChar = {
  // The value substring this display char covers ("---" for "—", a whole
  // whitespace run for " ", one char otherwise).
  raw: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
};

export type DisplayMap = {
  display: string;
  chars: DisplayChar[];
  // Value index where chars[i].raw starts (tags occupy value space too).
  valueStart: number[];
  // Outer whitespace stripped from the display but preserved in the value.
  prefix: string;
  suffix: string;
};

export type TypesetSelection = {
  src: FieldSrc;
  key: string;
  map: DisplayMap;
  value: string;
  dStart: number;
  dEnd: number;
};

const TAG_RE = /^<\/?(b|i|u)>/i;

// ---- value → display ----

export function buildDisplayMap(value: string, opts?: { uppercase?: boolean }): DisplayMap {
  const chars: DisplayChar[] = [];
  const valueStart: number[] = [];
  let display = "";
  let prefix = "";
  let bold = 0;
  let italic = 0;
  let underline = 0;
  let i = 0;
  while (i < value.length) {
    const tag = TAG_RE.exec(value.slice(i));
    if (tag) {
      const name = tag[1].toLowerCase();
      const closing = tag[0][1] === "/";
      const delta = closing ? -1 : 1;
      if (name === "b") bold = Math.max(0, bold + delta);
      else if (name === "i") italic = Math.max(0, italic + delta);
      else underline = Math.max(0, underline + delta);
      i += tag[0].length;
      continue;
    }
    const flags = { bold: bold > 0, italic: italic > 0, underline: underline > 0 };
    const ch = value[i];
    if (ch === "\n" || ch === "\r") {
      // The line breaker preserves every authored newline. Fold horizontal
      // space immediately around it into the newline's raw source because TeX
      // discards that glue at line edges, while serialization must retain it.
      let rawPrefix = "";
      let start = i;
      if (display.endsWith(" ")) {
        rawPrefix = chars[chars.length - 1].raw;
        start = valueStart[valueStart.length - 1];
        chars.pop();
        valueStart.pop();
        display = display.slice(0, -1);
      } else if (!display.length && prefix) {
        rawPrefix = prefix;
        start = 0;
        prefix = "";
      }
      let j = ch === "\r" && value[i + 1] === "\n" ? i + 2 : i + 1;
      while (j < value.length && /[^\S\r\n]/.test(value[j])) j += 1;
      display += "\n";
      chars.push({ raw: rawPrefix + value.slice(i, j), ...flags });
      valueStart.push(start);
      i = j;
      continue;
    }
    if (/[^\S\r\n]/.test(ch)) {
      // Consume one horizontal-whitespace run (tags inside a run would end it
      // — fine: adjacent display spaces collapse again below).
      let j = i;
      while (j < value.length && /[^\S\r\n]/.test(value[j])) j += 1;
      const raw = value.slice(i, j);
      // Collapse: no leading space, no doubled spaces (engine glue collapses).
      if (!display.length) {
        // Leading whitespace: display drops it; the value keeps it (prefix).
        prefix += raw;
      } else if (display[display.length - 1] !== " ") {
        display += " ";
        chars.push({ raw, ...flags });
        valueStart.push(i);
      } else {
        // Extend the previous space's raw so nothing is lost on serialize.
        chars[chars.length - 1] = { ...chars[chars.length - 1], raw: chars[chars.length - 1].raw + raw };
      }
      i = j;
      continue;
    }
    let raw: string;
    let shown: string;
    if (value.startsWith("---", i)) {
      raw = "---";
      shown = "—";
    } else if (value.startsWith("--", i)) {
      raw = "--";
      shown = "–";
    } else if (ch === "'") {
      raw = "'";
      shown = "’";
    } else {
      raw = ch;
      shown = ch;
    }
    if (opts?.uppercase) shown = shown.toUpperCase().slice(0, 1) || shown;
    display += shown;
    chars.push({ raw, ...flags });
    valueStart.push(i);
    i += raw.length;
  }
  // Trim the trailing display space into suffix (leading whitespace already
  // went to prefix above — display never starts with a space).
  let suffix = "";
  if (chars.length && display[display.length - 1] === " ") {
    suffix = chars[chars.length - 1].raw;
    chars.pop();
    valueStart.pop();
    display = display.slice(0, -1);
  }
  return { display, chars, valueStart, prefix, suffix };
}

// ---- display chars → value (canonical <b><i><u> nesting; flags-driven) ----

function serializeChars(prefix: string, chars: DisplayChar[], suffix: string, boundary: number): { value: string; boundaryIndex: number } {
  let value = prefix;
  let boundaryIndex = -1;
  let open = { bold: false, italic: false, underline: false };
  const closeAll = () => {
    if (open.underline) value += "</u>";
    if (open.italic) value += "</i>";
    if (open.bold) value += "</b>";
    open = { bold: false, italic: false, underline: false };
  };
  chars.forEach((c, idx) => {
    if (idx === boundary) boundaryIndex = value.length;
    if (c.bold !== open.bold || c.italic !== open.italic || c.underline !== open.underline) {
      closeAll();
      if (c.bold) value += "<b>";
      if (c.italic) value += "<i>";
      if (c.underline) value += "<u>";
      open = { bold: c.bold, italic: c.italic, underline: c.underline };
    }
    value += c.raw;
  });
  if (boundary >= chars.length) boundaryIndex = value.length;
  closeAll();
  value += suffix;
  if (boundaryIndex < 0) boundaryIndex = value.length - suffix.length;
  return { value, boundaryIndex };
}

// Replace display range [dStart, dEnd) with plain text; returns the new value
// and the caret's VALUE index (convert back to display with a fresh map, so
// newly-formed ligatures — e.g. typing the second "-" of "--" — land right).
export function applyEdit(map: DisplayMap, dStart: number, dEnd: number, insert: string): { value: string; caretValueIndex: number } {
  const inherit = map.chars[dStart - 1] ?? map.chars[dStart] ?? { bold: false, italic: false, underline: false };
  const inserted: DisplayChar[] = Array.from(insert).map((ch) => ({
    raw: ch,
    bold: inherit.bold,
    italic: inherit.italic,
    underline: inherit.underline
  }));
  const chars = [...map.chars.slice(0, dStart), ...inserted, ...map.chars.slice(dEnd)];
  return withBoundary(serializeChars(map.prefix, chars, map.suffix, dStart + inserted.length));
}

export function toggleMark(map: DisplayMap, dStart: number, dEnd: number, mark: "bold" | "italic" | "underline"): { value: string; caretValueIndex: number } {
  const range = map.chars.slice(dStart, dEnd);
  const allSet = range.length > 0 && range.every((c) => c[mark]);
  const chars = map.chars.map((c, i) => (i >= dStart && i < dEnd ? { ...c, [mark]: !allSet } : c));
  return withBoundary(serializeChars(map.prefix, chars, map.suffix, dEnd));
}

function withBoundary(res: { value: string; boundaryIndex: number }): { value: string; caretValueIndex: number } {
  return { value: res.value, caretValueIndex: res.boundaryIndex };
}

// Split a display boundary into two mark-balanced value halves (Enter).
export function splitValueAt(map: DisplayMap, d: number): { before: string; after: string } {
  const before = serializeChars(map.prefix, map.chars.slice(0, d), "", 0).value;
  const after = serializeChars("", map.chars.slice(d), map.suffix, 0).value;
  return { before, after };
}

// Value boundary → display boundary (smallest display index at/after it).
export function displayIndexForValueIndex(map: DisplayMap, valueIndex: number): number {
  for (let i = 0; i < map.valueStart.length; i += 1) {
    if (map.valueStart[i] >= valueIndex) return i;
  }
  return map.chars.length;
}

// ---- field access (the ResumeData contracts used by the engine) ----

function findEntry(data: ResumeData, sectionId: string, entryId: string) {
  const section = data.sections.find((s) => s.id === sectionId);
  return section?.items.find((it) => it.id === entryId) ?? null;
}

export function valueForField(data: ResumeData, src: FieldSrc): string {
  switch (src.kind) {
    case "name":
      return data.name;
    case "contact":
      return data.contact[src.index] ?? "";
    case "heading":
      return data.sections.find((s) => s.id === src.sectionId)?.heading ?? "";
    case "entry":
      return findEntry(data, src.sectionId, src.entryId)?.[src.field] ?? "";
    case "bullet": {
      const entry = findEntry(data, src.sectionId, src.entryId);
      return entry?.bullets.find((b) => b.id === src.bulletId)?.text ?? "";
    }
    case "skillsRow": {
      const entry = findEntry(data, src.sectionId, src.entryId);
      if (!entry) return "";
      const label = entry.titleLeft.trim();
      const skills = entry.subtitleLeft.trim();
      return label && skills ? `${label}: ${skills}` : label || skills;
    }
  }
}

// Every editable field, in document order. Used to locate what an undo/redo
// changed by diffing field values between the two snapshots.
export function listFieldSrcs(data: ResumeData): FieldSrc[] {
  const srcs: FieldSrc[] = [{ kind: "name" }];
  data.contact.forEach((_, index) => srcs.push({ kind: "contact", index }));
  for (const section of data.sections) {
    srcs.push({ kind: "heading", sectionId: section.id });
    for (const entry of section.items) {
      if (section.type === "skills") {
        srcs.push({ kind: "skillsRow", sectionId: section.id, entryId: entry.id });
      } else {
        for (const field of ["titleLeft", "titleRight", "subtitleLeft", "subtitleRight"] as const) {
          srcs.push({ kind: "entry", sectionId: section.id, entryId: entry.id, field });
        }
      }
      for (const bullet of entry.bullets) {
        srcs.push({ kind: "bullet", sectionId: section.id, entryId: entry.id, bulletId: bullet.id });
      }
    }
  }
  return srcs;
}

// Where to put the caret/selection after an undo/redo restores `after` from
// `before`. Finds the first field whose value differs and returns the changed
// span in the RESTORED value: a non-empty span is re-selected (so a replaced or
// deleted selection comes back highlighted), an empty span collapses the caret
// at the edit site — which for append-typing is the end of the text. Returns
// null when only structure changed (add/remove/reorder), so the caller leaves
// the selection alone instead of pointing at a field that moved or vanished.
export function historyCaretTarget(
  before: ResumeData,
  after: ResumeData
): { key: string; valueIndex: number; valueEndIndex?: number } | null {
  for (const src of listFieldSrcs(after)) {
    const afterVal = valueForField(after, src);
    const beforeVal = valueForField(before, src); // "" when the field is new in `after`
    if (afterVal === beforeVal) continue;
    const maxCommon = Math.min(afterVal.length, beforeVal.length);
    let prefix = 0;
    while (prefix < maxCommon && afterVal[prefix] === beforeVal[prefix]) prefix += 1;
    let suffix = 0;
    while (
      suffix < maxCommon - prefix &&
      afterVal[afterVal.length - 1 - suffix] === beforeVal[beforeVal.length - 1 - suffix]
    ) {
      suffix += 1;
    }
    const start = prefix;
    const end = afterVal.length - suffix;
    return { key: fieldKey(src), valueIndex: start, valueEndIndex: end > start ? end : undefined };
  }
  return null;
}

export function commitField(actions: ResumeEditorActions, src: FieldSrc, value: string): void {
  switch (src.kind) {
    case "name":
      actions.setName(value);
      break;
    case "contact":
      actions.updateContact(src.index, value);
      break;
    case "heading":
      actions.setHeading(src.sectionId, value);
      break;
    case "entry":
      actions.updateEntry(src.sectionId, src.entryId, src.field, value);
      break;
    case "bullet":
      actions.updateBullet(src.sectionId, src.entryId, src.bulletId, value);
      break;
    case "skillsRow": {
      // Same first-colon rule the renderer/engine use for "Label: skills".
      // The label/skills trim means caret restore can drift a char at the
      // colon seam — accepted (the row re-canonicalizes on paint).
      const colon = value.indexOf(":");
      if (colon > 0 && colon <= 40) {
        actions.updateSkillsRow(
          src.sectionId,
          src.entryId,
          value.slice(0, colon).trim(),
          value.slice(colon + 1).trim()
        );
      } else {
        actions.updateSkillsRow(src.sectionId, src.entryId, "", value.trim());
      }
      break;
    }
  }
}

// ---- DOM walk (painted spans → display offsets and back) ----

// The painter's spans hold display text PLUS injected whitespace (a space at
// segment gaps, "\n" at line ends). Walking rule: a char that matches the
// display consumes it; unmatched whitespace is injected (skip); anything else
// is a mismatch (structural drift — callers bail gracefully).
// Bullet markers share the bullet's provenance key but carry data-tsdm — a
// structural flag from the painter, so bullet CONTENT that happens to be "•"
// can never be mistaken for the marker.
export function fieldSpans(host: HTMLElement, key: string): HTMLElement[] {
  return Array.from(host.querySelectorAll<HTMLElement>(`[data-tsdf="${CSS.escape(key)}"]:not([data-tsdm])`));
}

export function caretToDisplayIndex(host: HTMLElement, key: string, display: string, node: Node, offset: number): number | null {
  const spans = fieldSpans(host, key);
  let d = 0;
  for (const span of spans) {
    const textNode = span.firstChild;
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) continue;
    const text = textNode.textContent ?? "";
    const isTarget = textNode === node || span === node;
    // When the browser reports the SPAN itself, `offset` is a child index
    // (0 = before the text node, 1 = after it), not a character offset.
    const upTo = !isTarget ? text.length : span === node ? (offset === 0 ? 0 : text.length) : Math.min(offset, text.length);
    for (let i = 0; i < upTo; i += 1) {
      const c = text[i];
      if (d < display.length && c === display[d]) d += 1;
      else if (/\s/.test(c)) {
        if (display[d] === " ") d += 1; // real interword space
        // else injected boundary whitespace — consumes nothing
      } else return null;
    }
    if (isTarget) return d;
  }
  return null;
}

export function displayIndexToCaret(host: HTMLElement, key: string, display: string, target: number): { node: Node; offset: number } | null {
  const spans = fieldSpans(host, key);
  let d = 0;
  let last: { node: Node; offset: number } | null = null;
  for (const span of spans) {
    const textNode = span.firstChild;
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) continue;
    const text = textNode.textContent ?? "";
    for (let i = 0; i < text.length; i += 1) {
      if (d >= target) return { node: textNode, offset: i };
      const c = text[i];
      if (d < display.length && c === display[d]) d += 1;
      else if (/\s/.test(c)) {
        if (display[d] === " ") d += 1;
      } else return last;
      last = { node: textNode, offset: i + 1 };
    }
  }
  return last ?? (spans[0]?.firstChild ? { node: spans[0].firstChild, offset: 0 } : null);
}
