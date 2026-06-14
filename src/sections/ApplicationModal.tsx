import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BriefcaseBusiness,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Download,
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
  APPLICATION_STATUSES,
  JOB_TYPES,
  makeApplicationDraft,
  type Application,
  type ApplicationAnswer,
  type ApplicationContact,
  type ApplicationPriority,
  type ApplicationSource,
  type ApplicationStatus,
  type SalaryPeriod
} from "../hooks/useApplications";
import { STATUS_LABEL, fitLabel, fitTone, formatSalary } from "../lib/applicationDisplay";

type ApplicationModalProps = {
  open: boolean;
  // null = add mode (blank form); an application = detail/edit mode.
  application: Application | null;
  onClose: () => void;
  onSave: (application: Application) => void;
  onDelete?: (id: string, title: string) => void;
  // Load this application's job target + resume snapshot into the Polish editor.
  onLoad?: (application: Application) => void;
};

type ModalTab = "overview" | "interview" | "documents" | "questions";

type FormState = {
  company: string;
  role: string;
  roleDescription: string;
  status: ApplicationStatus;
  priority: "" | ApplicationPriority;
  source: ApplicationSource;
  location: string;
  jobType: string;
  workAuth: string;
  appliedAt: string;
  deadline: string;
  followupAt: string;
  jobUrl: string;
  jobDescription: string;
  salaryMin: string;
  salaryMax: string;
  salaryCurrency: string;
  salaryPeriod: SalaryPeriod;
  fitScore: string;
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
      roleDescription: "",
      status: "applied",
      priority: "",
      source: "Company site",
      location: "",
      jobType: "Full-time",
      workAuth: "",
      appliedAt: new Date().toISOString().slice(0, 10),
      deadline: "",
      followupAt: "",
      jobUrl: "",
      jobDescription: "",
      salaryMin: "",
      salaryMax: "",
      salaryCurrency: "USD",
      salaryPeriod: "yr",
      fitScore: "",
      interviewTips: "",
      notes: "",
      contacts: [],
      answers: []
    };
  }
  return {
    company: application.company ?? "",
    role: application.role ?? "",
    roleDescription: application.roleDescription ?? "",
    status: application.status,
    priority: application.priority ?? "",
    source: application.source ?? "",
    location: application.location ?? "",
    jobType: application.jobType ?? "",
    workAuth: application.workAuth ?? "",
    appliedAt: toDateInput(application.appliedAt),
    deadline: toDateInput(application.deadline),
    followupAt: toDateInput(application.followupAt),
    jobUrl: application.jobUrl ?? "",
    jobDescription: application.jobDescription ?? "",
    salaryMin: typeof application.salaryMin === "number" ? String(application.salaryMin) : "",
    salaryMax: typeof application.salaryMax === "number" ? String(application.salaryMax) : "",
    salaryCurrency: application.salaryCurrency ?? "USD",
    salaryPeriod: application.salaryPeriod ?? "yr",
    fitScore:
      typeof application.fitScore === "number"
        ? String(application.fitScore)
        : typeof application.tailoredFitScore === "number"
        ? String(application.tailoredFitScore)
        : "",
    interviewTips: application.interviewTips ?? "",
    notes: application.notes ?? "",
    contacts: application.contacts?.length ? application.contacts.map((c) => ({ ...c })) : [],
    answers: application.applicationAnswers?.length ? application.applicationAnswers.map((a) => ({ ...a })) : []
  };
}

