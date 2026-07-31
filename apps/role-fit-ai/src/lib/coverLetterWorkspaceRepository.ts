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

// Ranking reads each saved letter through the same validated select route the
// editor opens with, so a variant is compared by its real bytes rather than by
// its filename. The select route is a pure read: it never changes which letter
// the editor holds. A variant that fails to parse is skipped, not ranked as
// empty, so one bad file cannot hand the recommendation to a weaker letter.
export async function readCoverLetterVariantCandidates(
  options: CoverLetterOption[]
): Promise<VariantCandidate[]> {
  const candidates = await Promise.all(
    options.map(async (option): Promise<VariantCandidate | null> => {
      try {
        const document = await selectCoverLetterWorkspaceDocument(option.fileName);
        const parsed = parseCoverLetterFile(document.text);
        return {
          fileName: option.fileName,
          label: option.label,
          text: coverLetterPlainText(parsed.data)
        };
      } catch {
        return null;
      }
    })
  );
  return candidates.filter((candidate): candidate is VariantCandidate => candidate !== null);
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
