// The one browser download choreography for every file the app emits
// (.resume saves, exported PDFs): object URL → hidden anchor click → deferred
// revoke. The revoke must not be synchronous — some engines (Safari) abort the
// download if the URL dies inside the click's task.
import type { DocStyle } from "./documentStyle.ts";
import type { ResumeData } from "./resumeData.ts";
import { resumeFileName, serializeResumeFile } from "./resumeFile.ts";

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadResumeFile(data: ResumeData, style: DocStyle, suggestedName = data.name): string {
  const filename = resumeFileName(suggestedName);
  downloadBlob(new Blob([serializeResumeFile(data, style)], { type: "application/json" }), filename);
  return filename;
}
