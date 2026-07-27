import { useRef, useState, type ChangeEvent, type RefObject } from "react";
import { Download, Eye, FileText, Trash2, Upload } from "lucide-react";
import { parseCoverLetterFile } from "@typeset/engine/lib/coverLetter.ts";
import { parseResumeFile } from "@typeset/engine/lib/resumeFile.ts";

import {
  type Application,
  type DocumentArtifacts
} from "../../hooks/useApplications";
import { useDialog } from "../../hooks/useDialog";
import {
  ATTACHMENT_ACCEPT,
  applicationAttachmentUrl,
  applicationDocumentUrl,
  type ApplicationDocumentKind,
  type DocumentUpload
} from "../../lib/applicationDocumentRequests";

type ApplicationDocumentsTabProps = {
  application: Application | null;
  downloadBase: string;
  onSaveDocument: (
    id: string,
    kind: ApplicationDocumentKind,
    upload: DocumentUpload,
    sourceOrigin?: "editor" | "upload"
  ) => Promise<{ ok: boolean; error?: string }>;
  onRemoveDocument: (
    id: string,
    kind: ApplicationDocumentKind
  ) => Promise<{ ok: boolean; error?: string }>;
  onPreviewDocument?: (application: Application, kind: ApplicationDocumentKind) => void;
  onDownloadDocument?: (application: Application, kind: ApplicationDocumentKind) => void;
  onSaveAttachment: (id: string, file: File) => Promise<{ ok: boolean; error?: string }>;
  onRemoveAttachment: (id: string, fileName: string) => Promise<{ ok: boolean; error?: string }>;
};

type UploadKind = ApplicationDocumentKind | "attachment";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      resolve(value.includes(",") ? value.slice(value.indexOf(",") + 1) : "");
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the PDF."));
    reader.readAsDataURL(file);
  });
}

function savedLabel(artifacts: DocumentArtifacts, fallback: string): string {
  if (!artifacts.savedAt) return fallback;
  const date = new Date(artifacts.savedAt);
  return Number.isFinite(date.getTime()) ? `Saved ${date.toLocaleDateString()}` : fallback;
}

