import type { DocumentFontFamily } from "@typeset/engine/typeset/fontRegistry.ts";
import { FONT_FAMILY_OPTIONS } from "@typeset/engine/lib/documentStyle.ts";
import {
  encodeLinkHref,
  normalizeLinkDestination
} from "@typeset/engine/lib/links.ts";
import {
  inlineFontSizePt,
  paragraphLineHeight,
  paragraphSpacePt
} from "@typeset/engine/lib/inlineMarksText.ts";

// How source whitespace lays out: "normal" collapses spaces and newlines,
// "pre-line" collapses spaces but keeps newlines, "pre" keeps both.
type WhiteSpace = "normal" | "pre-line" | "pre";

type RichStyle = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  fontFamily: DocumentFontFamily | null;
  fontSizePt: number | null;
  lineHeight: number | null;
  href: string | null;
  whiteSpace: WhiteSpace;
};

const PLAIN_STYLE: RichStyle = {
  bold: false,
  italic: false,
  underline: false,
  fontFamily: null,
  fontSizePt: null,
  lineHeight: null,
  href: null,
  whiteSpace: "normal"
};

const BLOCK_TAGS = new Set([
  "ADDRESS",
  "BLOCKQUOTE",
  "DIV",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "LI",
  "P",
  "PRE"
]);
const MAX_INLINE_CLIPBOARD_CHARS = 1_000_000;

// Names beyond a family's own label that should resolve to it. Two kinds:
// internal CSS families the painter emits (so copying inside the editor
// round-trips), and the proprietary families a bundled font is metrically
// compatible with — text pasted from a Word or Docs file set in Times New Roman
// lands on the font that keeps its measurements instead of losing the family.
const FAMILY_ALIASES: Partial<Record<DocumentFontFamily, readonly string[]>> = {
  "latin-modern": ["lm roman"],
  // Helvetica and Arial share advance widths, so Helvetica belongs on the
  // Arial-metric font too.
  arimo: ["helvetica"],
  tinos: ["times"]
};

// Longest name first so a short alias cannot shadow a longer, more specific one.
const FAMILY_NAMES: ReadonlyArray<readonly [string, DocumentFontFamily]> = FONT_FAMILY_OPTIONS.flatMap(
  (option) => {
    const names = [option.label, ...(option.metricsOf ? [option.metricsOf] : []), ...(FAMILY_ALIASES[option.value] ?? [])];
    return names.map((name) => [name.toLowerCase(), option.value] as const);
  }
).sort((left, right) => right[0].length - left[0].length);

function mappedFontFamily(value: string): DocumentFontFamily | null {
  const normalized = value.toLowerCase().replace(/["']/g, "");
  return FAMILY_NAMES.find(([name]) => normalized.includes(name))?.[1] ?? null;
}

function parsedFontSize(value: string): number | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(pt|px)\s*$/i.exec(value);
  if (!match) return null;
  const numeric = Number(match[1]);
  if (!Number.isFinite(numeric)) return null;
  const points = match[2].toLowerCase() === "px" ? numeric * 0.75 : numeric;
  return inlineFontSizePt(points);
}

export function clipboardParagraphSpacePt(value: string): number | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(pt|px)\s*$/i.exec(value);
  if (!match) return null;
  const numeric = Number(match[1]);
  if (!Number.isFinite(numeric)) return null;
  const points = match[2].toLowerCase() === "px" ? numeric * 0.75 : numeric;
  return paragraphSpacePt(points);
}

export function clipboardLineHeight(
  value: string,
  fontSizePt: number | null
): number | null {
  const normalized = value.trim().toLowerCase();
  const unitless = /^(\d+(?:\.\d+)?)$/.exec(normalized);
  if (unitless) return paragraphLineHeight(Number(unitless[1]));
  const percent = /^(\d+(?:\.\d+)?)%$/.exec(normalized);
  if (percent) return paragraphLineHeight(Number(percent[1]) / 100);
  const absolute = /^(\d+(?:\.\d+)?)\s*(pt|px)$/.exec(normalized);
  if (!absolute || fontSizePt === null || fontSizePt <= 0) return null;
  const numeric = Number(absolute[1]);
  if (!Number.isFinite(numeric)) return null;
  const points = absolute[2] === "px" ? numeric * 0.75 : numeric;
  return paragraphLineHeight(points / fontSizePt);
}

