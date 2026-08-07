import { useEffect, useRef, useState } from "react";

import type { InitialFitAudit } from "../lib/initialFitAudit.ts";
import {
  decideAutoPolish,
  type AutoPolishDecision,
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
  resume: AutoPolishDecision;
  coverLetter: AutoPolishDecision;
};

export function prepareAutomationDecision(
  audit: Pick<InitialFitAudit, "assessment">,
  resumeThreshold: AutoPolishThreshold,
  coverThreshold: AutoPolishThreshold
): PrepareAutomationDecision {
  return {
    resume: decideAutoPolish(audit.assessment, resumeThreshold),
    coverLetter: decideAutoPolish(audit.assessment, coverThreshold)
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

function settledDecisionState(decision: AutoPolishDecision): PrepareAutomationActionState {
  if (decision.action === "WAIT") return { status: "waiting", note: decision.reason };
  if (decision.action === "SKIP") return { status: "skipped", reason: decision.reason };
  return { status: "running" };
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
  const handledDecisionsRef = useRef(new Set<string>());
  const activeResumeRunRef = useRef<{
    auditFingerprint: string;
    promise: Promise<void>;
  } | null>(null);
  const currentAuditFingerprintRef = useRef(audit?.fingerprint ?? "");
  const runResumeRef = useRef(runResume);
  const runCoverLetterRef = useRef(runCoverLetter);
  currentAuditFingerprintRef.current = audit?.fingerprint ?? "";
  runResumeRef.current = runResume;
  runCoverLetterRef.current = runCoverLetter;

  useEffect(() => {
    if (audit) return;
    setState((current) => {
      if (!current.auditFingerprint) return current;
      const stopActive = (action: PrepareAutomationActionState): PrepareAutomationActionState =>
        action.status === "waiting" || action.status === "running"
          ? { status: "stopped", reason: "Initial Fit changed before this automatic action completed." }
          : action;
      const resume = stopActive(current.resume);
      const coverLetter = stopActive(current.coverLetter);
      return resume === current.resume && coverLetter === current.coverLetter
        ? current
        : { ...current, resume, coverLetter };
    });
  }, [audit]);

  useEffect(() => {
    if (!audit) return;
    const decision = prepareAutomationDecision(audit, resumeThreshold, coverThreshold);
    const expectedFingerprint = audit.fingerprint;
    const resumeDecisionKey = [
      expectedFingerprint,
      `resume:${decision.resume.action}:${decision.resume.reason}`
    ].join("|");
    const coverDecisionKey = [
      expectedFingerprint,
      `cover:${decision.coverLetter.action}:${decision.coverLetter.reason}`
    ].join("|");
    const resumeNeedsHandling = !handledDecisionsRef.current.has(resumeDecisionKey);
    const coverCanStart = decision.coverLetter.action !== "RUN" || coverSelectionSettled;
    const coverNeedsHandling = coverCanStart && !handledDecisionsRef.current.has(coverDecisionKey);
    if (!resumeNeedsHandling && !coverNeedsHandling) {
      if (decision.coverLetter.action === "RUN" && !coverSelectionSettled) {
        setState((current) => current.auditFingerprint === expectedFingerprint
          ? { ...current, coverLetter: { status: "waiting", note: "Selecting the best saved cover letter." } }
          : current);
      }
      return;
    }

    if (resumeNeedsHandling) handledDecisionsRef.current.add(resumeDecisionKey);
    if (coverNeedsHandling) handledDecisionsRef.current.add(coverDecisionKey);
    setState((current) => {
      const sameAudit = current.auditFingerprint === expectedFingerprint;
      return {
        auditFingerprint: expectedFingerprint,
        resume: resumeNeedsHandling
          ? settledDecisionState(decision.resume)
          : sameAudit ? current.resume : { status: "idle" },
        coverLetter: coverNeedsHandling
          ? decision.coverLetter.action === "RUN"
            ? { status: "waiting", note: decision.resume.action === "RUN" ? "Waiting for Resume automation." : "Ready to start." }
            : settledDecisionState(decision.coverLetter)
          : decision.coverLetter.action === "RUN" && !coverSelectionSettled
            ? { status: "waiting", note: "Selecting the best saved cover letter." }
            : sameAudit ? current.coverLetter : { status: "idle" }
      };
    });

    void (async () => {
      let currentResumeRun: Promise<void> | null = null;
      if (resumeNeedsHandling && decision.resume.action === "RUN") {
        currentResumeRun = (async () => {
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
        })();
        activeResumeRunRef.current = {
          auditFingerprint: expectedFingerprint,
          promise: currentResumeRun
        };
        await currentResumeRun;
      }

      // Cover is an independent policy decision. A failed/stopped Resume action
      // never suppresses a threshold-qualified cover proposal.
      if (
        !coverNeedsHandling ||
        decision.coverLetter.action !== "RUN" ||
        currentAuditFingerprintRef.current !== expectedFingerprint
      ) return;
      const activeResumeRun = activeResumeRunRef.current;
      if (
        activeResumeRun &&
        activeResumeRun.auditFingerprint === expectedFingerprint &&
        activeResumeRun.promise !== currentResumeRun
      ) {
        await activeResumeRun.promise;
      }
      if (currentAuditFingerprintRef.current !== expectedFingerprint) return;
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
