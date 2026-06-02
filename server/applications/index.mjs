// Application tracker — JSON file as DB.
// Stored at <workspaceDir>/applications.json which is gitignored.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const APPLICATION_STATUSES = ["interested", "applied", "interviewing", "offer", "rejected", "withdrawn"];
const MAX_APPLICATIONS = 500;
const MAX_FIELD = 50_000;

export function applicationsFilePath(workspaceDir) {
  return join(workspaceDir, "applications.json");
}

export async function readApplications(workspaceDir) {
  const path = applicationsFilePath(workspaceDir);
  try {
    const text = await readFile(path, "utf8");
    const data = JSON.parse(text);
    const apps = Array.isArray(data?.applications) ? data.applications : [];
    return apps.map(sanitizeApplication).filter(Boolean);
  } catch {
    return [];
  }
}

export async function writeApplications(workspaceDir, applications) {
  await mkdir(workspaceDir, { recursive: true });
  const path = applicationsFilePath(workspaceDir);
  const sane = (Array.isArray(applications) ? applications : [])
    .map(sanitizeApplication)
    .filter(Boolean)
    .slice(0, MAX_APPLICATIONS);
  const payload = JSON.stringify(
    { savedAt: new Date().toISOString(), applications: sane },
    null,
    2
  );
  await writeFile(path, payload, "utf8");
  return sane;
}

const APPLICATION_SOURCES = ["LinkedIn", "Company site", "Referral", "Job board", "Recruiter", "Other"];

function sanitizeScore(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function sanitizeReview(raw) {
  if (!raw || typeof raw !== "object") return undefined;
  const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
  const list = (v) => (Array.isArray(v) ? v : []);
  const rec = raw.recommendation && typeof raw.recommendation === "object" ? raw.recommendation : {};
  const review = {
    verdict: str(raw.verdict, 40),
    verdictReason: str(raw.verdictReason, 1_000),
    riskFlags: list(raw.riskFlags)
      .slice(0, 12)
      .map((r) => ({ risk: str(r?.risk, 400), suggestion: str(r?.suggestion, 400) }))
      .filter((r) => r.risk),
    gaps: list(raw.gaps)
      .slice(0, 12)
      .map((g) => ({ gap: str(g?.gap, 400), severity: str(g?.severity, 12) }))
      .filter((g) => g.gap),
    recommendation: {
      applyAsIs: Boolean(rec.applyAsIs),
      reason: str(rec.reason, 1_000),
      coverLetterAngle: str(rec.coverLetterAngle, 1_000),
      topEdits: list(rec.topEdits).slice(0, 8).map((e) => str(e, 300)).filter(Boolean)
    }
  };
  // Drop an empty snapshot entirely so it doesn't clutter storage.
  if (!review.verdict && !review.riskFlags.length && !review.gaps.length) return undefined;
  return review;
}

function sanitizeApplication(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" ? raw.id.slice(0, 80) : "";
  const title = typeof raw.title === "string" ? raw.title.slice(0, 200) : "";
  if (!id || !title) return null;

  const status = APPLICATION_STATUSES.includes(raw.status) ? raw.status : "interested";
  const source = APPLICATION_SOURCES.includes(raw.source) ? raw.source : "";
  const now = new Date().toISOString();

  return {
    id,
    title,
    company: typeof raw.company === "string" ? raw.company.slice(0, 200) : "",
    role: typeof raw.role === "string" ? raw.role.slice(0, 200) : "",
    source,
    jobUrl: typeof raw.jobUrl === "string" ? raw.jobUrl.slice(0, 2_000) : "",
    jobDescription: typeof raw.jobDescription === "string" ? raw.jobDescription.slice(0, MAX_FIELD) : "",
    status,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : now,
    appliedAt: typeof raw.appliedAt === "string" ? raw.appliedAt : "",
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : now,
    followupAt: typeof raw.followupAt === "string" ? raw.followupAt : "",
    notes: typeof raw.notes === "string" ? raw.notes.slice(0, 8_000) : "",
    fitScore: sanitizeScore(raw.fitScore),
    baseFitScore: sanitizeScore(raw.baseFitScore),
    tailoredFitScore: sanitizeScore(raw.tailoredFitScore),
    fitScoreSource: raw.fitScoreSource === "ai" || raw.fitScoreSource === "local" ? raw.fitScoreSource : null,
    templateId: typeof raw.templateId === "string" ? raw.templateId.slice(0, 80) : "",
    polishedText: typeof raw.polishedText === "string" ? raw.polishedText.slice(0, MAX_FIELD) : "",
    coverLetterText: typeof raw.coverLetterText === "string" ? raw.coverLetterText.slice(0, MAX_FIELD) : "",
    review: sanitizeReview(raw.review),
    resumeUsed: raw.resumeUsed === "base" || raw.resumeUsed === "tailored" ? raw.resumeUsed : undefined
  };
}
