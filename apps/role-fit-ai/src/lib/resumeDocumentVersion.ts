import { toDocumentStyle, type DocStyle } from "@typeset/engine/lib/documentStyle.ts";
import type { ResumeData } from "@typeset/engine/lib/resumeData.ts";

// Replacement races need every structural and persisted-style change, including
// an otherwise text-empty header. This is deliberately not the file codec:
// save-time size/shape validation must never throw from a React render.
export function resumeDocumentVersion(data: ResumeData, style: DocStyle): string {
  return JSON.stringify({ data, style: toDocumentStyle(style) });
}
