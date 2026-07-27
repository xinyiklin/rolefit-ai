// The Documents tab of the application detail modal: what actually went out for
// this role. The resume and the cover letter are rendered by one component with
// one set of actions, so neither can quietly acquire better file support than
// the other, and anything else the posting asked for lives beneath them.

import { useRef, useState } from "react";
import { Copy, Download, Eye, FileText, FileUp, Loader2, Paperclip, Trash2 } from "lucide-react";

import type { Application, ApplicationAttachment, DocumentArtifacts } from "../../hooks/useApplications";
import {
  ATTACHMENT_ACCEPT,
  applicationAttachmentUrl,
  applicationDocumentUrl,
  deleteApplicationAttachment,
  uploadApplicationAttachment,
  type ApplicationDocumentKind
} from "../../lib/applicationDocumentRequests";

type ApplicationDocumentsTabProps = {
  application: Application | null;
  /** False in add mode: there is no record to hang files on yet. */
  isEdit: boolean;
  downloadBase: string;
  onPreviewDocument?: (application: Application, kind: ApplicationDocumentKind) => void;
  // Persisted immediately: the bytes are already on disk, so the record that
  // remembers them must not wait for the modal's Save.
  onAttachmentsChange?: (id: string, attachments: ApplicationAttachment[]) => Promise<boolean>;
};

