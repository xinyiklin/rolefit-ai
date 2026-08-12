import { useCallback, useEffect, useRef, useState } from "react";

import {
  resolvePreparedCoverLetterSelection,
  type PreparedCoverLetterResolutionDeps,
  type PreparedCoverLetterState
} from "../lib/preparedCoverLetter.ts";
import type { VariantRecommendation } from "../lib/variantRecommendation.ts";

type WorkspaceOpenOptions = {
  background?: boolean;
  shouldCancel?: () => boolean;
};

type UsePreparedCoverLetterArgs = {
  preparationId: string;
  jobPrepared: boolean;
  jobText: string;
  rankingJobText: string;
  state: PreparedCoverLetterState;
  isWorkspaceBootstrapping: boolean;
  isWorkspaceReplacing: boolean;
  readCandidates: PreparedCoverLetterResolutionDeps["readCandidates"];
  openWorkspaceCoverLetter: (
    fileName: string,
    options: WorkspaceOpenOptions
  ) => Promise<boolean>;
};

export function usePreparedCoverLetter({
  preparationId,
  jobPrepared,
  jobText,
  rankingJobText,
  state,
  isWorkspaceBootstrapping,
  isWorkspaceReplacing,
  readCandidates,
  openWorkspaceCoverLetter
}: UsePreparedCoverLetterArgs) {
  const stateRef = useRef(state);
  stateRef.current = state;
  const inputKey =
    jobPrepared &&
    !isWorkspaceBootstrapping &&
    preparationId &&
    rankingJobText === jobText.trim() &&
    state.options.length > 0
      ? JSON.stringify({
          preparationId,
          job: rankingJobText,
          orderedFileNames: state.options.map((option) => option.fileName),
          candidateRevision: state.candidateRevision
        })
      : "";
  const inputKeyRef = useRef(inputKey);
  inputKeyRef.current = inputKey;
  const resolvedKeyRef = useRef("");
  const generationRef = useRef(0);
  const manuallyOwnedPreparationRef = useRef("");
  const [activeResolutionKey, setActiveResolutionKey] = useState("");
  const [recommendationReceipt, setRecommendationReceipt] = useState<{
    key: string;
    recommendation: VariantRecommendation | null;
  }>({ key: "", recommendation: null });

  const preemptPreparedCoverLetterResolution = useCallback(() => {
    generationRef.current += 1;
    manuallyOwnedPreparationRef.current = preparationId;
    setActiveResolutionKey("");
    setRecommendationReceipt({ key: "", recommendation: null });
  }, [preparationId]);

  const manuallyOwned = Boolean(
    preparationId && manuallyOwnedPreparationRef.current === preparationId
  );

  useEffect(() => {
    if (!inputKey || manuallyOwned || resolvedKeyRef.current === inputKey) return;

    resolvedKeyRef.current = inputKey;
    generationRef.current += 1;
    const generation = generationRef.current;
    const isCurrent = () =>
      generation === generationRef.current && inputKeyRef.current === inputKey;
    setActiveResolutionKey(inputKey);

    void (async () => {
      try {
        const result = await resolvePreparedCoverLetterSelection({
          jobText: rankingJobText,
          readState: () => stateRef.current,
          readCandidates,
          adopt: (fileName, shouldCancel) =>
            openWorkspaceCoverLetter(fileName, {
              background: true,
              shouldCancel: () => !isCurrent() || shouldCancel()
            }),
          isCurrent
        });
        if (!result || !isCurrent()) return;
        setRecommendationReceipt({
          key: inputKey,
          recommendation: result.recommendation
        });
      } finally {
        if (isCurrent()) setActiveResolutionKey("");
      }
    })();

    return () => {
      if (generation === generationRef.current) {
        generationRef.current += 1;
        if (resolvedKeyRef.current === inputKey) resolvedKeyRef.current = "";
      }
    };
  }, [
    inputKey,
    manuallyOwned,
    openWorkspaceCoverLetter,
    rankingJobText,
    readCandidates
  ]);

  const isResolvingPreparedCoverLetter =
    Boolean(inputKey) && activeResolutionKey === inputKey;
  const preparedCoverLetterResolutionPending = Boolean(
    isWorkspaceBootstrapping ||
      isWorkspaceReplacing ||
      (jobPrepared &&
        !manuallyOwned &&
        state.options.length > 0 &&
        (rankingJobText !== jobText.trim() ||
          !inputKey ||
          resolvedKeyRef.current !== inputKey ||
          isResolvingPreparedCoverLetter))
  );
  const coverLetterVariantRecommendation =
    recommendationReceipt.key === inputKey
      ? recommendationReceipt.recommendation
      : null;

  return {
    coverLetterVariantRecommendation,
    isResolvingPreparedCoverLetter,
    preparedCoverLetterResolutionPending,
    preemptPreparedCoverLetterResolution
  };
}
