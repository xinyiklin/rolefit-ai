// Application tracker — JSON file as DB.
// Stored at <workspaceDir>/applications.json which is gitignored.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dedupeSourceUrls } from "../../src/lib/jobIdentity.ts";
import { assertWorkspaceAccessAllowed, captureWorkspaceAccess } from "../workspaceRestoreGate.ts";
import {
  MAX_ATTACHMENTS_PER_APPLICATION,
  MAX_DOCUMENT_BYTES,
  attachmentContentType,
  safeAttachmentFileName
} from "./documents.ts";

// Narrowing form of filter(Boolean): drops null/undefined AND narrows the element
// type. Behaviour-identical to filter(Boolean) for these truthy-object arrays.
const isPresent = <T>(v: T): v is NonNullable<T> => Boolean(v);
// Enum membership that also narrows the value to the list's literal type. Same
// runtime result as `list.includes(value)` (a non-string value is never in a
// string list), but usable on `unknown` request/JSON data.
const inList = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === "string" && (list as readonly string[]).includes(value);

const APPLICATION_STATUSES = ["interested", "applied", "interviewing", "offer", "rejected", "withdrawn"] as const;
// Shared with the application-tracker routes (routes.ts imports this) so the id
// validation used for storage and for route dispatch can never drift.
export const APPLICATION_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_APPLICATIONS = 500;
const MAX_FIELD = 50_000;
const MAX_RESUME_DATA_BYTES = 400_000;
// Sanitization is a pure read boundary. Missing persisted timestamps use one
// stable sentinel so repeated reads cannot manufacture different tracker
// revisions or metadata merely because wall-clock time advanced.
const MISSING_PERSISTED_TIMESTAMP = "1970-01-01T00:00:00.000Z";

export function applicationsFilePath(workspaceDir: string): string {
  return join(workspaceDir, "applications.json");
}

export class ApplicationsStorageError extends Error {
  status: number;
  currentApplications?: unknown[];
  constructor(
    message = "Application tracker data could not be read safely. Repair or restore applications.json before saving.",
    status = 500,
    currentApplications?: unknown[]
  ) {
    super(message);
    this.name = "ApplicationsStorageError";
    this.status = status;
    this.currentApplications = currentApplications;
  }
}

// Serialize every tracker read-modify-write cycle and any workspace-wide
// snapshot/restore that must observe applications.json and its PDF artifacts as
// one consistent state.
let applicationsWriteQueue: Promise<unknown> = Promise.resolve();
export function withApplicationsLock<T>(
  task: () => Promise<T>,
  options: { allowDuringRestore?: boolean } = {}
): Promise<T> {
  const capture = captureWorkspaceAccess();
  const run = applicationsWriteQueue.then(() => {
    if (!options.allowDuringRestore) assertWorkspaceAccessAllowed(capture);
    return task();
  });
  applicationsWriteQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

export function sanitizeApplications(applications: unknown) {
  return (Array.isArray(applications) ? applications : [])
    .map(sanitizeApplication)
    .filter(isPresent)
    .slice(0, MAX_APPLICATIONS);
}

function duplicateApplicationId(applications: { id: string }[]): string | null {
  const ids = new Set<string>();
  for (const application of applications) {
    if (ids.has(application.id)) return application.id;
    ids.add(application.id);
  }
  return null;
}

export async function readApplications(workspaceDir: string) {
  const path = applicationsFilePath(workspaceDir);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw new ApplicationsStorageError();
  }

  try {
    const data: unknown = JSON.parse(text);
    if (!data || typeof data !== "object" || !Array.isArray((data as { applications?: unknown }).applications)) {
      throw new Error("Invalid applications file shape.");
    }
    const apps = (data as { applications: unknown[] }).applications;
    const sane = sanitizeApplications(apps);
    // Never silently erase an invalid on-disk record during the next merge/write.
    // A malformed saved file needs explicit repair, with the original bytes left
    // untouched for recovery.
    if (apps.length > MAX_APPLICATIONS || sane.length !== apps.length || duplicateApplicationId(sane)) {
      throw new Error("Invalid application record.");
    }
    return sane;
  } catch {
    throw new ApplicationsStorageError();
  }
}

