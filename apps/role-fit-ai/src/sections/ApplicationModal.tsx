import { useEffect, useMemo, useRef, useState } from "react";
import {
  BriefcaseBusiness,
  CheckCircle2,
  ClipboardCheck,
  ExternalLink,
  FileText,
  MessageSquareText,
  Plus,
  Sparkles,
  Trash2,
  Users,
  X
} from "lucide-react";
import {
  APPLICATION_SOURCES,
  JOB_TYPES,
  NOT_APPLYING_REASON_LABEL,
  type Application,
  type ApplicationAnswer,
  type ApplicationContact,
  type NotApplyingReason,
  type ApplicationPriority,
  type ApplicationSource,
  type ApplicationStatus,
  type SalaryPeriod
} from "../hooks/useApplications";
import type { ApplicationDocumentKind } from "../lib/applicationDocumentRequests";
import type { DocumentUpload } from "../lib/applicationDocumentRequests";
import { ApplicationDocumentsTab } from "./application/ApplicationDocumentsTab";
import { STATUS_LABEL, appFitVerdict, fitAssessmentRunLabel, formatSalary } from "../lib/applicationDisplay";
import { applicationStatusOptions } from "../lib/applicationStatusTransitions";
import { withoutSubmittedApplicationArtifacts } from "../lib/notApplyingApplication";
import { useModalFocus } from "@typeset/editor/hooks/useModalFocus.ts";

type ApplicationModalProps = {
  open: boolean;
  // Null is only a vanished-record safety state. New job intake belongs to
  // Prepare; this modal edits applications that already exist.
  application: Application | null;
  onClose: () => void;
  onSave: (application: Application) => Promise<boolean>;
  onDelete?: (id: string, title: string) => void;
  // Load this application's prepared job + saved documents into the workspace.
  onLoad?: (application: Application) => Promise<boolean>;
  relatedApplications?: Application[];
  onOpenRelated?: (application: Application) => void;
  // Open a saved application document in the in-app PDF viewer.
  onPreviewDocument?: (application: Application, kind: ApplicationDocumentKind) => void;
  // Render/download a source-only saved document as PDF on demand.
  onDownloadDocument?: (application: Application, kind: ApplicationDocumentKind) => void;
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
  onSaveAttachment: (id: string, file: File) => Promise<{ ok: boolean; error?: string }>;
  onRemoveAttachment: (id: string, fileName: string) => Promise<{ ok: boolean; error?: string }>;
};

type ModalTab = "overview" | "interview" | "documents" | "questions";

type FormState = {
  company: string;
  role: string;
  status: ApplicationStatus;
  priority: "" | ApplicationPriority;
  source: ApplicationSource;
  location: string;
  jobType: string;
  workAuth: string;
  appliedAt: string;
  notApplyingAt: string;
  notApplyingReason: "" | NotApplyingReason;
  notApplyingNote: string;
  deadline: string;
  followupAt: string;
  jobUrl: string;
  salaryMin: string;
  salaryMax: string;
  salaryCurrency: string;
  salaryPeriod: SalaryPeriod;
  interviewTips: string;
  notes: string;
  contacts: ApplicationContact[];
  answers: ApplicationAnswer[];
};

function toDateInput(iso?: string) {
  return iso ? iso.slice(0, 10) : "";
}

function toIso(dateInput: string) {
  // Anchor at noon so a yyyy-mm-dd never slips a day across time zones.
  return dateInput ? new Date(`${dateInput}T12:00:00`).toISOString() : "";
}

function formatDetailDate(iso?: string) {
  if (!iso || !Number.isFinite(Date.parse(iso))) return "Date not recorded";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(iso));
}

function numberField(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null;
}

