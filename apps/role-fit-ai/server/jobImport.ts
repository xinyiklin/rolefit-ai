// Job-posting import: the /api/import-job route and the extension resolver.
// This module owns recognized-source URL targets, fetch sequencing, caches, and
// HTTP outcomes; ./jobImportContent.ts owns HTML→text and exact-posting parsing,
// and ./network.ts performs every public fetch behind its SSRF guards.
// resolveImportedJobText is exported for the browser-extension routes, which
// keep the captured page text whenever a recognized source cannot resolve.

import type { IncomingMessage, ServerResponse } from "node:http";
import { FetchTimeoutError, readBody, sendJson } from "./http.ts";
import {
  BlockedHostError,
  DnsError,
  ResponseTooLargeError,
  fetchPublicHtml,
  isPublicHttpUrl
} from "./network.ts";
import type { FetchPublicHtmlDeps } from "./network.ts";
import {
  ashbyPostingText,
  dayforceJobText,
  decodeEntities,
  greenhouseEmbeddedJobText,
  htmlAttr,
  htmlToText,
  icimsJobText,
  isMostlyCodeShaped,
  jobPostingJsonLdText,
  jobviteMissingJob,
  linkedInJobText,
  oracleRequisitionText,
  pageShowsPosting,
  ukgOpportunityText,
  workablePostingText
} from "./jobImportContent.ts";

type FetchHtml = (url: URL, headers?: Record<string, string>) => ReturnType<typeof fetchPublicHtml>;
type Page = { status: number; ok: boolean; html: string };
type LoadPage = () => Promise<Page>;
// missing: a recognized source whose selected JD is unavailable. null: not recognized.
type Outcome = { text: string } | { missing: string } | { httpStatus: number };
type SourceOutcome = Outcome | null;

const MISSING_JOB = "Could not find this job's description on its job board. " +
  "Paste it instead, or capture the page with the browser extension.";
const MISSING_LINKEDIN = "LinkedIn did not expose this job's description. " +
  "Paste it instead, or capture the page with the browser extension.";
const found = (text: string): Outcome => (text ? { text } : { missing: MISSING_JOB });

// A provider answering 404/410 has no such posting; any other non-OK status
// (rate limit, outage) is reported as that status, not as a missing job.
class SourceHttpError extends Error {}

function sourceOk(response: { ok: boolean; status: number }): boolean {
  if (response.ok) return true;
  if (response.status === 404 || response.status === 410) return false;
  throw new SourceHttpError(`The job board returned HTTP ${response.status}.`);
}

function pageLoader(fetchHtml: FetchHtml, url: URL): LoadPage {
  let pending: Promise<Page> | undefined;
  return () => (pending ??= fetchHtml(url).then(async (response) => ({
    status: response.status,
    ok: response.ok,
    html: response.ok ? await response.text() : ""
  })));
}

// --- Greenhouse --------------------------------------------------------------

function greenhouseParam(value: unknown, pattern: RegExp): string {
  const param = String(value ?? "").trim();
  return pattern.test(param) ? param : "";
}

