import { useCallback, useEffect, useRef, useState } from "react";
import type { Application } from "./useApplications.ts";
import { DEFAULT_GHOSTED_AFTER_DAYS, normalizeGhostedAfterDays } from "../lib/ghostedThreshold.ts";
import { loadSettings } from "../lib/settings.ts";
import { autoGhostingCandidateIds, runAutoGhostingPass, type GhostedMark } from "../lib/ghostedMarks.ts";

// Same-origin tabs take turns: the second tab re-reads the first tab's marks
// instead of sending the same write into a 409 conflict.
const AUTO_GHOSTING_LOCK = "rolefit:auto-ghosting";
// Lets a threshold being typed, or a burst of tracker changes, settle first.
const AUTO_GHOSTING_SETTLE_MS = 1_500;

type AutoGhostingOptions = {
  enabled: boolean;
  afterDays: number;
  applications: Application[];
  hasLoadedApplications: boolean;
  pendingWrites: number;
  trackerError: string;
  // The record open in Application Detail: never moved under an open form.
  openApplicationId: string | null;
  refresh: () => Promise<boolean>;
  getApplication: (id: string) => Application | undefined;
  markGhosted: (marks: GhostedMark[]) => Promise<number | null>;
};

// The browser cache every tab of this origin shares. A tab whose own settings
// state is stale (another tab turned automation off, or the startup workspace
// read failed) still sees the latest choice here before it writes.
function cacheStillOptsIn(afterDays: number) {
  const settings = loadSettings();
  return settings.autoMarkGhosted === true
    && (normalizeGhostedAfterDays(settings.ghostedAfterDays) ?? DEFAULT_GHOSTED_AFTER_DAYS) === afterDays;
}

const msUntilNextDay = (now = new Date()) =>
  new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime();

function withTabLock<T>(run: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  return locks ? locks.request(AUTO_GHOSTING_LOCK, run) : run();
}

// Opt-in automatic Ghosted marks. A pass waits for a loaded tracker with no
// write in flight and no error showing (its re-read would clear a conflict
// notice the user has not seen), re-reads under the tab lock, and sends one
// write. An id is tried at most once per session, so nothing loops on failure.
// It runs again when the tracker or settings change and at local midnight,
// when more records come due.
export function useAutoGhosting({
  enabled,
  afterDays,
  applications,
  hasLoadedApplications,
  pendingWrites,
  trackerError,
  openApplicationId,
  refresh,
  getApplication,
  markGhosted
}: AutoGhostingOptions) {
  const [autoMarkedCount, setAutoMarkedCount] = useState(0);
  const [settledPasses, setSettledPasses] = useState(0);
  // Bumped at each local midnight; a counter, so a clock set back still
  // re-arms the timer.
  const [midnights, setMidnights] = useState(0);
  const openId = useRef(openApplicationId);
  const attempted = useRef(new Set<string>());
  const running = useRef(false);
  const missedWhileRunning = useRef(false);
  const ready = enabled
    && hasLoadedApplications
    && pendingWrites === 0
    && !trackerError
    && normalizeGhostedAfterDays(afterDays) !== null;
  const latest = useRef({ ready, afterDays });
  useEffect(() => {
    latest.current = { ready, afterDays };
  }, [ready, afterDays]);

  useEffect(() => {
    openId.current = openApplicationId;
  }, [openApplicationId]);

  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => setMidnights((count) => count + 1), msUntilNextDay() + 1_000);
    return () => clearTimeout(timer);
  }, [enabled, midnights]);

  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      if (running.current) {
        missedWhileRunning.current = true;
        return;
      }
      const ids = autoGhostingCandidateIds(applications, afterDays, attempted.current)
        .filter((id) => id !== openApplicationId);
      if (!ids.length) return;
      running.current = true;
      void withTabLock(() => runAutoGhostingPass({
        ids,
        afterDays,
        attempted: attempted.current,
        isCurrent: () => latest.current.ready && latest.current.afterDays === afterDays && cacheStillOptsIn(afterDays),
        refresh,
        getApplication,
        isOpen: (id) => id === openId.current,
        markGhosted
      }))
        .then((marked) => {
          if (marked) setAutoMarkedCount((count) => count + marked);
        })
        .finally(() => {
          running.current = false;
          if (missedWhileRunning.current) {
            missedWhileRunning.current = false;
            setSettledPasses((passes) => passes + 1);
          }
        });
    }, AUTO_GHOSTING_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [ready, afterDays, applications, openApplicationId, midnights, settledPasses, refresh, getApplication, markGhosted]);

  const dismissAutoMarked = useCallback(() => setAutoMarkedCount(0), []);

  return { autoMarkedCount, dismissAutoMarked };
}
