import type { ReactNode } from "react";

export { stripInlineMarks } from "@typeset/engine/lib/inlineMarksText.ts";
// Ligature DISPLAY preview: ASCII `---` renders as an em dash, `--` as an en
// dash, and `'` as a typographic apostrophe. Rendered resume surfaces use the
// same substitutions so the on-screen page matches the PDF —
// but ONLY at the display layer: ResumeData keeps the ASCII the user typed
// (serializeRichHtml maps the glyphs back), so scoring and the stored data
// are untouched, and reparsing can never split a "–"-joined date range. The
// shared engine owns this transform (also used by measurement/painting); this
// file re-exports it (and uses it locally below) rather than keeping a
// second copy.
export { texLigatures } from "@typeset/engine/typeset/measure.ts";
import { texLigatures } from "@typeset/engine/typeset/measure.ts";
export { inlineMarksToHtml } from "./inlineMarksHtml";
import { inlineMarksToHtml } from "./inlineMarksHtml";

// Lightweight inline formatting for resume text. The rich editor serializes
// inline style as small internal tags (`<b>`, `<i>`, `<u>`) so nested bold/
// italic/underline can round-trip through the editor and the owned renderers
// without changing the ResumeData schema.

const HAS_INLINE_MARKUP_RE = /<\/?(?:b|i|u)>/i;

const TEX_LIGATURE_RE = /---|--|'/;

// Inverse of texLigatures, for serializing edited DOM back to ResumeData.
function unTexLigatures(text: string): string {
  return text.replace(/—/g, "---").replace(/–/g, "--").replace(/’/g, "'");
}

// Render inline markup as sanitized HTML. The source string is escaped except
// for the tiny allowed tag set above, so pasted/typed HTML cannot execute.
export function renderInlineMarks(text: string): ReactNode {
  if (!HAS_INLINE_MARKUP_RE.test(text)) {
    // Plain text still gets the TeX-ligature preview (no HTML needed).
    return TEX_LIGATURE_RE.test(text) ? texLigatures(text) : text;
  }
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
  // Undo the display-layer TeX ligatures so ResumeData stays ASCII (see
  // texLigatures above): the DOM shows \u2014/\u2013/\u2019, the stored value keeps ---/--/'.
  return unTexLigatures(normalized);
}