function whiteSpaceFor(value: string): WhiteSpace | null {
  const normalized = value.trim().toLowerCase();
  // Newer two-value syntax (`preserve nowrap`) and white-space-collapse keywords.
  if (/^(?:preserve|break-spaces)\b/.test(normalized)) return "pre";
  if (/^preserve-breaks\b/.test(normalized)) return "pre-line";
  if (/^collapse\b/.test(normalized)) return "normal";
  switch (normalized) {
    case "pre":
    case "pre-wrap":
    case "break-spaces":
      return "pre";
    case "pre-line":
      return "pre-line";
    case "normal":
    case "nowrap":
      return "normal";
    default:
      return null;
  }
}

function styleForElement(element: HTMLElement, inherited: RichStyle): RichStyle {
  const next = { ...inherited };
  const tag = element.tagName;
  if (tag === "PRE") next.whiteSpace = "pre";
  next.whiteSpace =
    whiteSpaceFor(element.style.whiteSpace) ??
    whiteSpaceFor(element.style.getPropertyValue("white-space-collapse")) ??
    next.whiteSpace;
  if (tag === "B" || tag === "STRONG") next.bold = true;
  if (tag === "I" || tag === "EM") next.italic = true;
  if (tag === "U") next.underline = true;

  const weight = element.style.fontWeight.trim().toLowerCase();
  if (weight) {
    const numeric = Number(weight);
    next.bold = weight === "bold" || weight === "bolder" || (Number.isFinite(numeric) && numeric >= 600);
  }
  const fontStyle = element.style.fontStyle.trim().toLowerCase();
  if (fontStyle) next.italic = fontStyle === "italic" || fontStyle === "oblique";
  const decoration = `${element.style.textDecoration} ${element.style.textDecorationLine}`.toLowerCase();
  if (decoration.trim()) next.underline = decoration.includes("underline");

  const family = mappedFontFamily(element.style.fontFamily);
  if (family) next.fontFamily = family;
  const size = parsedFontSize(element.style.fontSize);
  if (size !== null) next.fontSizePt = size;
  const lineHeight = clipboardLineHeight(element.style.lineHeight, next.fontSizePt);
  if (lineHeight !== null) next.lineHeight = lineHeight;

  if (tag === "A") {
    next.href = normalizeLinkDestination(element.getAttribute("href") ?? "");
  }
  return next;
}

function wrapText(text: string, style: RichStyle): string {
  let value = text;
  if (style.underline) value = `<u>${value}</u>`;
  if (style.italic) value = `<i>${value}</i>`;
  if (style.bold) value = `<b>${value}</b>`;
  if (style.fontFamily) value = `<font=${style.fontFamily}>${value}</font>`;
  if (style.fontSizePt !== null) value = `<size=${style.fontSizePt}>${value}</size>`;
  if (style.href) value = `<link=${encodeLinkHref(style.href)}>${value}</link>`;
  if (style.lineHeight !== null) {
    value = `<line-height=${style.lineHeight}>${value}</line-height>`;
  }
  return value;
}

// Convert clipboard HTML into the editor's small, allowlisted inline grammar.
// DOMParser gives us text nodes only; scripts, event handlers, arbitrary CSS,
// unsupported fonts, and unknown markup never cross into document state.
const BLOCK_SEPARATOR = "\uFDD0";

// A collapsed space the text ended with, followed only by closing mark tags.
const TRAILING_COLLAPSED_SPACE = / ((?:<\/[^<>]+>)*)$/;

function collapseWhiteSpace(text: string, mode: WhiteSpace): string {
  if (mode === "pre") return text;
  if (mode === "pre-line") {
    return text.replace(/\r\n?/g, "\n").replace(/[\t ]*\n[\t ]*/g, "\n").replace(/[\t ]+/g, " ");
  }
  return text.replace(/[\t\n\r ]+/g, " ");
}