export async function writeApplications(workspaceDir: string, applications: unknown) {
  await mkdir(workspaceDir, { recursive: true });
  const path = applicationsFilePath(workspaceDir);
  if (!Array.isArray(applications) || applications.length > MAX_APPLICATIONS) {
    throw new ApplicationsStorageError(
      `The tracker supports at most ${MAX_APPLICATIONS} applications. No tracker changes were saved.`,
      400
    );
  }
  const sane = sanitizeApplications(applications);
  if (sane.length !== applications.length) {
    throw new ApplicationsStorageError("One or more applications are invalid. No tracker changes were saved.", 400);
  }
  if (duplicateApplicationId(sane)) {
    throw new ApplicationsStorageError("Application ids must be unique. No tracker changes were saved.", 400);
  }
  const payload = JSON.stringify(
    { savedAt: new Date().toISOString(), applications: sane },
    null,
    2
  );
  // A crash or process kill during writeFile must not truncate the user's tracker.
  // Write a private sibling file, then atomically replace the committed snapshot.
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, payload, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
  return sane;
}

const APPLICATION_SOURCES = ["LinkedIn", "Company site", "Referral", "Job board", "Recruiter", "Other"] as const;
const EVIDENCE_TYPES = ["exact", "adjacent", "none"] as const;

const APPLICATION_PRIORITIES = ["High", "Medium", "Low"] as const;
const SALARY_PERIODS = ["yr", "mo", "hr"] as const;
const RESUME_SECTION_TYPES = ["standard", "skills", "summary"] as const;
const REVIEW_GAP_SEVERITIES = ["BLOCKER", "HIGH", "MEDIUM", "LOW"] as const;
const REVIEW_VERDICTS = ["STRONG FIT", "REASONABLE FIT", "STRETCH", "DON'T APPLY"] as const;
// Per-stage AI-usage provenance: which model produced each pipeline stage's
// output (distill / tailor / review / cover / answers). `source` is required and
// enumerated; a stage whose source is not one of these is dropped entirely so a
// malformed entry can never persist a half-recorded provenance row.
const AI_USAGE_SOURCES = ["ai", "local", "none"] as const;
// A stage key is a short lowercase slug (e.g. "distill", "tailor", "review",
// "cover", "answers"). Keep the shape narrow so the map can't be used as an
// arbitrary key/value store.
const AI_USAGE_STAGE_RE = /^[a-z][a-z0-9-]{0,23}$/;
const AI_USAGE_MAX_STAGES = 12;
const SOURCE_URLS_MAX = 10;

function sanitizeScore(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function sanitizeSalary(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(10_000_000, Math.round(value)));
}

function sanitizeString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function sanitizeContacts(raw: unknown) {
  if (!Array.isArray(raw)) return undefined;
  const contacts = raw
    .slice(0, 8)
    .map((c) => ({
      name: sanitizeString(c?.name, 200),
      title: sanitizeString(c?.title, 200),
      email: sanitizeString(c?.email, 200),
      phone: sanitizeString(c?.phone, 200)
    }))
    .filter((c) => c.name || c.title || c.email || c.phone);
  return contacts.length ? contacts : undefined;
}

// What one document kind has on disk. Both the resume and the cover letter use
// this shape, so the tracker cannot describe one of them more richly than the
// other. New writes store strict source or an explicit PDF. Retired artifact
// flags are not part of the current storage contract.
function sanitizeDocumentArtifacts(raw: unknown) {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const hasPdf = r.hasPdf === true;
  const hasSource = r.hasSource === true;
  const sourceFingerprint =
    hasSource && typeof r.sourceFingerprint === "string" && /^[a-z0-9]+-[a-z0-9]+-[a-z0-9]+$/.test(r.sourceFingerprint)
      ? r.sourceFingerprint.slice(0, 80)
      : undefined;
  if (!hasPdf && !hasSource) return undefined;
  return {
    hasPdf,
    hasSource,
    sourceFingerprint,
    fileName: sanitizeString(r.fileName, 200),
    templateId: sanitizeString(r.templateId, 80),
    savedAt:
      typeof r.savedAt === "string" && r.savedAt
        ? r.savedAt.slice(0, 100)
        : MISSING_PERSISTED_TIMESTAMP
  };
}

