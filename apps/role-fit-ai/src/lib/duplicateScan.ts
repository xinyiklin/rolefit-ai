// Client-only caching layer over the tracker-wide duplicate scan
// (jobIdentity.ts → groupDuplicateApplications). Deliberately NOT part of
// jobIdentity.ts: that module is imported by the Node server routes and is
// documented as dependency-free and side-effect-free, so the mutable caches
// below cannot live there. Nothing under server/ imports this file.
//
// It solves three separate costs the Applications tab used to pay on every
// visit, because the tab unmounts and its useMemo cache dies with it:
//
//   1. The O(n²) scan itself — held in a one-entry module cache that survives
//      unmount, so returning to the tab with unchanged identity data is free.
//   2. Re-hashing every record's job description to build the cache key — a
//      per-record WeakMap memo means editing one row rehashes one row.
//   3. Over-invalidation — the key covers only fields the matcher actually
//      reads. Status and date changes no longer discard the scan.
//
// Results are stored as member IDS, never as Application objects. A cached
// group that held the records as they were at scan time would go stale against
// later edits — the merge modal reads current status, dates, artifacts, and
// attachments, and only some of those are part of the scan key at all.
// Callers rehydrate against the live array on every render instead.

import {
  duplicateCandidateKey,
  groupDuplicateApplications,
  type DuplicateCandidate,
  type DuplicateConfidence,
  type DuplicateEdge,
  type DuplicateGroup
} from "./jobIdentity.ts";

/** One duplicate cluster, stored by id so it cannot carry stale records. */
export type DuplicateScanGroup = {
  memberIds: string[];
  edges: DuplicateEdge[];
  confidence: DuplicateConfidence;
};

export type DuplicateScanResult = {
  /** The identity the scan ran against; a cache hit requires an exact match. */
  key: string;
  groups: DuplicateScanGroup[];
};

// Instrumentation for the offline eval and the development benchmark probe:
// the "did this actually avoid a rescan?" assertions have no other observable
// signal. Never read by product code.
export const duplicateScanStats = { scans: 0, hashedRecords: 0 };

// Per-record identity hash. Application objects are replaced only when that
// record changes (useApplications maps unchanged rows through by reference), so
// memoizing on object identity means a notes keystroke rehashes one description
// instead of every stored description.
const recordKeys = new WeakMap<object, string>();

function recordKey(record: DuplicateCandidate): string {
  const cached = recordKeys.get(record);
  if (cached !== undefined) return cached;
  duplicateScanStats.hashedRecords += 1;
  const key = duplicateCandidateKey(record);
  recordKeys.set(record, key);
  return key;
}

/**
 * Identity of only the fields the matcher reads. Status, applied/created dates,
 * notes, documents, and attachments are excluded on purpose: the duplicate
 * modal displays some of them, but none of them are duplicate EVIDENCE, and
 * including them made moving a row to "Interviewing" rerun the whole scan.
 */
export function duplicateScanIdentity(applications: readonly DuplicateCandidate[]): string {
  return applications.map(recordKey).join("\n");
}

let cached: DuplicateScanResult | null = null;

/** The stored scan when it matches `key`, else null. Never recomputes. */
export function cachedDuplicateScan(key: string): DuplicateScanResult | null {
  return cached && cached.key === key ? cached : null;
}

/** Run the scan and store it as the one cached entry. Synchronous and O(n²). */
export function computeDuplicateScan(
  applications: readonly DuplicateCandidate[],
  key: string
): DuplicateScanResult {
  duplicateScanStats.scans += 1;
  const groups = groupDuplicateApplications(applications).map((group) => ({
    memberIds: group.applications.map((application) => application.id as string),
    edges: group.edges,
    confidence: group.confidence
  }));
  const result: DuplicateScanResult = { key, groups };
  cached = result;
  return result;
}

/**
 * Project a stored scan back onto the CURRENT records. Members that no longer
 * exist (deleted or merged away since the scan) are dropped along with their
 * edges, and a cluster that falls below two surviving members is dropped
 * entirely — so a stale-but-valid scan degrades to fewer groups rather than to
 * wrong ones.
 */
export function rehydrateDuplicateGroups<T extends DuplicateCandidate>(
  result: DuplicateScanResult | null,
  applications: readonly T[]
): DuplicateGroup<T>[] {
  if (!result?.groups.length) return [];
  const byId = new Map<string, T>();
  for (const application of applications) {
    if (application.id) byId.set(application.id, application);
  }

  const groups: DuplicateGroup<T>[] = [];
  for (const group of result.groups) {
    const members = group.memberIds
      .map((id) => byId.get(id))
      .filter((application): application is T => Boolean(application));
    if (members.length < 2) continue;
    const present = new Set(members.map((application) => application.id));
    groups.push({
      applications: members,
      edges: group.edges.filter((edge) => present.has(edge.a) && present.has(edge.b)),
      confidence: group.confidence
    });
  }
  return groups;
}

/** Every id belonging to any cluster, for the table's inline duplicate badge. */
export function duplicateIdsOf<T extends DuplicateCandidate>(
  groups: readonly DuplicateGroup<T>[]
): Set<string> {
  const ids = new Set<string>();
  for (const group of groups) {
    for (const application of group.applications) {
      if (application.id) ids.add(application.id);
    }
  }
  return ids;
}

/** Test seam only — drops the cached scan so an eval can assert a cold run. */
export function resetDuplicateScanCache(): void {
  cached = null;
}
