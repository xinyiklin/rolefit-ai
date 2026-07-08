import { useCallback, useEffect, useRef, useState } from "react";
import type { EvidenceType, MissingRequiredSkill, StrictReviewSeverity } from "../resumeEngine";
import { inferApplicationTitle, inferCompanyFromUrl } from "../lib/jobTarget";
import { sourceFromUrl, type ExtractedJobTracking } from "../lib/jobExtract";
import type { ResumeData } from "../lib/resumeData";
import { dedupeSourceUrls, normalizeJobUrl, findDuplicateApplications } from "../lib/jobIdentity";
import type { DuplicateTarget } from "../lib/jobIdentity";
import type { ApplicationAiUsage } from "../lib/aiUsage";

export type { ApplicationAiUsage, StageAiUsage } from "../lib/aiUsage";

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
  // Additional discovered URLs for this same posting beyond the primary jobUrl
  // (e.g. the same role seen on LinkedIn and later on the company's ATS). Capped
  // at 10; deduped by normalized URL. Lets duplicate detection match a record no
  // matter which board the user is currently looking at.
  sourceUrls?: { url: string; source?: string; addedAt: string }[];
  // Raw pre-distill posting text, kept ONLY when it differs from jobDescription
  // (the distilled brief) — avoids storing the same text twice.
  rawJobDescription?: string;
  // Per-stage AI usage snapshot (distill/tailor/review/cover), captured at Apply
  // time. Whole-map-replace on upsert — an incoming snapshot always wins, no
  // deep per-stage merge.
  aiUsage?: ApplicationAiUsage;
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

// EXACT-tier only: these two drive SILENT merges (Apply + Save answers), so
// they must never widen to the fuzzy/layered matching findDuplicatesForTarget
// below performs — only the URL-equality check itself is normalize-aware (so a
// tracking-param variant of the same link still counts as the same target).
function sameApplicationTarget(a: Application, incoming: Application) {
  const incomingUrl = incoming.jobUrl.trim();
  const aUrl = a.jobUrl.trim();
  if (incomingUrl && aUrl && normalizeJobUrl(aUrl) === normalizeJobUrl(incomingUrl)) return true;

  const incomingDescription = (incoming.jobDescription ?? "").trim();
  return Boolean(
    !incomingUrl &&
    incomingDescription &&
    !aUrl &&
    (a.jobDescription ?? "").trim() === incomingDescription
  );
}

const MAX_SOURCE_URLS = 10;

