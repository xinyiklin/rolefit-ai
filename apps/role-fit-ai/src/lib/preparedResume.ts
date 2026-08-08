// Which resume this preparation speaks for — the ONE decision behind Initial
// Fit, the editor's loaded document, Prepare's recommendation note, and whether
// an automatic proposal may begin. Splitting that decision in two (a pre-fit
// pick that never adopted, plus a post-Prepare ranking that could adopt a
// different variant) let Initial Fit describe resume A while the editor held
// resume B, which then suppressed the proposals the fit had just approved.
//
// Pure by design: this module decides, the resolver hook performs the load.

import { contentFingerprint } from "./contentFingerprint.ts";
import { recommendVariant, type VariantCandidate, type VariantRecommendation } from "./variantRecommendation.ts";

// The same floor the variant ranker uses for a resume: anything shorter is a
// stub, not a document worth screening a posting against.
export const MINIMUM_PREPARED_RESUME_LENGTH = 80;

// Where the document currently in the editor came from. Only `starter` is
// sample content that must never be mistaken for the applicant's own resume.
export type ResumeOrigin = "saved" | "uploaded" | "application" | "starter" | "blank";

export type PreparedResumeOrigin = "current" | "sole-saved" | "ranked";

export type PreparedResumeSelection = {
  fileName: string | null;
  label: string;
  text: string;
  contentFingerprint: string;
  origin: PreparedResumeOrigin;
};

// Why no resume could be resolved. "starter-only" is the case worth naming: the
// bundled starter is long enough to pass every length test while being sample
// content that must never be screened, tailored, or reported as ready.
export type PreparedResumeBlocker = "no-resume" | "starter-only";

export type PreparedResumeDecision =
  | { kind: "current" }
  | { kind: "adopt"; fileName: string; origin: "sole-saved" | "ranked" }
  | { kind: "none"; reason: PreparedResumeBlocker };

export type PreparedResumeInput = Readonly<{
  // The local job-analysis brief, not the raw posting: the ranker weights
  // section headings, and the raw page text has none of them.
  jobText: string;
  // How many saved variants the workspace reports. An incomplete candidate read
  // must not be ranked as if it were the whole set.
  savedOptionCount: number;
  candidates: VariantCandidate[];
  loadedFileName: string;
  currentText: string;
  // False for the bundled starter, and for anything else that is not the
  // applicant's own document.
  currentIsApplicantOwned: boolean;
  // False while the current document must not be replaced: unsaved edits, an
  // application of record, or another selection/save already in flight.
  canAdopt: boolean;
}>;

function usableCurrent(input: PreparedResumeInput): boolean {
  return (
    input.currentIsApplicantOwned &&
    input.currentText.trim().length >= MINIMUM_PREPARED_RESUME_LENGTH
  );
}

function fallback(input: PreparedResumeInput): PreparedResumeDecision {
  if (usableCurrent(input)) return { kind: "current" };
  return {
    kind: "none",
    reason:
      !input.currentIsApplicantOwned &&
      input.currentText.trim().length >= MINIMUM_PREPARED_RESUME_LENGTH
        ? "starter-only"
        : "no-resume"
  };
}

export function decidePreparedResume(input: PreparedResumeInput): {
  decision: PreparedResumeDecision;
  recommendation: VariantRecommendation | null;
} {
  if (!input.canAdopt) return { decision: fallback(input), recommendation: null };

  // Exactly one saved variant is not a ranking problem, it is the answer. This
  // is the case that used to fail: with a single saved resume there was nothing
  // to recommend, so preparation fell through to whatever text the editor
  // happened to hold — empty, while the workspace was still hydrating.
  if (input.savedOptionCount === 1) {
    const only = input.candidates[0];
    if (
      only?.fileName &&
      only.text.trim().length >= MINIMUM_PREPARED_RESUME_LENGTH &&
      only.fileName !== input.loadedFileName
    ) {
      return { decision: { kind: "adopt", fileName: only.fileName, origin: "sole-saved" }, recommendation: null };
    }
    return { decision: fallback(input), recommendation: null };
  }

  if (input.savedOptionCount > 1) {
    const recommendation = recommendVariant(input.jobText, input.candidates, input.savedOptionCount);
    if (recommendation && recommendation.fileName !== input.loadedFileName) {
      return {
        decision: { kind: "adopt", fileName: recommendation.fileName, origin: "ranked" },
        recommendation
      };
    }
    return { decision: fallback(input), recommendation };
  }

  return { decision: fallback(input), recommendation: null };
}

