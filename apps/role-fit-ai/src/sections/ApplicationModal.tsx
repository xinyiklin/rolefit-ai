import { useEffect, useMemo, useRef, useState } from "react";
import {
  Building2,
  BriefcaseBusiness,
  CalendarDays,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  ExternalLink,
  FileText,
  Link2,
  MapPin,
  MoreHorizontal,
  Plus,
  ShieldCheck,
  Trash2,
  X
} from "lucide-react";
import {
  APPLICATION_SOURCES,
  NOT_APPLYING_REASON_LABEL,
  type Application,
  type ApplicationAnswer,
  type ApplicationContact,
  type NotApplyingReason,
  type ApplicationSource,
  type ApplicationStatus,
  type SalaryPeriod
} from "../hooks/useApplications";
import type { ApplicationDocumentKind } from "../lib/applicationDocumentRequests";
import type { DocumentUpload } from "../lib/applicationDocumentRequests";
import { ApplicationDocumentsTab } from "./application/ApplicationDocumentsTab";
import { ApplicationJobSnapshot } from "./application/ApplicationJobSnapshot";
import { TrackerRowMenu, type RowMenuItem } from "./tracker/TrackerRowMenu";
import {
  STATUS_LABEL,
  appFitVerdict,
  applicationActivityDate,
  fitAssessmentRunLabel
} from "../lib/applicationDisplay";
import { applicationStatusOptions } from "../lib/applicationStatusTransitions";
import { withoutSubmittedApplicationArtifacts } from "../lib/notApplyingApplication";
import { useDialog } from "../hooks/useDialog";
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
  onMarkRelatedUnrelated?: (application: Application) => Promise<boolean>;
  onMergeRelated?: (application: Application) => Promise<boolean>;
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

type ModalTab = "details" | "prep" | "documents";