// Union existing.sourceUrls + incoming.sourceUrls + whichever of the two
// records' primary jobUrl is non-empty and is NOT the final merged primary —
// so a URL that used to be primary (or an incoming primary that lost to the
// existing one) is still remembered as an alternate posting location. The
// dedup/cap/earliest-addedAt rules live in the shared dedupeSourceUrls (one
// implementation with the group-merge path and the server sanitizer).
function mergeSourceUrls(existing: Application, incoming: Application, now: string) {
  const finalPrimary = (incoming.jobUrl || existing.jobUrl).trim();
  const candidates: { url?: string; source?: string; addedAt?: string }[] = [
    ...(existing.sourceUrls ?? []),
    ...(incoming.sourceUrls ?? []),
    ...[existing.jobUrl, incoming.jobUrl]
      .map((rawUrl) => (rawUrl ?? "").trim())
      .filter(Boolean)
      .map((url) => ({ url, source: sourceFromUrl(url) || undefined, addedAt: now }))
  ];
  const result = dedupeSourceUrls(candidates, finalPrimary, now, MAX_SOURCE_URLS);
  return result.length ? result : undefined;
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

  // `deleteIds` names records this write REMOVES. The server's read-merge
  // resurrects on-disk entries missing from the request (multi-tab protection),
  // so a deleting operation (the duplicate merge) must list them explicitly —
  // sending a shorter list alone would be silently undone.
  const persist = useCallback(async (next: Application[], previous: Application[], deleteIds?: string[]) => {
    const requestId = persistVersion.current + 1;
    persistVersion.current = requestId;
    const write = persistQueue.current.catch(() => undefined).then(async () => {
      const res = await fetch("/api/applications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applications: next, ...(deleteIds?.length ? { deleteIds } : {}) })
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
              rawJobDescription: incoming.rawJobDescription || current[idx].rawJobDescription,
              sourceUrls: mergeSourceUrls(current[idx], incoming, now),
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
      // Snapshot the pre-delete list so a failed DELETE can roll back (same
      // contract as `persist`, which restores `previous` on error).
      let snapshot: Application[] = [];
      setApplications((current) => {
        snapshot = current;
        return current.filter((a) => a.id !== id);
      });
      const requestId = ++persistVersion.current;
      const write = persistQueue.current.catch(() => undefined).then(async () => {
        const res = await fetch(`/api/applications/${encodeURIComponent(id)}`, { method: "DELETE" });
        const data = await res.json();
        // 404 = already deleted (e.g. by another tab) — the optimistic removal
        // is correct, so treat it as success rather than rolling back.
        if (!res.ok && res.status !== 404) throw new Error(data.error ?? "Delete failed.");
        return data;
      });
      persistQueue.current = write.then(() => undefined, () => undefined);
      void write.then(
        (data) => {
          if (requestId === persistVersion.current && Array.isArray(data.applications)) {
            setApplications(data.applications);
          }
        },
        (err) => {
          if (requestId === persistVersion.current) {
            setApplications(snapshot);
            setError(err instanceof Error ? err.message : "Delete failed.");
          }
        }
      );
    },
    []
  );

  // Find an existing application matching the current job target — by
  // normalized URL when present, else by exact job-description text for
  // link-less entries. Shared by the "Apply" and "Save answers" paths so both
  // update in place rather than creating duplicate rows. EXACT-tier only — see
  // sameApplicationTarget.
  const findForTarget = useCallback(
    (targetUrl: string, targetDescription: string) => {
      const trimmedUrl = targetUrl.trim();
      const trimmedDescription = targetDescription.trim();
      if (!trimmedUrl) {
        return applications.find(
          (a) => !a.jobUrl.trim() && trimmedDescription && (a.jobDescription ?? "").trim() === trimmedDescription
        );
      }
      const normTarget = normalizeJobUrl(trimmedUrl);
      return applications.find((a) => a.jobUrl.trim() && normalizeJobUrl(a.jobUrl.trim()) === normTarget);
    },
    [applications]
  );

  // Layered duplicate scan (same-posting/repost/same-company-role, tiered
  // confidence) against every stored application — see src/lib/jobIdentity.ts.
  // Unlike findForTarget, this NEVER drives a silent merge on its own; callers
  // decide what to do with "high"/"possible" matches (e.g. App.tsx's apply-time
  // warning dialog).
  const findDuplicatesForTarget = useCallback(
    (target: DuplicateTarget) => findDuplicateApplications(target, applications),
    [applications]
  );

  // Merge a duplicate group into one canonical record: keep the canonical's
  // fields, absorb every other member's discovered URLs as sourceUrls, adopt the
  // earliest createdAt, backfill rawJobDescription/aiUsage only when the canonical
  // lacks them, then delete the other members. Destructive (removes rows) — the
  // caller confirms first. No-ops on an unknown canonicalId or a <2 member set,
  // so a stale group (already merged in another tab) can't drop data.
  const mergeApplications = useCallback(
    (memberIds: string[], canonicalId: string) => {
      setApplications((current) => {
        const ids = new Set(memberIds);
        const members = current.filter((a) => ids.has(a.id));
        const canonical = members.find((a) => a.id === canonicalId);
        if (!canonical || members.length < 2) return current;
        const now = new Date().toISOString();
        const others = members.filter((a) => a.id !== canonicalId);

        // Union sourceUrls: every member's sourceUrls + every non-canonical
        // member's primary jobUrl. Dedup/primary-exclusion/cap/earliest-addedAt
        // rules live in the shared dedupeSourceUrls (one implementation with
        // the upsert merge and the server sanitizer).
        const candidates: { url?: string; source?: string; addedAt?: string }[] = [
          ...members.flatMap((member) => member.sourceUrls ?? []),
          ...others
            .map((member) => (member.jobUrl ?? "").trim())
            .filter(Boolean)
            .map((url) => ({ url, source: sourceFromUrl(url) || undefined, addedAt: now }))
        ];
        const deduped = dedupeSourceUrls(candidates, canonical.jobUrl, now, MAX_SOURCE_URLS);
        const sourceUrls = deduped.length ? deduped : undefined;

        // ISO timestamps sort lexically, so min() is a plain string comparison.
        const earliestCreatedAt = members
          .map((m) => m.createdAt)
          .filter(Boolean)
          .sort()[0] || canonical.createdAt;

        const merged: Application = {
          ...canonical,
          sourceUrls,
          rawJobDescription: canonical.rawJobDescription || others.find((m) => m.rawJobDescription)?.rawJobDescription,
          aiUsage: canonical.aiUsage ?? others.find((m) => m.aiUsage)?.aiUsage,
          createdAt: earliestCreatedAt,
          updatedAt: now
        };

        const next = current
          .filter((a) => !ids.has(a.id) || a.id === canonicalId)
          .map((a) => (a.id === canonicalId ? merged : a));
        // Name the removed members explicitly — without deleteIds the server's
        // multi-tab read-merge would resurrect them from disk on this very write.
        void persist(next, current, others.map((a) => a.id));
        return next;
      });
    },
    [persist]
  );

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/applications");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load applications.");
      setApplications(Array.isArray(data.applications) ? data.applications : []);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load applications.");
    }
  }, []);

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
    findForTarget,
    findDuplicatesForTarget,
    mergeApplications,
    refresh
  };
}