// Extra files the user attached to this application. The metadata is only a
// record of what the server already wrote: a name that does not survive the
// same validation the upload route applies is dropped rather than stored.
function sanitizeAttachments(raw: unknown) {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const attachments = raw.slice(0, MAX_ATTACHMENTS_PER_APPLICATION).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const value = entry as Record<string, unknown>;
    const safe = typeof value.fileName === "string" ? safeAttachmentFileName(value.fileName) : null;
    if (!safe || seen.has(safe.fileName)) return [];
    seen.add(safe.fileName);
    const size = typeof value.size === "number" && Number.isFinite(value.size) && value.size >= 0
      ? Math.min(Math.floor(value.size), MAX_DOCUMENT_BYTES)
      : 0;
    return [{
      fileName: safe.fileName,
      // Trimmed: the label is display text for a file row, unlike the free-text
      // fields above where sanitizeString deliberately preserves the user's
      // spacing.
      label: sanitizeString(value.label, 120).trim() || safe.fileName,
      size,
      contentType: attachmentContentType(safe.fileName),
      savedAt:
        typeof value.savedAt === "string" && value.savedAt
          ? value.savedAt.slice(0, 100)
          : MISSING_PERSISTED_TIMESTAMP
    }];
  });
  return attachments.length ? attachments : undefined;
}

function sanitizeResumeSectionType(value: unknown, heading: unknown): "standard" | "skills" | "summary" {
  if (inList(RESUME_SECTION_TYPES, value)) return value;
  const normalized = sanitizeString(heading, 120);
  if (/\b(?:technical\s+skills|skills|core\s+skills)\b/i.test(normalized)) return "skills";
  if (/\b(?:summary|objective|profile|about\s+me|highlights)\b/i.test(normalized)) return "summary";
  return "standard";
}

function jsonByteLength(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return Infinity;
  }
}

function sanitizeResumeData(raw: unknown) {
  if (!raw || typeof raw !== "object" || jsonByteLength(raw) > MAX_RESUME_DATA_BYTES) return undefined;
  const r = raw as Record<string, unknown>;

  const sections = (Array.isArray(r.sections) ? r.sections : [])
    .slice(0, 24)
    .map((section, sectionIndex) => {
      const heading = sanitizeString(section?.heading, 160);
      const type = sanitizeResumeSectionType(section?.type, heading);
      const items = ((Array.isArray(section?.items) ? section.items : []) as any[])
        .slice(0, 80)
        .map((item, itemIndex) => {
          const bullets = ((Array.isArray(item?.bullets) ? item.bullets : []) as any[])
            .slice(0, 40)
            .map((bullet, bulletIndex) => ({
              id: sanitizeString(bullet?.id, 80) || `bullet-${sectionIndex + 1}-${itemIndex + 1}-${bulletIndex + 1}`,
              text: sanitizeString(bullet?.text, 6_000)
            }))
            .filter((bullet) => bullet.text);
          const entry = {
            id: sanitizeString(item?.id, 80) || `entry-${sectionIndex + 1}-${itemIndex + 1}`,
            titleLeft: sanitizeString(item?.titleLeft, 2_000),
            titleRight: sanitizeString(item?.titleRight, 2_000),
            subtitleLeft: sanitizeString(item?.subtitleLeft, 2_000),
            subtitleRight: sanitizeString(item?.subtitleRight, 2_000),
            bullets
          };
          return entry.titleLeft || entry.titleRight || entry.subtitleLeft || entry.subtitleRight || entry.bullets.length
            ? entry
            : null;
        })
        .filter(isPresent);
      return heading || items.length
        ? {
            id: sanitizeString(section?.id, 80) || `section-${sectionIndex + 1}`,
            heading,
            type,
            items
          }
        : null;
    })
    .filter(isPresent);

  const rawHeader =
    r.header && typeof r.header === "object" && !Array.isArray(r.header)
      ? r.header as Record<string, unknown>
      : null;
  const sanitizedHeader =
    rawHeader &&
    typeof rawHeader.visible === "boolean" &&
    (rawHeader.name === null || typeof rawHeader.name === "string") &&
    Array.isArray(rawHeader.contact)
    ? {
        visible: rawHeader.visible,
        name:
          rawHeader.name === null
            ? null
            : sanitizeString(rawHeader.name, 300),
        // Blank structural fields are intentional editor state. Dropping them
        // would make the application snapshot disagree with its strict source.
        contact: (Array.isArray(rawHeader.contact) ? rawHeader.contact : [])
          .slice(0, 12)
          .map((contact) => sanitizeString(contact, 300))
      }
    : null;
  const header =
    sanitizedHeader &&
    (sanitizedHeader.name !== null || sanitizedHeader.contact.length)
      ? sanitizedHeader
      : null;
  const data = {
    header,
    sections
  };
  return data.header || data.sections.length ? data : undefined;
}

