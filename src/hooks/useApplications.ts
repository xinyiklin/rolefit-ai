import { useCallback, useEffect, useRef, useState } from "react";
import type { EvidenceType, MissingRequiredSkill, StrictReviewSeverity } from "../resumeEngine";
import { inferApplicationTitle, inferCompanyFromUrl } from "../lib/jobTarget";
import type { ExtractedJobTracking } from "../lib/jobExtract";
import type { ResumeData } from "../lib/resumeData";

export type ApplicationStatus = "interested" | "applied" | "interviewing" | "offer" | "rejected" | "withdrawn";

export const APPLICATION_STATUSES: ApplicationStatus[] = [
  "interested",
  "applied",
  "interviewing",
  "offer",
  "rejected",
  "withdrawn"
];

export type ApplicationSource = "" | "LinkedIn" | "Company site" | "Referral" | "Job board" | "Recruiter" | "Other";

export const APPLICATION_SOURCES: ApplicationSource[] = [
  "",
  "LinkedIn",
  "Company site",
  "Referral",
  "Job board",
  "Recruiter",
  "Other"
];

// Snapshot of the recruiter (strict) review captured when a role is applied, so
// the pipeline remembers the verdict, interview risks, and gaps per application.
export type ApplicationReviewGap = {
  gap: string;
  severity: StrictReviewSeverity | string;
  evidenceType?: EvidenceType;
  canHonestlyAdd?: boolean;
  evidence?: string;
  suggestedEdit?: string;
};

export type ApplicationReview = {
  verdict: string;
  verdictReason: string;
  riskFlags: { risk: string; suggestion: string }[];
  gaps: ApplicationReviewGap[];
  recommendation: { applyAsIs: boolean; reason: string; coverLetterAngle: string; topEdits: string[] };
};

// A drafted application-question answer (or per-role description) the user chose
// to save with this application from the Application Questions tab.
export type ApplicationAnswer = {
  question: string;
  answer: string;
  savedAt: string;
};

// A recruiter / interviewer / referral contact recorded on an application.
export type ApplicationContact = {
  name?: string;
  title?: string;
  email?: string;
  phone?: string;
};

export type ApplicationPriority = "High" | "Medium" | "Low";
export type SalaryPeriod = "yr" | "mo" | "hr";

export const JOB_TYPES = ["Full-time", "Part-time", "Contract", "Internship", "Temporary"] as const;

// Metadata for the resume that actually went out, snapshotted to gitignored
// files at <workspace>/applications/<id>/resume.{tex,pdf} when the role is
// applied. The bytes live on disk; this record only remembers what exists so
// the detail modal can offer re-downloads.
export type ResumeArtifacts = {
  hasTex: boolean;
  hasPdf: boolean;
  fileName?: string;
  templateId?: string;
  savedAt?: string;
};

export type Application = {
  id: string;
  title: string;
  company?: string;
  role?: string;
  roleDescription?: string;
  source?: ApplicationSource;
  jobUrl: string;
  jobDescription?: string;
  status: ApplicationStatus;
  createdAt: string;
  appliedAt?: string;
  updatedAt: string;
  followupAt?: string;
  // Application deadline (ISO date) — distinct from followupAt (next personal step).
  deadline?: string;
  notes?: string;
  // Basic job metadata captured in the detail modal.
  location?: string;
  jobType?: string;
  workAuth?: string;
  // Explicit priority override; when unset the UI derives it from fit + stage.
  priority?: ApplicationPriority;
  // Compensation, as advertised or negotiated. Stored as plain integers in the
  // chosen currency; min/max may be set independently.
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string;
  salaryPeriod?: SalaryPeriod;
  // Free-text interview prep the user keeps for this role (the review snapshot
  // below supplies the AI-derived risks/gaps that complement these notes).
  interviewTips?: string;
  contacts?: ApplicationContact[];
  fitScore?: number | null;
  // Before/after fit captured at Apply time: the original (base) resume vs. the
  // tailored draft, so the pipeline can show the lift tailoring produced.
  baseFitScore?: number | null;
  tailoredFitScore?: number | null;
  // Which engine produced the pair, so a restored local estimate isn't shown as
  // AI-judged after reload.
  fitScoreSource?: "ai" | "local" | null;
  templateId?: string;
  // Structured editor snapshot captured at Apply time. `polishedText` stays as
  // the plain-text compatibility/search field; this restores the exact editor
  // model without re-inferring section types from text.
  resumeData?: ResumeData;
  polishedText?: string;
  coverLetterText?: string;
  review?: ApplicationReview;
  missingRequiredSkills?: MissingRequiredSkill[];
  // Which resume actually went out — the AI-tailored draft or the original/base
  // (the AI may judge the base already a strong fit). Captured at Apply time.
  resumeUsed?: "tailored" | "base";
  // Metadata for the .tex / .pdf snapshot saved to the workspace at Apply time.
  resumeArtifacts?: ResumeArtifacts;
  // Application-question answers the user saved from the Application Questions tab.
  applicationAnswers?: ApplicationAnswer[];
};

