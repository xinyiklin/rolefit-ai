import {
  recommendVariant,
  type VariantCandidate,
  type VariantRecommendation
} from "./variantRecommendation.ts";

export const MINIMUM_PREPARED_COVER_LETTER_LENGTH = 40;

export type PreparedCoverLetterOption = {
  fileName: string;
  label: string;
};

export type PreparedCoverLetterState = {
  activeFileName: string;
  options: PreparedCoverLetterOption[];
  applicationOwned: boolean;
  documentDirty: boolean;
  documentFingerprint: string;
  workspaceSaving: boolean;
  candidateRevision: number;
};

export type PreparedCoverLetterResolution = {
  recommendation: VariantRecommendation | null;
  adoptedFileName: string | null;
};

export type PreparedCoverLetterResolutionDeps = {
  jobText: string;
  readState: () => PreparedCoverLetterState;
  readCandidates: (
    options: PreparedCoverLetterOption[]
  ) => Promise<VariantCandidate[]>;
  adopt: (
    fileName: string,
    shouldCancel: () => boolean
  ) => Promise<boolean>;
  isCurrent: () => boolean;
};

function documentIsReplaceable(state: PreparedCoverLetterState): boolean {
  return (
    !state.applicationOwned &&
    !state.documentDirty &&
    !state.workspaceSaving
  );
}

export function preparedCoverLetterOptionSnapshotKey(
  state: PreparedCoverLetterState
): string {
  return JSON.stringify({
    orderedFileNames: state.options.map((option) => option.fileName),
    candidateRevision: state.candidateRevision
  });
}

function preparedCoverLetterTarget(
  jobText: string,
  state: PreparedCoverLetterState,
  candidates: VariantCandidate[]
): { fileName: string | null; recommendation: VariantRecommendation | null } {
  if (state.options.length === 1) {
    const only = candidates[0];
    const fileName =
      candidates.length === 1 &&
      only?.fileName === state.options[0]?.fileName &&
      only.text.trim().length >= MINIMUM_PREPARED_COVER_LETTER_LENGTH
        ? only.fileName
        : null;
    return {
      fileName,
      recommendation: null
    };
  }
  if (state.options.length === 0) {
    return { fileName: null, recommendation: null };
  }
  const recommendation = recommendVariant(
    jobText,
    candidates,
    state.options.length,
    MINIMUM_PREPARED_COVER_LETTER_LENGTH
  );
  return {
    fileName: recommendation?.fileName ?? null,
    recommendation
  };
}

export async function resolvePreparedCoverLetterSelection(
  deps: PreparedCoverLetterResolutionDeps
): Promise<PreparedCoverLetterResolution | null> {
  const startingState = deps.readState();
  let settled = startingState;
  let candidates: VariantCandidate[] = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = settled;
    const snapshotKey = preparedCoverLetterOptionSnapshotKey(snapshot);
    const shouldRead =
      snapshot.options.length > 1 ||
      (snapshot.options.length === 1 &&
        snapshot.options[0]?.fileName !== snapshot.activeFileName &&
        documentIsReplaceable(snapshot));
    candidates = shouldRead ? await deps.readCandidates(snapshot.options) : [];
    if (!deps.isCurrent()) return null;

    settled = deps.readState();
    if (snapshotKey === preparedCoverLetterOptionSnapshotKey(settled)) break;
    if (attempt === 1) {
      return { recommendation: null, adoptedFileName: null };
    }
  }

  const { fileName, recommendation } = preparedCoverLetterTarget(
    deps.jobText,
    settled,
    candidates
  );
  if (
    !fileName ||
    fileName === settled.activeFileName ||
    !documentIsReplaceable(startingState) ||
    !documentIsReplaceable(settled) ||
    settled.activeFileName !== startingState.activeFileName ||
    settled.documentFingerprint !== startingState.documentFingerprint
  ) {
    return { recommendation, adoptedFileName: null };
  }

  const adoptionState = settled;
  const adopted = await deps.adopt(fileName, () => {
    const latest = deps.readState();
    return (
      !deps.isCurrent() ||
      !documentIsReplaceable(latest) ||
      latest.activeFileName !== adoptionState.activeFileName ||
      latest.documentFingerprint !== adoptionState.documentFingerprint ||
      preparedCoverLetterOptionSnapshotKey(latest) !==
        preparedCoverLetterOptionSnapshotKey(adoptionState)
    );
  });
  if (!deps.isCurrent()) return null;
  return {
    recommendation,
    adoptedFileName: adopted ? fileName : null
  };
}
