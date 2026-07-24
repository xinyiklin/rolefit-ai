import { INLINE_MARK_TAG_PATTERN } from "@typeset/engine/lib/inlineMarksText.ts";
import { texLigatures } from "@typeset/engine/typeset/measure.ts";

// Instance over the engine's single inline-mark grammar (D057). Only b/i/u
// render semantically; the structural marks (link/font/size/align/nolink) are
// stripped for display — matching just the b/i/u subset here used to leak
// engine-authored link/font/size/align tags as literal text in the review rail.
const INLINE_TAG_RE = new RegExp(INLINE_MARK_TAG_PATTERN, "gi");

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Convert the persisted inline-mark grammar into fully escaped display HTML. */
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
    else if (tag === "<u>") html += "<u>";
    else if (tag === "</u>") html += "</u>";
    // Any other grammar tag carries structure, not display text: drop the tag,
    // keep its content.
    cursor = (match.index ?? 0) + match[0].length;
  }

  html += escapeHtml(texLigatures(source.slice(cursor)));
  return html.replace(/\n/g, "<br>");
}