function formFromApplication(application: Application | null): FormState {
  if (!application) {
    return {
      company: "",
      role: "",
      status: "applied",
      priority: "",
      source: "Company site",
      location: "",
      jobType: "Full-time",
      workAuth: "",
      appliedAt: new Date().toISOString().slice(0, 10),
      notApplyingAt: "",
      notApplyingReason: "",
      notApplyingNote: "",
      deadline: "",
      followupAt: "",
      jobUrl: "",
      salaryMin: "",
      salaryMax: "",
      salaryCurrency: "USD",
      salaryPeriod: "yr",
      interviewTips: "",
      notes: "",
      contacts: [],
      answers: []
    };
  }
  return {
    company: application.company ?? "",
    role: application.role ?? "",
    status: application.status,
    priority: application.priority ?? "",
    source: application.source ?? "",
    location: application.location ?? "",
    jobType: application.jobType ?? "",
    workAuth: application.workAuth ?? "",
    appliedAt: toDateInput(application.appliedAt),
    notApplyingAt: toDateInput(application.notApplyingAt),
    notApplyingReason: application.notApplyingReason ?? "",
    notApplyingNote: application.notApplyingNote ?? "",
    deadline: toDateInput(application.deadline),
    followupAt: toDateInput(application.followupAt),
    jobUrl: application.jobUrl ?? "",
    salaryMin: typeof application.salaryMin === "number" ? String(application.salaryMin) : "",
    salaryMax: typeof application.salaryMax === "number" ? String(application.salaryMax) : "",
    salaryCurrency: application.salaryCurrency ?? "USD",
    salaryPeriod: application.salaryPeriod ?? "yr",
    interviewTips: application.interviewTips ?? "",
    notes: application.notes ?? "",
    contacts: application.contacts?.length ? application.contacts.map((c) => ({ ...c })) : [],
    answers: application.applicationAnswers?.length ? application.applicationAnswers.map((a) => ({ ...a })) : []
  };
}

