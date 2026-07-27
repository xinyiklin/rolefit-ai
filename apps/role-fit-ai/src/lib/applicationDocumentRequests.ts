// Intentional request boundary (see the filename): every client call that puts
// a file on, or takes one off, a tracked application. Apply, the per-document
// "Update application" action, and the Documents tab all go through here, so
// the resume and the cover letter are stored and served identically.

import type { Application, ApplicationAttachment, DocumentArtifacts } from "../hooks/useApplications";

export type ApplicationDocumentKind = "resume" | "cover";

/** The editable source format owned by each document slot. */
export const DOCUMENT_SOURCE_EXTENSION: Record<ApplicationDocumentKind, string> = {
  resume: "resume",
  cover: "cover"
};

// The file picker's filter, kept beside the request helpers so it cannot drift
// from the extension allowlist the upload route enforces.
export const ATTACHMENT_ACCEPT = ".pdf,application/pdf";

// One slot stores one representation. Encoding that as a union prevents a
// caller from accidentally asking the server to retain duplicate source + PDF
// bytes for the same Resume/Cover letter.
export type DocumentUpload = {
  fileName: string;
} & (
  | { pdfBase64: string; sourceText?: null }
  | {
      pdfBase64?: null;
      // Serialized `.resume` / `.cover` text, including print style and inline
      // formatting rather than only flattened tracker text.
      sourceText: string;
    }
);

const base = (id: string) => `/api/applications/${encodeURIComponent(id)}`;

export type ApplicationFileMutationResult<T extends object = object> =
  | ({ ok: true; application: Application; applications: Application[] } & T)
  | { ok: false; error: string; applications?: Application[] };

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

export async function uploadApplicationDocument(
  applicationId: string,
  kind: ApplicationDocumentKind,
  upload: DocumentUpload,
  baseUpdatedAt: string,
  sourceOrigin: "editor" | "upload" = "editor"
): Promise<ApplicationFileMutationResult<{ artifacts: DocumentArtifacts }>> {
  try {
    const res = await fetch(`${base(applicationId)}/documents/${kind}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pdfBase64: upload.pdfBase64 ?? undefined,
        sourceText: upload.sourceText ?? undefined,
        fileName: upload.fileName,
        baseUpdatedAt,
        sourceOrigin
      })
    });
    const data = await res.json();
    if (!res.ok || !data.artifacts || !data.application || !Array.isArray(data.applications)) {
      return {
        ok: false,
        error: typeof data.error === "string" ? data.error : "That document could not be saved.",
        ...(Array.isArray(data.applications) ? { applications: data.applications as Application[] } : {})
      };
    }
    return {
      ok: true,
      artifacts: data.artifacts as DocumentArtifacts,
      application: data.application as Application,
      applications: data.applications as Application[]
    };
  } catch {
    return { ok: false, error: "The local server did not respond. The document was not changed." };
  }
}

export async function deleteApplicationDocument(
  applicationId: string,
  kind: ApplicationDocumentKind,
  baseUpdatedAt: string
): Promise<ApplicationFileMutationResult> {
  try {
    const res = await fetch(`${base(applicationId)}/documents/${kind}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseUpdatedAt })
    });
    const data = await res.json();
    if (!res.ok || !data.application || !Array.isArray(data.applications)) {
      return {
        ok: false,
        error: typeof data.error === "string" ? data.error : "Removing that document failed.",
        ...(Array.isArray(data.applications) ? { applications: data.applications as Application[] } : {})
      };
    }
    return {
      ok: true,
      application: data.application as Application,
      applications: data.applications as Application[]
    };
  } catch {
    return { ok: false, error: "The local server did not respond. Nothing was removed." };
  }
}

export async function uploadApplicationAttachment(
  applicationId: string,
  file: File,
  baseUpdatedAt: string
): Promise<ApplicationFileMutationResult<{ attachment: ApplicationAttachment }>> {
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
      body: JSON.stringify({ fileName: file.name, label: file.name, dataBase64, baseUpdatedAt })
    });
    const data = await res.json();
    if (!res.ok || !data.attachment || !data.application || !Array.isArray(data.applications)) {
      return {
        ok: false,
        error: typeof data.error === "string" ? data.error : "That file could not be saved.",
        ...(Array.isArray(data.applications) ? { applications: data.applications as Application[] } : {})
      };
    }
    return {
      ok: true,
      attachment: data.attachment as ApplicationAttachment,
      application: data.application as Application,
      applications: data.applications as Application[]
    };
  } catch {
    return { ok: false, error: "The local server did not respond. The file was not saved." };
  }
}

export async function deleteApplicationAttachment(
  applicationId: string,
  fileName: string,
  baseUpdatedAt: string
): Promise<ApplicationFileMutationResult> {
  try {
    const res = await fetch(applicationAttachmentUrl(applicationId, fileName), {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseUpdatedAt })
    });
    const data = await res.json();
    if (!res.ok || !data.application || !Array.isArray(data.applications)) {
      return {
        ok: false,
        error: typeof data.error === "string" ? data.error : "Removing that file failed.",
        ...(Array.isArray(data.applications) ? { applications: data.applications as Application[] } : {})
      };
    }
    return {
      ok: true,
      application: data.application as Application,
      applications: data.applications as Application[]
    };
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
