import {
  coverLetterFileName,
  coverLetterPlainText,
  documentStyleToCoverLetterStyle,
  serializeCoverLetterFile
} from "@typeset/engine/lib/coverLetter.ts";
import type { DocStyle } from "@typeset/engine/lib/documentStyle.ts";
import type { ResumeData } from "@typeset/engine/lib/resumeData.ts";
import { toTypesetSchema } from "@typeset/engine/typeset/schema.ts";

import type { DocumentUpload } from "./applicationDocumentRequests.ts";

export function coverLetterPdfFailureMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : "";
  if (/font|Unknown font format/i.test(detail)) {
    return "PDF export failed because the bundled document fonts could not be loaded.";
  }
  return "PDF export failed. Try again.";
}

export async function renderCoverLetterPdfBytes({
  data,
  style,
  title,
  fontBaseUrl
}: {
  data: ResumeData;
  style: DocStyle;
  title: string;
  fontBaseUrl: string;
}) {
  const [{ layoutCoverLetter }, { emitPdf, fetchFontBytes }] = await Promise.all([
    import("@typeset/engine/typeset/layout.ts"),
    import("@typeset/engine/typeset/pdf/emit.ts")
  ]);
  const document = layoutCoverLetter(toTypesetSchema(data), style);
  const fonts = await fetchFontBytes(document, fontBaseUrl);
  return emitPdf(document, fonts, { title: title.trim() || "Cover letter" });
}

export function createCoverLetterDocumentUpload(
  data: ResumeData | null,
  style: DocStyle,
  title: string
): DocumentUpload | null {
  if (!data || !coverLetterPlainText(data).trim()) return null;
  return {
    sourceText: serializeCoverLetterFile(
      data,
      documentStyleToCoverLetterStyle(style)
    ),
    fileName: coverLetterFileName(title)
  };
}