// Build the common skeleton for a new pipeline entry from the current job
// target. Both the "Apply" and "Save answers" paths start here and
// then add their own fields (fit scores / review, or saved answers), so the
// shared shape — id, inferred title/company, trimmed job target, default
// status, timestamps — lives in one place and cannot drift between them.
// crypto.randomUUID exists only in secure contexts (https / localhost). Served
// over a LAN IP or plain http it is undefined and would throw, so fall back to a
// unique-enough id for these client-side pipeline keys.
function newApplicationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `app_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function cleanDraftString(value: unknown, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function cleanDraftSource(value: unknown): ApplicationSource {
  return APPLICATION_SOURCES.includes(value as ApplicationSource) ? (value as ApplicationSource) : "";
}

export function makeApplicationDraft(
  jobUrl: string,
  jobDescription: string,
  metadata: ExtractedJobTracking = {}
): Application {
  const now = new Date().toISOString();
  const role = cleanDraftString(metadata.role || metadata.title);
  const company = cleanDraftString(metadata.company);
  const source = cleanDraftSource(metadata.source);
  const draft: Application = {
    id: newApplicationId(),
    title: [role, company].filter(Boolean).join(" at ") || inferApplicationTitle(jobUrl, jobDescription),
    company: company || inferCompanyFromUrl(jobUrl),
    role,
    source,
    jobUrl: jobUrl.trim(),
    jobDescription: jobDescription.trim(),
    status: "interested",
    createdAt: now,
    updatedAt: now
  };

  const roleDescription = cleanDraftString(metadata.roleDescription, 2_000);
  const location = cleanDraftString(metadata.location);
  const jobType = cleanDraftString(metadata.jobType, 60);
  const workAuth = cleanDraftString(metadata.workAuth, 80);
  if (roleDescription) draft.roleDescription = roleDescription;
  if (location) draft.location = location;
  if (jobType) draft.jobType = jobType;
  if (workAuth) draft.workAuth = workAuth;
  if (typeof metadata.salaryMin === "number") draft.salaryMin = metadata.salaryMin;
  if (typeof metadata.salaryMax === "number") draft.salaryMax = metadata.salaryMax;
  if (metadata.salaryCurrency) draft.salaryCurrency = cleanDraftString(metadata.salaryCurrency, 8);
  if (metadata.salaryPeriod) draft.salaryPeriod = metadata.salaryPeriod;
  return draft;
}

// Derive a missing-required-skills list for a saved application: prefer the
// explicitly stored list, else reconstruct it from the snapshotted review gaps
// (treating an exact, addable gap as "exact" evidence and the rest as "none").
export function missingRequiredSkillsFromApplication(app: Application): MissingRequiredSkill[] | undefined {
  if (app.missingRequiredSkills?.length) return app.missingRequiredSkills;
  const derived = app.review?.gaps
    ?.filter((gap) => gap.gap)
    .map((gap) => {
      const evidenceType = gap.evidenceType ?? (gap.canHonestlyAdd ? "exact" : "none");
      return {
        keyword: gap.gap,
        evidenceType,
        canHonestlyAdd: evidenceType === "exact" && Boolean(gap.canHonestlyAdd),
        reason: gap.evidence || gap.suggestedEdit || (gap.severity ? `${gap.severity} gap` : "")
      };
    });
  return derived?.length ? derived : undefined;
}

function sameApplicationTarget(a: Application, incoming: Application) {
  const incomingUrl = incoming.jobUrl.trim();
  if (incomingUrl && a.jobUrl.trim() === incomingUrl) return true;

  const incomingDescription = (incoming.jobDescription ?? "").trim();
  return Boolean(
    !incomingUrl &&
    incomingDescription &&
    !a.jobUrl.trim() &&
    (a.jobDescription ?? "").trim() === incomingDescription
  );
}

type EditableField = "title" | "company" | "role" | "source" | "notes" | "followupAt" | "jobUrl";

export function useApplications() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [storagePath, setStoragePath] = useState("");
  const persistVersion = useRef(0);
  const persistQueue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/applications");
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error ?? "Failed to load applications.");
        setApplications(Array.isArray(data.applications) ? data.applications : []);
        setStoragePath(typeof data.path === "string" ? data.path : "");
        setError("");
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load applications.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(async (next: Application[], previous: Application[]) => {
    const requestId = persistVersion.current + 1;
    persistVersion.current = requestId;
    const write = persistQueue.current.catch(() => undefined).then(async () => {
      const res = await fetch("/api/applications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applications: next })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed.");
      return data;
    });
    persistQueue.current = write.then(
      () => undefined,
      () => undefined
    );

    try {
      const data = await write;
      // Trust the server-sanitized list back
      if (requestId === persistVersion.current) {
        if (Array.isArray(data.applications)) setApplications(data.applications);
        setError("");
      }
    } catch (err) {
      if (requestId === persistVersion.current) {
        setApplications(previous);
        setError(err instanceof Error ? err.message : "Save failed.");
      }
    }
  }, []);

  const upsert = useCallback(
    (incoming: Application) => {
      setApplications((current) => {
        const now = new Date().toISOString();
        const idx = current.findIndex((a) => a.id === incoming.id || sameApplicationTarget(a, incoming));
        const merged: Application = idx >= 0
          ? {
              ...current[idx],
              ...incoming,
              id: current[idx].id,
              title: current[idx].title || incoming.title,
              company: current[idx].company || incoming.company,
              role: current[idx].role || incoming.role,
              source: current[idx].source || incoming.source,
              jobUrl: incoming.jobUrl || current[idx].jobUrl,
              jobDescription: incoming.jobDescription || current[idx].jobDescription,
              updatedAt: now,
              createdAt: current[idx].createdAt
            }
          : { ...incoming, createdAt: now, updatedAt: now };

        const next = idx >= 0
          ? current.map((a, i) => (i === idx ? merged : a))
          : [merged, ...current];

        void persist(next, current);
        return next;
      });
    },
    [persist]
  );

  // Full overwrite of one application by id (the detail/add modal's save path).
  // Unlike `upsert` — which deliberately preserves existing non-empty title /
  // company / role / source for the Apply + save-answers dedup flow — this lets
  // the user actually edit those fields. Incoming wins for every field; only id
  // and createdAt are pinned. A new id (no match) is prepended.
  const saveApplication = useCallback(
    (incoming: Application) => {
      setApplications((current) => {
        const now = new Date().toISOString();
        const idx = current.findIndex((a) => a.id === incoming.id);
        const merged: Application =
          idx >= 0
            ? { ...current[idx], ...incoming, id: current[idx].id, createdAt: current[idx].createdAt, updatedAt: now }
            : { ...incoming, createdAt: incoming.createdAt || now, updatedAt: now };
        const next = idx >= 0 ? current.map((a, i) => (i === idx ? merged : a)) : [merged, ...current];
        void persist(next, current);
        return next;
      });
    },
    [persist]
  );

  // Merge a partial patch into one application by id (used to attach the saved
  // resume-artifact metadata after Apply renders the .tex/.pdf). No-ops if the
  // id is gone. The persistVersion guard in `persist` makes the later artifact
  // write win over the in-flight pre-artifact Apply write.
  const patchApplication = useCallback(
    (id: string, patch: Partial<Application>) => {
      setApplications((current) => {
        const idx = current.findIndex((a) => a.id === id);
        if (idx < 0) return current;
        const next = current.map((a, i) =>
          i === idx ? { ...a, ...patch, id: a.id, updatedAt: new Date().toISOString() } : a
        );
        void persist(next, current);
        return next;
      });
    },
    [persist]
  );

  const updateStatus = useCallback(
    (id: string, status: ApplicationStatus) => {
      setApplications((current) => {
        const now = new Date().toISOString();
        const next = current.map((a) =>
          a.id === id
            ? {
                ...a,
                status,
                updatedAt: now,
                appliedAt: status === "applied" && !a.appliedAt ? now : a.appliedAt
              }
            : a
        );
        void persist(next, current);
        return next;
      });
    },
    [persist]
  );

  const updateNotes = useCallback(
    (id: string, notes: string) => {
      setApplications((current) => {
        const next = current.map((a) =>
          a.id === id ? { ...a, notes, updatedAt: new Date().toISOString() } : a
        );
        void persist(next, current);
        return next;
      });
    },
    [persist]
  );

  const updateField = useCallback(
    (id: string, field: EditableField, value: string) => {
      setApplications((current) => {
        const next = current.map((a) =>
          a.id === id ? { ...a, [field]: value, updatedAt: new Date().toISOString() } : a
        );
        void persist(next, current);
        return next;
      });
    },
    [persist]
  );

  const remove = useCallback(
    (id: string) => {
      setApplications((current) => {
        const next = current.filter((a) => a.id !== id);
        void persist(next, current);
        return next;
      });
    },
    [persist]
  );

  // Find an existing application matching the current job target — by URL when
  // present, else by exact job-description text for link-less entries. Shared by
  // the "Apply" and "Save answers" paths so both update in place
  // rather than creating duplicate rows.
  const findForTarget = useCallback(
    (targetUrl: string, targetDescription: string) => {
      const trimmedUrl = targetUrl.trim();
      const trimmedDescription = targetDescription.trim();
      return trimmedUrl
        ? applications.find((a) => a.jobUrl.trim() === trimmedUrl)
        : applications.find(
            (a) => !a.jobUrl.trim() && trimmedDescription && (a.jobDescription ?? "").trim() === trimmedDescription
          );
    },
    [applications]
  );

  return {
    applications,
    isLoading,
    error,
    storagePath,
    upsert,
    saveApplication,
    patchApplication,
    updateStatus,
    updateNotes,
    updateField,
    remove,
    findForTarget
  };
}