function DocumentPane({
  application,
  kind,
  artifacts,
  hasDocument,
  busy,
  uploadRef,
  downloadBase,
  onUpload,
  onRemove,
  onPreviewDocument,
  onDownloadDocument
}: {
  application: Application | null;
  kind: ApplicationDocumentKind;
  artifacts?: DocumentArtifacts;
  hasDocument: boolean;
  busy: boolean;
  uploadRef: RefObject<HTMLInputElement | null>;
  downloadBase: string;
  onUpload: (kind: UploadKind, event: ChangeEvent<HTMLInputElement>) => void;
  onRemove: (kind: ApplicationDocumentKind) => void;
  onPreviewDocument?: (application: Application, kind: ApplicationDocumentKind) => void;
  onDownloadDocument?: (application: Application, kind: ApplicationDocumentKind) => void;
}) {
  const isResume = kind === "resume";
  const title = isResume ? "Resume" : "Cover letter";
  const sourceExtension = isResume ? ".resume" : ".cover";
  const pdfName = `${downloadBase}_${isResume ? "Resume" : "Cover_Letter"}.pdf`;

  return (
    <article className="application-doc-card" aria-label={title}>
      <div className="application-doc-card__head">
        <h4><FileText size={14} aria-hidden="true" /> {title}</h4>
        <div className="application-doc-card__actions">
          <input
            ref={uploadRef}
            type="file"
            accept={`${sourceExtension},.pdf,application/pdf`}
            hidden
            onChange={(event) => onUpload(kind, event)}
          />
          <button
            type="button"
            className="ghost-button is-icon"
            aria-label={`Upload ${title.toLowerCase()}`}
            title="Upload"
            onClick={() => uploadRef.current?.click()}
            disabled={!application || busy}
          >
            <Upload size={13} aria-hidden="true" />
          </button>
          {hasDocument ? (
            <button
              type="button"
              className="ghost-button is-icon"
              aria-label={`Remove ${title.toLowerCase()}`}
              title="Remove"
              onClick={() => onRemove(kind)}
              disabled={busy}
            >
              <Trash2 size={13} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      {application && artifacts && (artifacts.hasPdf || artifacts.hasSource) ? (
        <div className="application-doc-card__footer">
          <span>{savedLabel(artifacts, `${title} saved.`)}</span>
          <div className="application-doc-card__actions">
            {onPreviewDocument ? (
              <button
                type="button"
                className="secondary-button is-compact"
                onClick={() => onPreviewDocument(application, kind)}
              >
                <Eye size={14} aria-hidden="true" /> Preview
              </button>
            ) : null}
            {artifacts.hasSource ? (
              <a
                className="secondary-button is-compact"
                href={applicationDocumentUrl(application.id, kind, "source")}
                download={`${downloadBase}${sourceExtension}`}
              >
                <Download size={14} aria-hidden="true" /> {sourceExtension}
              </a>
            ) : null}
            {artifacts.hasPdf ? (
              <a
                className="primary-button is-compact"
                href={applicationDocumentUrl(application.id, kind, "pdf")}
                download={pdfName}
              >
                <Download size={14} aria-hidden="true" /> PDF
              </a>
            ) : artifacts.hasSource && onDownloadDocument ? (
              <button
                type="button"
                className="primary-button is-compact"
                onClick={() => onDownloadDocument(application, kind)}
              >
                <Download size={14} aria-hidden="true" /> PDF
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="application-muted">{hasDocument ? `${title} saved.` : `No ${title.toLowerCase()} saved.`}</p>
      )}
    </article>
  );
}

export function ApplicationDocumentsTab({
  application,
  downloadBase,
  onSaveDocument,
  onRemoveDocument,
  onPreviewDocument,
  onDownloadDocument,
  onSaveAttachment,
  onRemoveAttachment
}: ApplicationDocumentsTabProps) {
  const resumeUploadRef = useRef<HTMLInputElement>(null);
  const coverUploadRef = useRef<HTMLInputElement>(null);
  const attachmentUploadRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const { alert, confirm } = useDialog();
  const resumeArtifacts = application?.resumeArtifacts;
  const coverArtifacts = application?.coverLetterArtifacts;
  const hasResume = Boolean(application?.resumeData || resumeArtifacts?.hasPdf || resumeArtifacts?.hasSource);
  const hasCover = Boolean(application?.coverLetterText || coverArtifacts?.hasPdf || coverArtifacts?.hasSource);

  async function upload(kind: UploadKind, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || busy) return;
    if (!application) {
      await alert({ title: "Save application first", message: "Save the application before uploading a document." });
      return;
    }

    const extension = file.name.toLowerCase().match(/\.(resume|cover|pdf)$/)?.[1] ?? "";
    const valid = kind === "resume"
      ? extension === "resume" || extension === "pdf"
      : kind === "cover"
        ? extension === "cover" || extension === "pdf"
        : extension === "pdf";
    if (!valid) {
      const message = kind === "resume"
        ? "Upload a .resume or .pdf file."
        : kind === "cover"
          ? "Upload a .cover or .pdf file."
          : "Upload a PDF file.";
      await alert({ title: "Unsupported file", message });
      return;
    }

    setBusy(true);
    try {
      if (extension === "resume") {
        const sourceText = await file.text();
        parseResumeFile(sourceText);
        const result = await onSaveDocument(application.id, "resume", {
          pdfBase64: null,
          sourceText,
          fileName: file.name
        }, "upload");
        if (!result.ok) throw new Error(result.error ?? "Could not store the resume file.");
      } else if (extension === "cover") {
        const sourceText = await file.text();
        parseCoverLetterFile(sourceText);
        const result = await onSaveDocument(application.id, "cover", {
          pdfBase64: null,
          sourceText,
          fileName: file.name
        }, "upload");
        if (!result.ok) throw new Error(result.error ?? "Could not store the cover letter file.");
      } else if (kind === "attachment") {
        const result = await onSaveAttachment(application.id, file);
        if (!result.ok) throw new Error(result.error);
      } else {
        const result = await onSaveDocument(application.id, kind, {
          pdfBase64: await fileToBase64(file),
          sourceText: null,
          fileName: file.name
        }, "upload");
        if (!result.ok) throw new Error(result.error ?? "Could not store the PDF.");
      }
    } catch (error) {
      await alert({
        title: "Upload failed",
        message: error instanceof Error ? error.message : "Could not upload that file."
      });
    } finally {
      setBusy(false);
    }
  }

  async function removeDocument(kind: ApplicationDocumentKind) {
    if (!application || busy) return;
    const label = kind === "resume" ? "resume" : "cover letter";
    if (!(await confirm({
      title: `Remove ${label}?`,
      message: `This removes the saved ${label} from this application.`,
      confirmLabel: "Remove",
      tone: "danger"
    }))) return;

    setBusy(true);
    try {
      const result = await onRemoveDocument(application.id, kind);
      if (!result.ok) throw new Error(result.error);
    } catch (error) {
      await alert({
        title: "Remove failed",
        message: error instanceof Error ? error.message : `Could not remove the ${label}.`
      });
    } finally {
      setBusy(false);
    }
  }

  async function removeAttachment(fileName: string) {
    if (!application || busy) return;
    if (!(await confirm({
      title: "Remove document?",
      message: "This removes the uploaded document from this application.",
      confirmLabel: "Remove",
      tone: "danger"
    }))) return;

    setBusy(true);
    try {
      const result = await onRemoveAttachment(application.id, fileName);
      if (!result.ok) throw new Error(result.error);
    } catch (error) {
      await alert({
        title: "Remove failed",
        message: error instanceof Error ? error.message : "Could not remove that document."
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="application-form application-form--wide">
      <div className="application-doc-grid">
        <DocumentPane
          application={application}
          kind="resume"
          artifacts={resumeArtifacts}
          hasDocument={hasResume}
          busy={busy}
          uploadRef={resumeUploadRef}
          downloadBase={downloadBase}
          onUpload={upload}
          onRemove={removeDocument}
          onPreviewDocument={onPreviewDocument}
          onDownloadDocument={onDownloadDocument}
        />
        <DocumentPane
          application={application}
          kind="cover"
          artifacts={coverArtifacts}
          hasDocument={hasCover}
          busy={busy}
          uploadRef={coverUploadRef}
          downloadBase={downloadBase}
          onUpload={upload}
          onRemove={removeDocument}
          onPreviewDocument={onPreviewDocument}
          onDownloadDocument={onDownloadDocument}
        />
      </div>

      <article className="application-doc-card" aria-label="Additional documents">
        <div className="application-doc-card__head">
          <h4><FileText size={14} aria-hidden="true" /> Additional documents</h4>
          <input
            ref={attachmentUploadRef}
            type="file"
            accept={ATTACHMENT_ACCEPT}
            hidden
            onChange={(event) => void upload("attachment", event)}
          />
          <button
            type="button"
            className="ghost-button is-compact"
            onClick={() => attachmentUploadRef.current?.click()}
            disabled={!application || busy}
          >
            <Upload size={13} aria-hidden="true" /> Upload
          </button>
        </div>
        {application?.attachments?.length ? (
          <div className="application-doc-card__actions">
            {application.attachments.map((attachment) => (
              <span key={attachment.fileName} className="application-doc-card__actions">
                <a
                  className="secondary-button is-compact"
                  href={applicationAttachmentUrl(application.id, attachment.fileName)}
                  download={attachment.label}
                >
                  <Download size={14} aria-hidden="true" /> {attachment.label}
                </a>
                <button
                  type="button"
                  className="ghost-button is-icon application-attachment__remove"
                  aria-label={`Remove ${attachment.label}`}
                  title="Remove"
                  onClick={() => void removeAttachment(attachment.fileName)}
                  disabled={busy}
                >
                  <Trash2 size={13} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="application-muted">No additional documents saved.</p>
        )}
      </article>
    </section>
  );
}