const DOCUMENT_LABEL: Record<ApplicationDocumentKind, { title: string; sourceLabel: string; noun: string }> = {
  resume: { title: "Resume", sourceLabel: ".resume", noun: "resume" },
  cover: { title: "Cover letter", sourceLabel: ".cover", noun: "cover letter" }
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function savedLine(artifacts: DocumentArtifacts | undefined): string {
  if (!artifacts?.savedAt) return "";
  const saved = new Date(artifacts.savedAt);
  return Number.isFinite(saved.getTime()) ? `Saved ${saved.toLocaleDateString()}` : "";
}

// One document row. `badge` and `children` are the only parts that differ
// between the two kinds — the actions are deliberately identical.
function DocumentCard({
  application,
  kind,
  artifacts,
  badge,
  emptyNote,
  downloadBase,
  onPreviewDocument,
  children
}: {
  application: Application | null;
  kind: ApplicationDocumentKind;
  artifacts?: DocumentArtifacts;
  badge?: React.ReactNode;
  emptyNote: string;
  downloadBase: string;
  onPreviewDocument?: (application: Application, kind: ApplicationDocumentKind) => void;
  children?: React.ReactNode;
}) {
  const meta = DOCUMENT_LABEL[kind];
  const hasFiles = Boolean(artifacts?.hasPdf || artifacts?.hasSource);
  const saved = savedLine(artifacts);
  const fileBase = `${downloadBase}_${kind === "resume" ? "Resume" : "Cover_Letter"}`;

  return (
    <article className="application-doc-card" aria-label={meta.title}>
      <div className="application-doc-card__head">
        <h4><FileText size={14} aria-hidden="true" /> {meta.title}</h4>
        {badge}
      </div>

      {application && hasFiles ? (
        <>
          <p className="application-muted">
            {[saved, artifacts?.hasPdf ? "PDF" : null, artifacts?.hasSource ? meta.sourceLabel : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <div className="application-doc-card__actions">
            {artifacts?.hasPdf && onPreviewDocument ? (
              <button
                type="button"
                className="secondary-button is-compact"
                onClick={() => onPreviewDocument(application, kind)}
              >
                <Eye size={14} aria-hidden="true" /> Preview
              </button>
            ) : null}
            {artifacts?.hasPdf ? (
              <a
                className="secondary-button is-compact"
                href={applicationDocumentUrl(application.id, kind, "pdf")}
                download={`${fileBase}.pdf`}
              >
                <Download size={14} aria-hidden="true" /> PDF
              </a>
            ) : null}
            {artifacts?.hasSource ? (
              <a
                className="secondary-button is-compact"
                href={applicationDocumentUrl(application.id, kind, "source")}
                download={`${fileBase}${meta.sourceLabel}`}
              >
                <Download size={14} aria-hidden="true" /> {meta.sourceLabel}
              </a>
            ) : null}
          </div>
        </>
      ) : (
        <p className="application-muted">{emptyNote}</p>
      )}

      {children}
    </article>
  );
}

export function ApplicationDocumentsTab({
  application,
  isEdit,
  downloadBase,
  onPreviewDocument,
  onAttachmentsChange
}: ApplicationDocumentsTabProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [copyState, setCopyState] = useState<"" | "copied" | "failed">("");
  const attachments = application?.attachments ?? [];

  async function copyLetter(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyState("copied");
      window.setTimeout(() => setCopyState(""), 1600);
    } catch {
      // Surface the failure instead of silently clearing — the text stays on
      // screen so the user can copy it manually.
      setCopyState("failed");
      window.setTimeout(() => setCopyState(""), 2500);
    }
  }

  async function addFiles(files: FileList | null) {
    if (!application || !onAttachmentsChange || !files?.length) return;
    setBusy(true);
    setError("");
    setStatus("");
    // Sequential: each upload is checked against the per-application cap on the
    // server, and a parallel burst would race that check.
    let next = [...attachments];
    let addedCount = 0;
    for (const file of Array.from(files)) {
      const result = await uploadApplicationAttachment(application.id, file);
      if (!result.ok) {
        setError(result.error);
        break;
      }
      next = [...next.filter((entry) => entry.fileName !== result.attachment.fileName), result.attachment];
      addedCount += 1;
    }
    if (addedCount) {
      const saved = await onAttachmentsChange(application.id, next);
      setStatus(
        saved
          ? `Added ${addedCount} file${addedCount === 1 ? "" : "s"}.`
          : "The files were stored, but the application record could not be updated."
      );
    }
    setBusy(false);
  }

  async function removeFile(attachment: ApplicationAttachment) {
    if (!application || !onAttachmentsChange) return;
    setBusy(true);
    setError("");
    setStatus("");
    const result = await deleteApplicationAttachment(application.id, attachment.fileName);
    if (!result.ok) {
      setError(result.error ?? "Removing that file failed.");
      setBusy(false);
      return;
    }
    const saved = await onAttachmentsChange(
      application.id,
      attachments.filter((entry) => entry.fileName !== attachment.fileName)
    );
    setStatus(saved ? `Removed ${attachment.label}.` : "The file was removed, but the record could not be updated.");
    setBusy(false);
  }

  return (
    <section className="application-form application-form--wide">
      <DocumentCard
        application={application}
        kind="resume"
        artifacts={application?.resumeArtifacts}
        downloadBase={downloadBase}
        onPreviewDocument={onPreviewDocument}
        badge={
          application?.resumeUsed ? (
            <span
              className={`application-stage application-stage--${application.resumeUsed === "tailored" ? "interviewing" : "applied"}`}
            >
              {application.resumeUsed === "tailored" ? "Tailored draft" : "Base resume"}
            </span>
          ) : undefined
        }
        emptyNote={
          isEdit
            ? "No resume saved for this role yet. Open it in Polish, then Apply — or use Update application in the resume's Save menu."
            : "Save the application first, then apply a polished resume to keep its files here."
        }
      />

      <DocumentCard
        application={application}
        kind="cover"
        artifacts={application?.coverLetterArtifacts}
        downloadBase={downloadBase}
        onPreviewDocument={onPreviewDocument}
        badge={
          application?.coverLetterText ? (
            <button
              type="button"
              className="ghost-button is-compact"
              onClick={() => void copyLetter(application.coverLetterText ?? "")}
            >
              <Copy size={13} aria-hidden="true" />
              {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy text"}
            </button>
          ) : undefined
        }
        emptyNote={
          application?.coverLetterText
            ? "The letter's text is saved below. Use Update application in the Cover letter Save menu to keep its PDF and .cover file too."
            : isEdit
              ? "No cover letter saved for this role yet. Write one in the Cover letter tab, then Apply or use Update application."
              : "Save the application first, then apply a cover letter to keep its files here."
        }
      >
        {application?.coverLetterText ? (
          <details className="application-doc-card__reader">
            <summary>Read the saved letter</summary>
            <pre className="application-doc-card__text">{application.coverLetterText}</pre>
          </details>
        ) : null}
      </DocumentCard>

      <article className="application-doc-card" aria-label="Attachments">
        <div className="application-doc-card__head">
          <h4><Paperclip size={14} aria-hidden="true" /> Attachments</h4>
          {application && onAttachmentsChange ? (
            <button
              type="button"
              className="ghost-button is-compact"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
            >
              {busy ? <Loader2 size={13} aria-hidden="true" /> : <FileUp size={13} aria-hidden="true" />}
              {busy ? "Working…" : "Add file"}
            </button>
          ) : null}
        </div>

        <input
          ref={fileInputRef}
          className="sr-only"
          type="file"
          multiple
          accept={ATTACHMENT_ACCEPT}
          onChange={(event) => {
            void addFiles(event.target.files);
            event.currentTarget.value = "";
          }}
        />

        {attachments.length ? (
          <ul className="application-attachments">
            {attachments.map((attachment) => (
              <li key={attachment.fileName} className="application-attachments__row">
                <span className="application-attachments__name">
                  <FileText size={13} aria-hidden="true" />
                  {attachment.label}
                </span>
                <span className="application-attachments__meta">
                  {formatSize(attachment.size)}
                  {attachment.savedAt ? ` · ${new Date(attachment.savedAt).toLocaleDateString()}` : ""}
                </span>
                <a
                  className="ghost-button is-compact"
                  href={applicationAttachmentUrl((application as Application).id, attachment.fileName)}
                  download={attachment.label}
                >
                  <Download size={13} aria-hidden="true" /> Download
                </a>
                {onAttachmentsChange ? (
                  <button
                    type="button"
                    className="ghost-button is-icon"
                    aria-label={`Remove ${attachment.label}`}
                    disabled={busy}
                    onClick={() => void removeFile(attachment)}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="application-muted">
            {application
              ? "Transcripts, portfolios, writing samples — anything else this posting asked for."
              : "Save the application first to attach files."}
          </p>
        )}

        {error ? <p className="application-error" role="alert">{error}</p> : null}
        {status && !error ? <p className="application-muted" role="status">{status}</p> : null}
      </article>
    </section>
  );
}
