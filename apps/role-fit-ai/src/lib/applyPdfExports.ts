export type ApplyPdfExportKind = "resume" | "cover letter";

type ApplyPdfExporters = {
  resume?: () => Promise<boolean>;
  coverLetter?: () => Promise<boolean>;
};

// Apply exports remain ordered so the browser sees one download at a time.
// Each attempt owns its own failure boundary: one renderer rejecting is an
// export failure for that document, not a reason to skip the next document.
export async function runApplyPdfExports(
  exporters: ApplyPdfExporters
): Promise<ApplyPdfExportKind[]> {
  const failed: ApplyPdfExportKind[] = [];

  async function attempt(kind: ApplyPdfExportKind, exporter?: () => Promise<boolean>) {
    if (!exporter) return;
    try {
      if (!(await exporter())) failed.push(kind);
    } catch {
      failed.push(kind);
    }
  }

  await attempt("resume", exporters.resume);
  await attempt("cover letter", exporters.coverLetter);
  return failed;
}
