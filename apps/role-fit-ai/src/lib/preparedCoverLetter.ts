import {
  recommendVariant,
  type VariantCandidate,
  type VariantRecommendation
} from "./variantRecommendation.ts";
import { eligibleVariantOptions, type VariantExclusions } from "./variantPool.ts";

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
  // Settings' cover-letter pool: excluded letters are never read, ranked, or adopted.
  excludedVariants: VariantExclusions;
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
    eligibleFileNames: eligibleVariantOptions(state.options, state.excludedVariants).map((option) => option.fileName),
    candidateRevision: state.candidateRevision
  });
}

function preparedCoverLetterTarget(
  jobText: string,
  state: PreparedCoverLetterState,
  candidates: VariantCandidate[]
): { fileName: string | null; recommendation: VariantRecommendation | null } {
  const eligible = eligibleVariantOptions(state.options, state.excludedVariants);
  if (eligible.length === 1) {
    const only = candidates[0];
    const fileName =
      candidates.length === 1 &&
      only?.fileName === eligible[0]?.fileName &&
      only.text.trim().length >= MINIMUM_PREPARED_COVER_LETTER_LENGTH
        ? only.fileName
        : null;
    return {
      fileName,
      recommendation: null
    };
  }
  if (eligible.length === 0) {
    return { fileName: null, recommendation: null };
  }
  const recommendation = recommendVariant(
    jobText,
    candidates,
    eligible.length,
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
    const eligible = eligibleVariantOptions(snapshot.options, snapshot.excludedVariants);
    const shouldRead =
      eligible.length > 1 ||
      (eligible.length === 1 &&
        eligible[0]?.fileName !== snapshot.activeFileName &&
        documentIsReplaceable(snapshot));
    candidates = shouldRead ? await deps.readCandidates(eligible) : [];
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
  // A pick ranked under an option set or pool that changed before commit is
  // stale; other cancellations (edits, ownership) keep it as a non-mutating hint.
  const rankedSnapshotChanged =
    !adopted &&
    preparedCoverLetterOptionSnapshotKey(deps.readState()) !==
      preparedCoverLetterOptionSnapshotKey(adoptionState);
  return {
    recommendation: rankedSnapshotChanged ? null : recommendation,
    adoptedFileName: adopted ? fileName : null
  };
}
