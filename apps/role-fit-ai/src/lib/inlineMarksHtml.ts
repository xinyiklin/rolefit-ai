import { texLigatures } from "@typeset/engine/typeset/measure.ts";

const INLINE_TAG_RE = /<\/?(?:b|i|u)>/gi;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Convert the tiny persisted mark grammar into fully escaped display HTML. */
export function inlineMarksToHtml(value: string): string {
  const source = String(value ?? "");
  let html = "";
  let cursor = 0;

  for (const match of source.matchAll(INLINE_TAG_RE)) {
    const tag = match[0].toLowerCase();
    html += escapeHtml(texLigatures(source.slice(cursor, match.index)));
    if (tag === "<b>") html += "<strong>";
    else if (tag === "</b>") html += "</strong>";
    else if (tag === "<i>") html += "<em>";
    else if (tag === "</i>") html += "</em>";
    else html += tag;
    cursor = (match.index ?? 0) + match[0].length;
  }

  html += escapeHtml(texLigatures(source.slice(cursor)));
  return html.replace(/\n/g, "<br>");
}