function sanitizeEvidenceType(value: unknown): "exact" | "adjacent" | "none" | undefined {
  return inList(EVIDENCE_TYPES, value) ? value : undefined;
}

function sanitizeReviewGapSeverity(value: unknown): "BLOCKER" | "HIGH" | "MEDIUM" | "LOW" | undefined {
  return inList(REVIEW_GAP_SEVERITIES, value) ? value : undefined;
}

function sanitizeMissingRequiredSkills(raw: unknown) {
  if (!Array.isArray(raw)) return undefined;
  const skills = raw
    .slice(0, 12)
    .map((item) => {
      const evidenceType = sanitizeEvidenceType(item?.evidenceType) ?? "none";
      return {
        keyword: sanitizeString(item?.keyword, 160),
        evidenceType,
        canHonestlyAdd: evidenceType === "exact" && item?.canHonestlyAdd === true,
        reason: sanitizeString(item?.reason, 800)
      };
    })
    .filter((item) => item.keyword);
  return skills.length ? skills : undefined;
}

function sanitizeReview(raw: unknown) {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  // Deep JSON arrays coerced field-by-field below; `any[]` keeps this a thin
  // parse boundary (each field still runs through a sanitizer).
  const list = (v: unknown): any[] => (Array.isArray(v) ? v : []);
  const rec = (r.recommendation && typeof r.recommendation === "object" ? r.recommendation : {}) as Record<string, unknown>;
  if (!inList(REVIEW_VERDICTS, r.verdict)) return undefined;
  const review = {
    verdict: r.verdict,
    verdictReason: sanitizeString(r.verdictReason, 1_000),
    riskFlags: list(r.riskFlags)
      .slice(0, 12)
      .map((r) => ({ risk: sanitizeString(r?.risk, 400), suggestion: sanitizeString(r?.suggestion, 400) }))
      .filter((r) => r.risk),
    gaps: list(r.gaps)
      .slice(0, 12)
      .map((g) => {
        const gap = sanitizeString(g?.gap, 400);
        const severity = sanitizeReviewGapSeverity(g?.severity);
        if (!gap || !severity) return null;
        const evidenceType = sanitizeEvidenceType(g?.evidenceType);
        return {
          gap,
          severity,
          evidenceType,
          canHonestlyAdd: evidenceType === "exact" && g?.canHonestlyAdd === true,
          evidence: sanitizeString(g?.evidence, 800),
          suggestedEdit: sanitizeString(g?.suggestedEdit, 800)
        };
      })
      .filter(isPresent),
    recommendation: {
      applyAsIs: rec.applyAsIs === true,
      reason: sanitizeString(rec.reason, 1_000),
      coverLetterAngle: sanitizeString(rec.coverLetterAngle, 1_000),
      topEdits: list(rec.topEdits).slice(0, 8).map((e) => sanitizeString(e, 300)).filter(Boolean)
    }
  };
  // A valid verdict is required above; optional subfields may safely be empty.
  return review;
}

function sanitizeApplicationAnswers(raw: unknown) {
  if (!Array.isArray(raw)) return undefined;
  const answers = raw
    .slice(0, 40)
    .map((a) => ({
      question: sanitizeString(a?.question, 400),
      answer: sanitizeString(a?.answer, 4_000),
      savedAt:
        typeof a?.savedAt === "string" && a.savedAt
          ? a.savedAt.slice(0, 100)
          : MISSING_PERSISTED_TIMESTAMP
    }))
    .filter((a) => a.answer && a.question);
  return answers.length ? answers : undefined;
}

