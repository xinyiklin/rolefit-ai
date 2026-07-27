import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import type { Application } from "./useApplications";
import type { DuplicateGroup } from "../lib/jobIdentity";
import {
  cachedDuplicateScan,
  computeDuplicateScan,
  duplicateIdsOf,
  duplicateScanIdentity,
  rehydrateDuplicateGroups,
  type DuplicateScanResult
} from "../lib/duplicateScan";

// Two applications is the floor for a cluster, so anything smaller has no scan
// to run and must not flash a "checking" status.
const MIN_SCANNABLE = 2;

/**
 * Tracker-wide duplicate clusters for the Applications tab.
 *
 * The scan is O(n²) over every stored job description and used to run
 * synchronously during render — on every visit, because the tab unmounts. Here
 * it runs AFTER the browser has painted, and its result lives in a module cache
 * that outlives the tab, so a return visit with unchanged identity data costs
 * nothing. Groups are cached by id and rehydrated against the live array each
 * render, so status, notes, document, and attachment edits are always current
 * even when they do not justify a rescan.
 */
export function useDuplicateScan(applications: readonly Application[]) {
  const key = useMemo(() => duplicateScanIdentity(applications), [applications]);
  const [committed, setCommitted] = useState<DuplicateScanResult | null>(null);

  // The module cache is authoritative: it survives unmount, and a fresh mount
  // has no committed state yet. Falling back to `committed` only covers the
  // frame between this tab's own scan and the cache read on the next render.
  const result = cachedDuplicateScan(key) ?? (committed?.key === key ? committed : null);

  // The scan effect depends on `key` alone, never on the applications array.
  // Identical key means identical matching inputs, so a slightly older array
  // produces the same clusters — and depending on the array itself would let
  // per-keystroke notes edits cancel and reschedule the scan indefinitely.
  // Declared before that effect so the ref is current when it schedules.
  const latest = useRef(applications);
  useEffect(() => {
    latest.current = applications;
  }, [applications]);

  const pending = !result && applications.length >= MIN_SCANNABLE;

  useEffect(() => {
    if (result) return;
    let cancelled = false;
    let idleHandle: number | null = null;
    let usedIdleCallback = false;

    // rAF fires BEFORE paint, so the idle callback nested inside it is what
    // actually puts the work after the first frame. requestIdleCallback is not
    // universal (Safari gained it late), hence the timeout fallback; the idle
    // deadline is bounded so a busy page still resolves the duplicate badges.
    const frame = window.requestAnimationFrame(() => {
      const run = () => {
        if (cancelled) return;
        const next = computeDuplicateScan(latest.current, key);
        if (cancelled) return;
        // Only the state update is a transition. Wrapping the computation
        // would not defer it — startTransition lowers the priority of the
        // resulting render, it does not move synchronous work off the frame.
        startTransition(() => setCommitted(next));
      };
      usedIdleCallback = typeof window.requestIdleCallback === "function";
      idleHandle = usedIdleCallback
        ? window.requestIdleCallback(run, { timeout: 200 })
        : window.setTimeout(run, 0);
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      if (idleHandle === null) return;
      // Cancel with the same scheduler that issued the handle — the two id
      // spaces are unrelated, so a mismatched cancel silently does nothing.
      if (usedIdleCallback) window.cancelIdleCallback(idleHandle);
      else window.clearTimeout(idleHandle);
    };
  }, [key, result]);

  const groups: DuplicateGroup<Application>[] = useMemo(
    () => rehydrateDuplicateGroups(result, applications),
    [result, applications]
  );
  const duplicateIds = useMemo(() => duplicateIdsOf(groups), [groups]);

  return { groups, duplicateIds, isScanning: pending };
}
