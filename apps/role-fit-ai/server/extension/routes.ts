// Browser-extension HTTP routes and the pending-import inbox queue. Split out of
// server.ts; the pure keyword/dedupe helpers stay in ./index.ts and are
// imported here.
//
// The inbox queue is module-level state (single-process local server), exactly
// as it lived in server.ts. cleanExtensionClaimToken is a pure export because
// the server dispatcher also needs it to sanitize the inbox route's query param.
//
// The two shared helpers that cross the module boundary — resolveImportedJobText
// (from ../jobImport.ts) and readWorkspaceBaseResume (from ../workspace.ts) —
// plus jobWorkspaceDir are imported directly now that those subsystems are their
// own modules, so no dependency-injection factory is needed.

import type { IncomingMessage, ServerResponse } from "node:http";
import { readBody, sendJson } from "../http.ts";
import { readApplications } from "../applications/index.ts";
import { jobWorkspaceDir } from "../workspace.ts";
import { resolveImportedJobText } from "../jobImport.ts";
import { findMatchingApplication, extractJobMeta } from "./index.ts";

// Pending browser-extension import. `status` is "distilling" while the server
// PREPARES the posting text in the BACKGROUND (resolving the raw capture — e.g.
// fetching the full JD for a Greenhouse link — which survives the popup closing
// on focus loss), then "done". The AI distill itself is NOT run here: the server
// can't read the app tab's localStorage AI settings, so distilling server-side
// used the env-default provider instead of the tab's selected Distill provider.
// Instead the entry is delivered with `fields: null` and the receiving tab runs
// the distill client-side with its OWN Distill provider (see useExtensionInbox →
// distillJobPosting). `id` guards against a newer import landing while an older
// prepare is still in flight.
// QUEUE of pending imports, not a single slot. Each browser tab is an
// independent session, so imports must not clobber one another and one tab's
// import must not surface in another tab. Each entry is CLAIMED by the first
// tab to poll it (by the tab's session id); only that tab then sees its
// "distilling" → "done" lifecycle, so an import in one tab never pops the card
// in another. A claim is refreshed on every poll (lastSeenAt) and released when
// the owning tab goes quiet, so a claimed-then-closed import isn't stranded.
// Entry: { id, text, url, fields, autoTailor, distillAi, status, claimedBy,
// claimToken, createdAt, lastSeenAt }. `distillAi` (from the popup's "Distill
// with AI" toggle, default true) tells the claiming tab whether to run the AI
// distiller or fall straight to the deterministic parser.
type InboxEntry = {
  id: number;
  text: string;
  url: string;
  fields: null;
  autoTailor: boolean;
  distillAi: boolean;
  status: "distilling" | "done";
  claimedBy: string | null;
  claimToken: string | null;
  createdAt: number;
  lastSeenAt: number;
};
let extensionInbox: InboxEntry[] = [];
let extensionImportSeq = 0;
let extensionPreparing = false;
// Bound the queue: drop entries older than the TTL (a tab that claimed then
// closed before draining, or an import no tab ever picked up) and cap the count.
const EXTENSION_IMPORT_TTL_MS = 10 * 60 * 1000;
const EXTENSION_INBOX_MAX = 8;
// A claiming tab refreshes its claim on every poll (the client polls ~1.5s while
// an import is distilling). If a claim isn't refreshed within this window the
// owning tab is gone (closed/crashed), so the claim is released for re-acquisition
// — otherwise a claimed-then-closed import would strand until the 10-min TTL.
const EXTENSION_CLAIM_STALE_MS = 8 * 1000;

export function cleanExtensionClaimToken(value: unknown): string {
  const token = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9._:-]{8,128}$/.test(token) ? token : "";
}

function pruneExtensionInbox(now: number): void {
  extensionInbox = extensionInbox.filter((e) => now - e.createdAt < EXTENSION_IMPORT_TTL_MS);
  if (extensionInbox.length > EXTENSION_INBOX_MAX) {
    // Over the cap: drop the OLDEST entries first, but never an in-flight prepare.
    // Evicting a "distilling" entry would lose its resolved text — runExtensionPrepare
    // can no longer find its id, so the entry is silently dropped and the owning
    // tab polls forever. Keep every "distilling" entry plus the newest settled ones.
    let overflow = extensionInbox.length - EXTENSION_INBOX_MAX;
    extensionInbox = extensionInbox.filter((e) => {
      if (overflow > 0 && e.status !== "distilling") {
        overflow -= 1;
        return false;
      }
      return true;
    });
  }
}

