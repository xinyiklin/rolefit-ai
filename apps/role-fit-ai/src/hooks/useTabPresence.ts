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
  useEffect(() => {
    publishPresence(jobLabel, phase, Date.now());
    const beat = setInterval(() => publishPresence(jobLabel, phase, Date.now()), HEARTBEAT_MS);
    const onVisibility = () => publishPresence(jobLabel, phase, Date.now());
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(beat);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [jobLabel, phase]);

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