function greenhouseBoardFromWrapperHtml(html: string): string {
  const source = String(html || "");
  const patterns = [
    /(?:https?:)?\/\/boards\.greenhouse\.io\/embed\/job_board\/js\?[^"'<>]*?\bfor=([a-z0-9][a-z0-9_-]{0,80})(?=(?:&(?:amp;)?|["'<>\s]|$))/i,
    /(?:https?:)?\/\/job-boards\.greenhouse\.io\/embed\/job_app\?[^"'<>]*?\bfor=([a-z0-9][a-z0-9_-]{0,80})(?=(?:&(?:amp;)?|["'<>\s]|$))/i,
    /(?:https?:)?\/\/boards-api\.greenhouse\.io\/v1\/boards\/([a-z0-9][a-z0-9_-]{0,80})(?=\/)/i
  ];
  for (const pattern of patterns) {
    const board = greenhouseParam(source.match(pattern)?.[1], /^[a-z0-9][a-z0-9_-]{0,80}$/i);
    if (board) return board;
  }
  return "";
}

export function greenhouseJobAppUrl(u: URL, wrapperHtml = ""): URL | null {
  const isGreenhouseHost = /(^|\.)greenhouse\.io$/i.test(u.hostname);
  const boardFromSearch = greenhouseParam(
    u.searchParams.get("board") || u.searchParams.get("for"),
    /^[a-z0-9][a-z0-9_-]{0,80}$/i
  );
  const tokenFromSearch = greenhouseParam(u.searchParams.get("gh_jid") || u.searchParams.get("token"), /^\d{3,20}$/);
  const boardFromWrapper = tokenFromSearch ? greenhouseBoardFromWrapperHtml(wrapperHtml) : "";
  const board = boardFromSearch || boardFromWrapper;
  if (board && tokenFromSearch) {
    const appUrl = new URL("https://job-boards.greenhouse.io/embed/job_app");
    appUrl.searchParams.set("for", board);
    appUrl.searchParams.set("token", tokenFromSearch);
    return appUrl;
  }

  if (!isGreenhouseHost) return null;

  const pathParts = u.pathname.split("/").filter(Boolean);
  const jobIndex = pathParts.findIndex((part) => part === "jobs");
  const boardFromPath = jobIndex > 0 ? greenhouseParam(pathParts[jobIndex - 1], /^[a-z0-9][a-z0-9_-]{0,80}$/i) : "";
  const tokenFromPath = jobIndex >= 0 ? greenhouseParam(pathParts[jobIndex + 1], /^\d{3,20}$/) : "";
  if (!boardFromPath || !tokenFromPath) return null;

  const appUrl = new URL("https://job-boards.greenhouse.io/embed/job_app");
  appUrl.searchParams.set("for", boardFromPath);
  appUrl.searchParams.set("token", tokenFromPath);
  return appUrl;
}

// One extension import resolves the same posting TWICE within seconds —
// /api/extension/analyze (popup preview) and /api/extension/import
// (runExtensionPrepare) both land in resolveImportedJobText — so a successful
// Greenhouse extraction is cached briefly. Keyed by the CANONICAL embed URL
// (greenhouseJobAppUrl output, board+token validated), so two board links for
// the same posting share one entry and a key can never carry attacker-shaped
// text. Only non-empty successes are cached (a transient fetch failure must
// not stick for the TTL); the TTL is short (a posting doesn't change between
// popup and import); the map is capped with oldest-first eviction.
const GREENHOUSE_CACHE_TTL_MS = 120_000;
const GREENHOUSE_CACHE_MAX = 8;
const greenhouseTextCache = new Map<string, { text: string; at: number }>();
const ASHBY_CACHE_TTL_MS = 120_000;
const ASHBY_CACHE_MAX = 8;
const ashbyTextCache = new Map<string, { text: string; at: number }>();

async function importFromGreenhouse(fetchHtml: FetchHtml, appUrl: URL): Promise<string> {
  const cached = greenhouseTextCache.get(appUrl.href);
  if (cached && Date.now() - cached.at < GREENHOUSE_CACHE_TTL_MS) return cached.text;
  const response = await fetchHtml(appUrl, { Accept: "text/html" });
  if (!sourceOk(response)) return "";
  const html = await response.text();
  const text = greenhouseEmbeddedJobText(html);
  if (text) {
    greenhouseTextCache.set(appUrl.href, { text, at: Date.now() });
    if (greenhouseTextCache.size > GREENHOUSE_CACHE_MAX) {
      const oldest = greenhouseTextCache.keys().next().value;
      if (oldest !== undefined) greenhouseTextCache.delete(oldest);
    }
  }
  return text;
}

// --- Ashby -------------------------------------------------------------------

type AshbyTarget = { apiUrl: URL; jobId: string };

const ASHBY_JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ASHBY_BOARD_PATTERN = /^[a-z0-9][a-z0-9_-]{0,80}$/i;
const ASHBY_WRAPPER_BOARDS = new Map([
  ["joinhandshake.com", "handshake"],
  ["www.joinhandshake.com", "handshake"]
]);

function ashbyBoardTarget(board: string, jobId: string): AshbyTarget | null {
  if (!ASHBY_BOARD_PATTERN.test(board) || !ASHBY_JOB_ID_PATTERN.test(jobId)) return null;
  return {
    apiUrl: new URL(
      `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}?includeCompensation=true`
    ),
    jobId: jobId.toLowerCase()
  };
}

export function ashbyPostingApiTarget(u: URL): AshbyTarget | null {
  if (u.hostname.toLowerCase() === "jobs.ashbyhq.com") {
    const parts = u.pathname.split("/").filter(Boolean);
    return ashbyBoardTarget(parts[0] ?? "", parts[1] ?? "");
  }
  return ashbyBoardTarget(ASHBY_WRAPPER_BOARDS.get(u.hostname.toLowerCase()) ?? "", u.searchParams.get("ashby_jid") ?? "");
}

// A branded careers page with ashby_jid may embed its Ashby board. Exactly one
// valid board across recognized embed URLs resolves; conflicting or malformed
// evidence is reported as ambiguous rather than guessed.
function ashbyEmbedTarget(u: URL, html: string): AshbyTarget | "ambiguous" | null {
  const jobId = u.searchParams.get("ashby_jid") ?? "";
  if (!ASHBY_JOB_ID_PATTERN.test(jobId)) return null;
  const boards = [...html.matchAll(/(?:https?:)?\/\/jobs\.ashbyhq\.com\/([^/?#"'<>\s]+)\/embed\b/gi)].map((m) => m[1]);
  if (!boards.length) return null;
  const distinct = new Set(boards.map((board) => board.toLowerCase()));
  return (distinct.size === 1 && ashbyBoardTarget(boards[0], jobId)) || "ambiguous";
}

async function importFromAshby(fetchHtml: FetchHtml, target: AshbyTarget): Promise<string> {
  const cacheKey = `${target.apiUrl.href}#${target.jobId}`;
  const cached = ashbyTextCache.get(cacheKey);
  if (cached && Date.now() - cached.at < ASHBY_CACHE_TTL_MS) return cached.text;
  const response = await fetchHtml(target.apiUrl, { Accept: "application/json" });
  if (!sourceOk(response)) return "";
  let value: unknown;
  try {
    value = JSON.parse(await response.text()) as unknown;
  } catch {
    return "";
  }
  const text = ashbyPostingText(value, target.jobId);
  if (text) {
    ashbyTextCache.set(cacheKey, { text, at: Date.now() });
    if (ashbyTextCache.size > ASHBY_CACHE_MAX) {
      const oldest = ashbyTextCache.keys().next().value;
      if (oldest !== undefined) ashbyTextCache.delete(oldest);
    }
  }
  return text;
}

// A board can omit the job or exceed the byte cap; a direct Ashby job page may
// still carry that exact posting's JobPosting data. Only the size-cap error is
// recoverable — every other network rejection propagates.
async function resolveAshby(
  fetchHtml: FetchHtml,
  jobUrl: URL,
  target: AshbyTarget,
  loadPage: LoadPage
): Promise<SourceOutcome> {
  let text = "";
  try {
    text = await importFromAshby(fetchHtml, target);
  } catch (error) {
    if (!(error instanceof ResponseTooLargeError)) throw error;
  }
  if (text || jobUrl.hostname.toLowerCase() !== "jobs.ashbyhq.com") return found(text);
  const page = await loadPage();
  return found(page.ok ? jobPostingJsonLdText(page.html, jobUrl) : "");
}

// --- Workday -----------------------------------------------------------------

// Workday job pages render the description client-side, but expose it via their
// CXS JSON API. Rewrite a public job URL to that endpoint when we recognize the
// host. Career-site links use /Site/job/Loc/Title_R123 (older) or
// /Site/details/Title_R123 (newer share links); both map to .../wday/cxs/<tenant>/<site>/job/...
export function workdayCxsUrl(u: URL): URL | null {
  if (!/(^|\.)myworkdayjobs\.com$/i.test(u.hostname)) return null;
  const tenant = u.hostname.split(".")[0];
  const segs = u.pathname.split("/").filter(Boolean);
  const sepIdx = segs.findIndex((seg) => seg === "job" || seg === "details");
  if (sepIdx < 1 || sepIdx === segs.length - 1) return null; // need a site segment + a job path
  const site = segs[sepIdx - 1];
  const jobPath = segs.slice(sepIdx + 1).join("/");
  if (!tenant || !site || !jobPath) return null;
  try {
    return new URL(`https://${u.hostname}/wday/cxs/${tenant}/${site}/job/${jobPath}`);
  } catch {
    return null;
  }
}

async function importFromWorkday(fetchHtml: FetchHtml, apiUrl: URL): Promise<string> {
  const response = await fetchHtml(apiUrl, { Accept: "application/json" });
  if (!response.ok) return "";
  // Workday CXS JSON is boundary data — keep each field `unknown` and coerce.
  let info: { jobDescription?: unknown; title?: unknown; location?: unknown } | undefined;
  try {
    info = JSON.parse(await response.text())?.jobPostingInfo;
  } catch {
    return "";
  }
  if (!info) return "";
  const body = htmlToText(info.jobDescription);
  if (body.length < 200) return "";
  const header = [info.title, info.location].filter(Boolean).join(" · ");
  return (header ? `${header}\n\n` : "") + body;
}

// --- Page-configured sources -------------------------------------------------

function oracleJobId(u: URL): string {
  const host = u.hostname.toLowerCase();
  if (!host.endsWith(".oraclecloud.com") && host !== "enterpriseplatform.dell.com") return "";
  return u.pathname.match(
    /^\/hcmUI\/CandidateExperience\/[a-z]{2}(?:-[a-z]{2})?\/sites\/[a-z0-9_-]{1,80}\/job\/(\d{1,20})(?:\/|$)/i
  )?.[1] ?? "";
}

function oracleSiteNumber(html: string): string {
  const sites = new Set([...html.matchAll(/\bdata-sitenumber=["']([^"']*)["']/gi)].map((m) => m[1]));
  const [site = ""] = sites;
  return sites.size === 1 && /^[a-z0-9_]{1,40}$/i.test(site) ? site : "";
}

async function resolveOracle(fetchHtml: FetchHtml, jobUrl: URL, jobId: string, html: string): Promise<SourceOutcome> {
  const site = oracleSiteNumber(html);
  if (!site) return found("");
  const apiUrl = new URL("/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails", jobUrl.origin);
  apiUrl.searchParams.set("onlyData", "true");
  apiUrl.searchParams.set("expand", "all");
  apiUrl.searchParams.set("finder", `ById;Id="${jobId}",siteNumber=${site}`);
  const response = await fetchHtml(apiUrl, { Accept: "application/json" });
  if (!sourceOk(response)) return found("");
  try {
    return found(oracleRequisitionText(JSON.parse(await response.text()), jobId));
  } catch {
    return found("");
  }
}

function icimsJobId(u: URL): string {
  if (!/^[a-z0-9-]+\.icims\.com$/i.test(u.hostname)) return "";
  return u.pathname.match(/^\/jobs\/(\d{1,12})(?:\/|$)/)?.[1] ?? "";
}

// The careers page frames its job body; take the first same-origin frame for
// the same job id (attribute entities decoded), and never crawl further.
async function resolveIcims(fetchHtml: FetchHtml, jobUrl: URL, jobId: string, html: string): Promise<SourceOutcome> {
  const direct = icimsJobText(html);
  if (direct) return found(direct);
  const frame = (html.match(/<iframe\b[^>]*>/gi) ?? [])
    .flatMap((tag) => {
      try {
        return [new URL(decodeEntities(htmlAttr(tag, "src")), jobUrl)];
      } catch {
        return [];
      }
    })
    .find((url) => url.origin === jobUrl.origin && icimsJobId(url) === jobId);
  if (!frame) return found("");
  const response = await fetchHtml(frame, { Accept: "text/html" });
  return found(sourceOk(response) ? icimsJobText(await response.text()) : "");
}

function dayforceJobId(u: URL): string {
  if (u.hostname.toLowerCase() !== "jobs.dayforcehcm.com") return "";
  return u.pathname.match(/\/jobs\/(\d{1,12})(?:\/|$)/)?.[1] ?? "";
}

function ukgOpportunityId(u: URL): string {
  if (!/^recruiting\d*\.ultipro\.com$/i.test(u.hostname) || !/\/OpportunityDetail\/?$/i.test(u.pathname)) return "";
  const id = u.searchParams.get("opportunityId") ?? "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : "";
}

function workableTarget(u: URL): { apiUrl: URL; shortcode: string } | null {
  if (u.hostname.toLowerCase() !== "apply.workable.com") return null;
  const [account = "", marker, shortcode = ""] = u.pathname.split("/").filter(Boolean);
  if (marker !== "j" || !/^[a-z0-9][a-z0-9_-]{0,80}$/i.test(account) || !/^[a-z0-9]{6,20}$/i.test(shortcode)) return null;
  return { apiUrl: new URL(`https://apply.workable.com/api/v2/accounts/${account}/jobs/${shortcode}`), shortcode };
}

async function resolveWorkable(fetchHtml: FetchHtml, target: { apiUrl: URL; shortcode: string }): Promise<SourceOutcome> {
  const response = await fetchHtml(target.apiUrl, { Accept: "application/json" });
  if (!sourceOk(response)) return found("");
  try {
    return found(workablePostingText(JSON.parse(await response.text()), target.shortcode));
  } catch {
    return found("");
  }
}

// --- Source resolution -------------------------------------------------------

// Resolves a recognized public job source to its exact selected posting. Shared
// by URL import and extension enrichment; the page is fetched lazily and once.
async function resolveKnownSource(fetchHtml: FetchHtml, jobUrl: URL, loadPage: LoadPage): Promise<SourceOutcome> {
  const ashbyTarget = ashbyPostingApiTarget(jobUrl);
  if (ashbyTarget) return resolveAshby(fetchHtml, jobUrl, ashbyTarget, loadPage);

  // A CXS miss continues to the page: some tenants serve a readable page.
  const workdayApi = workdayCxsUrl(jobUrl);
  if (workdayApi) {
    const text = await importFromWorkday(fetchHtml, workdayApi);
    return text ? { text } : null;
  }

  const greenhouseDirect = greenhouseJobAppUrl(jobUrl);
  if (greenhouseDirect) return found(await importFromGreenhouse(fetchHtml, greenhouseDirect));

  const workable = workableTarget(jobUrl);
  if (workable) return resolveWorkable(fetchHtml, workable);

  const oracleId = oracleJobId(jobUrl);
  const icimsId = icimsJobId(jobUrl);
  const dayforceId = dayforceJobId(jobUrl);
  const ukgId = ukgOpportunityId(jobUrl);
  const wrapperToken = /^\d{3,20}$/.test(jobUrl.searchParams.get("gh_jid") || jobUrl.searchParams.get("token") || "");
  const wrapperAshby = ASHBY_JOB_ID_PATTERN.test(jobUrl.searchParams.get("ashby_jid") ?? "");
  if (!oracleId && !icimsId && !dayforceId && !ukgId && !wrapperToken && !wrapperAshby) return null;

  const page = await loadPage();
  if (!page.ok) return { httpStatus: page.status };
  if (oracleId) return resolveOracle(fetchHtml, jobUrl, oracleId, page.html);
  if (icimsId) return resolveIcims(fetchHtml, jobUrl, icimsId, page.html);
  if (dayforceId) return found(dayforceJobText(page.html, dayforceId));
  if (ukgId) return found(ukgOpportunityText(page.html, ukgId));

  // Branded wrappers resolve only with board evidence in their HTML; without
  // it, an unfamiliar page stays a generic import.
  const greenhouseWrapped = greenhouseJobAppUrl(jobUrl, page.html);
  if (greenhouseWrapped) return found(await importFromGreenhouse(fetchHtml, greenhouseWrapped));
  const ashbyEmbed = ashbyEmbedTarget(jobUrl, page.html);
  if (ashbyEmbed === "ambiguous") return found("");
  if (ashbyEmbed) return found(await importFromAshby(fetchHtml, ashbyEmbed));
  return null;
}

// Generic pages keep readable text that already shows the JD; a bound
// JobPosting replaces text that is unreadable or lacks it. Recognized shells
// without a JD fail.
function genericPageOutcome(jobUrl: URL, html: string): Outcome {
  const host = jobUrl.hostname.toLowerCase();
  if (/(^|\.)linkedin\.com$/.test(host) && /^\/jobs\/view\//i.test(jobUrl.pathname)) {
    const text = linkedInJobText(html) || jobPostingJsonLdText(html, jobUrl);
    return text ? { text } : { missing: MISSING_LINKEDIN };
  }
  if (host === "jobs.jobvite.com" && jobviteMissingJob(html)) return found("");
  const text = linkedInJobText(html) || htmlToText(html);
  const readable = text.length >= 200 && !isMostlyCodeShaped(text);
  // Workday pages carry boilerplate JobPosting data; CXS is their structured source.
  const structured = workdayCxsUrl(jobUrl) ? "" : jobPostingJsonLdText(html, jobUrl);
  if (structured && !(readable && pageShowsPosting(text, structured))) return { text: structured };
  if (!readable) return { missing: "Job page did not expose enough readable text. Paste it instead." };
  return { text };
}

export async function resolveImportedJobText(
  text: unknown,
  url: unknown,
  deps: FetchPublicHtmlDeps = {}
): Promise<string> {
  const fallbackText = String(text || "");
  let jobUrl: URL;
  try {
    jobUrl = new URL(String(url || ""));
  } catch {
    return fallbackText;
  }
  if (!isPublicHttpUrl(jobUrl)) return fallbackText;

  const fetchHtml: FetchHtml = (target, headers = {}) => fetchPublicHtml(target, headers, deps);
  try {
    const outcome = await resolveKnownSource(fetchHtml, jobUrl, pageLoader(fetchHtml, jobUrl));
    return outcome && "text" in outcome ? outcome.text : fallbackText;
  } catch {
    return fallbackText;
  }
}

export async function handleImportJob(
  req: IncomingMessage,
  res: ServerResponse,
  deps: FetchPublicHtmlDeps = {}
): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST." });
    return;
  }

  let jobUrl: URL;
  try {
    const { url } = JSON.parse(await readBody(req, 10_000));
    jobUrl = new URL(String(url ?? "").slice(0, 2_000));
  } catch {
    sendJson(res, 400, { error: "Enter a valid job posting URL." });
    return;
  }

  if (!isPublicHttpUrl(jobUrl)) {
    sendJson(res, 400, { error: "Enter a public http or https job posting URL." });
    return;
  }

  const fetchHtml: FetchHtml = (target, headers = {}) => fetchPublicHtml(target, headers, deps);
  try {
    const loadPage = pageLoader(fetchHtml, jobUrl);
    let outcome = await resolveKnownSource(fetchHtml, jobUrl, loadPage);
    if (!outcome) {
      const page = await loadPage();
      outcome = page.ok ? genericPageOutcome(jobUrl, page.html) : { httpStatus: page.status };
    }
    if ("text" in outcome) {
      sendJson(res, 200, { text: outcome.text.slice(0, 16_000) });
    } else if ("missing" in outcome) {
      sendJson(res, 400, { error: outcome.missing });
    } else {
      sendJson(res, 400, {
        error: `The job page returned HTTP ${outcome.httpStatus}. Paste the job description text instead.`
      });
    }
  } catch (error) {
    if (error instanceof SourceHttpError) {
      sendJson(res, 400, { error: `${error.message} Paste the job description text instead.` });
      return;
    }
    if (error instanceof BlockedHostError) {
      sendJson(res, 400, { error: `${error.message} Paste the job description text instead.` });
      return;
    }
    if (error instanceof DnsError) {
      sendJson(res, 400, { error: "Could not resolve that URL's host. Check the link or paste the text instead." });
      return;
    }
    if (error instanceof FetchTimeoutError) {
      sendJson(res, 504, { error: "Fetching the job page timed out. Paste the job description text instead." });
      return;
    }
    sendJson(res, 400, { error: "This site blocked direct import. Paste the job description text instead." });
  }
}
