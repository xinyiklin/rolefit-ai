// Browser-extension support helpers.
//
// This module is pure, dependency-free logic used by the /api/extension/*
// routes in server.mjs. It does a fast, deterministic keyword-overlap "quick
// score" of a base resume against a job page, plus light URL normalization and
// job-meta extraction. It never fabricates resume content — quickScore only
// reports which KNOWN tech keywords overlap; it does not invent or rewrite any
// resume claim. The authoritative, anti-fabrication-gated polish still runs
// server-side via /api/polish.

// Known tech keywords for overlap scoring. Single-token entries use a
// word-boundary match (so "go" never matches inside "golang"); multi-word
// entries use a plain substring match after lowercasing.
const TECH_KEYWORDS = [
  "javascript", "typescript", "python", "java", "c++", "c#", "go", "rust", "kotlin", "swift", "scala", "php", "ruby",
  "react", "vue", "angular", "svelte", "next.js", "nuxt",
  "node.js", "express", "fastapi", "django", "flask", "spring", "rails",
  "aws", "gcp", "azure", "docker", "kubernetes", "terraform", "helm",
  "sql", "postgresql", "postgres", "mysql", "mongodb", "redis", "elasticsearch", "kafka", "snowflake",
  "graphql", "rest", "grpc", "microservices", "websocket",
  "machine learning", "deep learning", "pytorch", "tensorflow", "llm", "nlp", "spark", "airflow",
  "git", "linux", "bash", "agile", "scrum", "jira", "ci/cd", "github actions", "jenkins"
];

// Tracking/analytics query params stripped during URL normalization.
const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "gclid", "fbclid", "msclkid", "mc_cid", "mc_eid",
  "ref", "refid", "ref_src", "src", "source",
  "trk", "trackingid", "originalsubdomain", "savedjobid", "position", "pagenum"
]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Build a case-insensitive, boundary-aware matcher for a single-token keyword.
// Boundaries use lookbehind/lookahead so partial matches are rejected: "go"
// will not match inside "golang" or "ago", and "rust" will not match
// "trustworthy". Word characters AND "." / "#" / "+" / "/" count as part of a
// token so "next.js", "c#", "c++", and "ci/cd" keep their own boundaries.
function buildTokenMatcher(keyword) {
  const escaped = escapeRegExp(keyword);
  return new RegExp(`(?<![A-Za-z0-9.#+/])${escaped}(?![A-Za-z0-9.#+/])`, "i");
}

// Normalize a URL for comparison: strip tracking params, drop the fragment,
// and remove a trailing slash from the path. Invalid URLs are returned as-is.
export function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    for (const param of [...parsed.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(param.toLowerCase())) {
        parsed.searchParams.delete(param);
      }
    }
    let pathname = parsed.pathname;
    if (pathname.length > 1 && pathname.endsWith("/")) {
      pathname = pathname.replace(/\/+$/, "");
    }
    parsed.pathname = pathname;
    let result = parsed.toString();
    // toString re-appends a trailing slash for an empty path; trim a bare
    // host trailing slash too for stable comparison.
    if (result.endsWith("/") && !parsed.search) {
      result = result.replace(/\/+$/, "");
    }
    return result;
  } catch {
    return url;
  }
}

// Find the first stored application whose URL matches the given page URL after
// normalization. Returns the application object, or null when none match.
export function findMatchingApplication(url, applications) {
  if (!url || !Array.isArray(applications)) return null;
  const target = normalizeUrl(url);
  for (const app of applications) {
    if (!app) continue;
    const appUrl = typeof app.jobUrl === "string" && app.jobUrl
      ? app.jobUrl
      : typeof app.url === "string"
      ? app.url
      : "";
    if (!appUrl) continue;
    if (normalizeUrl(appUrl) === target) return app;
  }
  return null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// Fast keyword-overlap fit estimate. Reports which KNOWN tech keywords are in
// the job text and which of those also appear in the resume text. This is a
// rough triage signal only — it never invents resume content; the
// anti-fabrication-gated polish path is authoritative.
export function quickScore(resumeText, jobText) {
  const resume = String(resumeText || "");
  const job = String(jobText || "");
  const resumeLower = resume.toLowerCase();
  const jobLower = job.toLowerCase();

  const inJob = [];
  for (const keyword of TECH_KEYWORDS) {
    const hit = keyword.includes(" ")
      ? jobLower.includes(keyword)
      : buildTokenMatcher(keyword).test(job);
    if (hit) inJob.push(keyword);
  }

  if (inJob.length === 0) {
    return { score: 55, verdict: "Stretch", matched: [], missing: [] };
  }

  const matched = [];
  const missing = [];
  for (const keyword of inJob) {
    const inResume = keyword.includes(" ")
      ? resumeLower.includes(keyword)
      : buildTokenMatcher(keyword).test(resume);
    if (inResume) matched.push(keyword);
    else missing.push(keyword);
  }

  const ratio = matched.length / inJob.length;
  const score = clamp(Math.round(ratio * 65 + 25), 20, 95);
  const verdict =
    score >= 85 ? "Strong fit" : score >= 70 ? "Reasonable fit" : score >= 55 ? "Stretch" : "Don't apply";

  return {
    score,
    verdict,
    matched: matched.slice(0, 8),
    missing: missing.slice(0, 5)
  };
}

// Best-effort title/company extraction from a job page title and body text.
// Conservative: returns only what it can read; never guesses an employer.
export function extractJobMeta(text, pageTitle) {
  const meta = {};
  const title = typeof pageTitle === "string" ? pageTitle.trim() : "";
  const body = typeof text === "string" ? text : "";

  // 1. LinkedIn: "<Title> at <Company> | ... LinkedIn"
  if (title) {
    const linkedin = title.match(/^(.+?)\s+at\s+(.+?)\s*[|–\-].*linkedin/i);
    if (linkedin) {
      meta.title = linkedin[1].trim();
      meta.company = linkedin[2].trim();
    }
  }

  // 2. Indeed: "<Title> - <Company> - <Location> | ..."
  if ((!meta.title || !meta.company) && title) {
    const indeed = title.match(/^(.+?)\s*-\s*(.+?)\s*-\s*.+\|/);
    if (indeed) {
      if (!meta.title) meta.title = indeed[1].trim();
      if (!meta.company) meta.company = indeed[2].trim();
    }
  }

  // 3. Generic: first segment of the page title is the role.
  if (!meta.title && title) {
    const first = title.split(/[|–\-]/)[0]?.trim() ?? "";
    if (first.length >= 3 && first.length <= 100) meta.title = first;
  }

  // 4. Body "at <Company>" cue for a still-missing employer.
  if (!meta.company && body) {
    const atMatch = body.match(/\bat\s+([A-Z][A-Za-z0-9\s,&.]{2,40}?)(?:\s*,|\s*\n)/m);
    if (atMatch) meta.company = atMatch[1].trim();
  }

  return meta;
}
