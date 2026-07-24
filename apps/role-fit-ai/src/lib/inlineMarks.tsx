import type { ReactNode } from "react";

export { stripInlineMarks } from "@typeset/engine/lib/inlineMarksText.ts";
// Ligature DISPLAY preview: ASCII `---` renders as an em dash, `--` as an en
// dash, and `'` as a typographic apostrophe. Rendered resume surfaces use the
// same substitutions so the on-screen page matches the PDF —
// but ONLY at the display layer: ResumeData keeps the ASCII the user typed
// (the editor package's contenteditable adapter maps the glyphs back on
// serialize), so scoring and the stored data are untouched, and reparsing can
// never split a "–"-joined date range. The shared engine owns this transform
// (also used by measurement/painting); this file re-exports it (and uses it
// locally below) rather than keeping a second copy.
export { texLigatures } from "@typeset/engine/typeset/measure.ts";
import { texLigatures } from "@typeset/engine/typeset/measure.ts";
import { hasInlineMarkTags } from "@typeset/engine/lib/inlineMarksText.ts";
export { inlineMarksToHtml } from "./inlineMarksHtml";
import { inlineMarksToHtml } from "./inlineMarksHtml";

// Display layer for the engine's inline-mark grammar in RoleFit chrome (review
// rail, suggestion cards). Rendering and mark detection both build on the
// engine's single grammar source (D057); DOM-to-marks serialization is owned by
// the editor package's contenteditable adapter, never re-implemented here.

const TEX_LIGATURE_RE = /---|--|'/;

// Render inline markup as sanitized HTML. The source string is escaped except
// for the tiny allowed tag set, so pasted/typed HTML cannot execute.
export function renderInlineMarks(text: string): ReactNode {
  if (!hasInlineMarkTags(text)) {
    // Plain text still gets the TeX-ligature preview (no HTML needed).
    return TEX_LIGATURE_RE.test(text) ? texLigatures(text) : text;
  }
  return <span dangerouslySetInnerHTML={{ __html: inlineMarksToHtml(text) }} />;
}
