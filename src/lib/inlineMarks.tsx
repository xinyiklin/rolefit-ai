import type { ReactNode } from "react";

// Lightweight inline formatting for resume text. The rich editor serializes
// inline style as small internal tags (`<b>`, `<i>`, `<u>`) so nested bold/
// italic/underline can round-trip through the editor, print mirror, and LaTeX
// export without changing the ResumeData schema.

const INLINE_TAG_RE = /<\/?(?:b|i|u)>/gi;
const HAS_INLINE_MARKUP_RE = /<\/?(?:b|i|u)>/i;

export function stripInlineMarks(text: string): string {
  return text.replace(INLINE_TAG_RE, "");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function inlineMarksToHtml(value: string): string {
  const source = String(value ?? "");
  let html = "";
  let cursor = 0;

  for (const match of source.matchAll(INLINE_TAG_RE)) {
    const tag = match[0].toLowerCase();
    html += escapeHtml(source.slice(cursor, match.index));
    if (tag === "<b>") html += "<strong>";
    else if (tag === "</b>") html += "</strong>";
    else if (tag === "<i>") html += "<em>";
    else if (tag === "</i>") html += "</em>";
    else html += tag;
    cursor = (match.index ?? 0) + match[0].length;
  }

  html += escapeHtml(source.slice(cursor));
  return html.replace(/\n/g, "<br>");
}

// Render inline markup as sanitized HTML. The source string is escaped except
// for the tiny allowed tag set above, so pasted/typed HTML cannot execute.
export function renderInlineMarks(text: string): ReactNode {
  if (!HAS_INLINE_MARKUP_RE.test(text)) return text;
  return <span dangerouslySetInnerHTML={{ __html: inlineMarksToHtml(text) }} />;
}

type InlineStyleState = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
};

function nodeHasStyle(element: HTMLElement, style: keyof InlineStyleState): boolean {
  const tag = element.tagName.toLowerCase();
  if (style === "bold") {
    return tag === "b" || tag === "strong" || /bold|[6-9]00/.test(element.style.fontWeight);
  }
  if (style === "italic") {
    return tag === "i" || tag === "em" || element.style.fontStyle === "italic";
  }
  return tag === "u" || element.style.textDecorationLine.includes("underline") || element.style.textDecoration.includes("underline");
}

function wrapTextForState(text: string, state: InlineStyleState): string {
  if (!text) return "";
  let out = text.replace(/\u00a0/g, " ");
  if (state.underline) out = `<u>${out}</u>`;
  if (state.italic) out = `<i>${out}</i>`;
  if (state.bold) out = `<b>${out}</b>`;
  return out;
}

function serializeNode(node: Node, inherited: InlineStyleState): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return wrapTextForState(node.textContent ?? "", inherited);
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const element = node as HTMLElement;
  const tag = element.tagName.toLowerCase();
  if (tag === "br") return "\n";

  const state: InlineStyleState = {
    bold: inherited.bold || nodeHasStyle(element, "bold"),
    italic: inherited.italic || nodeHasStyle(element, "italic"),
    underline: inherited.underline || nodeHasStyle(element, "underline")
  };
  let out = Array.from(element.childNodes).map((child) => serializeNode(child, state)).join("");
  if ((tag === "div" || tag === "p" || tag === "li") && out && !out.endsWith("\n")) out += "\n";
  return out;
}

export function serializeRichHtml(root: HTMLElement, multiline: boolean): string {
  const value = Array.from(root.childNodes)
    .map((node) => serializeNode(node, { bold: false, italic: false, underline: false }))
    .join("")
    .replace(/\u00a0/g, " ");
  const normalized = multiline ? value.replace(/\n{3,}/g, "\n\n").replace(/\n+$/g, "") : value.replace(/\s*\n+\s*/g, " ");
  return normalized;
}
