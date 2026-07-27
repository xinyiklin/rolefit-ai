// Intentional request boundary (see the filename): every client call that puts
// a file on, or takes one off, a tracked application. Apply, the per-document
// "Update application" action, and the Documents tab all go through here, so
// the resume and the cover letter are stored and served identically.

import type { ApplicationAttachment, DocumentArtifacts } from "../hooks/useApplications";

export type ApplicationDocumentKind = "resume" | "cover";

/** The editable source format each kind saves beside its PDF. */
export const DOCUMENT_SOURCE_EXTENSION: Record<ApplicationDocumentKind, string> = {
  resume: "resume",
  cover: "cover"
};

// The file picker's filter, kept beside the request helpers so it cannot drift
// from the extension allowlist the upload route enforces.
export const ATTACHMENT_ACCEPT = ".pdf,.docx,.txt,.md,.csv,.png,.jpg,.jpeg,.resume,.cover";

export type DocumentUpload = {
  pdfBase64: string | null;
  // Serialized `.resume` / `.cover` text, so the saved copy stays editable and
  // keeps its print style — not just the flattened text in the record.
  sourceText?: string | null;
  fileName: string;
};

const base = (id: string) => `/api/applications/${encodeURIComponent(id)}`;

export function applicationDocumentUrl(
  id: string,
  kind: ApplicationDocumentKind,
  format: "pdf" | "source"
): string {
  const extension = format === "pdf" ? "pdf" : DOCUMENT_SOURCE_EXTENSION[kind];
  return `${base(id)}/documents/${kind}.${extension}`;
}

export function applicationAttachmentUrl(id: string, fileName: string): string {
  return `${base(id)}/attachments/${encodeURIComponent(fileName)}`;
}

// Returns the stored metadata, or null when the route rejected the upload.
// Callers treat null as "the record saved, the files did not" — never as a
// failure of the document save itself.
export async function uploadApplicationDocument(
  applicationId: string,
  kind: ApplicationDocumentKind,
  upload: DocumentUpload
): Promise<DocumentArtifacts | null> {
  const res = await fetch(`${base(applicationId)}/documents/${kind}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pdfBase64: upload.pdfBase64 ?? undefined,
      sourceText: upload.sourceText ?? undefined,
      fileName: upload.fileName
    })
  });
  const data = await res.json();
  if (!res.ok || !data.artifacts) return null;
  return data.artifacts as DocumentArtifacts;
}

export type AttachmentUploadResult =
  | { ok: true; attachment: ApplicationAttachment }
  | { ok: false; error: string };

export async function uploadApplicationAttachment(
  applicationId: string,
  file: File
): Promise<AttachmentUploadResult> {
  let dataBase64: string;
  try {
    dataBase64 = await fileToBase64(file);
  } catch {
    return { ok: false, error: "That file could not be read." };
  }
  try {
    const res = await fetch(`${base(applicationId)}/attachments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: file.name, label: file.name, dataBase64 })
    });
    const data = await res.json();
    if (!res.ok || !data.attachment) {
      return { ok: false, error: typeof data.error === "string" ? data.error : "That file could not be saved." };
    }
    return { ok: true, attachment: data.attachment as ApplicationAttachment };
  } catch {
    return { ok: false, error: "The local server did not respond. The file was not saved." };
  }
}

export async function deleteApplicationAttachment(
  applicationId: string,
  fileName: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(applicationAttachmentUrl(applicationId, fileName), { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: typeof data.error === "string" ? data.error : "Removing that file failed." };
    return { ok: true };
  } catch {
    return { ok: false, error: "The local server did not respond. Nothing was removed." };
  }
}

// File → bare base64 (no data: prefix), matching how the compiled PDF is posted.
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      resolve(value.includes(",") ? value.slice(value.indexOf(",") + 1) : "");
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}
