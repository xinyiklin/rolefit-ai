/**
 * usePreparedResume — the single authoritative "which resume does this
 * preparation speak for" operation.
 *
 * It runs once per Prepare, immediately after the deterministic local job
 * analysis and before the combined AI Job analysis + Fit Assessment request, and
 * it owns every step of that answer: wait for workspace hydration, protect a
 * real current document, adopt the sole saved variant or the ranked winner
 * through the guarded workspace loader, and return the exact text (plus its
 * content fingerprint) that the provider request will carry.
 *
 * It replaced two independent selectors — a pre-fit pick that never adopted and
 * a post-Prepare ranking effect that could adopt a different variant — whose
 * disagreement made Fit Assessment describe one resume while the editor held
 * another. "Workspace is still loading" is never treated as "no resume".
 *
 * State ownership: the recommendation note and the resolving flag are OWNED
 * here; App only reads them for render. The ordering rules themselves live in
 * `lib/preparedResume.ts` so they are executable in tests rather than only
 * inspectable as source text. Every live value the decision needs arrives
 * through one `readState` thunk, because resolution runs at dispatch time
 * rather than render time and must never decide from a stale closure.
 */
import { useCallback, useRef, useState } from "react";

import {
  resolvePreparedResumeSelection,
  type PreparedResumeAdoption,
  type PreparedResumeSelection,
  type PreparedResumeState
} from "../lib/preparedResume.ts";
import type { VariantCandidate, VariantRecommendation } from "../lib/variantRecommendation.ts";
import type { BaseResumeOption } from "./useWorkspaceResume";

export type PreparedResumeResolverState = PreparedResumeState;

type UsePreparedResumeArgs = {
  readState: () => PreparedResumeResolverState;
  whenWorkspaceBootstrapped: () => Promise<void>;
  readBaseResumeCandidates: (options: BaseResumeOption[]) => Promise<VariantCandidate[]>;
  loadBaseResumeVersion: (
    fileName: string,
    clearRecoveryOnCommit?: boolean,
    shouldCancel?: () => boolean
  ) => Promise<PreparedResumeAdoption | null>;
};

export function usePreparedResume({
  readState,
  whenWorkspaceBootstrapped,
  readBaseResumeCandidates,
  loadBaseResumeVersion
}: UsePreparedResumeArgs) {
  const [resumeVariantRecommendation, setResumeVariantRecommendation] =
    useState<VariantRecommendation | null>(null);
  const [isResolvingPreparedResume, setIsResolvingPreparedResume] = useState(false);
  const resolveGenerationRef = useRef(0);

  const clearPreparedResumeRecommendation = useCallback(() => {
    resolveGenerationRef.current += 1;
    setResumeVariantRecommendation(null);
    setIsResolvingPreparedResume(false);
  }, []);

  const resolvePreparedResume = useCallback(
    async (jobText: string): Promise<PreparedResumeSelection | null> => {
      resolveGenerationRef.current += 1;
      const generation = resolveGenerationRef.current;
      const isCurrent = () => generation === resolveGenerationRef.current;
      setIsResolvingPreparedResume(true);
      try {
        const resolution = await resolvePreparedResumeSelection({
          jobText,
          whenWorkspaceBootstrapped,
          readState,
          readCandidates: (options) => readBaseResumeCandidates(options as BaseResumeOption[]),
          // Adoption always goes through the guarded workspace loader, and
          // cancels the moment the document stops being safe to replace.
          adopt: (fileName) =>
            loadBaseResumeVersion(fileName, true, () => {
              const latest = readState();
              return (
                !isCurrent() ||
                latest.applicationOwned ||
                latest.documentDirty ||
                latest.manualSelectionInFlight
              );
            }),
          isCurrent
        });
        if (!resolution) return null;
        setResumeVariantRecommendation(resolution.recommendation);
        return resolution.selection;
      } finally {
        if (isCurrent()) setIsResolvingPreparedResume(false);
      }
    },
    [loadBaseResumeVersion, readBaseResumeCandidates, readState, whenWorkspaceBootstrapped]
  );

  return {
    resolvePreparedResume,
    clearPreparedResumeRecommendation,
    resumeVariantRecommendation,
    isResolvingPreparedResume
  };
}
