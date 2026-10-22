import type { OutcomeId } from "../../lib/applicationAnalytics";

export type OutcomeCount = { id: OutcomeId; label: string; count: number };

// The rail and an opened week speak the tracker's stage-dot vocabulary; the
// derived No response takes the warm hue of the tracker's own label.
const DOT_CLASS: Record<OutcomeId, string> = {
  awaiting: "stage-dot--applied",
  noResponse: "stage-dot--no-response",
  interviewing: "stage-dot--interviewing",
  offer: "stage-dot--offer",
  rejected: "stage-dot--rejected",
  ghosted: "stage-dot--ghosted",
  withdrawn: "stage-dot--withdrawn",
  skipped: "stage-dot--not_applying"
};

export const outcomeDotClass = (id: OutcomeId) => `stage-dot ${DOT_CLASS[id]}`;