// Every board/ATS URL this posting has been seen at (LinkedIn, the company site,
// the underlying ATS…), so the layered duplicate matcher keeps matching no matter
// which board the user is on. Entries are trimmed, capped, and de-duplicated
// against each other AND against the record's own `jobUrl` via normalizeJobUrl
// (so tracking-param variants of the same link collapse). `ownJobUrl` is the
// already-sanitized jobUrl of the same record.
function sanitizeSourceUrls(raw: unknown, ownJobUrl: string) {
  if (!Array.isArray(raw)) return undefined;
  // Clip strings first, then dedupe with the SHARED rules (normalized-URL
  // dedup, own-jobUrl exclusion, earliest addedAt, cap) so this sanitizer can
  // never drift from the client's two merge paths.
  const clipped = raw
    .filter(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        typeof entry.addedAt === "string" &&
        entry.addedAt
    )
    .map((entry) => ({
      url: sanitizeString(entry.url, 2_000).trim(),
      source: sanitizeString(entry.source, 40) || undefined,
      addedAt:
        typeof entry.addedAt === "string" && entry.addedAt
          ? entry.addedAt.slice(0, 40)
          : MISSING_PERSISTED_TIMESTAMP
    }));
  const out = dedupeSourceUrls(
    clipped,
    ownJobUrl,
    MISSING_PERSISTED_TIMESTAMP,
    SOURCE_URLS_MAX
  )
    .map((entry) => ({ ...entry, source: entry.source ?? "" }));
  return out.length ? out : undefined;
}

function sanitizeDuplicateDismissedIds(raw: unknown, ownId: string) {
  if (!Array.isArray(raw)) return undefined;
  const ids = Array.from(
    new Set(
      raw.filter(
        (value): value is string =>
          typeof value === "string" && value !== ownId && APPLICATION_ID_RE.test(value)
      )
    )
  ).slice(0, MAX_APPLICATIONS);
  return ids.length ? ids : undefined;
}

// Optional string subfield of an aiUsage entry: drop an empty string rather than
// storing "" (so a caller can leave a field out and it stays out).
function aiUsageOptionalString(value: unknown, maxLength: number): string | undefined {
  const s = sanitizeString(value, maxLength).trim();
  return s || undefined;
}

// Per-stage AI provenance map. `source` is required + enumerated (a bad source
// drops the whole entry). Optional fields are clipped; empty strings drop rather
// than persist; `attempts` clamps to 1..9 (dropped if not a finite number);
// unknown subfields are dropped. Stage keys must match AI_USAGE_STAGE_RE. Returns
// undefined when no valid entries survive.
type AiUsageEntry = {
  source: "ai" | "local" | "none";
  provider?: string;
  model?: string;
  reasoningEffort?: string;
  requestedProvider?: string;
  requestedModel?: string;
  attempts?: number;
  fallback?: boolean;
  completedAt?: string;
};

function sanitizeAiUsage(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, AiUsageEntry> = {};
  let count = 0;
  for (const [stage, rawValue] of Object.entries(raw)) {
    if (count >= AI_USAGE_MAX_STAGES) break;
    if (!AI_USAGE_STAGE_RE.test(stage)) continue;
    if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) continue;
    const value = rawValue as Record<string, unknown>;
    if (!inList(AI_USAGE_SOURCES, value.source)) continue;

    const entry: AiUsageEntry = { source: value.source };
    const provider = aiUsageOptionalString(value.provider, 40);
    if (provider) entry.provider = provider;
    const model = aiUsageOptionalString(value.model, 120);
    if (model) entry.model = model;
    const reasoningEffort = aiUsageOptionalString(value.reasoningEffort, 24);
    if (reasoningEffort) entry.reasoningEffort = reasoningEffort;
    const requestedProvider = aiUsageOptionalString(value.requestedProvider, 40);
    if (requestedProvider) entry.requestedProvider = requestedProvider;
    const requestedModel = aiUsageOptionalString(value.requestedModel, 120);
    if (requestedModel) entry.requestedModel = requestedModel;
    if (typeof value.attempts === "number" && Number.isFinite(value.attempts)) {
      entry.attempts = Math.max(1, Math.min(9, Math.round(value.attempts)));
    }
    if (typeof value.fallback === "boolean") entry.fallback = value.fallback;
    const completedAt = aiUsageOptionalString(value.completedAt, 40);
    if (completedAt) entry.completedAt = completedAt;

    out[stage] = entry;
    count += 1;
  }
  return count ? out : undefined;
}

