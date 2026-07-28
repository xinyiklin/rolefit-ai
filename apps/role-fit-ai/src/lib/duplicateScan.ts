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
//      per-record WeakMap memo avoids that work while record references survive.
//   3. Over-invalidation — the key covers only fields the matcher actually
//      reads. Status and date changes no longer discard the scan.
//
// Results are stored as member IDS, never as Application objects. A cached
// group that held the records as they were at scan time would go stale against
// later edits — the merge modal reads current status, dates, artifacts, and
// attachments, and only some of those are part of the scan key at all.
// Callers rehydrate against the live array on every render instead.

import {
  CONFIDENCE_RANK,
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

// Per-record identity hash. Optimistic local edits retain references for
// untouched rows, so one edit normally hashes one new object. A full server
// response currently replaces every object and therefore misses this WeakMap;
// response reconciliation can restore that optimization without affecting the
// correctness of this cache.
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
 * Conservative version of matcher-observable identity. Status, applied/created
 * dates, notes, documents, and attachments are excluded on purpose: the
 * duplicate modal displays some of them, but none are duplicate EVIDENCE.
 * Some raw URL/metadata representations may still over-invalidate safely.
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
  const groups: DuplicateScanGroup[] = [];
  for (const group of groupDuplicateApplications(applications)) {
    // Grouped records always carry an id (see DuplicateCandidate), but an id is
    // optional on the type and the whole cache is keyed by it — so drop rather
    // than cast an absent one into the member list, where it would silently
    // vanish at rehydration instead.
    const memberIds = group.applications
      .map((application) => application.id)
      .filter((id): id is string => Boolean(id));
    if (memberIds.length < 2) continue;
    groups.push({ memberIds, edges: group.edges, confidence: group.confidence });
  }
  const result: DuplicateScanResult = { key, groups };
  cached = result;
  return result;
}

/**
 * Project a stored scan back onto the CURRENT records. Members that no longer
 * exist (deleted or merged away since the scan) are dropped along with their
 * edges, so a stale-but-valid scan degrades to fewer groups rather than to
 * wrong ones.
 *
 * Losing a member can DISCONNECT the rest: a cluster joined transitively as
 * A~B~C, minus B, leaves A and C with no evidence linking them at all. The
 * survivors are therefore re-split into connected components over the surviving
 * edges. Keeping them together would present two unrelated postings as
 * duplicates and offer to merge them, which deletes a row.
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

    // Fast path: nothing was lost, so the scan's own grouping still holds and
    // no edge can have been pruned. This is the only path a cache hit takes.
    if (members.length === group.memberIds.length) {
      groups.push({ applications: members, edges: group.edges, confidence: group.confidence });
      continue;
    }

    const present = new Set(members.map((application) => application.id));
    const edges = group.edges.filter((edge) => present.has(edge.a) && present.has(edge.b));
    for (const component of connectedComponents(members, edges)) {
      if (component.members.length < 2) continue;
      groups.push({
        applications: component.members,
        // Rank from the component's OWN edges: the strongest edge in the
        // original cluster may have belonged to the part that was removed.
        confidence: component.edges.reduce<DuplicateConfidence>(
          (best, edge) => (CONFIDENCE_RANK[edge.confidence] < CONFIDENCE_RANK[best] ? edge.confidence : best),
          "possible"
        ),
        edges: component.edges
      });
    }
  }
  return groups;
}

/** Union-find split of members into components joined by the given edges. */
function connectedComponents<T extends DuplicateCandidate>(
  members: readonly T[],
  edges: readonly DuplicateEdge[]
): { members: T[]; edges: DuplicateEdge[] }[] {
  const indexOf = new Map<string, number>();
  members.forEach((application, index) => {
    if (application.id) indexOf.set(application.id, index);
  });
  const parent = members.map((_, index) => index);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (const edge of edges) {
    const a = indexOf.get(edge.a);
    const b = indexOf.get(edge.b);
    if (a === undefined || b === undefined) continue;
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  const byRoot = new Map<number, { members: T[]; edges: DuplicateEdge[] }>();
  members.forEach((application, index) => {
    const root = find(index);
    if (!byRoot.has(root)) byRoot.set(root, { members: [], edges: [] });
    byRoot.get(root)!.members.push(application);
  });
  for (const edge of edges) {
    const a = indexOf.get(edge.a);
    if (a === undefined) continue;
    byRoot.get(find(a))?.edges.push(edge);
  }
  return [...byRoot.values()];
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
