import type { DocumentFontFamily } from "@typeset/engine/typeset/fontRegistry.ts";
import { FONT_FAMILY_OPTIONS } from "@typeset/engine/lib/documentStyle.ts";
import {
  automaticLinkHref,
  encodeLinkHref,
  normalizeLinkDestination
} from "@typeset/engine/lib/links.ts";
import {
  inlineFontSizePt,
  paragraphLineHeight,
  paragraphSpacePt,
  paragraphSpacingFromInlineMarks,
  type FieldAlignment
} from "@typeset/engine/lib/inlineMarksText.ts";

import type { DisplayMap } from "./inlineTextEditing.ts";
import type { FieldSrc } from "@typeset/engine/typeset/types.ts";
import type { DocumentHeader } from "@typeset/engine/lib/resumeData.ts";

export const TYPESET_INLINE_CLIPBOARD_MIME = "application/x-typeset-inline+json";
export const TYPESET_SELECTION_CLIPBOARD_MIME =
  "application/x-typeset-selection+json";

const INLINE_CLIPBOARD_FORMAT = "typeset-inline";
const INLINE_CLIPBOARD_VERSION = 1;
const MAX_INLINE_CLIPBOARD_CHARS = 1_000_000;
const SELECTION_CLIPBOARD_FORMAT = "typeset-selection";
const SELECTION_CLIPBOARD_VERSION = 1;

export type TypesetSelectionClipboardBlock =
  | { kind: "header"; header: DocumentHeader }
  | { kind: "paragraph"; value: string };

export function encodeSelectionClipboard(
  blocks: readonly TypesetSelectionClipboardBlock[]
): string {
  return JSON.stringify({
    format: SELECTION_CLIPBOARD_FORMAT,
    schemaVersion: SELECTION_CLIPBOARD_VERSION,
    blocks
  });
}

export function decodeSelectionClipboard(
  payload: string
): TypesetSelectionClipboardBlock[] | null {
  if (!payload || payload.length > MAX_INLINE_CLIPBOARD_CHARS) return null;
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    if (
      Object.keys(parsed).sort().join("|") !== "blocks|format|schemaVersion" ||
      parsed.format !== SELECTION_CLIPBOARD_FORMAT ||
      parsed.schemaVersion !== SELECTION_CLIPBOARD_VERSION ||
      !Array.isArray(parsed.blocks) ||
      parsed.blocks.length > 1_000
    ) {
      return null;
    }
    const blocks: TypesetSelectionClipboardBlock[] = [];
    for (const raw of parsed.blocks) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
      const block = raw as Record<string, unknown>;
      if (block.kind === "paragraph") {
        if (
          Object.keys(block).some((key) => key !== "kind" && key !== "value") ||
          typeof block.value !== "string" ||
          block.value.length > 100_000
        ) {
          return null;
        }
        blocks.push({ kind: "paragraph", value: block.value });
        continue;
      }
      if (block.kind !== "header") return null;
      if (
        Object.keys(block).some((key) => key !== "kind" && key !== "header") ||
        !block.header ||
        typeof block.header !== "object" ||
        Array.isArray(block.header)
      ) {
        return null;
      }
      const header = block.header as Record<string, unknown>;
      if (
        Object.keys(header).sort().join("|") !== "contact|name|visible" ||
        typeof header.visible !== "boolean" ||
        (header.name !== null && typeof header.name !== "string") ||
        !Array.isArray(header.contact) ||
        header.contact.length > 1_000 ||
        header.contact.some((item) => typeof item !== "string") ||
        (header.name === null && header.contact.length === 0)
      ) {
        return null;
      }
      blocks.push({
        kind: "header",
        header: {
          visible: header.visible,
          name: header.name as string | null,
          contact: [...header.contact] as string[]
        }
      });
    }
    const headerIndex = blocks.findIndex((block) => block.kind === "header");
    if (
      headerIndex > 0 ||
      blocks.filter((block) => block.kind === "header").length > 1
    ) {
      return null;
    }
    return blocks.length ? blocks : null;
  } catch {
    return null;
  }
}

type RichStyle = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  fontFamily: DocumentFontFamily | null;
  fontSizePt: number | null;
  lineHeight: number | null;
  href: string | null;
};

