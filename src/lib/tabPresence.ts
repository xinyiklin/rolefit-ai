// Cross-tab presence registry.
//
// Each browser tab is an INDEPENDENT tailoring session (its own job, draft, and
// review). To make that safe we need two things this module provides:
//
//   1. A stable per-tab id. `sessionStorage` normally matches the lifetime we
//      want: survives a reload of the same tab and clears on close. Some browser
//      "Duplicate Tab" flows clone sessionStorage, so we also stamp every live
//      heartbeat with a page-instance id and regenerate a cloned tab id when a
//      second live page owns it.
//   2. A liveness + activity signal shared across tabs. Tabs publish a heartbeat
//      carrying { jobLabel, phase } to a shared localStorage registry and a
//      BroadcastChannel. Other tabs read it to (a) render a shared in-progress
//      view and (b) tell a dead tab's orphaned draft (recoverable) apart from a
//      live tab's active draft (hands off).
//
// PRIVACY: the registry stores ONLY a short role · company label and a coarse
// phase — never the JD body, resume text, or any secret. Same contract as the
// autosave draft.

const TAB_ID_KEY = "rolefit:tabId";
const REGISTRY_KEY = "rolefit:tabPresence";
const CHANNEL_NAME = "rolefit:presence";

// A tab republishes its heartbeat on this cadence; an entry older than STALE_MS
// is treated as a dead tab (crash / hard close that skipped the unload cleanup).
// STALE must be a comfortable multiple of HEARTBEAT so a momentarily busy tab is
// never mistaken for dead.
export const HEARTBEAT_MS = 4000;
export const STALE_MS = 12000;

export type PresencePhase =
  | "idle"
  | "editing"
  | "distilling"
  | "tailoring"
  | "reviewing"
  | "tailoring+reviewing";

export type PresenceEntry = {
  tabId: string;
  jobLabel: string;
  phase: PresencePhase;
  updatedAt: number;
  instanceId?: string;
  instanceBornAt?: number;
};

type Registry = Record<string, Omit<PresenceEntry, "tabId">>;

// Lazily-created singleton channel, shared by publish + subscribe in this tab.
let channel: BroadcastChannel | null = null;
let channelTried = false;
function getChannel(): BroadcastChannel | null {
  if (channelTried) return channel;
  channelTried = true;
  try {
    if (typeof BroadcastChannel !== "undefined") channel = new BroadcastChannel(CHANNEL_NAME);
  } catch {
    channel = null;
  }
  return channel;
}

