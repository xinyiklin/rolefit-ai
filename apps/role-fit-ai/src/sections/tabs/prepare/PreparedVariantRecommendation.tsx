import type { VariantRecommendation } from "../../../lib/variantRecommendation";

type PreparedVariantRecommendationProps = {
  isRanking: boolean;
  recommendation: VariantRecommendation | null;
  selectedFileName: string;
  onUse: (fileName: string) => void;
};

// The clean path is silent: ranking selects the best source and the selector
// shows the result. This compact fallback appears only when protected editor
// state blocks that safe automatic replacement.
export function PreparedVariantRecommendation({
  isRanking,
  recommendation,
  selectedFileName,
  onUse
}: PreparedVariantRecommendationProps) {
  if (isRanking || !recommendation) return null;
  const selected = recommendation.fileName === selectedFileName;
  if (selected) return null;
  return (
    <p className="prepare-note">
      <strong>Recommended: {recommendation.label}</strong>
      <button
        className="ghost-button is-compact prepare-note__action"
        type="button"
        onClick={() => onUse(recommendation.fileName)}
      >
        Select
      </button>
    </p>
  );
}