function sanitizeApplication(raw: unknown) {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const rawId = sanitizeString(r.id, 80);
  const id = APPLICATION_ID_RE.test(rawId) ? rawId : "";
  const title = typeof r.title === "string" ? r.title.slice(0, 200) : "";
  if (!id || !title) return null;

  const status = inList(APPLICATION_STATUSES, r.status) ? r.status : "interested";
  const source = inList(APPLICATION_SOURCES, r.source) ? r.source : "";
  const storedCreatedAt = typeof r.createdAt === "string" ? r.createdAt.trim().slice(0, 100) : "";
  const storedUpdatedAt = typeof r.updatedAt === "string" ? r.updatedAt.trim().slice(0, 100) : "";
  const createdAt = storedCreatedAt || MISSING_PERSISTED_TIMESTAMP;
  const updatedAt = storedUpdatedAt || createdAt;
  const jobUrl = typeof r.jobUrl === "string" ? r.jobUrl.slice(0, 2_000) : "";

  return {
    id,
    title,
    company: typeof r.company === "string" ? r.company.slice(0, 200) : "",
    role: typeof r.role === "string" ? r.role.slice(0, 200) : "",
    roleDescription: typeof r.roleDescription === "string" ? r.roleDescription.slice(0, 2_000) : "",
    source,
    jobUrl,
    sourceUrls: sanitizeSourceUrls(r.sourceUrls, jobUrl),
    jobDescription: typeof r.jobDescription === "string" ? r.jobDescription.slice(0, MAX_FIELD) : "",
    rawJobDescription: typeof r.rawJobDescription === "string" ? r.rawJobDescription.slice(0, MAX_FIELD) : "",
    status,
    createdAt,
    appliedAt: typeof r.appliedAt === "string" ? r.appliedAt : "",
    updatedAt,
    followupAt: typeof r.followupAt === "string" ? r.followupAt : "",
    location: typeof r.location === "string" ? r.location.slice(0, 200) : "",
    jobType: typeof r.jobType === "string" ? r.jobType.slice(0, 60) : "",
    workAuth: typeof r.workAuth === "string" ? r.workAuth.slice(0, 80) : "",
    deadline: typeof r.deadline === "string" ? r.deadline.slice(0, 40) : "",
    priority: inList(APPLICATION_PRIORITIES, r.priority) ? r.priority : undefined,
    salaryMin: sanitizeSalary(r.salaryMin),
    salaryMax: sanitizeSalary(r.salaryMax),
    salaryCurrency: typeof r.salaryCurrency === "string" ? r.salaryCurrency.slice(0, 8) : "",
    salaryPeriod: inList(SALARY_PERIODS, r.salaryPeriod) ? r.salaryPeriod : undefined,
    interviewTips: typeof r.interviewTips === "string" ? r.interviewTips.slice(0, 8_000) : "",
    contacts: sanitizeContacts(r.contacts),
    resumeArtifacts: sanitizeDocumentArtifacts(r.resumeArtifacts),
    coverLetterArtifacts: sanitizeDocumentArtifacts(r.coverLetterArtifacts),
    attachments: sanitizeAttachments(r.attachments),
    notes: typeof r.notes === "string" ? r.notes.slice(0, 8_000) : "",
    fitScore: sanitizeScore(r.fitScore),
    baseFitScore: sanitizeScore(r.baseFitScore),
    tailoredFitScore: sanitizeScore(r.tailoredFitScore),
    fitScoreSource: r.fitScoreSource === "ai" || r.fitScoreSource === "local" ? r.fitScoreSource : null,
    templateId: typeof r.templateId === "string" ? r.templateId.slice(0, 80) : "",
    resumeData: sanitizeResumeData(r.resumeData),
    polishedText: typeof r.polishedText === "string" ? r.polishedText.slice(0, MAX_FIELD) : "",
    coverLetterText: typeof r.coverLetterText === "string" ? r.coverLetterText.slice(0, MAX_FIELD) : "",
    review: sanitizeReview(r.review),
    missingRequiredSkills: sanitizeMissingRequiredSkills(r.missingRequiredSkills),
    resumeUsed: r.resumeUsed === "base" || r.resumeUsed === "tailored" ? r.resumeUsed : undefined,
    applicationAnswers: sanitizeApplicationAnswers(r.applicationAnswers),
    aiUsage: sanitizeAiUsage(r.aiUsage),
    duplicateDismissedIds: sanitizeDuplicateDismissedIds(r.duplicateDismissedIds, id)
  };
}

