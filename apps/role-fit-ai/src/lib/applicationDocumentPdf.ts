import type { LayoutDocument } from "@typeset/engine/typeset/layout.ts";
import type { Application } from "../hooks/useApplications";
import {
  applicationDocumentUrl,
  type ApplicationDocumentKind
} from "./applicationDocumentRequests";

export async function applicationDocumentPdfBlob(
  application: Application,
  kind: ApplicationDocumentKind,
  publicBaseUrl: string
): Promise<Blob> {
  const artifacts = kind === "resume" ? application.resumeArtifacts : application.coverLetterArtifacts;
  if (artifacts?.hasPdf) {
    const response = await fetch(applicationDocumentUrl(application.id, kind, "pdf"));
    if (!response.ok) throw new Error("The saved PDF could not be read.");
    return response.blob();
  }
  if (!artifacts?.hasSource) throw new Error("No saved document source is available.");

  const sourceResponse = await fetch(applicationDocumentUrl(application.id, kind, "source"));
  if (!sourceResponse.ok) throw new Error("The saved document source could not be read.");
  const sourceBytes = await sourceResponse.arrayBuffer();
  const [
    { coverLetterStyleToDocumentStyle, parseCoverLetterFile },
    { parseResumeFile },
    { ensureLayoutMetrics, layoutCoverLetter, layoutResume },
    { toTypesetSchema },
    { emitPdf, fetchFontBytes }
  ] = await Promise.all([
    import("@typeset/engine/lib/coverLetter.ts"),
    import("@typeset/engine/lib/resumeFile.ts"),
    import("@typeset/engine/typeset/layout.ts"),
    import("@typeset/engine/typeset/schema.ts"),
    import("@typeset/engine/typeset/pdf/emit.ts")
  ]);
  const title = kind === "resume"
    ? application.role || application.title || "Resume"
    : `${application.role || application.title || "Cover letter"} cover letter`;
  let document: LayoutDocument;
  if (kind === "resume") {
    const parsed = parseResumeFile(sourceBytes);
    const schema = toTypesetSchema(parsed.data);
    await ensureLayoutMetrics(schema, parsed.documentStyle);
    document = layoutResume(schema, parsed.documentStyle);
  } else {
    const parsed = parseCoverLetterFile(sourceBytes);
    const schema = toTypesetSchema(parsed.data);
    const style = coverLetterStyleToDocumentStyle(parsed.style);
    await ensureLayoutMetrics(schema, style);
    document = layoutCoverLetter(schema, style);
  }
  const publicBase = publicBaseUrl.replace(/\/$/, "");
  const fonts = await fetchFontBytes(document, `${publicBase}/fonts`);
  const bytes = await emitPdf(document, fonts, { title });
  return new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
}