export function ApplicationModal({ open, application, onClose, onSave, onDelete, onLoad }: ApplicationModalProps) {
  const isEdit = Boolean(application);
  const [tab, setTab] = useState<ModalTab>("overview");
  const [form, setForm] = useState<FormState>(() => formFromApplication(application));
  const [copied, setCopied] = useState("");
  const [copyFailed, setCopyFailed] = useState("");

  // Re-seed whenever the modal opens or targets a different application.
  useEffect(() => {
    if (!open) return;
    setForm(formFromApplication(application));
    setTab("overview");
    setCopied("");
  }, [open, application]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, open]);

  const fitNumber = useMemo(() => {
    if (!form.fitScore.trim()) return null;
    const value = Number(form.fitScore);
    return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : null;
  }, [form.fitScore]);

  if (!open) return null;

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

  async function copyText(value: string, key: string) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setCopyFailed("");
      window.setTimeout(() => setCopied(""), 1600);
    } catch {
      // Surface the failure instead of silently clearing — the text stays on
      // screen so the user can copy it manually.
      setCopied("");
      setCopyFailed(key);
      window.setTimeout(() => setCopyFailed((k) => (k === key ? "" : k)), 2500);
    }
  }

  function buildApplication(statusOverride: ApplicationStatus): Application {
    const base =
      application ?? makeApplicationDraft(form.jobUrl, form.jobDescription || `${form.role}\n${form.company}`);
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

    return {
      ...base,
      id: base.id,
      title: [form.role.trim(), form.company.trim()].filter(Boolean).join(" at ") || base.title,
      company: form.company.trim(),
      role: form.role.trim(),
      roleDescription: form.roleDescription.trim(),
      source: form.source,
      status: statusOverride,
      location: form.location.trim(),
      jobType: form.jobType.trim(),
      workAuth: form.workAuth.trim(),
      priority: form.priority || undefined,
      jobUrl: form.jobUrl.trim(),
      jobDescription: form.jobDescription.trim(),
      appliedAt: statusOverride === "interested" && !form.appliedAt ? undefined : toIso(form.appliedAt) || undefined,
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
      fitScore: fitNumber,
      // For a brand-new manual entry, seed the tailored slot so the score shows
      // up as a local estimate; for an existing one keep the saved comparison.
      tailoredFitScore: isEdit ? base.tailoredFitScore ?? null : fitNumber,
      fitScoreSource: isEdit ? base.fitScoreSource ?? null : fitNumber === null ? null : "local",
      updatedAt: now
    };
  }

  function save(statusOverride: ApplicationStatus = form.status) {
    onSave(buildApplication(statusOverride));
    onClose();
  }

  const canSave =
    form.company.trim().length > 1 || form.role.trim().length > 1 || form.jobUrl.trim().length > 6;
  const ringTone = fitTone(fitNumber);
  const review = application?.review;
  const gaps = application?.missingRequiredSkills ?? [];
  const headerName = [form.company.trim(), form.role.trim()].filter(Boolean).join(" · ") || "New application";
  const artifacts = application?.resumeArtifacts;
  const downloadBase = (form.company.trim() || form.role.trim() || "Resume").replace(/[^A-Za-z0-9_-]+/g, "_");
  const compPreview = formatSalary({
    salaryMin: numberField(form.salaryMin),
    salaryMax: numberField(form.salaryMax),
    salaryCurrency: form.salaryCurrency,
    salaryPeriod: form.salaryPeriod
  });

  const TABS: { id: ModalTab; label: string; icon: typeof BriefcaseBusiness }[] = [
    { id: "overview", label: "Overview", icon: BriefcaseBusiness },
    { id: "interview", label: "Interview", icon: Sparkles },
    { id: "documents", label: "Documents", icon: FileText },
    { id: "questions", label: "Questions", icon: MessageSquareText }
  ];

  return (
    <div className="application-modal" role="dialog" aria-modal="true" aria-labelledby="application-modal-title">
      <button type="button" className="application-modal__scrim" aria-label="Close application" onClick={onClose} />
      <section className="application-modal__panel">
        <header className="application-modal__head">
          <div>
            <h2 id="application-modal-title" className="page-serif">{isEdit ? headerName : "Add application"}</h2>
          </div>
          <div className="application-modal__actions">
            {isEdit && onLoad ? (
              <button type="button" className="secondary-button is-compact" onClick={() => onLoad(application as Application)}>
                <ExternalLink size={14} aria-hidden="true" /> Open in Polish
              </button>
            ) : null}
            {!isEdit ? (
              <button type="button" className="secondary-button is-compact" disabled={!canSave} onClick={() => save("interested")}>
                Save draft
              </button>
            ) : null}
            <button type="button" className="primary-button is-compact" disabled={!canSave} onClick={() => save()}>
              {isEdit ? "Save changes" : "Save application"}
            </button>
            <button type="button" className="ghost-button is-icon" aria-label="Close" onClick={onClose}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </header>

        <nav className="application-modal__tabs" aria-label="Application sections">
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

        <div className="application-modal__body">
          {tab === "overview" ? (
            <>
              <section className="application-form">
                <div className="application-form__grid">
                  <label className="field">
                    <span>Company</span>
                    <input className="text-input" value={form.company} onChange={(e) => update("company", e.target.value)} placeholder="Notion, Stripe, Databricks" />
                  </label>
                  <label className="field">
                    <span>Role / job title</span>
                    <input className="text-input" value={form.role} onChange={(e) => update("role", e.target.value)} placeholder="Software Engineer II" />
                  </label>
                  <label className="field">
                    <span>Stage</span>
                    <select value={form.status} onChange={(e) => update("status", e.target.value as ApplicationStatus)}>
                      {APPLICATION_STATUSES.map((status) => (
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
                      <option value="">—</option>
                      {JOB_TYPES.map((type) => (
                        <option key={type} value={type}>{type}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Work authorization</span>
                    <input className="text-input" value={form.workAuth} onChange={(e) => update("workAuth", e.target.value)} placeholder="US Citizen, H-1B, …" />
                  </label>
                  <label className="field">
                    <span>Application date</span>
                    <input className="text-input" type="date" value={form.appliedAt} onChange={(e) => update("appliedAt", e.target.value)} />
                  </label>
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

                <label className="field">
                  <span>Role summary</span>
                  <textarea className="textarea" value={form.roleDescription} onChange={(e) => update("roleDescription", e.target.value)} placeholder="Compact role overview for tracking." rows={3} />
                </label>

                <label className="field">
                  <span>Job description</span>
                  <textarea className="textarea" value={form.jobDescription} onChange={(e) => update("jobDescription", e.target.value)} placeholder="Paste the role summary or requirements." rows={4} />
                </label>

                <label className="field">
                  <span>Notes</span>
                  <textarea className="textarea" value={form.notes} onChange={(e) => update("notes", e.target.value)} placeholder="Recruiter context, interview focus, or reminders." rows={3} />
                </label>
              </section>

              <aside className="application-match-card">
                <span className="application-match-card__eyebrow">
                  <Sparkles size={14} aria-hidden="true" /> AI match & insights
                </span>
                <div className="figures-strip figures-strip--compact" aria-label="Fit score">
                  <span className="figures-strip__item">
                    <em>Fit score</em>
                    <strong className={`application-fit application-fit--${ringTone}`}>{fitNumber === null ? "--" : `${fitNumber}%`}</strong>
                  </span>
                  {fitNumber !== null ? (
                    <>
                      <span className="figures-strip__divider" aria-hidden="true" />
                      <span className="figures-strip__item">
                        <em>Match</em>
                        <strong className="is-prose">{fitLabel(fitNumber)}</strong>
                      </span>
                    </>
                  ) : null}
                </div>
                <label className="field application-match-card__score">
                  <span>Fit score</span>
                  <input className="text-input" inputMode="numeric" value={form.fitScore} onChange={(e) => update("fitScore", e.target.value.replace(/[^\d]/g, "").slice(0, 3))} placeholder="86" />
                </label>
                {review?.verdictReason ? <p>{review.verdictReason}</p> : <p>Run Polish to replace this with an AI-reviewed fit, gaps, and interview risks.</p>}
                {gaps.length ? (
                  <div className="application-match-card__gaps">
                    <strong>Top gaps</strong>
                    <div className="application-chip-list">
                      {gaps.slice(0, 5).map((gap) => (
                        <span key={gap.keyword}>{gap.keyword}</span>
                      ))}
                    </div>
                  </div>
                ) : null}
                <ul className="application-checks">
                  {compPreview ? <li><CheckCircle2 size={13} aria-hidden="true" /> {compPreview}</li> : null}
                  {form.location.trim() ? <li><CheckCircle2 size={13} aria-hidden="true" /> {form.location.trim()}</li> : null}
                  <li><CheckCircle2 size={13} aria-hidden="true" /> Stage: {STATUS_LABEL[form.status]}</li>
                </ul>
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
                    <div className="application-contact-row" key={index}>
                      <input className="text-input" value={contact.name ?? ""} onChange={(e) => updateContact(index, "name", e.target.value)} placeholder="Name" />
                      <input className="text-input" value={contact.title ?? ""} onChange={(e) => updateContact(index, "title", e.target.value)} placeholder="Title (Recruiter…)" />
                      <input className="text-input" value={contact.email ?? ""} onChange={(e) => updateContact(index, "email", e.target.value)} placeholder="Email" />
                      <input className="text-input" value={contact.phone ?? ""} onChange={(e) => updateContact(index, "phone", e.target.value)} placeholder="Phone" />
                      <button type="button" className="ghost-button is-icon" aria-label="Remove contact" onClick={() => removeContact(index)}>
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="application-muted">No contacts yet. Add a recruiter or interviewer.</p>
                )}
              </div>

              {review ? (
                <div className="application-review">
                  <h4><AlertTriangle size={14} aria-hidden="true" /> AI-flagged interview risks</h4>
                  {review.verdict ? (
                    <p className="application-review__verdict">
                      <strong>{review.verdict}</strong>
                      {review.verdictReason ? ` — ${review.verdictReason}` : ""}
                    </p>
                  ) : null}
                  {review.riskFlags?.length ? (
                    <ul className="application-review__list">
                      {review.riskFlags.map((flag, index) => (
                        <li key={index}>
                          <strong>{flag.risk}</strong>
                          {flag.suggestion ? <span>{flag.suggestion}</span> : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {review.recommendation?.coverLetterAngle ? (
                    <p className="application-muted"><strong>Angle:</strong> {review.recommendation.coverLetterAngle}</p>
                  ) : null}
                  {review.recommendation?.topEdits?.length ? (
                    <div className="application-review__edits">
                      <strong>Top edits before applying</strong>
                      <ul>
                        {review.recommendation.topEdits.map((edit, index) => (
                          <li key={index}>{edit}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="application-muted">No AI review snapshot yet. Apply after a Polish run to capture interview risks and recommended edits here.</p>
              )}
            </section>
          ) : null}

          {tab === "documents" ? (
            <section className="application-form application-form--wide">
              <div className="application-doc-card">
                <div className="application-doc-card__head">
                  <h4><FileText size={14} aria-hidden="true" /> Resume used</h4>
                  {application?.resumeUsed ? (
                    <span className={`application-stage application-stage--${application.resumeUsed === "tailored" ? "interviewing" : "applied"}`}>
                      {application.resumeUsed === "tailored" ? "Tailored draft" : "Base resume"}
                    </span>
                  ) : null}
                </div>
                {artifacts?.hasTex || artifacts?.hasPdf ? (
                  <>
                    <p className="application-muted">
                      Saved {artifacts.savedAt ? new Date(artifacts.savedAt).toLocaleDateString() : ""}
                      {artifacts.templateId ? ` · ${artifacts.templateId} template` : ""}.
                    </p>
                    <div className="application-doc-card__actions">
                      {artifacts.hasPdf ? (
                        <a className="primary-button is-compact" href={`/api/applications/${encodeURIComponent((application as Application).id)}/resume.pdf`} download={`${downloadBase}_Resume.pdf`}>
                          <Download size={14} aria-hidden="true" /> PDF
                        </a>
                      ) : null}
                      {artifacts.hasTex ? (
                        <a className="secondary-button is-compact" href={`/api/applications/${encodeURIComponent((application as Application).id)}/resume.tex`} download={`${downloadBase}_Resume.tex`}>
                          <Download size={14} aria-hidden="true" /> .tex
                        </a>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <p className="application-muted">
                    {isEdit
                      ? "No resume snapshot saved for this role yet. Open it in Polish, then use Apply to save the .tex and PDF that went out."
                      : "Save the application first, then apply a polished resume to attach its .tex and PDF here."}
                  </p>
                )}
              </div>

              <div className="application-doc-card">
                <div className="application-doc-card__head">
                  <h4><FileText size={14} aria-hidden="true" /> Cover letter</h4>
                  {application?.coverLetterText ? (
                    <button type="button" className="ghost-button is-compact" onClick={() => copyText(application.coverLetterText ?? "", "cover")}>
                      <Copy size={13} aria-hidden="true" /> {copied === "cover" ? "Copied" : copyFailed === "cover" ? "Copy failed" : "Copy"}
                    </button>
                  ) : null}
                </div>
                {application?.coverLetterText ? (
                  <pre className="application-doc-card__text">{application.coverLetterText}</pre>
                ) : (
                  <p className="application-muted">No saved cover letter. Generate one in Polish and use Apply to keep it here.</p>
                )}
              </div>
            </section>
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
                  <div className="application-qa" key={index}>
                    <div className="application-qa__head">
                      <input className="text-input" value={entry.question} onChange={(e) => updateAnswer(index, "question", e.target.value)} placeholder="Question the application asked…" />
                      <button type="button" className="ghost-button is-icon" aria-label="Remove question" onClick={() => removeAnswer(index)}>
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </div>
                    <textarea className="textarea" value={entry.answer} onChange={(e) => updateAnswer(index, "answer", e.target.value)} rows={4} placeholder="Your answer." />
                  </div>
                ))
              ) : (
                <p className="application-muted">No saved questions. Generate answers in the Application Questions tab and save them, or add one here manually.</p>
              )}
            </section>
          ) : null}
        </div>

        <footer className="application-modal__foot">
          <span>
            {isEdit
              ? "Edits save to the local tracker (job-search-workspace/applications.json)."
              : "Tip: attach the job description here, then use Job target to tailor."}
          </span>
          <div className="application-modal__actions">
            {isEdit && onDelete ? (
              <button type="button" className="secondary-button is-compact danger-button" onClick={() => onDelete((application as Application).id, (application as Application).title)}>
                <Trash2 size={14} aria-hidden="true" /> Delete
              </button>
            ) : null}
            <button type="button" className="secondary-button is-compact" onClick={onClose}>Close</button>
            <button type="button" className="primary-button is-compact" disabled={!canSave} onClick={() => save()}>
              {isEdit ? "Save changes" : "Save application"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
