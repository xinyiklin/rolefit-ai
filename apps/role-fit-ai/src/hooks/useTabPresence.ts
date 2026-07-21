import { useEffect, useState } from "react";
import {
  HEARTBEAT_MS,
  activeSessionsSignature,
  getTabId,
  publishPresence,
  readLiveSessions,
  subscribePresence,
  type PresenceEntry,
  type PresencePhase
} from "../lib/tabPresence";

type UseTabPresenceArgs = {
  // Short role · company label for this tab's current job target (never the JD
  // body). Empty when no job is loaded.
  jobLabel: string;
  // Coarse activity of this tab, derived from existing app state.
  phase: PresencePhase;
};

// Fire-and-forget SERVER presence beacon — a companion-side "is any tab open"
// check, separate from the localStorage registry above. Failures are silent:
// a dropped beacon just leaves the server's view briefly stale, and the next
// cadence tick (or the next beacon on any event) corrects it.
function beaconPresence(tabId: string): void {
  if (typeof fetch === "undefined") return;
  try {
    fetch("/api/presence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tabId }),
      keepalive: true
    }).catch(() => {
      // no-op — see comment above
    });
  } catch {
    // fetch unavailable/blocked — no-op
  }
}

// Same beacon, "gone" variant, sent on pagehide. Prefers sendBeacon (survives
// the page unloading); falls back to a keepalive fetch when sendBeacon isn't
// available.
function beaconGone(tabId: string): void {
  const body = JSON.stringify({ tabId, gone: true });
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon("/api/presence", blob)) return;
    }
  } catch {
    // fall through to the keepalive fetch fallback
  }
  if (typeof fetch === "undefined") return;
  try {
    fetch("/api/presence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true
    }).catch(() => {
      // no-op — see beaconPresence
    });
  } catch {
    // no-op
  }
}

// Publishes THIS tab's heartbeat ({ jobLabel, phase }) to the shared registry on
// every change and on a steady interval, and returns the OTHER live tabs so the
// UI can show what concurrent sessions are doing.
//
// We deliberately do NOT clear this tab's entry on unload. `pagehide` fires for
// BOTH a close and a reload, and sessionStorage keeps the same tab id across a
// reload — so clearing would, in the gap between unload and remount, make a
// reloading tab look dead and let a sibling reclaim (migrate away) its still-
// valid autosave draft. Instead liveness is driven purely by heartbeat
// staleness: a reload refreshes the heartbeat well within STALE_MS, while a real
// close lets the entry expire after STALE_MS (also covering a crash). The cost is
// a closed tab lingering in the "active sessions" view for a few seconds — or up
// to HIDDEN_STALE_MS when it was closed while backgrounded — which still reads
// correctly as "active moments ago."
export function useTabPresence({ jobLabel, phase }: UseTabPresenceArgs): PresenceEntry[] {
  const [others, setOthers] = useState<PresenceEntry[]>([]);

  // Publish on mount and whenever this tab's label/phase changes. A heartbeat
  // interval republishes the same state so a long-running phase keeps the entry
  // fresh (and thus "live") for other tabs. Also republish the instant
  // visibility flips: the heartbeat self-reports `hidden`, and the hide-time
  // publish must land BEFORE background throttling can delay the interval —
  // otherwise the last visible-tagged heartbeat ages out on the strict budget
  // and this tab flickers dead in siblings (and to their autosave GC).
  //
  // Alongside the localStorage heartbeat, also beacon the SERVER on the same
  // cadence/events so a companion-driven restore can check whether any RoleFit
  // tab is currently open (see beaconPresence above).
  useEffect(() => {
    const publish = () => {
      publishPresence(jobLabel, phase, Date.now());
      // getTabId() is read fresh here (not closed over) for the same reason as
      // the `refresh` effect below: duplicate-tab detection can regenerate it
      // after mount.
      beaconPresence(getTabId());
    };
    publish();
    const beat = setInterval(publish, HEARTBEAT_MS);
    document.addEventListener("visibilitychange", publish);
    return () => {
      clearInterval(beat);
      document.removeEventListener("visibilitychange", publish);
    };
  }, [jobLabel, phase]);

  // SERVER presence "gone" beacon on pagehide — a DIFFERENT system from the
  // localStorage registry's deliberate no-clear-on-pagehide policy above. The
  // server only needs to know "is a tab open right now" to gate a companion
  // restore, so it's fine — correct, even — for a reload to momentarily report
  // gone: the reloading tab re-beacons `presence` within one HEARTBEAT_MS of
  // remount, while a real close simply never beacons again. The localStorage
  // registry instead drives autosave-draft ownership ACROSS that reload gap,
  // where the same gone-then-back flicker would wrongly let a sibling tab
  // reclaim an in-flight draft. Do not "fix" one policy to match the other.
  useEffect(() => {
    const onPageHide = () => beaconGone(getTabId());
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, []);

  // Track other live sessions from any presence change (broadcast, storage
  // event, or staleness tick). The staleness tick fires every few seconds, so
  // only push a NEW array when the meaningful content (which tabs, their phase
  // and label) actually changed — otherwise every tick would re-render all of
  // App, even single-tab. `updatedAt` is intentionally excluded from the
  // signature so steady heartbeats don't count as changes.
  useEffect(() => {
    let lastSig = "";
    const refresh = () => {
      // getTabId() can intentionally regenerate after mount when duplicate-tab
      // detection catches a cloned sessionStorage id. Read it at refresh time so
      // this tab never shows up as an "other" session under the old id.
      const myId = getTabId();
      const live = readLiveSessions(Date.now()).filter((entry) => entry.tabId !== myId);
      const sig = activeSessionsSignature(live);
      if (sig === lastSig) return;
      lastSig = sig;
      setOthers(live);
    };
    refresh();
    return subscribePresence(refresh);
  }, []);

  return others;
}
