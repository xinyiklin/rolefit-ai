import { coverLetterPlainText, parseCoverLetterFile } from "@typeset/engine/lib/coverLetter.ts";

import type { VariantCandidate } from "./variantRecommendation.ts";

export type CoverLetterOption = { fileName: string; label: string };
export type CoverLetterHistoryEntry = {
  key: string;
  originalName: string;
  date: string;
};
export type CoverLetterHistoryGroup = {
  variant: string;
  label: string;
  entries: CoverLetterHistoryEntry[];
};

export type CoverLetterWorkspaceSnapshot = {
  coverLetterOptions?: CoverLetterOption[];
  coverLetterHistory?: CoverLetterHistoryGroup[];
};

export type CoverLetterWorkspaceDocument = CoverLetterWorkspaceSnapshot & {
  text: string;
  fileName: string;
  label: string;
};

type WorkspaceDocumentResponse = CoverLetterWorkspaceSnapshot & {
  error?: string;
  text?: string;
  fileName?: string;
  label?: string;
};

async function postWorkspaceDocument(
  path: string,
  body: Record<string, unknown>,
  fallback: string
): Promise<CoverLetterWorkspaceDocument> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = (await response.json()) as WorkspaceDocumentResponse;
  if (!response.ok || !data.text) throw new Error(data.error ?? fallback);
  return {
    text: data.text,
    fileName: data.fileName ?? "default.cover",
    label: data.label ?? "Cover letter",
    coverLetterOptions: data.coverLetterOptions,
    coverLetterHistory: data.coverLetterHistory
  };
}

export async function readCoverLetterWorkspace(): Promise<CoverLetterWorkspaceSnapshot | null> {
  try {
    const response = await fetch("/api/workspace");
    if (!response.ok) return null;
    return (await response.json()) as CoverLetterWorkspaceSnapshot;
  } catch {
    // The list is an affordance, not the document. Mutations surface their own
    // errors, and the next refresh can recover this snapshot.
    return null;
  }
}

export async function saveCoverLetterWorkspace(
  text: string,
  target: { fileName?: string; variant?: string }
): Promise<CoverLetterWorkspaceSnapshot & { fileName?: string; label?: string }> {
  const response = await fetch("/api/workspace/cover-letter", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, ...target })
  });
  const data = (await response.json()) as WorkspaceDocumentResponse;
  if (!response.ok) throw new Error(data.error ?? "Cover letter save failed.");
  return data;
}

export function selectCoverLetterWorkspaceDocument(
  fileName: string
): Promise<CoverLetterWorkspaceDocument> {
  return postWorkspaceDocument(
    "/api/workspace/cover-letter/select",
    { fileName },
    "Cover letter version not found."
  );
}

// Ranking compares each saved letter by its real validated bytes rather than by
// its filename. One batch request, not one select per letter: the select route
// takes the server's serialized workspace lock and returns a cover-letter
// snapshot each time, so per-file reads serialized N round trips behind it.
// A variant that fails to parse is skipped, not ranked as empty, so one bad
// file cannot hand the recommendation to a weaker letter.
export async function readCoverLetterVariantCandidates(
  options: CoverLetterOption[]
): Promise<VariantCandidate[]> {
  const fileNames = [...new Set(options.map((option) => option.fileName).filter(Boolean))];
  if (!fileNames.length) return [];

  let read: { fileName?: unknown; label?: unknown; text?: unknown }[];
  try {
    const response = await fetch("/api/workspace/cover-letter/candidates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileNames })
    });
    const body = (await response.json()) as { candidates?: unknown };
    if (!response.ok || !Array.isArray(body.candidates)) return [];
    read = body.candidates as typeof read;
  } catch {
    return [];
  }

  const labels = new Map(options.map((option) => [option.fileName, option.label]));
  const candidates: VariantCandidate[] = [];
  for (const entry of read) {
    const fileName = typeof entry?.fileName === "string" ? entry.fileName : "";
    const text = typeof entry?.text === "string" ? entry.text : "";
    if (!fileName || !text) continue;
    try {
      const parsed = parseCoverLetterFile(text);
      candidates.push({
        fileName,
        label: labels.get(fileName) ?? (typeof entry.label === "string" ? entry.label : fileName),
        text: coverLetterPlainText(parsed.data)
      });
    } catch {
      // Skipped, never ranked empty — the ranker's completeness rule turns the
      // short list into no recommendation.
    }
  }
  return candidates;
}

export function restoreCoverLetterWorkspaceDocument(
  key: string
): Promise<CoverLetterWorkspaceDocument> {
  return postWorkspaceDocument(
    "/api/workspace/cover-letter/restore",
    { key },
    "Cover letter restore failed."
  );
}
