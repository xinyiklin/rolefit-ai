// The deterministic PDF import pipeline: text layer → lines → structure →
// style, then the preservation audit. An import that cannot account for every
// character is refused rather than handed to the editor.

import type { DocumentStyle } from "@typeset/engine/lib/documentStyle.ts";
import type { ResumeData } from "@typeset/engine/lib/resumeData.ts";
import { auditImport, type ContentAudit } from "./importAudit.ts";
import { inferImportStyle } from "./importStyle.ts";
import { layoutLines, type LayoutLines } from "./layoutLines.ts";
import { pdfImportError } from "./importErrors.ts";
import { readPdfLayout, type PdfJsLike, type PdfLayout } from "./pdfLayout.ts";
import { buildResumeDraft, type ImportFinding } from "./resumeFromLayout.ts";

export type PdfImportResult = {
  data: ResumeData;
  style: DocumentStyle;
  findings: ImportFinding[];
  // The style notes alone; an AI interpretation changes structure, not style,
  // so its findings keep these.
  styleFindings: ImportFinding[];
  audit: ContentAudit;
  layout: PdfLayout;
  lines: LayoutLines;
};

export async function importResumePdf(bytes: Uint8Array, pdfjs: PdfJsLike): Promise<PdfImportResult> {
  const layout = await readPdfLayout(bytes, pdfjs);
  const lines = layoutLines(layout);
  const draft = buildResumeDraft(lines, layout.rules);
  const { style, notes } = inferImportStyle(layout, draft.evidence);
  const styleFindings = notes.map((note, index): ImportFinding => ({ kind: "check", id: `style${index + 1}`, fieldKey: null, reason: note.reason, source: note.source }));
  const findings = [...draft.findings, ...styleFindings];
  const audit = auditImport(layout.spans, draft.data, findings, draft.consumed);
  if (!audit.ok) throw pdfImportError("unaccounted");
  return { data: draft.data, style, findings, styleFindings, audit, layout, lines };
}
