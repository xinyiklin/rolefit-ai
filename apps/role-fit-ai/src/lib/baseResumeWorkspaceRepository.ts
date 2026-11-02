// The resume counterpart to coverLetterWorkspaceRepository: loopback reads of
// saved base-resume variants, kept out of the hook so the request shape is
// directly testable.
//
// Capped batch requests, not one per variant. The select route answers with a whole
// workspace snapshot — cover-letter state, bundled starter, options, history,
// file list — under the server's serialized workspace lock, so per-file reads
// were N sequential full snapshots on the critical path to the first AI result.

import { parseResumeFile } from "@typeset/engine/lib/resumeFile.ts";

import { serializeResumeData } from "./resumeText.ts";
import { postVariantCandidateRequests } from "./variantCandidateRequests.ts";
import type { VariantCandidate } from "./variantRecommendation.ts";

type CandidateOption = { fileName: string; label: string };

// Resolves null when the read failed, so the caller does not cache it.
export async function fetchBaseResumeCandidates(
  options: CandidateOption[]
): Promise<VariantCandidate[] | null> {
  const fileNames = [...new Set(options.map((option) => option.fileName).filter(Boolean))];
  if (!fileNames.length) return [];

  const read = await postVariantCandidateRequests("/api/workspace/base-resume/candidates", fileNames);
  if (!read) return null;

  const labels = new Map(options.map((option) => [option.fileName, option.label]));
  const candidates: VariantCandidate[] = [];
  for (const entry of read) {
    const fileName = typeof entry?.fileName === "string" ? entry.fileName : "";
    const text = typeof entry?.text === "string" ? entry.text : "";
    if (!fileName || !text) continue;
    try {
      candidates.push({
        fileName,
        label: labels.get(fileName) ?? (typeof entry.label === "string" ? entry.label : fileName),
        // Rank the same serialization the editor would hold, so a variant's
        // score describes the document a user would actually get.
        text: serializeResumeData(parseResumeFile(text).data)
      });
    } catch {
      // A variant that no longer parses is skipped, never ranked empty: the
      // ranker's completeness rule turns the short list into no recommendation.
    }
  }
  return candidates;
}