// ---------------------------------------------------------------------------
// The resolution sequence. Deliberately outside React: the ordering rules here
// (wait for hydration, decide once, adopt through the guarded loader, report
// what was actually loaded) are the ones that broke in production, so they are
// directly executable in tests rather than only inspectable as source text.

export type PreparedResumeState = {
  baseResumeName: string;
  options: { fileName: string; label: string }[];
  resumeOrigin: ResumeOrigin;
  applicationOwned: boolean;
  currentText: string;
  documentTitle: string;
  documentDirty: boolean;
  manualSelectionInFlight: boolean;
  savingBaseResume: boolean;
};

export type PreparedResumeResolution = {
  selection: PreparedResumeSelection | null;
  recommendation: VariantRecommendation | null;
  blocker: PreparedResumeBlocker | null;
};

// A blank document speaks for nobody; the starter speaks for a sample person.
// A restored application's resume is the applicant's own by definition.
export function resumeIsApplicantOwned(state: PreparedResumeState): boolean {
  return state.applicationOwned || (state.resumeOrigin !== "starter" && state.resumeOrigin !== "blank");
}

function documentIsReplaceable(state: PreparedResumeState): boolean {
  return (
    !state.applicationOwned &&
    !state.documentDirty &&
    !state.manualSelectionInFlight &&
    !state.savingBaseResume
  );
}

function currentLabel(state: PreparedResumeState): string {
  return (
    state.options.find((option) => option.fileName === state.baseResumeName)?.label ||
    state.documentTitle ||
    "Current resume"
  );
}

// The document actually on screen, as a selection — used both when it is the
// right answer and when a chosen adoption could not be committed.
export function currentResumeSelection(state: PreparedResumeState): PreparedResumeSelection | null {
  if (!resumeIsApplicantOwned(state)) return null;
  if (state.currentText.trim().length < MINIMUM_PREPARED_RESUME_LENGTH) return null;
  return {
    fileName: state.baseResumeName || null,
    label: currentLabel(state),
    text: state.currentText,
    contentFingerprint: contentFingerprint(state.currentText),
    origin: "current"
  };
}

export type PreparedResumeResolutionDeps = {
  jobText: string;
  // Terminal states only. A resume that is still being read is not "no resume",
  // so resolution waits for the startup load rather than sampling a boolean an
  // extension import can observe mid-flight.
  whenWorkspaceBootstrapped: () => Promise<void>;
  readState: () => PreparedResumeState;
  readCandidates: (options: { fileName: string; label: string }[]) => Promise<VariantCandidate[]>;
  // The guarded workspace loader. Returns whether the document was replaced.
  adopt: (fileName: string) => Promise<boolean>;
  // False once this resolution has been superseded by a newer one.
  isCurrent: () => boolean;
};

export async function resolvePreparedResumeSelection(
  deps: PreparedResumeResolutionDeps
): Promise<PreparedResumeResolution | null> {
  await deps.whenWorkspaceBootstrapped();
  if (!deps.isCurrent()) return null;

  const hydrated = deps.readState();
  const candidates = documentIsReplaceable(hydrated) && hydrated.options.length
    ? await deps.readCandidates(hydrated.options)
    : [];
  if (!deps.isCurrent()) return null;

  // Re-read: reading candidates awaited, and the user may have started editing.
  const settled = deps.readState();
  const { decision, recommendation } = decidePreparedResume({
    jobText: deps.jobText,
    savedOptionCount: settled.options.length,
    candidates,
    loadedFileName: settled.baseResumeName,
    currentText: settled.currentText,
    currentIsApplicantOwned: resumeIsApplicantOwned(settled),
    canAdopt: documentIsReplaceable(settled)
  });

  if (decision.kind === "adopt") {
    const candidate = candidates.find((entry) => entry.fileName === decision.fileName);
    const adopted = candidate ? await deps.adopt(decision.fileName) : false;
    if (!deps.isCurrent()) return null;
    if (adopted && candidate) {
      return {
        selection: {
          fileName: candidate.fileName,
          label: candidate.label,
          text: candidate.text,
          contentFingerprint: contentFingerprint(candidate.text),
          origin: decision.origin
        },
        recommendation,
        blocker: null
      };
    }
    // A blocked or failed adoption falls back to the document actually on
    // screen rather than reporting a resume the editor does not hold.
    const fallbackSelection = currentResumeSelection(deps.readState());
    return {
      selection: fallbackSelection,
      recommendation,
      blocker: fallbackSelection ? null : "no-resume"
    };
  }

  if (decision.kind === "current") {
    return { selection: currentResumeSelection(settled), recommendation, blocker: null };
  }
  return { selection: null, recommendation, blocker: decision.reason };
}