// Release claims whose owning tab has gone quiet so the import can be re-acquired
// rather than stranded. The claimToken is PRESERVED on release: a token-bearing
// entry stays reserved for its fresh tab (only a request presenting the matching
// token can re-acquire it), so releasing a stale claim never hands a token entry
// to a different tab. Only token-less (legacy) entries fall back to another tab.
function releaseStaleExtensionClaims(now: number): void {
  for (const entry of extensionInbox) {
    if (entry.claimedBy && now - (entry.lastSeenAt ?? entry.createdAt) > EXTENSION_CLAIM_STALE_MS) {
      entry.claimedBy = null;
    }
  }
}

// Prepare a background extension import: resolve the raw captured text into the
// job text worth tailoring (e.g. fetch the full JD for a Greenhouse link — a
// server-side step the browser can't do), store it, and settle the entry to
// "done". SERIALIZED so a burst of imports can't fan out parallel fetches. The AI
// distill is intentionally NOT run here — the entry is left with `fields: null` so
// the receiving tab distills client-side with its own selected Distill provider.
// Always settles to "done" (even on a resolve failure) so the owning tab never
// polls forever; the tab then distills whatever raw text was captured.
async function runExtensionPrepare(importId: number, text: string, url: string): Promise<void> {
  extensionPreparing = true;
  try {
    const jobText = await resolveImportedJobText(text, url);
    const done = extensionInbox.find((e) => e.id === importId);
    if (done) {
      done.text = jobText.slice(0, 50_000);
      done.status = "done"; // fields stays null → the tab distills client-side
    }
  } catch {
    const failed = extensionInbox.find((e) => e.id === importId);
    if (failed) failed.status = "done"; // keep the raw captured text → the tab distills it
  } finally {
    extensionPreparing = false;
    // Chain to the next un-prepared import (the one we just finished is now
    // "done", so it won't be re-selected).
    const next = extensionInbox.find((e) => e.status === "distilling");
    if (next) void runExtensionPrepare(next.id, next.text, next.url);
  }
}

// Browser-extension API. These routes are reached cross-origin from a
// chrome-extension:// (or moz-/safari-) page, so they bypass the localhost
// same-origin CSRF guard (dispatched BEFORE it) and instead validate the
// extension Origin scheme directly. They never write resume data. The analyze
// route is a read-only keyword triage; the import route appends a captured job page
// to a claimable inbox queue AND kicks off a background PREPARE step (serialized
// via runExtensionPrepare) that only resolves the raw text (no provider call) —
// the AI distill runs later in the receiving tab with its own Distill provider.
// The routes remain extension-Origin-gated and never write resume data.
const EXTENSION_ORIGIN_SCHEMES = ["chrome-extension://", "moz-extension://", "safari-web-extension://"];

// Optional HARD allowlist of exact extension origins, comma-separated, e.g.
//   EXTENSION_ALLOWED_ORIGINS="chrome-extension://<id>,moz-extension://<uuid>"
// When set, ONLY those origins may reach the extension routes — locking out every
// other installed extension that can also see localhost. When unset (default),
// any well-formed extension-scheme origin is accepted: a locally-loaded
// extension's origin is browser/profile-specific (Chrome derives the id from a
// key; Firefox uses a random per-install UUID), so it can't be pinned ahead of
// time without breaking the user's own extension. Read the exact value to lock
// down from the extension page's console: `location.origin`.
//
// Read LAZILY (memoized on first request), not at module load: this module is
// imported by server.ts before its top-level `await loadLocalEnv()` runs, so a
// module-load-time read would freeze the allowlist BEFORE `.env` is parsed and
// silently turn an `.env`-configured lockdown into a no-op. Requests only
// arrive after listen(), which is after loadLocalEnv(), so first-request
// evaluation observes the loaded values.
let extensionAllowedOrigins: Set<string> | null = null;
function allowedExtensionOrigins(): Set<string> {
  extensionAllowedOrigins ??= new Set(
    String(process.env.EXTENSION_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean)
  );
  return extensionAllowedOrigins;
}

