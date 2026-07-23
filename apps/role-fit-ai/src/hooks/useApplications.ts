import { useCallback, useEffect, useRef, useState } from "react";
import type { EvidenceType, MissingRequiredSkill, StrictReviewSeverity } from "../resumeEngine";
import { inferApplicationTitle, inferCompanyFromUrl } from "../lib/jobTarget";
import { sourceFromUrl, type ExtractedJobTracking } from "../lib/jobExtract";
import type { ResumeData } from "@typeset/engine/lib/resumeData.ts";
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

// Metadata for the resume that actually went out, snapshotted to a gitignored
// file at <workspace>/applications/<id>/resume.pdf when the role is applied.
// The bytes live on disk; this record only remembers what exists so the
// detail modal can offer re-downloads.
export type ResumeArtifacts = {
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
  // Which engine produced the pair. "local" is accepted only for backward
  // compatibility with saved records and is never restored as an AI judgment.
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
  // Metadata for the PDF snapshot saved to the workspace at Apply time.
  resumeArtifacts?: ResumeArtifacts;
  // Application-question answers the user saved from the Application Questions tab.
  applicationAnswers?: ApplicationAnswer[];
  // Stable tracker ids the user reviewed and explicitly kept separate from this
  // application. Either side of a pair may carry the decision.
  duplicateDismissedIds?: string[];
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

type ApplicationMutation = {
  id: string;
  operation: "upsert" | "delete";
  baseUpdatedAt: string | null;
};

class ApplicationConflictError extends Error {
  applications: Application[];

  constructor(message: string, applications: Application[]) {
    super(message);
    this.name = "ApplicationConflictError";
    this.applications = applications;
  }
}

export function useApplications() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [storagePath, setStoragePath] = useState("");
  const [pendingWrites, setPendingWrites] = useState(0);
  // Synchronous source for optimistic mutations. Keeping mutation side effects
  // out of React state-updater callbacks avoids duplicate writes under Strict
  // Mode and lets callers await the exact write they initiated.
  const applicationsRef = useRef<Application[]>([]);
  const persistVersion = useRef(0);
  const persistQueue = useRef<Promise<void>>(Promise.resolve());
  // Last server-confirmed snapshot, updated after every successful queued
  // write (even when a newer optimistic write is already pending). Rolling a
  // failed latest write back to its immediate `previous` state can resurrect
  // an earlier optimistic edit whose own request also failed. This ref always
  // represents the durable state we can safely return to.
  const confirmedApplications = useRef<Application[]>([]);
  const conflictMessage = useRef("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loadVersion = persistVersion.current;
      try {
        const res = await fetch("/api/applications");
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error ?? "Failed to load applications.");
        // A mutation started while the initial GET was in flight. Its queued
        // write/rollback is now authoritative; never replace it with this older
        // read snapshot.
        if (loadVersion !== persistVersion.current) return;
        const loaded = Array.isArray(data.applications) ? data.applications : [];
        confirmedApplications.current = loaded;
        applicationsRef.current = loaded;
        setApplications(loaded);
        setStoragePath(typeof data.path === "string" ? data.path : "");
        conflictMessage.current = "";
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

  // Every changed record carries the revision this tab started from. The server
  // preserves unmutated disk rows and rejects a stale same-record edit with 409,
  // preventing one tab from silently overwriting a newer edit in another.
  const persist = useCallback(async (next: Application[], mutations: ApplicationMutation[]) => {
    setPendingWrites((count) => count + 1);
    // A mutation started after a surfaced conflict is an explicit user retry.
    // Clear the prior notice then; already-queued writes do not pass this branch
    // after the conflict arrives, so they cannot silently erase the warning.
    if (conflictMessage.current) {
      conflictMessage.current = "";
      setError("");
    }
    const requestId = persistVersion.current + 1;
    persistVersion.current = requestId;
    const write = persistQueue.current.catch(() => undefined).then(async () => {
      const res = await fetch("/api/applications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applications: next, mutations })
      });
      const data = await res.json();
      if (!res.ok) {
        const message = typeof data.error === "string" ? data.error : "Save failed.";
        if (res.status === 409 && Array.isArray(data.applications)) {
          throw new ApplicationConflictError(message, data.applications);
        }
        throw new Error(message);
      }
      if (!Array.isArray(data.applications)) throw new Error("Save returned an invalid applications list.");
      return data;
    });
    persistQueue.current = write.then(
      () => undefined,
      () => undefined
    );

    try {
      const data = await write;
      confirmedApplications.current = data.applications;
      // Trust the server-sanitized list back
      if (requestId === persistVersion.current) {
        applicationsRef.current = data.applications;
        setApplications(data.applications);
        setError(conflictMessage.current);
      }
      return true;
    } catch (err) {
      if (err instanceof ApplicationConflictError) {
        confirmedApplications.current = err.applications;
        conflictMessage.current = err.message;
        setError(err.message);
      }
      if (requestId === persistVersion.current) {
        applicationsRef.current = confirmedApplications.current;
        setApplications(confirmedApplications.current);
        setError(conflictMessage.current || (err instanceof Error ? err.message : "Save failed."));
      }
      return false;
    } finally {
      setPendingWrites((count) => Math.max(0, count - 1));
    }
  }, []);

  const upsert = useCallback(
    (incoming: Application) => {
      const current = applicationsRef.current;
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
      applicationsRef.current = next;
      setApplications(next);
      return persist(next, [{
        id: merged.id,
        operation: "upsert",
        baseUpdatedAt: idx >= 0 ? current[idx].updatedAt : null
      }]);
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
      const current = applicationsRef.current;
      const now = new Date().toISOString();
      const idx = current.findIndex((a) => a.id === incoming.id);
      const merged: Application =
        idx >= 0
          ? { ...current[idx], ...incoming, id: current[idx].id, createdAt: current[idx].createdAt, updatedAt: now }
          : { ...incoming, createdAt: incoming.createdAt || now, updatedAt: now };
      const next = idx >= 0 ? current.map((a, i) => (i === idx ? merged : a)) : [merged, ...current];
      applicationsRef.current = next;
      setApplications(next);
      return persist(next, [{
        id: merged.id,
        operation: "upsert",
        baseUpdatedAt: idx >= 0 ? current[idx].updatedAt : null
      }]);
    },
    [persist]
  );

  // Merge a partial patch into one application by id (used to attach the saved
  // resume-artifact metadata after Apply renders the PDF). No-ops if the
  // id is gone. The persistVersion guard in `persist` makes the later artifact
  // write win over the in-flight pre-artifact Apply write.
  const patchApplication = useCallback(
    (id: string, patch: Partial<Application>) => {
      const current = applicationsRef.current;
      const idx = current.findIndex((a) => a.id === id);
      if (idx < 0) return;
      const next = current.map((a, i) =>
        i === idx ? { ...a, ...patch, id: a.id, updatedAt: new Date().toISOString() } : a
      );
      applicationsRef.current = next;
      setApplications(next);
      void persist(next, [{ id, operation: "upsert", baseUpdatedAt: current[idx].updatedAt }]);
    },
    [persist]
  );

  const updateStatus = useCallback(
    (id: string, status: ApplicationStatus) => {
      const current = applicationsRef.current;
      const existing = current.find((a) => a.id === id);
      if (!existing) return;
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
      applicationsRef.current = next;
      setApplications(next);
      void persist(next, [{ id, operation: "upsert", baseUpdatedAt: existing.updatedAt }]);
    },
    [persist]
  );

  const updateNotes = useCallback(
    (id: string, notes: string) => {
      const current = applicationsRef.current;
      const existing = current.find((a) => a.id === id);
      if (!existing) return;
      const next = current.map((a) =>
        a.id === id ? { ...a, notes, updatedAt: new Date().toISOString() } : a
      );
      applicationsRef.current = next;
      setApplications(next);
      void persist(next, [{ id, operation: "upsert", baseUpdatedAt: existing.updatedAt }]);
    },
    [persist]
  );

  const updateField = useCallback(
    (id: string, field: EditableField, value: string) => {
      const current = applicationsRef.current;
      const existing = current.find((a) => a.id === id);
      if (!existing) return;
      const next = current.map((a) =>
        a.id === id ? { ...a, [field]: value, updatedAt: new Date().toISOString() } : a
      );
      applicationsRef.current = next;
      setApplications(next);
      void persist(next, [{ id, operation: "upsert", baseUpdatedAt: existing.updatedAt }]);
    },
    [persist]
  );

  const remove = useCallback(
    (id: string) => {
      const current = applicationsRef.current;
      const existing = current.find((a) => a.id === id);
      if (!existing) return;
      const next = current.filter((a) => a.id !== id);
      applicationsRef.current = next;
      setApplications(next);
      // Use the same serialized full-snapshot write as every other mutation
      // and name the deletion explicitly. This also means a delete queued after
      // an optimistic edit carries that edit's revision instead of silently
      // removing a newer server record.
      void persist(next, [{ id, operation: "delete", baseUpdatedAt: existing.updatedAt }]);
    },
    [persist]
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
      const current = applicationsRef.current;
      const ids = new Set(memberIds);
      const members = current.filter((a) => ids.has(a.id));
      const canonical = members.find((a) => a.id === canonicalId);
      if (!canonical || members.length < 2) return;
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

      const inheritedDismissals = Array.from(
        new Set(members.flatMap((member) => member.duplicateDismissedIds ?? []))
      ).filter((id) => !ids.has(id));
      const merged: Application = {
        ...canonical,
        sourceUrls,
        rawJobDescription: canonical.rawJobDescription || others.find((m) => m.rawJobDescription)?.rawJobDescription,
        aiUsage: canonical.aiUsage ?? others.find((m) => m.aiUsage)?.aiUsage,
        duplicateDismissedIds: inheritedDismissals.length ? inheritedDismissals : undefined,
        createdAt: earliestCreatedAt,
        updatedAt: now
      };

      const next = current
        .filter((a) => !ids.has(a.id) || a.id === canonicalId)
        .map((a) => (a.id === canonicalId ? merged : a));
      applicationsRef.current = next;
      setApplications(next);
      void persist(next, [
        { id: canonical.id, operation: "upsert", baseUpdatedAt: canonical.updatedAt },
        ...others.map((application): ApplicationMutation => ({
          id: application.id,
          operation: "delete",
          baseUpdatedAt: application.updatedAt
        }))
      ]);
    },
    [persist]
  );

  // Persist the user's review decision for every pair in a duplicate cluster.
  // The matcher treats a decision recorded on either record as sufficient, but
  // writing it symmetrically keeps the decision intact if one row is later
  // deleted or merged.
  const dismissDuplicateGroup = useCallback(
    (memberIds: string[]) => {
      const current = applicationsRef.current;
      const requestedIds = new Set(memberIds);
      const members = current.filter((application) => requestedIds.has(application.id));
      if (members.length < 2) return;

      const memberIdSet = new Set(members.map((application) => application.id));
      const now = new Date().toISOString();
      const mutations: ApplicationMutation[] = [];
      const next = current.map((application) => {
        if (!memberIdSet.has(application.id)) return application;
        const dismissed = new Set(application.duplicateDismissedIds ?? []);
        for (const otherId of memberIdSet) {
          if (otherId !== application.id) dismissed.add(otherId);
        }
        mutations.push({
          id: application.id,
          operation: "upsert",
          baseUpdatedAt: application.updatedAt
        });
        return {
          ...application,
          duplicateDismissedIds: [...dismissed],
          updatedAt: now
        };
      });

      applicationsRef.current = next;
      setApplications(next);
      void persist(next, mutations);
    },
    [persist]
  );

  const refresh = useCallback(async () => {
    try {
      // A GET racing an older queued PUT can finish last with the pre-write
      // snapshot and make a successful local edit appear to vanish. Read only
      // after this tab's queued mutations have settled.
      await persistQueue.current.catch(() => undefined);
      const refreshVersion = persistVersion.current;
      const res = await fetch("/api/applications");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load applications.");
      // A new mutation began after the queue wait. Its persist response (or
      // rollback) owns state; this GET may have observed the pre-mutation disk
      // snapshot and must not overwrite it.
      if (refreshVersion !== persistVersion.current) return;
      const loaded = Array.isArray(data.applications) ? data.applications : [];
      confirmedApplications.current = loaded;
      applicationsRef.current = loaded;
      setApplications(loaded);
      conflictMessage.current = "";
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
    pendingWrites,
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
    dismissDuplicateGroup,
    refresh
  };
}
