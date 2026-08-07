import { useEffect, useRef, useState } from "react";

import type { InitialFitAudit } from "../lib/initialFitAudit.ts";
import {
  meetsAutoPolishThreshold,
  type AutoPolishThreshold
} from "../lib/prepareAutomation.ts";
import type { CoverLetterRunOutcome } from "./useCoverLetter.ts";
import type { ResumePolishOutcome } from "./usePolishPipeline.ts";

export type AutomatedResumeStages = "tailor" | "both";

export function automaticResumeStages(
  preference: "tailor" | "review" | "both"
): AutomatedResumeStages {
  return preference === "tailor" ? "tailor" : "both";
}

export type PrepareAutomationDecision = {
  resume: boolean;
  coverLetter: boolean;
};

export function prepareAutomationDecision(
  audit: Pick<InitialFitAudit, "verdict">,
  resumeThreshold: AutoPolishThreshold,
  coverThreshold: AutoPolishThreshold
): PrepareAutomationDecision {
  return {
    resume: meetsAutoPolishThreshold(audit.verdict, resumeThreshold),
    coverLetter: meetsAutoPolishThreshold(audit.verdict, coverThreshold)
  };
}

export type PrepareAutomationActionState =
  | { status: "idle" }
  | { status: "waiting"; note: string }
  | { status: "running" }
  | { status: "skipped"; reason: string }
  | { status: "completed"; note: string }
  | { status: "failed"; reason: string }
  | { status: "stopped"; reason: string };

export type PrepareAutomationState = {
  auditFingerprint: string;
  resume: PrepareAutomationActionState;
  coverLetter: PrepareAutomationActionState;
};

type UsePrepareAutomationArgs = {
  audit: InitialFitAudit | null;
  resumeThreshold: AutoPolishThreshold;
  coverThreshold: AutoPolishThreshold;
  polishStages: "tailor" | "review" | "both";
  coverSelectionSettled: boolean;
  runResume: (stages: AutomatedResumeStages) => Promise<ResumePolishOutcome>;
  runCoverLetter: () => Promise<CoverLetterRunOutcome>;
};

function skippedReason(threshold: AutoPolishThreshold): string {
  return threshold === "off"
    ? "Automatic polish is off."
    : `Initial Fit is below the ${threshold} threshold.`;
}

function resumeAction(outcome: ResumePolishOutcome): PrepareAutomationActionState {
  if (outcome.status === "completed") {
    const note = outcome.review === "completed"
      ? "Resume proposal and final audit are ready."
      : outcome.review === "failed"
        ? "Resume proposal is ready; the optional final audit failed."
        : "Resume proposal is ready.";
    return { status: "completed", note };
  }
  if (outcome.status === "failed") return { status: "failed", reason: outcome.reason };
  if (outcome.status === "stopped" || outcome.status === "stale") {
    return { status: "stopped", reason: "Resume automation stopped before completion." };
  }
  return { status: "failed", reason: "Resume automation was already running." };
}

function coverAction(outcome: CoverLetterRunOutcome): PrepareAutomationActionState {
  if (outcome.status === "completed") {
    return { status: "completed", note: "Cover-letter proposal is ready for review." };
  }
  if (outcome.status === "blocked" || outcome.status === "failed") {
    return { status: "failed", reason: outcome.reason };
  }
  if (outcome.status === "stopped") {
    return { status: "stopped", reason: "Cover-letter automation stopped before completion." };
  }
  return { status: "failed", reason: "Cover-letter automation was already running." };
}

export function usePrepareAutomation({
  audit,
  resumeThreshold,
  coverThreshold,
  polishStages,
  coverSelectionSettled,
  runResume,
  runCoverLetter
}: UsePrepareAutomationArgs) {
  const [state, setState] = useState<PrepareAutomationState>({
    auditFingerprint: "",
    resume: { status: "idle" },
    coverLetter: { status: "idle" }
  });
  const handledAuditsRef = useRef(new Set<string>());
  const currentAuditFingerprintRef = useRef(audit?.fingerprint ?? "");
  const runResumeRef = useRef(runResume);
  const runCoverLetterRef = useRef(runCoverLetter);
  currentAuditFingerprintRef.current = audit?.fingerprint ?? "";
  runResumeRef.current = runResume;
  runCoverLetterRef.current = runCoverLetter;

  useEffect(() => {
    if (!audit || handledAuditsRef.current.has(audit.fingerprint)) return;
    const decision = prepareAutomationDecision(audit, resumeThreshold, coverThreshold);
    if (decision.coverLetter && !coverSelectionSettled) {
      setState({
        auditFingerprint: audit.fingerprint,
        resume: decision.resume
          ? { status: "waiting", note: "Waiting for saved materials to settle." }
          : { status: "skipped", reason: skippedReason(resumeThreshold) },
        coverLetter: { status: "waiting", note: "Selecting the best saved cover letter." }
      });
      return;
    }

    handledAuditsRef.current.add(audit.fingerprint);
    const expectedFingerprint = audit.fingerprint;
    setState({
      auditFingerprint: expectedFingerprint,
      resume: decision.resume
        ? { status: "running" }
        : { status: "skipped", reason: skippedReason(resumeThreshold) },
      coverLetter: decision.coverLetter
        ? { status: "waiting", note: decision.resume ? "Waiting for Resume automation." : "Ready to start." }
        : { status: "skipped", reason: skippedReason(coverThreshold) }
    });

    void (async () => {
      if (decision.resume) {
        try {
          const outcome = await runResumeRef.current(automaticResumeStages(polishStages));
          if (currentAuditFingerprintRef.current !== expectedFingerprint) return;
          setState((current) => ({ ...current, resume: resumeAction(outcome) }));
        } catch (error) {
          if (currentAuditFingerprintRef.current !== expectedFingerprint) return;
          setState((current) => ({
            ...current,
            resume: {
              status: "failed",
              reason: error instanceof Error ? error.message : "Resume automation failed."
            }
          }));
        }
      }

      // Cover is an independent policy decision. A failed/stopped Resume action
      // never suppresses a threshold-qualified cover proposal.
      if (!decision.coverLetter || currentAuditFingerprintRef.current !== expectedFingerprint) return;
      setState((current) => ({ ...current, coverLetter: { status: "running" } }));
      try {
        const outcome = await runCoverLetterRef.current();
        if (currentAuditFingerprintRef.current !== expectedFingerprint) return;
        setState((current) => ({ ...current, coverLetter: coverAction(outcome) }));
      } catch (error) {
        if (currentAuditFingerprintRef.current !== expectedFingerprint) return;
        setState((current) => ({
          ...current,
          coverLetter: {
            status: "failed",
            reason: error instanceof Error ? error.message : "Cover-letter automation failed."
          }
        }));
      }
    })();
  }, [
    audit,
    coverSelectionSettled,
    coverThreshold,
    polishStages,
    resumeThreshold
  ]);

  return state;
}