function isAllowedExtensionOrigin(origin: string | undefined): origin is string {
  if (!origin) return false; // never allow an absent Origin (a same-machine process/page)
  const allowlist = allowedExtensionOrigins();
  if (allowlist.size > 0) return allowlist.has(origin);
  return EXTENSION_ORIGIN_SCHEMES.some((scheme) => origin.startsWith(scheme));
}

// analyze + import: called cross-origin by the extension popup. Require a
// recognized extension-scheme Origin (a real chrome/moz/safari extension fetch
// always sends one) and reflect that exact Origin back — never a bare "*", and
// never allow an absent Origin, so no same-machine process or web page can
// reach these by omitting the header.
export async function handleExtensionRoutes(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  const origin = req.headers.origin;
  if (!isAllowedExtensionOrigin(origin)) {
    sendJson(res, 403, { error: "Forbidden." });
    return;
  }

  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.writeHead(204);
    res.end();
    return;
  }

  if (pathname === "/api/extension/analyze") {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Use POST." });
      return;
    }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse((await readBody(req, 2_000_000)) || "{}");
    } catch {
      sendJson(res, 400, { error: "Invalid JSON." });
      return;
    }
    const capturedText = typeof body.text === "string" ? body.text.slice(0, 50_000) : "";
    const url = typeof body.url === "string" ? body.url.slice(0, 2_000) : "";
    const pageTitle = typeof body.pageTitle === "string" ? body.pageTitle.slice(0, 500) : undefined;
    if (!capturedText.trim() || !url.trim()) {
      sendJson(res, 400, { error: "A job page text and url are required." });
      return;
    }
    const text = await resolveImportedJobText(capturedText, url);

    const { title, company } = extractJobMeta(text, pageTitle);

    // The extension intentionally does not read or score the base resume. It
    // identifies/imports the posting; AI Review in the main app owns fit.
    let previousApp: { id: string; status: string; appliedAt: string | null } | null = null;
    let duplicateMatch: { level: string; confidence: string; evidence: string[] } | null = null;
    try {
      const apps = await readApplications(jobWorkspaceDir);
      // Layered lookup (posting id / normalized URL / requisition id / company +
      // title + description overlap) with the captured page text as jobText, so a
      // duplicate is caught even when the URL differs across boards. previousApp
      // is built from the BEST match, keeping its existing shape.
      const best = findMatchingApplication(url, apps, text);
      if (best) {
        // The matched record is a full stored application (readApplications), not
        // just the DuplicateCandidate fields the matcher's return type exposes.
        const app = best.application as {
          id: string;
          status: string;
          appliedAt?: string;
        };
        previousApp = {
          id: app.id,
          status: app.status,
          appliedAt: app.appliedAt || null
        };
        duplicateMatch = {
          level: best.level,
          confidence: best.confidence,
          evidence: Array.isArray(best.evidence) ? best.evidence.slice(0, 3) : []
        };
      }
    } catch {
      // A corrupt tracker must not become a false "no duplicate" result. That
      // could prompt another application while the source data still needs repair.
      sendJson(res, 500, { error: "The application tracker could not be checked safely." });
      return;
    }

    sendJson(res, 200, {
      title: title ?? null,
      company: company ?? null,
      previousApp,
      match: duplicateMatch
    });
    return;
  }

  if (pathname === "/api/extension/import") {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Use POST." });
      return;
    }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse((await readBody(req, 2_000_000)) || "{}");
    } catch {
      sendJson(res, 400, { error: "Invalid JSON." });
      return;
    }
    const text = typeof body.text === "string" ? body.text.slice(0, 50_000) : "";
    const url = typeof body.url === "string" ? body.url.slice(0, 2_000) : "";
    const autoTailor = body.autoTailor === true;
    // Default TRUE for back-compat: older extension versions send no distillAi
    // field, and their behavior was to distill. Only an explicit `false` opts out.
    const distillAi = body.distillAi !== false;
    const claimToken = cleanExtensionClaimToken(body.claimToken);
    if (!text.trim() || !url.trim()) {
      sendJson(res, 400, { error: "A job page text and url are required." });
      return;
    }
    // Store a "distilling" placeholder and return IMMEDIATELY so the popup can
    // redirect without blocking (extension popups close on focus loss, which would
    // otherwise abort an awaited fetch). A BACKGROUND prepare step then resolves
    // the raw text (e.g. the full Greenhouse JD), server-side, independent of any
    // client connection; the app polls the inbox and, once status flips to "done",
    // distills the text client-side with the tab's Distill provider. fields is
    // always null here — the server no longer distills, so an import never carries
    // an env-default-provider brief the tab didn't ask for.
    const importId = (extensionImportSeq += 1);
    const now = Date.now();
    // Append (never overwrite) so a second import can't interrupt an in-flight
    // distill — each import is its own claimable entry.
    extensionInbox.push({
      id: importId,
      text,
      url,
      fields: null,
      autoTailor,
      distillAi,
      status: "distilling",
      claimedBy: null,
      claimToken: claimToken || null,
      createdAt: now,
      lastSeenAt: now,
    });
    pruneExtensionInbox(now);
    sendJson(res, 200, { ok: true });
    // Kick the serialized prepare step only when idle; if one is already running it
    // will pick up this import when it settles (queue, never fan out).
    if (!extensionPreparing) void runExtensionPrepare(importId, text, url);
    return;
  }

  sendJson(res, 404, { error: "Not found." });
}

