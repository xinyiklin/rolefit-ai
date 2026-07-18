// Job-posting import + ATS scraping: the /api/import-job route plus the HTML→text
// helpers and the Workday CXS / Greenhouse embedded-job resolvers. Split out of
// server.ts. The safe public-URL fetch, SSRF guards, and timeout handling live in
// ./network.ts; readBody/sendJson and the FetchTimeoutError type come from
// ./http.ts. resolveImportedJobText is exported for the browser-extension route,
// which resolves a captured Greenhouse link into the full posting body.

import type { IncomingMessage, ServerResponse } from "node:http";
import { FetchTimeoutError, readBody, sendJson } from "./http.ts";
import { BlockedHostError, DnsError, fetchPublicHtml, isPublicHttpUrl } from "./network.ts";

// Decode a numeric character reference, clamping control chars (which could
// inject fake structure into the prompt) and rejecting out-of-range values.
// fromCodePoint (not fromCharCode) so astral code points aren't truncated.
function fromCharRef(code: number): string {
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return "";
  if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return " ";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

// Convert posting HTML to readable text while keeping paragraph/bullet breaks
// (the front-end distiller and the description box both read better with them).
function htmlToText(html: unknown): string {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|ul|ol|tr|section|header|footer|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;|&ldquo;|&rdquo;/gi, '"')
    .replace(/&#39;|&rsquo;|&lsquo;|&apos;/gi, "'")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–")
    .replace(/&#(\d+);/g, (_, n) => fromCharRef(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => fromCharRef(parseInt(n, 16)))
    .replace(/&[a-z]+;/gi, " ")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function htmlAttr(tag: string, attr: string): string {
  const match = String(tag || "").match(new RegExp(`${attr}=["']([^"']*)["']`, "i"));
  return match?.[1] ?? "";
}

function metaContent(html: string, name: string): string {
  const meta = String(html || "")
    .match(/<meta\b[^>]*>/gi)
    ?.find((tag) => {
      const key = htmlAttr(tag, "name") || htmlAttr(tag, "property");
      return key.toLowerCase() === name.toLowerCase();
    });
  return meta ? htmlToText(htmlAttr(meta, "content")) : "";
}

function linkedInHeaderLines(html: string): string[] {
  const title = metaContent(html, "og:title") || metaContent(html, "twitter:title");
  const match = title.match(/^(.+?)\s+hiring\s+(.+?)\s+in\s+(.+?)\s*\|\s*LinkedIn\b/i);
  if (!match) return [];
  return [
    `Company: ${match[1].trim()}`,
    `Role: ${match[2].trim()}`,
    `Location: ${match[3].trim()}`
  ];
}

function linkedInCriteriaLines(html: string): string[] {
  const items = [...String(html || "").matchAll(/<li[^>]*class=["'][^"']*description__job-criteria-item[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi)];
  return items
    .map((item) => htmlToText(item[1]).split("\n").map((line) => line.trim()).filter(Boolean))
    .map((parts) => {
      if (parts.length < 2) return "";
      return `${parts[0].replace(/:$/, "")}: ${parts.slice(1).join(" ")}`;
    })
    .filter(Boolean);
}

function linkedInJobText(html: string): string {
  if (!/(\bshow-more-less-html__markup\b|\bdescription__job-criteria-item\b)/i.test(String(html || ""))) {
    return "";
  }
  const body = [...String(html || "").matchAll(/<div[^>]*class=["'][^"']*show-more-less-html__markup[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)]
    .map((match) => htmlToText(match[1]))
    .filter((text) => text.length > 80);
  if (!body.length) return "";

  const lines = [...linkedInHeaderLines(html), ...linkedInCriteriaLines(html), body.join("\n\n")];
  return htmlToText(lines.join("\n\n"));
}

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

function firstHtmlText(html: string, pattern: RegExp): string {
  const match = String(html || "").match(pattern);
  return match ? htmlToText(match[1]) : "";
}

function greenhouseEmbeddedJobText(html: string): string {
  const source = String(html || "");
  if (!/\bjob__description\b/i.test(source)) return "";

  const title = firstHtmlText(source, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const location = firstHtmlText(
    source,
    /<div\b[^>]*class=["'][^"']*\bjob__location\b[^"']*["'][^>]*>[\s\S]*?<div\b[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i
  );

  const descriptionStart = source.search(/<div\b[^>]*class=["'][^"']*\bjob__description\b[^"']*["'][^>]*>/i);
  if (descriptionStart < 0) return "";
  const rest = source.slice(descriptionStart);
  const endMarkers = [
    rest.search(/<div\b[^>]*class=["'][^"']*\bjob-alert\b/i),
    rest.search(/<div\b[^>]*class=["'][^"']*\bapplication--container\b/i),
    rest.search(/<div\b[^>]*class=["'][^"']*\bdivider\b/i)
  ].filter((index) => index > 0);
  const descriptionHtml = rest.slice(0, endMarkers.length ? Math.min(...endMarkers) : rest.length);
  const description = htmlToText(descriptionHtml);
  if (description.length < 200) return "";

  return htmlToText([
    title ? `Role: ${title}` : "",
    location ? `Location: ${location}` : "",
    description
  ].filter(Boolean).join("\n\n"));
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

async function importFromGreenhouse(jobUrl: URL, wrapperHtml = ""): Promise<string> {
  const appUrl = greenhouseJobAppUrl(jobUrl, wrapperHtml);
  if (!appUrl) return "";
  const cached = greenhouseTextCache.get(appUrl.href);
  if (cached && Date.now() - cached.at < GREENHOUSE_CACHE_TTL_MS) return cached.text;
  const response = await fetchPublicHtml(appUrl, { Accept: "text/html" });
  if (!response.ok) return "";
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

export async function resolveImportedJobText(text: unknown, url: unknown): Promise<string> {
  const fallbackText = String(text || "");
  let jobUrl: URL;
  try {
    jobUrl = new URL(String(url || ""));
  } catch {
    return fallbackText;
  }
  if (!isPublicHttpUrl(jobUrl)) return fallbackText;

  try {
    // Direct Greenhouse links already carry the board and token. Branded
    // careers wrappers often expose only gh_jid in the URL and keep the board
    // slug in their HTML, so fetch that wrapper once and resolve its canonical
    // Greenhouse job before falling back to captured page text.
    if (greenhouseJobAppUrl(jobUrl)) {
      const greenhouseText = await importFromGreenhouse(jobUrl);
      return greenhouseText || fallbackText;
    }
    const wrapperToken = greenhouseParam(
      jobUrl.searchParams.get("gh_jid") || jobUrl.searchParams.get("token"),
      /^\d{3,20}$/
    );
    if (!wrapperToken) return fallbackText;
    const wrapperResponse = await fetchPublicHtml(jobUrl, { Accept: "text/html" });
    if (!wrapperResponse.ok) return fallbackText;
    const wrapperHtml = await wrapperResponse.text();
    const greenhouseText = await importFromGreenhouse(jobUrl, wrapperHtml);
    return greenhouseText || fallbackText;
  } catch {
    return fallbackText;
  }
}

// Workday job pages render the description client-side, but expose it via their
// CXS JSON API. Rewrite a public job URL to that endpoint when we recognize the
// host. Career-site links use /Site/job/Loc/Title_R123 (older) or
// /Site/details/Title_R123 (newer share links); both map to .../wday/cxs/<tenant>/<site>/job/...
function workdayCxsUrl(u: URL): URL | null {
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

async function importFromWorkday(apiUrl: URL): Promise<string> {
  const response = await fetchPublicHtml(apiUrl, { Accept: "application/json" });
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

// Mirrors isLikelyProse in src/lib/jobExtract.ts. "$" stays out of the char
// class so salary lines like "$90k-$110k" are not penalized; "$(...)" jQuery
// calls are still caught by the JS-pattern test.
function isCodeShapedLine(t: string): boolean {
  const codeChars = (t.match(/[{}();=<>|]/g) ?? []).length;
  if (codeChars / t.length > 0.08) return true;
  return /function\s*\(|=>|==|\bvar\s|\$\(/.test(t);
}

// JS-only ATS pages (e.g. UltiPro) can clear the length gate with script and
// template junk. Weigh by characters, not lines: such pages hide a few huge
// code lines among dozens of one-char bullet/punctuation lines, so a
// line-count majority misses them. Letter-free lines count as unreadable too.
function isMostlyCodeShaped(text: string): boolean {
  let readable = 0;
  let unreadable = 0;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    if (isCodeShapedLine(t) || !/[a-zA-Z]/.test(t)) unreadable += t.length;
    else readable += t.length;
  }
  return unreadable >= readable;
}

export async function handleImportJob(req: IncomingMessage, res: ServerResponse): Promise<void> {
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

  try {
    // Prefer known ATS endpoints since their rendered pages are often JS-only;
    // fall back to a generic HTML scrape for everything else.
    const workdayApi = workdayCxsUrl(jobUrl);
    if (workdayApi) {
      const workdayText = await importFromWorkday(workdayApi);
      if (workdayText) {
        sendJson(res, 200, { text: workdayText.slice(0, 16_000) });
        return;
      }
    }

    const greenhouseText = await importFromGreenhouse(jobUrl);
    if (greenhouseText) {
      sendJson(res, 200, { text: greenhouseText.slice(0, 16_000) });
      return;
    }

    const response = await fetchPublicHtml(jobUrl);

    if (!response.ok) {
      sendJson(res, 400, {
        error: `The job page returned HTTP ${response.status}. Paste the job description text instead.`
      });
      return;
    }

    const html = await response.text();
    // A branded careers page can carry only gh_jid in its visible URL while an
    // embed script identifies the Greenhouse board. Resolve that canonical job
    // before the generic scraper accepts navigation/company chrome as a JD.
    const wrappedGreenhouseText = await importFromGreenhouse(jobUrl, html);
    if (wrappedGreenhouseText) {
      sendJson(res, 200, { text: wrappedGreenhouseText.slice(0, 16_000) });
      return;
    }
    const text = linkedInJobText(html) || htmlToText(html);

    if (text.length < 200 || isMostlyCodeShaped(text)) {
      sendJson(res, 400, { error: "Job page did not expose enough readable text. Paste it instead." });
      return;
    }
    sendJson(res, 200, { text: text.slice(0, 16_000) });
  } catch (error) {
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
