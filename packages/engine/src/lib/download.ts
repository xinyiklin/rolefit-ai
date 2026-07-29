// The one browser download choreography for every file the app emits
// (.resume saves, exported PDFs): object URL → hidden anchor click → deferred
// cleanup. Blob downloads begin asynchronously; keeping both the anchor and URL
// alive prevents Chromium from falling back to the blob UUID as the filename.
import type { DocStyle } from "./documentStyle.ts";
import type { ResumeData } from "./resumeData.ts";
import { resumeFileName, serializeResumeFile } from "./resumeFile.ts";

export const DOWNLOAD_OBJECT_URL_CLEANUP_DELAY_MS = 60_000;

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  window.setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, DOWNLOAD_OBJECT_URL_CLEANUP_DELAY_MS);
}

export function downloadResumeFile(
  data: ResumeData,
  style: DocStyle,
  suggestedName = data.header?.name ?? ""
): string {
  const filename = resumeFileName(suggestedName);
  downloadBlob(new Blob([serializeResumeFile(data, style)], { type: "application/json" }), filename);
  return filename;
}