type FormState = {
  company: string;
  role: string;
  status: ApplicationStatus;
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

function relatedRecordLabel(application: Application) {
  return application.title || `${application.role || "Role"} at ${application.company || "company"}`;
}

function listPhrase(items: string[]) {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function numberField(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null;
}

function displayValue(value: string) {
  return value.trim() || "Not recorded";
}

function displaySalary(value: string) {
  const parsed = numberField(value);
  return parsed == null ? "Not recorded" : new Intl.NumberFormat().format(parsed);
}

const SALARY_PERIOD_LABEL: Record<SalaryPeriod, string> = {
  yr: "Per year",
  mo: "Per month",
  hr: "Per hour"
};

function formFromApplication(application: Application | null): FormState {
  if (!application) {
    return {
      company: "",
      role: "",
      status: "applied",
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
  onMarkRelatedUnrelated,
  onMergeRelated,
  onPreviewDocument,
  onDownloadDocument,
  onSaveDocument,
  onRemoveDocument,
  onSaveAttachment,
  onRemoveAttachment
}: ApplicationModalProps) {
  const { confirm } = useDialog();
  const applicationId = application?.id ?? null;
  const [tab, setTab] = useState<ModalTab>("details");
  const [form, setForm] = useState<FormState>(() => formFromApplication(application));
  const [isSaving, setIsSaving] = useState(false);
  const [isOpeningPreparation, setIsOpeningPreparation] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [relatedMenu, setRelatedMenu] = useState<{ related: Application; x: number; y: number } | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const tablistRef = useRef<HTMLDivElement>(null);
  const primaryInputRef = useRef<HTMLSelectElement>(null);
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
    setTab("details");
    setSaveError("");
    setIsSaving(false);
    setIsOpeningPreparation(false);
    setRelatedMenu(null);
  }, [open, applicationId]);

  const isBusy = isSaving || isOpeningPreparation;
  const formHasUnsavedChanges = useMemo(
    () =>
      Boolean(application) &&
      JSON.stringify(form) !== JSON.stringify(formFromApplication(application)),
    [application, form]
  );

  const requestClose = () => {
    if (isBusy) return;
    if (!formHasUnsavedChanges) {
      onClose();
      return;
    }
    void confirm({
      title: "Discard unsaved changes?",
      message: "Your edits to this application have not been saved.",
      confirmLabel: "Discard changes",
      tone: "danger"
    }).then((shouldDiscard) => {
      if (shouldDiscard) onClose();
    });
  };

  const handleModalKeyDown = useModalFocus({
    active: open,
    containerRef: panelRef,
    initialFocusRef: primaryInputRef,
    onClose: requestClose
  });

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
      jobUrl: form.jobUrl.trim(),
      appliedAt:
        statusOverride === "not_applying"
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

  // Skipped is a terminal stage AND buildApplication drops the submitted-attempt
  // fields on the way in, so a plain "Save changes" must not be the trigger —
  // this is the same class of act as Merge duplicate, which already confirms.
  async function confirmSkipDowngrade(statusOverride: ApplicationStatus) {
    const base = application as Application;
    if (statusOverride !== "not_applying" || base.status === "not_applying") return true;
    const dropped = [
      base.appliedAt ? "the application date" : "",
      base.resumeUsed || base.resumeArtifacts ? "the saved resume" : "",
      base.coverLetterArtifacts ? "the saved cover letter" : ""
    ].filter(Boolean);
    return confirm({
      title: "Mark this job as Skipped?",
      message:
        "Skipped is final — this record cannot return to an earlier stage."
        + (dropped.length ? ` Saving also clears ${listPhrase(dropped)} from it.` : ""),
      confirmLabel: "Mark as Skipped",
      tone: "danger"
    });
  }

  async function save(statusOverride: ApplicationStatus = form.status) {
    if (isBusy) return;
    if (!(await confirmSkipDowngrade(statusOverride))) return;
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
    // Every path below that flushes the form must clear the same terminal-stage
    // gate as Save changes — leaving via a side door cannot skip it.
    if (formHasUnsavedChanges && !(await confirmSkipDowngrade(form.status))) return;
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
    if (!(await confirmSkipDowngrade(form.status))) return;
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

  async function changeRelatedRecord(
    related: Application,
    action: "unlink" | "merge"
  ) {
    const callback = action === "unlink" ? onMarkRelatedUnrelated : onMergeRelated;
    if (!callback || isBusy) return;
    const relatedLabel = relatedRecordLabel(related);
    const removesFiles = Boolean(
      related.resumeArtifacts
      || related.coverLetterArtifacts
      || related.attachments?.length
    );
    const proceed = await confirm(
      action === "unlink"
        ? {
            title: "Mark records as unrelated?",
            message: `“${relatedLabel}” will leave this posting group. Both tracker records will remain.`,
            confirmLabel: "Mark as unrelated"
          }
        : {
            title: "Merge accidental duplicate?",
            message:
              `Merge “${relatedLabel}” into this record? The related tracker row will be removed.`
              + (removesFiles
                ? " Documents on the removed row will be moved to workspace trash and will not be combined."
                : ""),
            confirmLabel: "Merge",
            tone: "danger"
          }
    );
    if (!proceed) return;
    if (formHasUnsavedChanges && !canSave) {
      setSaveError("Add a company, role, or job URL before changing related records. Your edits are still here.");
      return;
    }
    if (formHasUnsavedChanges && !(await confirmSkipDowngrade(form.status))) return;
    setIsSaving(true);
    setSaveError("");
    try {
      if (formHasUnsavedChanges && !(await onSave(buildApplication(form.status)))) {
        setSaveError("Could not save your edits before changing related records. Your edits are still here; review and retry.");
        return;
      }
      if (!(await callback(related))) {
        setSaveError(
          action === "unlink"
            ? "Could not unlink these records because storage was unavailable or a record changed elsewhere."
            : "Could not merge these records because storage was unavailable or a record changed elsewhere."
        );
      }
    } catch {
      setSaveError("Could not change these related records. Review the tracker and retry.");
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
  const preparationActionLabel = "Edit preparation";
  // Only one of the two head messages renders at a time, so describedby has to
  // point at whichever exists — otherwise it dangles when both conditions hold.
  const openHintId = saveError
    ? "application-modal-save-error"
    : openPreparationBlocked
      ? "application-open-requirements"
      : undefined;
  const relatedMenuItems: RowMenuItem[] = relatedMenu
    ? [
        ...(onMarkRelatedUnrelated
          ? [{
              kind: "action" as const,
              label: "Mark as unrelated",
              onSelect: () => void changeRelatedRecord(relatedMenu.related, "unlink")
            }]
          : []),
        ...(onMergeRelated
          ? [{
              kind: "action" as const,
              label: "Merge duplicate",
              danger: true,
              onSelect: () => void changeRelatedRecord(relatedMenu.related, "merge")
            }]
          : [])
      ]
    : [];

  const TABS: { id: ModalTab; label: string; icon: typeof BriefcaseBusiness }[] = [
    { id: "details", label: "Details", icon: BriefcaseBusiness },
    { id: "prep", label: "Prep", icon: ClipboardCheck },
    { id: "documents", label: "Documents", icon: FileText }
  ];

  // APG tabs: arrow/Home/End move selection AND focus. stopPropagation keeps
  // these off the dialog's own key handler.
  function handleTabsKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const order = TABS.map((entry) => entry.id);
    const current = order.indexOf(tab);
    const next =
      event.key === "ArrowRight" ? (current + 1) % order.length
      : event.key === "ArrowLeft" ? (current - 1 + order.length) % order.length
      : event.key === "Home" ? 0
      : event.key === "End" ? order.length - 1
      : -1;
    if (next < 0) return;
    event.preventDefault();
    event.stopPropagation();
    setTab(order[next]);
    tablistRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }

  // The saved record's own line — stage, its governing date, and how many other
  // records share this posting. Reads the record, not the form, so a pending
  // stage edit cannot backdate a stage that was never saved.
  const savedStageDate = formatDetailDate(applicationActivityDate(application));
  const headerMeta = [
    STATUS_LABEL[application.status],
    savedStageDate === "Date not recorded" ? "" : savedStageDate,
    relatedApplications.length
      ? `${relatedApplications.length} related ${relatedApplications.length === 1 ? "record" : "records"}`
      : ""
  ].filter(Boolean);

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
            <p className="application-modal__identity">
              <span className={`stage-dot stage-dot--${application.status}`} aria-hidden="true" />
              {headerMeta.map((part, index) => (
                <span key={part}>
                  {index ? <span className="application-modal__identity-sep" aria-hidden="true">·</span> : null}
                  {part}
                </span>
              ))}
            </p>
            {saveError ? (
              <p className="application-modal__save-error" id="application-modal-save-error" role="alert">
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
                aria-describedby={openHintId}
              >
                <ExternalLink size={14} aria-hidden="true" /> {isOpeningPreparation ? "Opening…" : preparationActionLabel}
              </button>
            ) : null}
            <button type="button" className="ghost-button is-icon" aria-label="Close" onClick={requestClose} disabled={isBusy}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div
          className="application-modal__tabs"
          role="tablist"
          ref={tablistRef}
          aria-label="Application sections"
          onKeyDown={handleTabsKeyDown}
          inert={isBusy}
        >
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              type="button"
              key={id}
              id={`application-tab-${id}`}
              role="tab"
              className={tab === id ? "is-active" : ""}
              aria-selected={tab === id}
              aria-controls="application-tabpanel"
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)}
            >
              <Icon size={14} aria-hidden="true" /> {label}
            </button>
          ))}
        </div>

        <div
          className={`application-modal__body application-modal__body--${tab === "details" ? "details" : "single"}`}
          role="tabpanel"
          id="application-tabpanel"
          aria-labelledby={`application-tab-${tab}`}
          inert={isBusy}
        >
          {tab === "details" ? (
            <>
              <section className="application-details-pane application-modal__main">
                <div className="application-workflow-grid">
                  <section className="application-details-section" aria-labelledby="application-status-title">
                    <h4 id="application-status-title">Status</h4>
                    <div className="application-details-grid application-details-grid--record">
                      <label className="field">
                        <span>Stage</span>
                        <select ref={primaryInputRef} value={form.status} onChange={(e) => update("status", e.target.value as ApplicationStatus)}>
                          {editableStatuses.map((status) => (
                            <option key={status} value={status}>{STATUS_LABEL[status]}</option>
                          ))}
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
                    </div>
                  </section>

                  <section className="application-details-section" aria-labelledby="application-timing-title">
                    <h4 id="application-timing-title">Timing</h4>
                    <div className="application-details-grid application-details-grid--timing">
                      {form.status === "not_applying" ? (
                        <label className="field">
                          <span>Decision date</span>
                          <input className="text-input is-data" type="date" value={form.notApplyingAt} onChange={(e) => update("notApplyingAt", e.target.value)} />
                        </label>
                      ) : (
                        <label className="field">
                          <span>Application date</span>
                          <input className="text-input is-data" type="date" value={form.appliedAt} onChange={(e) => update("appliedAt", e.target.value)} />
                        </label>
                      )}
                      <label className="field">
                        <span>Deadline</span>
                        <input className="text-input is-data" type="date" value={form.deadline} onChange={(e) => update("deadline", e.target.value)} />
                      </label>
                      <label className="field">
                        <span>Next step date</span>
                        <input className="text-input is-data" type="date" value={form.followupAt} onChange={(e) => update("followupAt", e.target.value)} />
                      </label>
                    </div>
                  </section>

                  {form.status === "not_applying" ? (
                    <section className="application-details-section application-details-decision" aria-labelledby="application-decision-title">
                      <div className="application-details-decision__head">
                        <h4 id="application-decision-title">Skipped decision</h4>
                        <strong><span className="stage-dot stage-dot--not_applying" aria-hidden="true" /> Skipped</strong>
                      </div>
                      <div className="application-details-grid application-details-grid--2">
                        <label className="field">
                          <span>Reason</span>
                          <select value={form.notApplyingReason} onChange={(e) => update("notApplyingReason", e.target.value as FormState["notApplyingReason"])}>
                            <option value="">No reason recorded</option>
                            {Object.entries(NOT_APPLYING_REASON_LABEL).map(([value, label]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          <span>Decision note <small>Optional</small></span>
                          <textarea className="textarea" value={form.notApplyingNote} onChange={(e) => update("notApplyingNote", e.target.value)} placeholder="What made you skip this role?" rows={3} />
                        </label>
                      </div>
                    </section>
                  ) : null}
                </div>

                <div className="application-job-facts">
                  <section className="application-job-card" aria-labelledby="application-role-title">
                    <h4 id="application-role-title">Role &amp; company</h4>
                    <dl className="application-fact-list application-fact-list--identity">
                      <div>
                        <dt><Building2 size={14} aria-hidden="true" /><span className="sr-only">Company</span></dt>
                        <dd>{displayValue(form.company)}</dd>
                      </div>
                      <div>
                        <dt><BriefcaseBusiness size={14} aria-hidden="true" /><span className="sr-only">Role</span></dt>
                        <dd>{displayValue(form.role)}</dd>
                      </div>
                      <div>
                        <dt><Link2 size={14} aria-hidden="true" /><span className="sr-only">Job link</span></dt>
                        <dd>
                          {form.jobUrl.trim() ? (
                            <a href={form.jobUrl} target="_blank" rel="noreferrer">
                              <span>{form.jobUrl}</span><ExternalLink size={13} aria-hidden="true" />
                            </a>
                          ) : "Not recorded"}
                        </dd>
                      </div>
                    </dl>
                  </section>

                  <section className="application-job-card" aria-labelledby="application-work-title">
                    <h4 id="application-work-title">Job details</h4>
                    <dl className="application-fact-list">
                      <div><dt><MapPin size={14} aria-hidden="true" />Location</dt><dd>{displayValue(form.location)}</dd></div>
                      <div><dt><CalendarDays size={14} aria-hidden="true" />Job type</dt><dd>{displayValue(form.jobType)}</dd></div>
                      <div><dt><ShieldCheck size={14} aria-hidden="true" />Work authorization</dt><dd>{displayValue(form.workAuth)}</dd></div>
                    </dl>
                  </section>

                  <section className="application-job-card application-job-card--wide" aria-labelledby="application-compensation-title">
                    <h4 id="application-compensation-title">Compensation</h4>
                    <dl className="application-compensation-facts">
                      <div><dt><CircleDollarSign size={14} aria-hidden="true" />Minimum</dt><dd>{displaySalary(form.salaryMin)}</dd></div>
                      <div><dt><CircleDollarSign size={14} aria-hidden="true" />Maximum</dt><dd>{displaySalary(form.salaryMax)}</dd></div>
                      <div><dt><CircleDollarSign size={14} aria-hidden="true" />Currency</dt><dd>{displayValue(form.salaryCurrency)}</dd></div>
                      <div><dt><Clock3 size={14} aria-hidden="true" />Period</dt><dd>{SALARY_PERIOD_LABEL[form.salaryPeriod]}</dd></div>
                    </dl>
                  </section>

                  <ApplicationJobSnapshot application={application} />
                </div>

              </section>

              <aside className="application-details-pane application-modal__side" aria-label="Fit assessment and related history">
                <section className="application-match-card" aria-labelledby="application-fit-title">
                  <h4 id="application-fit-title" className="application-match-card__title">Fit assessment</h4>
                  <div className="application-fit-summary" aria-label="Fit Assessment">
                    <strong className={`application-fit application-fit--ring application-fit--${fitVerdict?.tone ?? "neutral"}`}>{fitVerdict?.label ?? "Not checked"}</strong>
                    <div className="application-fit-summary__resume">
                      <span>{fitAssessment ? "Resume" : "Assessment"}</span>
                      <strong>{fitAssessment?.resumeLabel ?? "Not yet run"}</strong>
                    </div>
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
                </section>

                {relatedApplications.length ? (
                  <section className="application-side-card" aria-labelledby="application-related-records-title">
                    <h4 id="application-related-records-title">Related records history</h4>
                    <ul className="application-related-records">
                      {relatedApplications.map((related) => (
                        <li key={related.id}>
                          <span className="application-related-records__marker" aria-hidden="true">
                            <span className={`stage-dot stage-dot--${related.status}`} />
                          </span>
                          <span className="application-related-records__label">
                            <strong>{STATUS_LABEL[related.status]}</strong>
                            <span>
                              <time className="is-data">{formatDetailDate(applicationActivityDate(related))}</time>
                              {related.status === "not_applying" && related.notApplyingReason
                                ? ` · ${NOT_APPLYING_REASON_LABEL[related.notApplyingReason]}`
                                : ""}
                            </span>
                          </span>
                          <span className="application-related-records__actions">
                            {onOpenRelated ? (
                              <button type="button" className="secondary-button is-compact application-related-records__open" onClick={() => void openRelatedApplication(related)} disabled={isBusy}>
                                {isSaving ? "Saving…" : "Open"}
                              </button>
                            ) : null}
                            {onMarkRelatedUnrelated || onMergeRelated ? (
                              <button
                                type="button"
                                className="ghost-button is-icon"
                                aria-label={`More actions for ${relatedRecordLabel(related)}`}
                                aria-haspopup="menu"
                                aria-expanded={relatedMenu?.related.id === related.id}
                                disabled={isBusy}
                                onClick={(event) => {
                                  const rect = event.currentTarget.getBoundingClientRect();
                                  setRelatedMenu({ related, x: rect.left, y: rect.bottom + 4 });
                                }}
                              >
                                <MoreHorizontal size={14} aria-hidden="true" />
                              </button>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </aside>
            </>
          ) : null}

          {tab === "prep" ? (
            <section className="application-form application-form--prep">
              <fieldset className="application-fieldset">
                <legend>Preparation notes</legend>
                <div className="application-fieldset__row application-fieldset__row--2">
                  <label className="field">
                    <span>Application notes</span>
                    <textarea className="textarea" value={form.notes} onChange={(e) => update("notes", e.target.value)} placeholder="Recruiter context, reminders, or useful role details." rows={4} />
                  </label>
                  <label className="field">
                    <span>Interview preparation</span>
                    <textarea className="textarea" value={form.interviewTips} onChange={(e) => update("interviewTips", e.target.value)} rows={4} placeholder="Rounds, people, topics to drill, and questions to ask." />
                  </label>
                </div>
              </fieldset>

              <section className="application-prep-section application-contacts" aria-labelledby="application-contacts-title">
                <header className="application-contacts__head">
                  <h3 id="application-contacts-title">Contacts</h3>
                  <button type="button" className="ghost-button is-compact" onClick={addContact}>
                    <Plus size={13} aria-hidden="true" /> Add contact
                  </button>
                </header>
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
              </section>

              <section className="application-prep-section" aria-labelledby="application-questions-title">
                <header className="application-contacts__head">
                  <h3 id="application-questions-title">Application questions</h3>
                  <button type="button" className="ghost-button is-compact" onClick={addAnswer}>
                    <Plus size={13} aria-hidden="true" /> Add question
                  </button>
                </header>
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
                  <p className="application-muted">No saved questions. Generate answers in Application Questions or add one here.</p>
                )}
              </section>
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

        </div>

        <footer className="application-modal__foot">
          {onDelete ? (
            <button type="button" className="secondary-button is-compact danger-button" disabled={isBusy} onClick={() => onDelete(application.id, application.title)}>
              <Trash2 size={14} aria-hidden="true" /> Delete
            </button>
          ) : null}
          <div className="application-modal__actions">
            <button type="button" className="secondary-button is-compact" onClick={requestClose} disabled={isBusy}>
              {formHasUnsavedChanges ? "Cancel" : "Close"}
            </button>
            <button type="button" className="primary-button is-compact" disabled={!canSave || isBusy} onClick={() => void save()}>
              {isSaving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </footer>

        {relatedMenu && relatedMenuItems.length ? (
          <TrackerRowMenu
            x={relatedMenu.x}
            y={relatedMenu.y}
            items={relatedMenuItems}
            onClose={() => setRelatedMenu(null)}
          />
        ) : null}
      </section>
    </div>
  );
}
