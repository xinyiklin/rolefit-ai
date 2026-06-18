// Application tracker — JSON file as DB.
// Stored at <workspaceDir>/applications.json which is gitignored.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const APPLICATION_STATUSES = ["interested", "applied", "interviewing", "offer", "rejected", "withdrawn"];
const APPLICATION_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_APPLICATIONS = 500;
const MAX_FIELD = 50_000;
const MAX_RESUME_DATA_BYTES = 400_000;

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
const EVIDENCE_TYPES = ["exact", "adjacent", "none"];

const APPLICATION_PRIORITIES = ["High", "Medium", "Low"];
const SALARY_PERIODS = ["yr", "mo", "hr"];
const RESUME_SECTION_TYPES = ["standard", "skills", "summary"];
const REVIEW_GAP_SEVERITIES = ["BLOCKER", "HIGH", "MEDIUM", "LOW"];

function sanitizeScore(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function sanitizeSalary(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(10_000_000, Math.round(value)));
}

function sanitizeString(value, maxLength) {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function sanitizeContacts(raw) {
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

function sanitizeResumeArtifacts(raw) {
  if (!raw || typeof raw !== "object") return undefined;
  const hasTex = Boolean(raw.hasTex);
  const hasPdf = Boolean(raw.hasPdf);
  if (!hasTex && !hasPdf) return undefined;
  return {
    hasTex,
    hasPdf,
    fileName: sanitizeString(raw.fileName, 200),
    templateId: sanitizeString(raw.templateId, 80),
    savedAt: typeof raw.savedAt === "string" ? raw.savedAt : new Date().toISOString()
  };
}

function sanitizeResumeSectionType(value, heading) {
  if (RESUME_SECTION_TYPES.includes(value)) return value;
  const normalized = sanitizeString(heading, 120);
  if (/\b(?:technical\s+skills|skills|core\s+skills)\b/i.test(normalized)) return "skills";
  if (/\b(?:summary|objective|profile|about\s+me|highlights)\b/i.test(normalized)) return "summary";
  return "standard";
}

function jsonByteLength(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return Infinity;
  }
}

function sanitizeResumeData(raw) {
  if (!raw || typeof raw !== "object" || jsonByteLength(raw) > MAX_RESUME_DATA_BYTES) return undefined;

  const sections = (Array.isArray(raw.sections) ? raw.sections : [])
    .slice(0, 24)
    .map((section, sectionIndex) => {
      const heading = sanitizeString(section?.heading, 160);
      const type = sanitizeResumeSectionType(section?.type, heading);
      const items = (Array.isArray(section?.items) ? section.items : [])
        .slice(0, 80)
        .map((item, itemIndex) => {
          const bullets = (Array.isArray(item?.bullets) ? item.bullets : [])
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
        .filter(Boolean);
      return heading || items.length
        ? {
            id: sanitizeString(section?.id, 80) || `section-${sectionIndex + 1}`,
            heading,
            type,
            items
          }
        : null;
    })
    .filter(Boolean);

  const data = {
    name: sanitizeString(raw.name, 300),
    contact: (Array.isArray(raw.contact) ? raw.contact : [])
      .slice(0, 12)
      .map((contact) => sanitizeString(contact, 300))
      .filter(Boolean),
    sections
  };
  return data.name || data.contact.length || data.sections.length ? data : undefined;
}

function sanitizeEvidenceType(value) {
  return EVIDENCE_TYPES.includes(value) ? value : undefined;
}

function sanitizeReviewGapSeverity(value) {
  return REVIEW_GAP_SEVERITIES.includes(value) ? value : "MEDIUM";
}

function sanitizeMissingRequiredSkills(raw) {
  if (!Array.isArray(raw)) return undefined;
  const skills = raw
    .slice(0, 12)
    .map((item) => {
      const evidenceType = sanitizeEvidenceType(item?.evidenceType) ?? "none";
      return {
        keyword: sanitizeString(item?.keyword, 160),
        evidenceType,
        canHonestlyAdd: evidenceType === "exact" && Boolean(item?.canHonestlyAdd),
        reason: sanitizeString(item?.reason, 800)
      };
    })
    .filter((item) => item.keyword);
  return skills.length ? skills : undefined;
}

function sanitizeReview(raw) {
  if (!raw || typeof raw !== "object") return undefined;
  const list = (v) => (Array.isArray(v) ? v : []);
  const rec = raw.recommendation && typeof raw.recommendation === "object" ? raw.recommendation : {};
  const review = {
    verdict: sanitizeString(raw.verdict, 40),
    verdictReason: sanitizeString(raw.verdictReason, 1_000),
    riskFlags: list(raw.riskFlags)
      .slice(0, 12)
      .map((r) => ({ risk: sanitizeString(r?.risk, 400), suggestion: sanitizeString(r?.suggestion, 400) }))
      .filter((r) => r.risk),
    gaps: list(raw.gaps)
      .slice(0, 12)
      .map((g) => {
        const evidenceType = sanitizeEvidenceType(g?.evidenceType);
        return {
          gap: sanitizeString(g?.gap, 400),
          severity: sanitizeReviewGapSeverity(g?.severity),
          evidenceType,
          canHonestlyAdd: evidenceType === "exact" && Boolean(g?.canHonestlyAdd),
          evidence: sanitizeString(g?.evidence, 800),
          suggestedEdit: sanitizeString(g?.suggestedEdit, 800)
        };
      })
      .filter((g) => g.gap),
    recommendation: {
      applyAsIs: Boolean(rec.applyAsIs),
      reason: sanitizeString(rec.reason, 1_000),
      coverLetterAngle: sanitizeString(rec.coverLetterAngle, 1_000),
      topEdits: list(rec.topEdits).slice(0, 8).map((e) => sanitizeString(e, 300)).filter(Boolean)
    }
  };
  // Drop an empty snapshot entirely so it doesn't clutter storage.
  if (!review.verdict && !review.riskFlags.length && !review.gaps.length) return undefined;
  return review;
}

function sanitizeApplicationAnswers(raw) {
  if (!Array.isArray(raw)) return undefined;
  const now = new Date().toISOString();
  const answers = raw
    .slice(0, 40)
    .map((a) => ({
      question: sanitizeString(a?.question, 400),
      answer: sanitizeString(a?.answer, 4_000),
      savedAt: typeof a?.savedAt === "string" ? a.savedAt : now
    }))
    .filter((a) => a.answer && a.question);
  return answers.length ? answers : undefined;
}

function sanitizeApplication(raw) {
  if (!raw || typeof raw !== "object") return null;
  const rawId = sanitizeString(raw.id, 80);
  const id = APPLICATION_ID_RE.test(rawId) ? rawId : "";
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
    roleDescription: typeof raw.roleDescription === "string" ? raw.roleDescription.slice(0, 2_000) : "",
    source,
    jobUrl: typeof raw.jobUrl === "string" ? raw.jobUrl.slice(0, 2_000) : "",
    jobDescription: typeof raw.jobDescription === "string" ? raw.jobDescription.slice(0, MAX_FIELD) : "",
    status,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : now,
    appliedAt: typeof raw.appliedAt === "string" ? raw.appliedAt : "",
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : now,
    followupAt: typeof raw.followupAt === "string" ? raw.followupAt : "",
    location: typeof raw.location === "string" ? raw.location.slice(0, 200) : "",
    jobType: typeof raw.jobType === "string" ? raw.jobType.slice(0, 60) : "",
    workAuth: typeof raw.workAuth === "string" ? raw.workAuth.slice(0, 80) : "",
    deadline: typeof raw.deadline === "string" ? raw.deadline.slice(0, 40) : "",
    priority: APPLICATION_PRIORITIES.includes(raw.priority) ? raw.priority : undefined,
    salaryMin: sanitizeSalary(raw.salaryMin),
    salaryMax: sanitizeSalary(raw.salaryMax),
    salaryCurrency: typeof raw.salaryCurrency === "string" ? raw.salaryCurrency.slice(0, 8) : "",
    salaryPeriod: SALARY_PERIODS.includes(raw.salaryPeriod) ? raw.salaryPeriod : undefined,
    interviewTips: typeof raw.interviewTips === "string" ? raw.interviewTips.slice(0, 8_000) : "",
    contacts: sanitizeContacts(raw.contacts),
    resumeArtifacts: sanitizeResumeArtifacts(raw.resumeArtifacts),
    notes: typeof raw.notes === "string" ? raw.notes.slice(0, 8_000) : "",
    fitScore: sanitizeScore(raw.fitScore),
    baseFitScore: sanitizeScore(raw.baseFitScore),
    tailoredFitScore: sanitizeScore(raw.tailoredFitScore),
    fitScoreSource: raw.fitScoreSource === "ai" || raw.fitScoreSource === "local" ? raw.fitScoreSource : null,
    templateId: typeof raw.templateId === "string" ? raw.templateId.slice(0, 80) : "",
    resumeData: sanitizeResumeData(raw.resumeData),
    polishedText: typeof raw.polishedText === "string" ? raw.polishedText.slice(0, MAX_FIELD) : "",
    coverLetterText: typeof raw.coverLetterText === "string" ? raw.coverLetterText.slice(0, MAX_FIELD) : "",
    review: sanitizeReview(raw.review),
    missingRequiredSkills: sanitizeMissingRequiredSkills(raw.missingRequiredSkills),
    resumeUsed: raw.resumeUsed === "base" || raw.resumeUsed === "tailored" ? raw.resumeUsed : undefined,
    applicationAnswers: sanitizeApplicationAnswers(raw.applicationAnswers)
  };
}