// Polled same-origin by the app (useExtensionInbox), with the polling tab's
// session id in `tabId`. Returns at most ONE import per tab: the entry this tab
// already claimed, else the oldest unclaimed entry (which it then claims). Only
// the claiming tab sees that import's "distilling" → "done" lifecycle, so a
// distill started in one tab never pops the card in another. Drains the entry on
// hand-off. Stays behind the localhost CSRF/Host guard (dispatched after it) and
// sends no CORS header, so a foreign page can neither reach nor read it.
export async function handleExtensionInbox(req: IncomingMessage, res: ServerResponse, tabId: string, claimToken: string): Promise<void> {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Use GET." });
    return;
  }
  const now = Date.now();
  pruneExtensionInbox(now);
  // Free up claims held by tabs that stopped polling (closed/crashed) before
  // selecting, so a claimed-then-closed import isn't stranded until the TTL.
  releaseStaleExtensionClaims(now);
  // A token-bearing entry belongs to the fresh app tab the extension opened with
  // that token. Reserve it for as long as it stays unclaimed so a non-matching tab
  // can NEVER drain it into the wrong session — the whole point of per-tab imports.
  // If the fresh tab never arrives (failed/slow/closed tab-open), the entry is not
  // handed to some other tab; it simply expires via the TTL (pruneExtensionInbox).
  const isReservedForFreshTab = (entry: InboxEntry) => Boolean(entry.claimToken) && !entry.claimedBy;
  // Prefer an entry already bound to this tab; otherwise claim the oldest
  // unclaimed one. A token-bearing fresh tab can claim its matching import even
  // if duplicate-tab detection regenerated its tab id after the first poll; the
  // claim token is the stronger routing identity for extension-opened tabs.
  // Older visible tabs have no token and skip token-reserved entries so they
  // don't steal a new session.
  // Without a tabId (legacy client) fall back to first-unclaimed without binding.
  let entry: InboxEntry | null | undefined = null;
  if (claimToken) {
    entry = extensionInbox.find((e) => e.claimToken === claimToken);
    if (entry && tabId) entry.claimedBy = tabId;
  }
  if (!entry && tabId) {
    entry = extensionInbox.find((e) => e.claimedBy === tabId);
  }
  if (!entry) {
    entry = extensionInbox.find((e) => e.claimedBy === null && !isReservedForFreshTab(e));
    if (entry && tabId) entry.claimedBy = tabId;
  }
  if (!entry) {
    sendJson(res, 200, null);
    return;
  }
  // This tab owns the entry now — refresh the liveness stamp so the claim isn't
  // released out from under it while it keeps polling.
  if (tabId && entry.claimedBy === tabId) entry.lastSeenAt = now;
  // Still preparing in the background (resolving the raw text) — report progress
  // WITHOUT draining so the owning tab keeps polling until the text is ready. The
  // "distilling" token is the wire value the client polls on (it then distills).
  if (entry.status === "distilling") {
    sendJson(res, 200, { status: "distilling" });
    return;
  }
  // Done — hand over the brief once and remove it from the queue.
  extensionInbox = extensionInbox.filter((e) => e !== entry);
  sendJson(res, 200, {
    text: entry.text,
    url: entry.url,
    fields: entry.fields ?? null,
    autoTailor: entry.autoTailor === true,
    // Default true so a legacy entry (or one from an older extension) keeps the
    // prior distill-by-default behavior.
    distillAi: entry.distillAi !== false,
  });
}
