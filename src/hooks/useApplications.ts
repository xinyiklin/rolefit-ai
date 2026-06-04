import { useCallback, useEffect, useRef, useState } from "react";
import type { EvidenceType, MissingRequiredSkill, StrictReviewSeverity } from "../resumeEngine";
import { inferApplicationTitle, inferCompanyFromUrl } from "../lib/jobTarget";

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

// Snapshot of the recruiter (strict) review captured when a role is tracked, so
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

export type Application = {
  id: string;
  title: string;
  company?: string;
  role?: string;
  source?: ApplicationSource;
  jobUrl: string;
  jobDescription?: string;
  status: ApplicationStatus;
  createdAt: string;
  appliedAt?: string;
  updatedAt: string;
  followupAt?: string;
  notes?: string;
  fitScore?: number | null;
  // Before/after fit captured at Track time: the original (base) resume vs. the
  // tailored draft, so the pipeline can show the lift tailoring produced.
  baseFitScore?: number | null;
  tailoredFitScore?: number | null;
  // Which engine produced the pair, so a restored local estimate isn't shown as
  // AI-judged after reload.
  fitScoreSource?: "ai" | "local" | null;
  templateId?: string;
  polishedText?: string;
  coverLetterText?: string;
  review?: ApplicationReview;
  missingRequiredSkills?: MissingRequiredSkill[];
  // Which resume actually went out — the AI-tailored draft or the original/base
  // (the AI may judge the base already a strong fit). Captured at Track time.
  resumeUsed?: "tailored" | "base";
  // Application-question answers the user saved from the Application Questions tab.
  applicationAnswers?: ApplicationAnswer[];
};

// Build the common skeleton for a new pipeline entry from the current job
// target. Both the "Track in pipeline" and "Save answers" paths start here and
// then add their own fields (fit scores / review, or saved answers), so the
// shared shape — id, inferred title/company, trimmed job target, default
// status, timestamps — lives in one place and cannot drift between them.
export function makeApplicationDraft(jobUrl: string, jobDescription: string): Application {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: inferApplicationTitle(jobUrl, jobDescription),
    company: inferCompanyFromUrl(jobUrl),
    role: "",
    source: "",
    jobUrl: jobUrl.trim(),
    jobDescription: jobDescription.trim(),
    status: "interested",
    createdAt: now,
    updatedAt: now
  };
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
    try {
      const res = await fetch("/api/applications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applications: next })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed.");
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

  return {
    applications,
    isLoading,
    error,
    storagePath,
    upsert,
    updateStatus,
    updateNotes,
    updateField,
    remove
  };
}
