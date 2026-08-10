// The resume counterpart to coverLetterWorkspaceRepository: loopback reads of
// saved base-resume variants, kept out of the hook so the request shape is
// directly testable.
//
// One batch request, not one per variant. The select route answers with a whole
// workspace snapshot — cover-letter state, bundled starter, options, history,
// file list — under the server's serialized workspace lock, so per-file reads
// were N sequential full snapshots on the critical path to the first AI result.

import { parseResumeFile } from "@typeset/engine/lib/resumeFile.ts";

import { serializeResumeData } from "./resumeText.ts";
import type { VariantCandidate } from "./variantRecommendation.ts";

type CandidateOption = { fileName: string; label: string };

export async function fetchBaseResumeCandidates(
  options: CandidateOption[]
): Promise<VariantCandidate[]> {
  const fileNames = [...new Set(options.map((option) => option.fileName).filter(Boolean))];
  if (!fileNames.length) return [];

  let read: { fileName?: unknown; label?: unknown; kind?: unknown; text?: unknown }[];
  try {
    const response = await fetch("/api/workspace/base-resume/candidates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileNames })
    });
    const body = (await response.json()) as { candidates?: unknown };
    if (!response.ok || !Array.isArray(body.candidates)) return [];
    read = body.candidates as typeof read;
  } catch {
    // Ranking is an affordance over the selector, never the document itself.
    // An unreachable workspace produces no recommendation, not a broken Prepare.
    return [];
  }

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
        text: entry.kind === "resume" ? serializeResumeData(parseResumeFile(text).data) : text
      });
    } catch {
      // A variant that no longer parses is skipped, never ranked empty: the
      // ranker's completeness rule turns the short list into no recommendation.
    }
  }
  return candidates;
}
