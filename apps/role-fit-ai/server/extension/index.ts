// Browser-extension support helpers.
//
// This module is pure, dependency-free logic used by the /api/extension/*
// routes in server.ts. It owns job-meta extraction and the layered tracked-
// application duplicate lookup. Fit judgment belongs to compact Fit Assessment
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

// Role and employer from a job board's own page-title forms only:
// Handshake "<Title> | <Company> | Handshake"; LinkedIn "<Title> at <Company> |
// LinkedIn", "<Title> | <Company> | LinkedIn" and "<Company> hiring <Title> in
// <Place> | LinkedIn" (after its "(3) " unread count); Indeed "<Title> - <Company>
// - <Place> - Indeed.com" with exactly those three fields. Anything else yields nothing.
export function jobBoardTitleMeta(pageTitle: unknown): { title?: string; company?: string } {
  const title = typeof pageTitle === "string" ? pageTitle.trim().replace(/^\(\d+\)\s+/, "") : "";
  if (!title) return {};
  // One line each, so a title holding line breaks cannot add labelled lines.
  const line = (value: string) => value.replace(/\s+/g, " ").trim();
  const found = (role: string, company: string) => (line(role) && line(company) ? { title: line(role), company: line(company) } : {});
  const segments = title.split("|");
  const board = segments.length >= 2 ? segments.at(-1)!.trim().toLowerCase() : "";
  // The pipe forms come first, so " at " inside a role ("Work at Home") never splits it.
  if ((board === "handshake" && segments.length >= 3) || (board === "linkedin" && segments.length === 3)) {
    return found(segments.slice(0, -2).join("|"), segments.at(-2)!);
  }
  const at = /\s+at\s+/i.exec(title);
  const afterAt = at ? title.slice(at.index + at[0].length) : "";
  // A spaced hyphen separates fields, so "Coca-Cola" stays one employer.
  const separator = afterAt.search(/[|–]|\s-\s/);
  if (at && at.index > 0 && separator > 0 && /linkedin/i.test(afterAt.slice(separator))) {
    // A second " at " ("Work at Home at Acme") leaves the split unclear.
    return /\s+at\s+/i.test(afterAt.slice(0, separator)) ? {} : found(title.slice(0, at.index), afterAt.slice(0, separator));
  }
  if (board === "linkedin") {
    // "<Company> hiring <Title> in <Place>", with the same lowercase markers as og:title.
    const hiring = /^(.+?) hiring (.+) in .+$/.exec(segments[0].trim());
    return hiring ? found(hiring[2], hiring[1]) : {};
  }
  // Exactly role, employer and place, so a role holding " - " is never split.
  const indeed = /\s[-|–]\s*Indeed(?:\.[a-z.]+)?\s*$/i.exec(title);
  const fields = indeed ? title.slice(0, indeed.index).split(/\s-\s/) : [];
  return fields.length === 3 ? found(fields[0], fields[1]) : {};
}

const JOB_BOARD_HOST = /(?:^|\.)(?:linkedin\.com|indeed\.(?:com|co\.[a-z]{2}|com\.[a-z]{2}|[a-z]{2})|joinhandshake\.com)$/i;

// Labelled lines the app's posting parser reads, taken from a job board's own page
// title: LinkedIn and Indeed captures keep only the description element.
export function jobBoardHeader(url: string, pageTitle: unknown): string {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return "";
  }
  if (!JOB_BOARD_HOST.test(host)) return "";
  const { title, company } = jobBoardTitleMeta(pageTitle);
  return title && company ? `Job title: ${title}\nCompany: ${company}\n\n` : "";
}

// Best-effort title/company extraction from a job page title and body text.
// Conservative: returns only what it can read; never guesses an employer.
// Any site supplies both inputs and the analyze route runs this synchronously
// (title <= 500, text <= 50,000 characters), so titles are split rather than
// matched, and the whitespace before an anchored body label cannot cross a
// line, so no anchor rescans later lines; backtracking stays bounded.
export function extractJobMeta(text: unknown, pageTitle: unknown): { title?: string; company?: string } {
  const meta: { title?: string; company?: string } = { ...jobBoardTitleMeta(pageTitle) };
  const title = typeof pageTitle === "string" ? pageTitle.trim() : "";
  const body = typeof text === "string" ? text : "";

  // Any site: "<Title> - <Company> - <Location> | ..."
  if ((!meta.title || !meta.company) && title) {
    // Only a spaced hyphen separates fields, so "Front-End Developer" stays whole.
    const dashed = title.slice(0, Math.max(0, title.lastIndexOf("|"))).split(/\s-\s/);
    const role = dashed[0]?.trim() ?? "";
    const company = dashed[1]?.trim() ?? "";
    if (dashed.length >= 3 && role && company && dashed.slice(2).join(" - ")) {
      if (!meta.title) meta.title = role;
      if (!meta.company) meta.company = company;
    }
  }

  // 3. Imported ATS text may include explicit header lines even when the page
  // title is just wrapper chrome — but only fill what the trusted LinkedIn/Indeed
  // title parses above didn't, so a stray "Company:" line in a JD body can't
  // clobber a correctly-parsed employer. These still win over the generic
  // page-title fallback (step 4) because that step is guarded on an empty field.
  if (body) {
    const roleLine = body.match(/^[^\S\r\n\u2028\u2029]*(?:Role|Title):\s*(.+)$/im);
    if (roleLine && !meta.title) meta.title = roleLine[1].trim();

    const companyLine = body.match(/^[^\S\r\n\u2028\u2029]*Company:\s*(.+)$/im);
    if (companyLine && !meta.company) meta.company = companyLine[1].trim();
  }

  // 4. Generic: first segment of the page title is the role.
  if (!meta.title && title) {
    const first = title.split(/[|–]|\s-\s/)[0]?.trim() ?? "";
    if (first.length >= 3 && first.length <= 100) meta.title = first;
  }

  // 5. Body company cues for a still-missing employer.
  if (!meta.company && body) {
    const introMatch = body.match(/^[^\S\r\n\u2028\u2029]*([A-Z][A-Za-z0-9 .&-]{2,60})\s+is\b/m);
    if (introMatch) meta.company = introMatch[1].trim();
  }
  if (!meta.company && body) {
    const atMatch = body.match(/\bat\s+([A-Z][A-Za-z0-9\s,&.]{2,40}?)(?:\s*,|\s*\n)/m);
    if (atMatch) meta.company = atMatch[1].trim();
  }

  return meta;
}
