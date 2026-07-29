import type { DocumentFontFamily } from "@typeset/engine/typeset/fontRegistry.ts";
import { FONT_FAMILY_OPTIONS } from "@typeset/engine/lib/documentStyle.ts";
import { automaticLinkHref } from "@typeset/engine/lib/links.ts";
import {
  paragraphSpacingFromInlineMarks,
  type FieldAlignment
} from "@typeset/engine/lib/inlineMarksText.ts";

import type { DisplayMap } from "./inlineTextEditing.ts";
import type { FieldSrc } from "@typeset/engine/typeset/types.ts";

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
