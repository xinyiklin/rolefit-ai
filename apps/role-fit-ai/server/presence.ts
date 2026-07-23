// Lightweight tab-presence beacon. The Electron companion cannot see live
// browser tabs, so the browser posts a per-tab liveness beat here and the server
// exposes an aggregate count. Restore uses that count to refuse while Drafting
// Desk tabs are live. State is in-memory only — never persisted — and no tab id
// ever leaves this module.

import type { IncomingMessage, ServerResponse } from "node:http";
import { readBody, sendJson } from "./http.ts";
import {
  noteWorkspacePresenceAttempt,
  workspaceRestoreIsActive
} from "./workspaceRestoreGate.ts";

const PRESENCE_TAB_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const PRESENCE_ACTIVE_WINDOW_MS = 90_000;
const MAX_PRESENCE_ENTRIES = 200;
const MAX_PRESENCE_BODY_BYTES = 2_000;

// tabId -> last-seen epoch ms. Map iteration order is insertion order; each beat
// re-inserts so the front is always the least-recently-seen entry.
const presence = new Map<string, number>();

// Exported as the pure validation seam so the tab-id contract can be probed
// without binding a loopback listener.
export function isValidPresenceTabId(value: string): boolean {
  return PRESENCE_TAB_ID_RE.test(value);
}

function prunePresence(now: number): void {
  for (const [tabId, lastSeen] of presence) {
    if (now - lastSeen > PRESENCE_ACTIVE_WINDOW_MS) presence.delete(tabId);
  }
}

export function countActiveTabs(now = Date.now()): number {
  prunePresence(now);
  return presence.size;
}

export async function handlePresence(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Use POST." });
    return;
  }
  if (workspaceRestoreIsActive()) {
    noteWorkspacePresenceAttempt();
    sendJson(res, 409, { error: "The workspace is being restored. Reload after it finishes." });
    return;
  }
  let body: unknown;
  try {
    body = JSON.parse(await readBody(req, MAX_PRESENCE_BODY_BYTES));
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === "Request is too large.";
    sendJson(res, tooLarge ? 413 : 400, { error: tooLarge ? "The presence beacon is too large." : "Invalid presence beacon." });
    return;
  }

  // A restore may start while this request body is in flight. Recheck before
  // mutating the presence map and tell the restore that a live tab attempted to
  // arrive, so it can keep/roll back the active workspace safely.
  if (workspaceRestoreIsActive()) {
    noteWorkspacePresenceAttempt();
    sendJson(res, 409, { error: "The workspace is being restored. Reload after it finishes." });
    return;
  }

  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  const tabId = record && typeof record.tabId === "string" ? record.tabId.trim() : "";
  if (!isValidPresenceTabId(tabId)) {
    sendJson(res, 400, { error: "Invalid tab id." });
    return;
  }

  const now = Date.now();
  prunePresence(now);
  if (record?.gone === true) {
    presence.delete(tabId);
  } else {
    // Re-insert so a refreshed tab moves to the back; over-cap eviction then
    // drops the oldest-seen entries from the front.
    presence.delete(tabId);
    presence.set(tabId, now);
    while (presence.size > MAX_PRESENCE_ENTRIES) {
      const oldest = presence.keys().next().value;
      if (oldest === undefined) break;
      presence.delete(oldest);
    }
  }

  res.writeHead(204);
  res.end();
}

export function handleWorkspaceActivity(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Use GET." });
    return;
  }
  sendJson(res, 200, { activeTabs: countActiveTabs() });
}
