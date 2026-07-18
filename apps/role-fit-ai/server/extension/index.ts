// Browser-extension support helpers.
//
// This module is pure, dependency-free logic used by the /api/extension/*
// routes in server.ts. It owns job-meta extraction and the layered tracked-
// application duplicate lookup. Fit scoring belongs exclusively to AI Review
// in the main app; the extension does not estimate or review qualifications.
//
// URL normalization + the layered duplicate matcher live in the shared
// src/lib/jobIdentity.ts (importable from Node and the bundler both) so the
// client tracker and the extension route can never drift.

import { findDuplicateApplications, type DuplicateMatch } from "../../src/lib/jobIdentity.ts";

// Find the best stored-application duplicate for the current job page, using the
// LAYERED matcher (ATS posting id / normalized URL / requisition id in the JD /
// company+title+description overlap) instead of URL equality alone — the same job
// routinely appears under different URLs, so URL-only under-detects. Passing the
// captured page `text` as jobText enables the requisition-id and description tiers.
// Returns the strongest DuplicateMatch { application, level, confidence, evidence }
// or null when nothing matches. Back-compat: an empty/invalid input yields null,
// exactly like the old URL-only lookup.
export function findMatchingApplication(url: unknown, applications: unknown, pageText: unknown = ""): DuplicateMatch | null {
  if (!Array.isArray(applications) || applications.length === 0) return null;
  const target = {
    jobUrl: typeof url === "string" ? url : "",
    jobText: typeof pageText === "string" ? pageText : ""
  };
  if (!target.jobUrl.trim() && !target.jobText.trim()) return null;
  const matches = findDuplicateApplications(target, applications);
  return matches.length ? matches[0] : null;
}

// Best-effort title/company extraction from a job page title and body text.
// Conservative: returns only what it can read; never guesses an employer.
export function extractJobMeta(text: unknown, pageTitle: unknown): { title?: string; company?: string } {
  const meta: { title?: string; company?: string } = {};
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

  // 3. Imported ATS text may include explicit header lines even when the page
  // title is just wrapper chrome — but only fill what the trusted LinkedIn/Indeed
  // title parse (steps 1-2) didn't, so a stray "Company:" line in a JD body can't
  // clobber a correctly-parsed employer. These still win over the generic
  // page-title fallback (step 4) because that step is guarded on an empty field.
  if (body) {
    const roleLine = body.match(/^\s*(?:Role|Title):\s*(.+)$/im);
    if (roleLine && !meta.title) meta.title = roleLine[1].trim();

    const companyLine = body.match(/^\s*Company:\s*(.+)$/im);
    if (companyLine && !meta.company) meta.company = companyLine[1].trim();
  }

  // 4. Generic: first segment of the page title is the role.
  if (!meta.title && title) {
    const first = title.split(/[|–\-]/)[0]?.trim() ?? "";
    if (first.length >= 3 && first.length <= 100) meta.title = first;
  }

  // 5. Body company cues for a still-missing employer.
  if (!meta.company && body) {
    const introMatch = body.match(/^\s*([A-Z][A-Za-z0-9 .&-]{2,60})\s+is\b/m);
    if (introMatch) meta.company = introMatch[1].trim();
  }
  if (!meta.company && body) {
    const atMatch = body.match(/\bat\s+([A-Z][A-Za-z0-9\s,&.]{2,40}?)(?:\s*,|\s*\n)/m);
    if (atMatch) meta.company = atMatch[1].trim();
  }

  return meta;
}