function randomId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to the manual id below
  }
  // `Date.now()` keeps ids monotonic-ish even without crypto; the random suffix
  // disambiguates two tabs opened in the same millisecond.
  return `tab-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

const PAGE_INSTANCE_ID = randomId();
const PAGE_INSTANCE_BORN_AT = Date.now();

function navigationWasReload(): boolean {
  try {
    const [entry] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    return entry?.type === "reload";
  } catch {
    return false;
  }
}

function isClonedLiveTabId(tabId: string, now: number): boolean {
  const entry = prune(readRegistry(), now)[tabId];
  if (!entry || !entry.instanceId || entry.instanceId === PAGE_INSTANCE_ID) return false;
  // A same-tab reload starts with the previous heartbeat still fresh. Keep the
  // id in that short overlap so reload recovery continues to read this tab's own
  // autosave key. A duplicated tab is a fresh navigation, so it can regenerate.
  if (navigationWasReload() && now - PAGE_INSTANCE_BORN_AT < STALE_MS) return false;
  const otherBornAt =
    typeof entry.instanceBornAt === "number" ? entry.instanceBornAt : entry.updatedAt;
  return otherBornAt <= PAGE_INSTANCE_BORN_AT;
}

// The id for THIS tab. Generated once and pinned in sessionStorage so a reload
// keeps the same id (its autosave draft survives) while a brand-new tab gets a
// fresh one. If a duplicated tab cloned sessionStorage from a live original,
// regenerate here before autosave / inbox code keys anything by the cloned id.
let cachedTabId: string | null = null;
export function getTabId(): string {
  if (cachedTabId && !isClonedLiveTabId(cachedTabId, Date.now())) return cachedTabId;
  try {
    const existing = sessionStorage.getItem(TAB_ID_KEY);
    if (existing && !isClonedLiveTabId(existing, Date.now())) {
      cachedTabId = existing;
      return existing;
    }
    const fresh = randomId();
    sessionStorage.setItem(TAB_ID_KEY, fresh);
    cachedTabId = fresh;
    return fresh;
  } catch {
    // sessionStorage blocked — fall back to an in-memory id (stable for this
    // page load, which is enough for isolation; reload recovery just won't apply).
    cachedTabId = cachedTabId ?? randomId();
    return cachedTabId;
  }
}

function readRegistry(): Registry {
  try {
    const raw = localStorage.getItem(REGISTRY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object") return {};
    return parsed as Registry;
  } catch {
    return {};
  }
}

function writeRegistry(reg: Registry): void {
  try {
    localStorage.setItem(REGISTRY_KEY, JSON.stringify(reg));
  } catch {
    // localStorage full / blocked — presence is best-effort, never throw.
  }
}

// Drop entries whose heartbeat has gone stale. Pure prune, returns a new object.
function prune(reg: Registry, now: number): Registry {
  const next: Registry = {};
  for (const [id, entry] of Object.entries(reg)) {
    if (entry && typeof entry.updatedAt === "number" && now - entry.updatedAt < STALE_MS) {
      next[id] = entry;
    }
  }
  return next;
}

function broadcast(): void {
  try {
    getChannel()?.postMessage("update");
  } catch {
    // ignore — the `storage` event and the staleness interval are fallbacks.
  }
}

// Upsert this tab's heartbeat. Called on mount, on every {jobLabel, phase}
// change, and on the heartbeat interval.
export function publishPresence(jobLabel: string, phase: PresencePhase, now: number): void {
  const id = getTabId();
  const reg = prune(readRegistry(), now);
  reg[id] = {
    jobLabel,
    phase,
    updatedAt: now,
    instanceId: PAGE_INSTANCE_ID,
    instanceBornAt: PAGE_INSTANCE_BORN_AT
  };
  writeRegistry(reg);
  broadcast();
}

// All currently-live sessions (heartbeat within STALE_MS), this tab included.
export function readLiveSessions(now: number): PresenceEntry[] {
  const reg = prune(readRegistry(), now);
  return Object.entries(reg).map(([tabId, entry]) => ({ tabId, ...entry }));
}

// Stable content signature of a session set: which tabs, their phase, and their
// job label — order-independent and excluding `updatedAt` so steady heartbeats
// don't register as changes. Used both to gate re-renders (useTabPresence) and to
// keep a manual dismiss sticky until the set meaningfully changes (App). Single
// source of truth so those two equality contracts can't silently diverge.
export function activeSessionsSignature(sessions: PresenceEntry[]): string {
  return sessions
    .map((s) => `${s.tabId}:${s.phase}:${s.jobLabel}`)
    .sort()
    .join("|");
}

// Ids of tabs whose heartbeat is fresh. The autosave GC uses this to leave a
// live tab's draft alone while reclaiming a dead tab's orphan.
export function liveTabIds(now: number): Set<string> {
  return new Set(Object.keys(prune(readRegistry(), now)));
}

// Subscribe to presence changes from any source: BroadcastChannel push, the
// cross-tab `storage` event, and a staleness tick (so a crashed tab's entry
// disappears even though no event ever fires). Returns an unsubscribe fn.
export function subscribePresence(onChange: () => void): () => void {
  const ch = getChannel();
  const onMessage = () => onChange();
  const onStorage = (e: StorageEvent) => {
    if (e.key === REGISTRY_KEY || e.key === null) onChange();
  };
  ch?.addEventListener("message", onMessage);
  window.addEventListener("storage", onStorage);
  // Re-evaluate on a cadence shorter than STALE so a stale entry is dropped from
  // the UI within a few seconds of the owning tab dying.
  const timer = setInterval(onChange, Math.max(2000, Math.floor(STALE_MS / 3)));
  return () => {
    ch?.removeEventListener("message", onMessage);
    window.removeEventListener("storage", onStorage);
    clearInterval(timer);
  };
}
