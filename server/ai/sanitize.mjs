// Validation + reconciliation for the structured fields a polish/strict-review
// reply returns (fit scores, missing-skill gaps). Kept separate from the
// provider clients so the response-shaping rules are easy to find and test.

function clampFitScore(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}

// Validate the AI's base/tailored fit numbers. Returns null when neither score
// is usable so the client falls back to the local engine.
export function sanitizeAiScore(raw) {
  if (!raw || typeof raw !== "object") return null;
  const base = clampFitScore(raw.base);
  const tailored = clampFitScore(raw.tailored);
  if (base === null && tailored === null) return null;
  return {
    base: base ?? tailored,
    tailored: tailored ?? base,
    liftReason: typeof raw.liftReason === "string" ? raw.liftReason.slice(0, 300) : ""
  };
}

const EVIDENCE_TYPES = new Set(["exact", "adjacent", "none"]);

export function sanitizeMissingRequiredSkills(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const keyword = String(item.keyword ?? item.skill ?? "").trim().slice(0, 120);
      if (!keyword) return null;
      const evidenceType = EVIDENCE_TYPES.has(String(item.evidenceType)) ? String(item.evidenceType) : "none";
      return {
        keyword,
        evidenceType,
        canHonestlyAdd: evidenceType === "exact" ? Boolean(item.canHonestlyAdd) : false,
        reason: String(item.reason ?? item.evidence ?? "").trim().slice(0, 300)
      };
    })
    .filter(Boolean)
    .slice(0, 8);
}

export function missingRequiredSkillsFromStrictReview(strictReview) {
  if (!strictReview || !Array.isArray(strictReview.gaps)) return [];
  return sanitizeMissingRequiredSkills(
    strictReview.gaps.map((gap) => ({
      keyword: gap.gap,
      evidenceType: gap.evidenceType,
      canHonestlyAdd: gap.canHonestlyAdd,
      reason: gap.evidence || gap.suggestedEdit
    }))
  );
}

// The numeric band each strict-review verdict must fall in. Mirrors the rule in
// the strict-review prompt.
const VERDICT_SCORE_BANDS = {
  "DON'T APPLY": [0, 45],
  STRETCH: [46, 69],
  "REASONABLE FIT": [70, 84],
  "STRONG FIT": [85, 100]
};

// Enforce verdict/score agreement server-side rather than trusting the prompt:
// if the model returns e.g. "DON'T APPLY" with a tailored 82, clamp the tailored
// score into the verdict's band so the UI can't show a contradictory pair. The
// verdict is the categorical judgment, so the number defers to it.
export function reconcileScoreToVerdict(aiScore, verdict) {
  if (!aiScore || typeof verdict !== "string") return aiScore;
  const band = VERDICT_SCORE_BANDS[verdict.trim().toUpperCase()];
  if (!band) return aiScore;
  const [lo, hi] = band;
  const tailored = Math.max(lo, Math.min(hi, aiScore.tailored));
  if (tailored !== aiScore.tailored) {
    console.warn("[ai] reconciled tailored fit score to verdict band", {
      verdict,
      from: aiScore.tailored,
      to: tailored
    });
  }
  return { ...aiScore, tailored };
}