function fragmentsFromHtml(html: string): ParsedClipboardHtml {
  if (!html || html.length > MAX_INLINE_CLIPBOARD_CHARS) {
    return parsedClipboardHtml(null, false);
  }
  const document = new DOMParser().parseFromString(html, "text/html");
  let sawBlockStructure = false;
  // Emitted pieces; a block joins and rewraps only its own tail, so large
  // pastes never re-copy the whole output per paragraph.
  const out: string[] = [];
  // Browser-style collapsing across text nodes: a collapsed space is dropped at
  // a line start, after another collapsed space, and before a line end. A
  // whitespace-only node waits in `pendingSpace` so a line end can discard it
  // without leaving an empty mark behind.
  let atLineStart = true;
  let endsWithCollapsedSpace = false;
  let pendingSpace: string | null = null;

  const endLine = () => {
    // The flag guarantees the last piece is the text that ended with the space.
    if (endsWithCollapsedSpace) out.push(out.pop()!.replace(TRAILING_COLLAPSED_SPACE, "$1"));
    endsWithCollapsedSpace = false;
    pendingSpace = null;
    atLineStart = true;
  };

  const emitText = (raw: string, style: RichStyle) => {
    let text = collapseWhiteSpace(raw, style.whiteSpace);
    if (style.whiteSpace !== "pre" && (atLineStart || endsWithCollapsedSpace || pendingSpace !== null)) {
      text = text.replace(/^ /, "");
    }
    if (!text) return;
    if (style.whiteSpace !== "pre" && text === " ") {
      pendingSpace = wrapText(text, style);
      return;
    }
    out.push((pendingSpace ?? "") + wrapText(text, style));
    pendingSpace = null;
    atLineStart = text.endsWith("\n");
    endsWithCollapsedSpace = style.whiteSpace !== "pre" && text.endsWith(" ");
  };

  const visit = (node: Node, inherited: RichStyle): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      emitText(node.nodeValue ?? "", inherited);
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.tagName === "BR") {
      endLine();
      out.push("\n");
      return;
    }
    const style = styleForElement(node, inherited);
    const block = BLOCK_TAGS.has(node.tagName);
    if (block) endLine();
    const start = out.length;
    for (const child of Array.from(node.childNodes)) visit(child, style);
    if (!block) return;
    endLine();
    sawBlockStructure = true;
    let value = out.splice(start).join("");
    // Descendant blocks already own their separators and margins; wrapping a
    // container such as Google Docs' internal root would add a false block.
    if (value.includes(BLOCK_SEPARATOR)) {
      out.push(value);
      return;
    }
    const spaceBeforePt = clipboardParagraphSpacePt(
      node.style.marginTop || node.style.marginBlockStart
    );
    const spaceAfterPt = clipboardParagraphSpacePt(
      node.style.marginBottom || node.style.marginBlockEnd
    );
    if ((spaceAfterPt ?? 0) > 0) {
      value = `<space-after=${spaceAfterPt}>${value}</space-after>`;
    }
    if ((spaceBeforePt ?? 0) > 0) {
      value = `<space-before=${spaceBeforePt}>${value}</space-before>`;
    }
    if (style.lineHeight !== null && !/<line-height=/i.test(value)) {
      value = `<line-height=${style.lineHeight}>${value}</line-height>`;
    }
    out.push(value + BLOCK_SEPARATOR);
  };

  for (const node of Array.from(document.body.childNodes)) visit(node, PLAIN_STYLE);
  endLine();
  const value = out.join("").replace(new RegExp(`${BLOCK_SEPARATOR}+$`), "");
  return parsedClipboardHtml(value || null, sawBlockStructure);
}

export type ParsedClipboardHtml = {
  inlineValue: string | null;
  blocks: string[] | null;
  sawBlockStructure: boolean;
};

export function parsedClipboardHtml(
  value: string | null,
  sawBlockStructure: boolean
): ParsedClipboardHtml {
  return {
    inlineValue: value?.split(BLOCK_SEPARATOR).join("\n") ?? null,
    blocks: value && sawBlockStructure ? value.split(BLOCK_SEPARATOR) : null,
    sawBlockStructure
  };
}

export function inlineFragmentFromHtml(html: string): string | null {
  return fragmentsFromHtml(html).inlineValue;
}

export function paragraphFragmentsFromHtml(html: string): string[] | null {
  return fragmentsFromHtml(html).blocks;
}
