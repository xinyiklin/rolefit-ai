// The saved-variant `/candidates` batch reads, shared by both material kinds.
// Each route reads at most MAX_VARIANT_CANDIDATES_PER_REQUEST documents under
// one workspace lock; a larger eligible pool is read in consecutive requests of
// that size, so a big pool still ranks instead of losing its recommendation.

export const MAX_VARIANT_CANDIDATES_PER_REQUEST = 40;

export type VariantCandidateEntry = { fileName?: unknown; label?: unknown; text?: unknown };

// Resolves null when any request failed (transport, HTTP, or body shape): a
// partial pool must never rank as if it were complete.
export async function postVariantCandidateRequests(
  url: string,
  fileNames: readonly string[]
): Promise<VariantCandidateEntry[] | null> {
  const read: VariantCandidateEntry[] = [];
  for (let start = 0; start < fileNames.length; start += MAX_VARIANT_CANDIDATES_PER_REQUEST) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileNames: fileNames.slice(start, start + MAX_VARIANT_CANDIDATES_PER_REQUEST) })
      });
      const body = (await response.json()) as { candidates?: unknown };
      if (!response.ok || !Array.isArray(body.candidates)) return null;
      read.push(...(body.candidates as VariantCandidateEntry[]));
    } catch {
      // Ranking is an affordance over the selector, never the document itself.
      // An unreachable workspace produces no recommendation, not a broken Prepare.
      return null;
    }
  }
  return read;
}