export function ApplicationModal({
  open,
  application,
  onClose,
  onSave,
  onDelete,
  onLoad,
  relatedApplications = [],
  onOpenRelated,
  onPreviewDocument,
  onDownloadDocument,
  onSaveDocument,
  onRemoveDocument,
  onSaveAttachment,
  onRemoveAttachment
}: ApplicationModalProps) {
  const applicationId = application?.id ?? null;
  const [tab, setTab] = useState<ModalTab>("overview");
  const [form, setForm] = useState<FormState>(() => formFromApplication(application));
  const [isSaving, setIsSaving] = useState(false);
  const [isOpeningPreparation, setIsOpeningPreparation] = useState(false);
  const [saveError, setSaveError] = useState("");
  const panelRef = useRef<HTMLElement>(null);
  const companyInputRef = useRef<HTMLInputElement>(null);
  // Last application id the form was seeded from — the vanish-guard for the
  // reseed effect below.
  const lastSeededId = useRef<string | null>(null);

  // Re-seed whenever the modal opens or targets a different application. Use
  // the stable id, not the whole application object, so async tracker refreshes
  // do not wipe unsaved form edits while the modal is open.
  useEffect(() => {
    if (!open) return;
    // A record that vanishes mid-edit (deleted in another tab, then a 409
    // refresh replaced the list) must NOT reseed the form to blank Add-mode
    // defaults — that wipes the user's unsaved edits while the save-error copy
    // promises they are still here. Keep the form and say what happened.
    if (applicationId === null && lastSeededId.current !== null) {
      setSaveError("This application was removed elsewhere. Saving now will re-create it.");
      return;
    }
    lastSeededId.current = applicationId;
    setForm(formFromApplication(application));
    setTab("overview");
    setSaveError("");
    setIsSaving(false);
    setIsOpeningPreparation(false);
  }, [open, applicationId]);

  const isBusy = isSaving || isOpeningPreparation;
  const requestClose = () => {
    if (!isBusy) onClose();
  };

  const handleModalKeyDown = useModalFocus({
    active: open,
    containerRef: panelRef,
    initialFocusRef: companyInputRef,
    onClose: requestClose
  });

  const formHasUnsavedChanges = useMemo(
    () =>
      Boolean(application) &&
      JSON.stringify(form) !== JSON.stringify(formFromApplication(application)),
    [application, form]
  );

  if (!open || !application) return null;

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateContact(index: number, key: keyof ApplicationContact, value: string) {
    setForm((current) => ({
      ...current,
      contacts: current.contacts.map((c, i) => (i === index ? { ...c, [key]: value } : c))
    }));
  }

  function addContact() {
    setForm((current) => ({ ...current, contacts: [...current.contacts, { name: "", title: "", email: "", phone: "" }] }));
  }

  function removeContact(index: number) {
    setForm((current) => ({ ...current, contacts: current.contacts.filter((_, i) => i !== index) }));
  }

  function updateAnswer(index: number, key: "question" | "answer", value: string) {
    setForm((current) => ({
      ...current,
      answers: current.answers.map((a, i) => (i === index ? { ...a, [key]: value } : a))
    }));
  }

  function addAnswer() {
    setForm((current) => ({
      ...current,
      answers: [...current.answers, { question: "", answer: "", savedAt: new Date().toISOString() }]
    }));
  }

  function removeAnswer(index: number) {
    setForm((current) => ({ ...current, answers: current.answers.filter((_, i) => i !== index) }));
  }

  function buildApplication(statusOverride: ApplicationStatus): Application {
    const base = application as Application;
    const now = new Date().toISOString();
    const cleanContacts = form.contacts
      .map((c) => ({
        name: c.name?.trim() || "",
        title: c.title?.trim() || "",
        email: c.email?.trim() || "",
        phone: c.phone?.trim() || ""
      }))
      .filter((c) => c.name || c.title || c.email || c.phone);
    const cleanAnswers = form.answers
      .map((a) => ({ question: a.question.trim(), answer: a.answer.trim(), savedAt: a.savedAt || now }))
      .filter((a) => a.question && a.answer);

    const next: Application = {
      ...base,
      id: base.id,
      title: [form.role.trim(), form.company.trim()].filter(Boolean).join(" at ") || base.title,
      company: form.company.trim(),
      role: form.role.trim(),
      source: form.source,
      status: statusOverride,
      location: form.location.trim(),
      jobType: form.jobType.trim(),
      workAuth: form.workAuth.trim(),
      priority: form.priority || undefined,
      jobUrl: form.jobUrl.trim(),
      appliedAt:
        statusOverride === "interested" || statusOverride === "not_applying"
          ? undefined
          : toIso(form.appliedAt) || base.appliedAt || (statusOverride === "applied" ? now : undefined),
      notApplyingAt:
        statusOverride === "not_applying"
          ? toIso(form.notApplyingAt) || base.notApplyingAt || now
          : undefined,
      notApplyingReason:
        statusOverride === "not_applying" ? form.notApplyingReason || undefined : undefined,
      notApplyingNote:
        statusOverride === "not_applying" ? form.notApplyingNote.trim().slice(0, 2_000) || undefined : undefined,
      deadline: toIso(form.deadline) || undefined,
      followupAt: toIso(form.followupAt) || undefined,
      salaryMin: numberField(form.salaryMin),
      salaryMax: numberField(form.salaryMax),
      salaryCurrency: form.salaryCurrency.trim(),
      salaryPeriod: form.salaryPeriod,
      interviewTips: form.interviewTips.trim(),
      notes: form.notes.trim(),
      contacts: cleanContacts.length ? cleanContacts : undefined,
      applicationAnswers: cleanAnswers.length ? cleanAnswers : undefined,
      updatedAt: now
    };
    return statusOverride === "not_applying"
      ? withoutSubmittedApplicationArtifacts(next)
      : next;
  }

  async function save(statusOverride: ApplicationStatus = form.status) {
    if (isBusy) return;
    setIsSaving(true);
    setSaveError("");
    let saved = false;
    try {
      saved = await onSave(buildApplication(statusOverride));
    } catch {
      // Keep the form recoverable if a future persistence adapter rejects.
    }
    if (!saved) {
      setSaveError("Could not save this application because storage was unavailable or the record changed elsewhere. Your edits are still here; review and retry.");
      setIsSaving(false);
      return;
    }
    setIsSaving(false);
    onClose();
  }

  async function openPreparation() {
    if (!application || !onLoad || isBusy) return;
    if (formHasUnsavedChanges && !canSave) {
      setSaveError(
        "Add a company, role, or job URL before opening this preparation. Your edits are still here."
      );
      return;
    }
    setIsOpeningPreparation(true);
    setSaveError("");
    try {
      const applicationToOpen = formHasUnsavedChanges
        ? buildApplication(form.status)
        : application;
      if (formHasUnsavedChanges && !(await onSave(applicationToOpen))) {
        setSaveError(
          "Could not save your edits before opening this preparation. Your edits are still here; review and retry."
        );
        return;
      }
      const opened = await onLoad(applicationToOpen);
      if (opened) onClose();
    } catch {
      setSaveError("Could not open this preparation. The current workspace was kept.");
    } finally {
      setIsOpeningPreparation(false);
    }
  }

  async function openRelatedApplication(related: Application) {
    if (!onOpenRelated || isBusy) return;
    if (!formHasUnsavedChanges) {
      onOpenRelated(related);
      return;
    }
    if (!canSave) {
      setSaveError("Add a company, role, or job URL before leaving this record. Your edits are still here.");
      return;
    }
    setIsSaving(true);
    setSaveError("");
    try {
      if (!(await onSave(buildApplication(form.status)))) {
        setSaveError(
          "Could not save your edits before opening the related record. Your edits are still here; review and retry."
        );
        return;
      }
      onOpenRelated(related);
    } catch {
      setSaveError("Could not open the related record. Your edits are still here.");
    } finally {
      setIsSaving(false);
    }
  }

  const canSave =
    form.company.trim().length > 1 || form.role.trim().length > 1 || form.jobUrl.trim().length > 6;
  const editableStatuses = applicationStatusOptions(application.status);
  const openPreparationBlocked = formHasUnsavedChanges && !canSave;
  const fitAssessment = application.fitAssessment;
  const fitAssessmentMeta = fitAssessment ? fitAssessmentRunLabel(fitAssessment) : "";
  const fitVerdict = appFitVerdict(application);
  const headerName = [form.company.trim(), form.role.trim()].filter(Boolean).join(" · ") || "New application";
  const downloadBase = (form.company.trim() || form.role.trim() || "Resume").replace(/[^A-Za-z0-9_-]+/g, "_");
  const compPreview = formatSalary({
    salaryMin: numberField(form.salaryMin),
    salaryMax: numberField(form.salaryMax),
    salaryCurrency: form.salaryCurrency,
    salaryPeriod: form.salaryPeriod
  });
  const preparationActionLabel = form.status === "interested"
    ? "Continue preparation"
    : "Edit preparation";

  const TABS: { id: ModalTab; label: string; icon: typeof BriefcaseBusiness }[] = [
    { id: "overview", label: "Overview", icon: BriefcaseBusiness },
    { id: "interview", label: "Interview", icon: Sparkles },
    { id: "documents", label: "Documents", icon: FileText },
    { id: "questions", label: "Questions", icon: MessageSquareText }
  ];

  return (
    <div
      className="application-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="application-modal-title"
      onKeyDown={handleModalKeyDown}
    >
      <div className="application-modal__scrim" aria-hidden="true" onMouseDown={requestClose} />
      <section className="application-modal__panel" ref={panelRef} tabIndex={-1} aria-busy={isBusy}>
        <header className="application-modal__head">
          <div>
            <h2 id="application-modal-title" className="page-serif">
              {headerName}
            </h2>
            {saveError ? (
              <p className="application-modal__save-error" role="alert">
                {saveError}
              </p>
            ) : openPreparationBlocked ? (
              <p className="application-modal__save-error" id="application-open-requirements">
                Add a company, role, or job URL before opening this preparation. Your edits are still here.
              </p>
            ) : null}
          </div>
          <div className="application-modal__actions">
            {onLoad ? (
              <button
                type="button"
                className="secondary-button is-compact"
                onClick={() => void openPreparation()}
                disabled={isBusy || openPreparationBlocked}
                aria-describedby={openPreparationBlocked ? "application-open-requirements" : undefined}
              >
                <ExternalLink size={14} aria-hidden="true" /> {isOpeningPreparation ? "Opening…" : preparationActionLabel}
              </button>
            ) : null}
            <button type="button" className="ghost-button is-icon" aria-label="Close" onClick={requestClose} disabled={isBusy}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </header>

        <nav className="application-modal__tabs" aria-label="Application sections" inert={isBusy}>
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              type="button"
              key={id}
              className={tab === id ? "is-active" : ""}
              aria-pressed={tab === id}
              onClick={() => setTab(id)}
            >
              <Icon size={14} aria-hidden="true" /> {label}
            </button>
          ))}
        </nav>

        <div className="application-modal__body" inert={isBusy}>
          {tab === "overview" ? (
            <>
              <section className="application-form">
                <div className="application-form__grid">
                  <label className="field">
                    <span>Company</span>
                    <input ref={companyInputRef} className="text-input" value={form.company} onChange={(e) => update("company", e.target.value)} placeholder="Notion, Stripe, Databricks" />
                  </label>
                  <label className="field">
                    <span>Role / job title</span>
                    <input className="text-input" value={form.role} onChange={(e) => update("role", e.target.value)} placeholder="Software Engineer II" />
                  </label>
                  <label className="field">
                    <span>Stage</span>
                    <select value={form.status} onChange={(e) => update("status", e.target.value as ApplicationStatus)}>
                      {editableStatuses.map((status) => (
                        <option key={status} value={status}>{STATUS_LABEL[status]}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Priority</span>
                    <select value={form.priority} onChange={(e) => update("priority", e.target.value as FormState["priority"])}>
                      <option value="">Auto (from fit)</option>
                      <option value="High">High</option>
                      <option value="Medium">Medium</option>
                      <option value="Low">Low</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Source</span>
                    <select value={form.source} onChange={(e) => update("source", e.target.value as ApplicationSource)}>
                      {APPLICATION_SOURCES.filter(Boolean).map((source) => (
                        <option key={source} value={source}>{source}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Location</span>
                    <input className="text-input" value={form.location} onChange={(e) => update("location", e.target.value)} placeholder="San Francisco, CA (Hybrid)" />
                  </label>
                  <label className="field">
                    <span>Job type</span>
                    <select value={form.jobType} onChange={(e) => update("jobType", e.target.value)}>
                      <option value="">Not specified</option>
                      {JOB_TYPES.map((type) => (
                        <option key={type} value={type}>{type}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Work authorization</span>
                    <input className="text-input" value={form.workAuth} onChange={(e) => update("workAuth", e.target.value)} placeholder="US Citizen, H-1B, …" />
                  </label>
                  {form.status === "not_applying" ? (
                    <>
                      <label className="field">
                        <span>Not applying date</span>
                        <input className="text-input" type="date" value={form.notApplyingAt} onChange={(e) => update("notApplyingAt", e.target.value)} />
                      </label>
                      <label className="field">
                        <span>Reason</span>
                        <select value={form.notApplyingReason} onChange={(e) => update("notApplyingReason", e.target.value as FormState["notApplyingReason"])}>
                          <option value="">No reason recorded</option>
                          {Object.entries(NOT_APPLYING_REASON_LABEL).map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                      </label>
                    </>
                  ) : (
                    <label className="field">
                      <span>Application date</span>
                      <input className="text-input" type="date" value={form.appliedAt} onChange={(e) => update("appliedAt", e.target.value)} />
                    </label>
                  )}
                  <label className="field">
                    <span>Deadline</span>
                    <input className="text-input" type="date" value={form.deadline} onChange={(e) => update("deadline", e.target.value)} />
                  </label>
                  <label className="field">
                    <span>Next step date</span>
                    <input className="text-input" type="date" value={form.followupAt} onChange={(e) => update("followupAt", e.target.value)} />
                  </label>
                  <label className="field">
                    <span>Job link</span>
                    <input className="text-input" value={form.jobUrl} onChange={(e) => update("jobUrl", e.target.value)} placeholder="https://…" />
                  </label>
                </div>

                <fieldset className="application-comp">
                  <legend>Compensation</legend>
                  <div className="application-comp__row">
                    <label className="field">
                      <span>Min</span>
                      <input className="text-input" inputMode="numeric" value={form.salaryMin} onChange={(e) => update("salaryMin", e.target.value.replace(/[^\d]/g, "").slice(0, 9))} placeholder="160000" />
                    </label>
                    <label className="field">
                      <span>Max</span>
                      <input className="text-input" inputMode="numeric" value={form.salaryMax} onChange={(e) => update("salaryMax", e.target.value.replace(/[^\d]/g, "").slice(0, 9))} placeholder="200000" />
                    </label>
                    <label className="field">
                      <span>Currency</span>
                      <input className="text-input" value={form.salaryCurrency} onChange={(e) => update("salaryCurrency", e.target.value.slice(0, 8).toUpperCase())} placeholder="USD" />
                    </label>
                    <label className="field">
                      <span>Period</span>
                      <select value={form.salaryPeriod} onChange={(e) => update("salaryPeriod", e.target.value as SalaryPeriod)}>
                        <option value="yr">/ year</option>
                        <option value="mo">/ month</option>
                        <option value="hr">/ hour</option>
                      </select>
                    </label>
                  </div>
                </fieldset>

                {form.status === "not_applying" ? (
                  <label className="field">
                    <span>Decision note</span>
                    <textarea className="textarea" value={form.notApplyingNote} onChange={(e) => update("notApplyingNote", e.target.value)} placeholder="Optional context for this decision." rows={2} />
                  </label>
                ) : null}

                <section className="application-prepared-snapshot" aria-labelledby="application-prepared-snapshot-title">
                  <div className="application-prepared-snapshot__head">
                    <div>
                      <h4 id="application-prepared-snapshot-title">Prepared job snapshot</h4>
                      <p>Read-only here. Use {preparationActionLabel.toLowerCase()} to correct the prepared posting.</p>
                    </div>
                  </div>
                  {application.roleDescription ? (
                    <p className="application-prepared-snapshot__summary">{application.roleDescription}</p>
                  ) : null}
                  {application.jobDescription ? (
                    <pre>{application.jobDescription}</pre>
                  ) : (
                    <p className="application-muted">No prepared snapshot is saved for this record.</p>
                  )}
                </section>

                <label className="field">
                  <span>Notes</span>
                  <textarea className="textarea" value={form.notes} onChange={(e) => update("notes", e.target.value)} placeholder="Recruiter context, interview focus, or reminders." rows={3} />
                </label>
              </section>

              <aside className="application-match-card">
                <span className="application-match-card__eyebrow">
                  <Sparkles size={14} aria-hidden="true" /> AI match & insights
                </span>
                <div className="figures-strip figures-strip--compact" aria-label="Fit Assessment">
                  <span className="figures-strip__item">
                    <em>Fit Assessment</em>
                    <strong className={`application-fit application-fit--${fitVerdict?.tone ?? "neutral"}`}>{fitVerdict?.label ?? "Not checked"}</strong>
                  </span>
                  {fitAssessment ? (
                    <>
                      <span className="figures-strip__divider" aria-hidden="true" />
                      <span className="figures-strip__item">
                        <em>Resume</em>
                        <strong className="is-prose">{fitAssessment.resumeLabel}</strong>
                      </span>
                    </>
                  ) : null}
                </div>
                <p>{fitAssessment?.result.summary ?? "Run a Fit Assessment from Prepare to save this snapshot."}</p>
                {fitAssessmentMeta ? <p className="application-match-card__meta">{fitAssessmentMeta}</p> : null}
                {fitAssessment?.result.gaps.length ? (
                  <div className="application-match-card__gaps">
                    <strong>Top gaps</strong>
                    <div className="application-chip-list">
                      {fitAssessment.result.gaps.map((gap) => (
                        <span key={gap}>{gap}</span>
                      ))}
                    </div>
                  </div>
                ) : null}
                <ul className="application-checks">
                  {compPreview ? <li><CheckCircle2 size={13} aria-hidden="true" /> {compPreview}</li> : null}
                  {form.location.trim() ? <li><CheckCircle2 size={13} aria-hidden="true" /> {form.location.trim()}</li> : null}
                  <li><CheckCircle2 size={13} aria-hidden="true" /> Stage: {STATUS_LABEL[form.status]}</li>
                </ul>
                {application.status === "not_applying" ? (
                  <section className="application-related-records" aria-label="Not applying decision">
                    <strong>Decision</strong>
                    <p>Marked Not applying on {formatDetailDate(toIso(form.notApplyingAt))}.</p>
                    {form.notApplyingReason ? (
                      <p>{NOT_APPLYING_REASON_LABEL[form.notApplyingReason]}</p>
                    ) : null}
                    {form.notApplyingNote.trim() ? <p>{form.notApplyingNote.trim()}</p> : null}
                  </section>
                ) : null}
                {relatedApplications.length ? (
                  <section className="application-related-records" aria-labelledby="application-related-records-title">
                    <strong id="application-related-records-title">Related records</strong>
                    <p>
                      {relatedApplications.length} other {relatedApplications.length === 1 ? "decision or application is" : "decisions or applications are"} linked to this posting.
                    </p>
                    <ul>
                      {relatedApplications.map((related) => (
                        <li key={related.id}>
                          <span>
                            {STATUS_LABEL[related.status]} · {formatDetailDate(related.notApplyingAt || related.appliedAt || related.createdAt)}
                          </span>
                          {onOpenRelated ? (
                            <button type="button" className="ghost-button is-compact" onClick={() => void openRelatedApplication(related)} disabled={isBusy}>
                              {isSaving ? "Saving…" : "Open"}
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </aside>
            </>
          ) : null}

          {tab === "interview" ? (
            <section className="application-form application-form--wide">
              <label className="field">
                <span>Interview tips & prep</span>
                <textarea className="textarea" value={form.interviewTips} onChange={(e) => update("interviewTips", e.target.value)} rows={5} placeholder="Format of each round, who you'll meet, topics to drill, questions to ask back, things that went well or poorly." />
              </label>

              <div className="application-contacts">
                <div className="application-contacts__head">
                  <h4><Users size={14} aria-hidden="true" /> Contacts</h4>
                  <button type="button" className="ghost-button is-compact" onClick={addContact}>
                    <Plus size={13} aria-hidden="true" /> Add contact
                  </button>
                </div>
                {form.contacts.length ? (
                  form.contacts.map((contact, index) => (
                    <div className="application-contact-row" key={index} role="group" aria-label={`Contact ${index + 1}`}>
                      <input aria-label={`Contact ${index + 1} name`} className="text-input" value={contact.name ?? ""} onChange={(e) => updateContact(index, "name", e.target.value)} placeholder="Name" />
                      <input aria-label={`Contact ${index + 1} title`} className="text-input" value={contact.title ?? ""} onChange={(e) => updateContact(index, "title", e.target.value)} placeholder="Title (Recruiter…)" />
                      <input aria-label={`Contact ${index + 1} email`} className="text-input" value={contact.email ?? ""} onChange={(e) => updateContact(index, "email", e.target.value)} placeholder="Email" />
                      <input aria-label={`Contact ${index + 1} phone`} className="text-input" value={contact.phone ?? ""} onChange={(e) => updateContact(index, "phone", e.target.value)} placeholder="Phone" />
                      <button type="button" className="ghost-button is-icon" aria-label={`Remove contact ${index + 1}`} onClick={() => removeContact(index)}>
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="application-muted">No contacts yet. Add a recruiter or interviewer.</p>
                )}
              </div>

            </section>
          ) : null}

          {tab === "documents" ? (
            <ApplicationDocumentsTab
              application={application}
              downloadBase={downloadBase}
              onSaveDocument={onSaveDocument}
              onRemoveDocument={onRemoveDocument}
              onPreviewDocument={onPreviewDocument}
              onDownloadDocument={onDownloadDocument}
              onSaveAttachment={onSaveAttachment}
              onRemoveAttachment={onRemoveAttachment}
            />
          ) : null}

          {tab === "questions" ? (
            <section className="application-form application-form--wide">
              <div className="application-contacts__head">
                <h4><ClipboardCheck size={14} aria-hidden="true" /> Application questions</h4>
                <button type="button" className="ghost-button is-compact" onClick={addAnswer}>
                  <Plus size={13} aria-hidden="true" /> Add question
                </button>
              </div>
              {form.answers.length ? (
                form.answers.map((entry, index) => (
                  <div className="application-qa" key={index} role="group" aria-label={`Application question ${index + 1}`}>
                    <div className="application-qa__head">
                      <input aria-label={`Application question ${index + 1}`} className="text-input" value={entry.question} onChange={(e) => updateAnswer(index, "question", e.target.value)} placeholder="Question the application asked…" />
                      <button type="button" className="ghost-button is-icon" aria-label={`Remove application question ${index + 1}`} onClick={() => removeAnswer(index)}>
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </div>
                    <textarea aria-label={`Answer to application question ${index + 1}`} className="textarea" value={entry.answer} onChange={(e) => updateAnswer(index, "answer", e.target.value)} rows={4} placeholder="Your answer." />
                  </div>
                ))
              ) : (
                <p className="application-muted">No saved questions. Generate answers in the Application Questions tab and save them, or add one here manually.</p>
              )}
            </section>
          ) : null}
        </div>

        <footer className="application-modal__foot">
          <span>Edits save to the local workspace tracker.</span>
          <div className="application-modal__actions">
            {onDelete ? (
              <button type="button" className="secondary-button is-compact danger-button" disabled={isBusy} onClick={() => onDelete(application.id, application.title)}>
                <Trash2 size={14} aria-hidden="true" /> Delete
              </button>
            ) : null}
            <button type="button" className="secondary-button is-compact" onClick={requestClose} disabled={isBusy}>Close</button>
            <button type="button" className="primary-button is-compact" disabled={!canSave || isBusy} onClick={() => void save()}>
              {isSaving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
