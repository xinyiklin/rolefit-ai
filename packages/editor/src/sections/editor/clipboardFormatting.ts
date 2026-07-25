import type { DocumentFontFamily } from "@typeset/engine/typeset/fontRegistry.ts";
import { FONT_FAMILY_OPTIONS } from "@typeset/engine/lib/documentStyle.ts";
import { encodeLinkHref, normalizeLinkDestination } from "@typeset/engine/lib/links.ts";
import { inlineFontSizePt } from "@typeset/engine/lib/inlineMarksText.ts";

export const TYPESET_INLINE_CLIPBOARD_MIME = "application/x-typeset-inline+json";

const INLINE_CLIPBOARD_FORMAT = "typeset-inline";
const INLINE_CLIPBOARD_VERSION = 1;
const MAX_INLINE_CLIPBOARD_CHARS = 1_000_000;

type RichStyle = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  fontFamily: DocumentFontFamily | null;
  fontSizePt: number | null;
  href: string | null;
};

const PLAIN_STYLE: RichStyle = {
  bold: false,
  italic: false,
  underline: false,
  fontFamily: null,
  fontSizePt: null,
  href: null
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

export function encodeInlineClipboard(fragment: string): string {
  return JSON.stringify({
    format: INLINE_CLIPBOARD_FORMAT,
    schemaVersion: INLINE_CLIPBOARD_VERSION,
    value: fragment
  });
}

export function decodeInlineClipboard(payload: string): string | null {
  if (!payload || payload.length > MAX_INLINE_CLIPBOARD_CHARS) return null;
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    if (
      parsed.format !== INLINE_CLIPBOARD_FORMAT ||
      parsed.schemaVersion !== INLINE_CLIPBOARD_VERSION ||
      typeof parsed.value !== "string" ||
      parsed.value.length > MAX_INLINE_CLIPBOARD_CHARS
    ) {
      return null;
    }
    return parsed.value;
  } catch {
    return null;
  }
}

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

function styleForElement(element: HTMLElement, inherited: RichStyle): RichStyle {
  const next = { ...inherited };
  const tag = element.tagName;
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
  return value;
}

// Convert clipboard HTML into the editor's small, allowlisted inline grammar.
// DOMParser gives us text nodes only; scripts, event handlers, arbitrary CSS,
// unsupported fonts, and unknown markup never cross into document state.
export function inlineFragmentFromHtml(html: string): string | null {
  if (!html || html.length > MAX_INLINE_CLIPBOARD_CHARS) return null;
  const document = new DOMParser().parseFromString(html, "text/html");

  const visit = (node: Node, inherited: RichStyle): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return wrapText(node.nodeValue ?? "", inherited);
    }
    if (!(node instanceof HTMLElement)) return "";
    if (node.tagName === "BR") return "\n";
    const style = styleForElement(node, inherited);
    let value = Array.from(node.childNodes)
      .map((child) => visit(child, style))
      .join("");
    if (BLOCK_TAGS.has(node.tagName) && value && !value.endsWith("\n")) value += "\n";
    return value;
  };

  const value = Array.from(document.body.childNodes)
    .map((node) => visit(node, PLAIN_STYLE))
    .join("")
    .replace(/\n+$/, "");
  return value || null;
}