const PLAIN_STYLE: RichStyle = {
  bold: false,
  italic: false,
  underline: false,
  fontFamily: null,
  fontSizePt: null,
  lineHeight: null,
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
      Object.keys(parsed).sort().join("|") !== "format|schemaVersion|value" ||
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

export type ClipboardRange = {
  src: FieldSrc;
  map: DisplayMap;
  dStart: number;
  dEnd: number;
  defaultFontFamily: DocumentFontFamily;
  defaultFontSizePt: number;
  defaultAlignment: FieldAlignment;
  defaultLineHeight: number;
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const escapeAttribute = (value: string): string =>
  escapeHtml(value).replace(/"/g, "&quot;");

function externalFontFamily(family: DocumentFontFamily): string {
  const option = FONT_FAMILY_OPTIONS.find((candidate) => candidate.value === family);
  return option?.metricsOf ?? option?.label ?? family;
}

function inlineHtmlForRange(range: ClipboardRange): string {
  const chunks: string[] = [];
  let currentKey = "";
  let currentText = "";
  const automaticHrefs: Array<string | null> = range.map.chars.map(() => null);
  let wordStart = 0;
  for (let index = 0; index <= range.map.chars.length; index += 1) {
    const char = range.map.display[index];
    if (index < range.map.chars.length && char !== " " && char !== "\n") continue;
    const word = range.map.chars.slice(wordStart, index);
    if (
      word.length &&
      word.every((candidate) => candidate.linkHref === null && !candidate.linkSuppressed)
    ) {
      const href = automaticLinkHref(range.map.display.slice(wordStart, index));
      if (href) {
        for (let cursor = wordStart; cursor < index; cursor += 1) {
          automaticHrefs[cursor] = href;
        }
      }
    }
    wordStart = index + 1;
  }

  const flush = () => {
    if (!currentText) return;
    const [family, size, lineHeight, bold, italic, underline, href] = JSON.parse(currentKey) as [
      string,
      number,
      number,
      boolean,
      boolean,
      boolean,
      string | null
    ];
    const styles = [
      `font-family: ${family}`,
      `font-size: ${size}pt`,
      `line-height: ${lineHeight}`,
      ...(bold ? ["font-weight: 700"] : []),
      ...(italic ? ["font-style: italic"] : []),
      ...(underline ? ["text-decoration: underline"] : []),
      "white-space: pre-wrap"
    ];
    const content = `<span style="${styles.join("; ")}">${currentText}</span>`;
    chunks.push(href ? `<a href="${escapeAttribute(href)}">${content}</a>` : content);
    currentText = "";
  };

  for (let index = range.dStart; index < range.dEnd; index += 1) {
    const char = range.map.chars[index];
    if (!char) continue;
    const key = JSON.stringify([
      externalFontFamily(char.fontFamily ?? range.defaultFontFamily),
      char.fontSizePt ?? range.defaultFontSizePt,
      char.lineHeight ?? range.defaultLineHeight,
      char.bold,
      char.italic,
      char.underline,
      char.linkHref ?? automaticHrefs[index]
    ]);
    if (currentText && key !== currentKey) flush();
    currentKey = key;
    currentText += escapeHtml(range.map.display[index] ?? "").replace(/\r?\n/g, "<br>");
  }
  flush();
  return chunks.join("");
}

// External copy follows the logical document, not the absolutely positioned
// line divs used to paint it. Destination editors can therefore reflow one
// paragraph to their own measure instead of treating every Typeset wrap point
// as a hard block boundary.
function paragraphHtml(
  range: ClipboardRange,
  inline: string,
  role?: "name" | "contacts"
): string {
  const fullParagraph =
    range.dStart === 0 && range.dEnd === range.map.chars.length;
  const spacing = fullParagraph
    ? paragraphSpacingFromInlineMarks(range.map.source)
    : { lineHeight: null, spaceBeforePt: null, spaceAfterPt: null };
  const alignment =
    range.map.chars[range.dStart]?.alignment ?? range.defaultAlignment;
  const lineHeight =
    range.map.chars[range.dStart]?.lineHeight ??
    spacing.lineHeight ??
    range.defaultLineHeight;
  return `<p${role ? ` data-typeset-role="${role}"` : ""} style="margin-top: ${spacing.spaceBeforePt ?? 0}pt; margin-right: 0; margin-bottom: ${spacing.spaceAfterPt ?? 0}pt; margin-left: 0; text-align: ${alignment}; line-height: ${lineHeight}">${inline || "<br>"}</p>`;
}

export function clipboardHtmlForRanges(
  ranges: readonly ClipboardRange[],
  contactDivider = "|"
): string {
  if (!ranges.length) return "";
  const blocks: string[] = [];

  for (let index = 0; index < ranges.length; index += 1) {
    const range = ranges[index];
    if (range.src.kind === "contact") {
      const contacts: ClipboardRange[] = [];
      while (ranges[index]?.src.kind === "contact") {
        contacts.push(ranges[index]);
        index += 1;
      }
      index -= 1;
      const divider = ` <span aria-hidden="true">${escapeHtml(contactDivider)}</span> `;
      blocks.push(
        paragraphHtml(
          contacts[0],
          contacts.map(inlineHtmlForRange).join(divider),
          "contacts"
        )
      );
      continue;
    }
    const fullParagraph =
      range.dStart === 0 && range.dEnd === range.map.chars.length;
    const inline = inlineHtmlForRange(range);
    const asBlock = ranges.length > 1 || fullParagraph;
    blocks.push(
      asBlock
        ? paragraphHtml(
            range,
            inline,
            range.src.kind === "name" ? "name" : undefined
          )
        : inline
    );
  }
  return blocks.join("");
}

export function clipboardPlainTextForRanges(
  ranges: readonly ClipboardRange[],
  contactDivider = "|"
): string {
  const blocks: string[] = [];
  let previousWasHeader = false;
  for (let index = 0; index < ranges.length; index += 1) {
    const range = ranges[index];
    const isHeader =
      range.src.kind === "name" || range.src.kind === "contact";
    if (blocks.length && previousWasHeader && !isHeader) blocks.push("");
    if (range.src.kind === "contact") {
      const contacts: string[] = [];
      while (ranges[index]?.src.kind === "contact") {
        const contact = ranges[index];
        contacts.push(contact.map.display.slice(contact.dStart, contact.dEnd));
        index += 1;
      }
      index -= 1;
      blocks.push(contacts.join(` ${contactDivider} `));
    } else {
      blocks.push(range.map.display.slice(range.dStart, range.dEnd));
    }
    previousWasHeader = isHeader;
  }
  return blocks.join("\n");
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

function fragmentsFromHtml(html: string): ParsedClipboardHtml {
  if (!html || html.length > MAX_INLINE_CLIPBOARD_CHARS) {
    return parsedClipboardHtml(null, false);
  }
  const document = new DOMParser().parseFromString(html, "text/html");
  let sawBlockStructure = false;

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
    if (BLOCK_TAGS.has(node.tagName)) {
      sawBlockStructure = true;
      // A wrapper such as Google Docs' docs-internal-guid container may contain
      // several real paragraph blocks. Those descendants already own the
      // separators and paragraph margins; wrapping the container again would
      // add a false extra paragraph.
      if (value.includes(BLOCK_SEPARATOR)) return value;
      // Google Docs represents paragraph before/after spacing as block margins.
      // Convert those physical values into the editor's explicit paragraph
      // marks before reducing the block to its textual separator.
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
      value += BLOCK_SEPARATOR;
    }
    return value;
  };

  const value = Array.from(document.body.childNodes)
    .map((node) => visit(node, PLAIN_STYLE))
    .join("")
    .replace(new RegExp(`${BLOCK_SEPARATOR}+$`), "");
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

// Structural paste choices operate on logical blocks. Rich HTML wins because
// it retains the supported inline grammar; plain text is only a fallback and
// splits on authored, nonempty lines rather than guessing at header roles.
export function clipboardBlocks(
  html: string,
  plainText: string
): string[] {
  const rich = paragraphFragmentsFromHtml(html);
  if (rich?.length) return rich;
  return plainText
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
}

export function defaultDocumentPasteMapping(blockCount: number): {
  nameIndex: number | null;
  bodyStart: number;
} {
  if (blockCount <= 1) return { nameIndex: null, bodyStart: 0 };
  const bodyStart = Math.min(2, blockCount - 1);
  return { nameIndex: 0, bodyStart };
}