export type ApplicationMutation = {
  id: string;
  operation: "upsert" | "delete";
  baseUpdatedAt: string | null;
};

function parseApplicationMutations(raw: unknown): ApplicationMutation[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_APPLICATIONS) {
    throw new ApplicationsStorageError(
      "Each tracker save must name between 1 and 500 application mutations.",
      400
    );
  }

  const ids = new Set<string>();
  return raw.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new ApplicationsStorageError("One or more application mutations are invalid.", 400);
    }
    const record = value as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : "";
    const operation = record.operation;
    const baseUpdatedAt = record.baseUpdatedAt;
    if (
      !APPLICATION_ID_RE.test(id) ||
      (operation !== "upsert" && operation !== "delete") ||
      (baseUpdatedAt !== null && (typeof baseUpdatedAt !== "string" || baseUpdatedAt.length > 100)) ||
      ids.has(id)
    ) {
      throw new ApplicationsStorageError("One or more application mutations are invalid.", 400);
    }
    ids.add(id);
    return { id, operation, baseUpdatedAt };
  });
}

/**
 * Apply an explicitly described client mutation set to the latest disk state.
 * The client may send sparse upsert records or a legacy full snapshot, but
 * unchanged rows always come from `existing`. New rows are prepended in
 * incoming order; existing rows retain their server order.
 */
export function reconcileApplicationMutations(
  existing: ReturnType<typeof sanitizeApplications>,
  incoming: ReturnType<typeof sanitizeApplications>,
  rawMutations: unknown
) {
  if (duplicateApplicationId(existing) || duplicateApplicationId(incoming)) {
    throw new ApplicationsStorageError("Application ids must be unique. No tracker changes were saved.", 400);
  }

  const mutations = parseApplicationMutations(rawMutations);
  const mutationById = new Map(mutations.map((mutation) => [mutation.id, mutation]));
  const existingById = new Map(existing.map((application) => [application.id, application]));
  const incomingById = new Map(incoming.map((application) => [application.id, application]));

  for (const mutation of mutations) {
    const current = existingById.get(mutation.id);
    const requested = incomingById.get(mutation.id);
    if (mutation.operation === "upsert" && !requested) {
      throw new ApplicationsStorageError("An upsert mutation must include its application record.", 400);
    }
    if (mutation.operation === "delete" && requested) {
      throw new ApplicationsStorageError("A delete mutation must omit its application record.", 400);
    }
    if (
      mutation.operation === "upsert" &&
      current &&
      requested?.updatedAt === current.updatedAt
    ) {
      throw new ApplicationsStorageError(
        "A changed application must advance its updatedAt revision. No tracker changes were saved.",
        400
      );
    }

    const revisionMatches = current
      ? mutation.baseUpdatedAt === current.updatedAt
      : mutation.baseUpdatedAt === null;
    if (!revisionMatches) {
      throw new ApplicationsStorageError(
        "This application changed in another tab. The latest saved tracker has been restored; review it before trying again.",
        409,
        existing
      );
    }
  }

  for (const application of incoming) {
    if (!existingById.has(application.id) && mutationById.get(application.id)?.operation !== "upsert") {
      throw new ApplicationsStorageError(
        "A new application must include an upsert mutation. No tracker changes were saved.",
        400
      );
    }
  }

  const reconciled = incoming.filter((application) =>
    !existingById.has(application.id) &&
    mutationById.get(application.id)?.operation === "upsert"
  );
  for (const current of existing) {
    const mutation = mutationById.get(current.id);
    if (mutation?.operation === "delete") continue;
    reconciled.push(
      mutation?.operation === "upsert"
        ? incomingById.get(current.id)!
        : current
    );
  }
  return reconciled;
}
