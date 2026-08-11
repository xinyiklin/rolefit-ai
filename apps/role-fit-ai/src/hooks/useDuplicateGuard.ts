/**
 * Duplicate review for the current posting. Matching can pause a workflow,
 * open an exact saved record, or remember a non-destructive posting
 * relationship. It never chooses a tracker write target.
 */
import { useEffect, useRef, useState } from "react";
import type { Application } from "./useApplications";
import { NOT_APPLYING_REASON_LABEL } from "../lib/notApplying.ts";
import type { DuplicateMatch, DuplicateTarget } from "../lib/jobIdentity";
import type { JobPostingRelationship } from "../lib/preparationSession";
import {
  STATUS_LABEL,
  displayCompany,
  displayRole,
  formatCompactDate
} from "../lib/applicationDisplay";

type TrackingFacts = { company?: string; role?: string; location?: string };

export type DuplicateResolution =
  | {
      action: "continue";
      relationship: JobPostingRelationship | null;
      unrelatedApplicationId?: string;
    }
  | { action: "open-existing"; applicationId: string }
  | { action: "cancel" };

export type DuplicatePreparationPrompt = {
  kind: "existing-application" | "existing-draft" | "existing-not-applying" | "similar";
  title: string;
  message: string;
};

export type DuplicatePreparationChoice =
  | "continue-new"
  | "continue-existing"
  | "review-again"
  | "open-existing"
  | "link"
  | "separate"
  | "cancel";

export type DuplicateGateResult = {
  proceed: boolean;
  note: string | null;
  handled?: boolean;
};

type UseDuplicateGuardArgs = {
  jobUrl: string;
  jobDescription: string;
  jobRawText: string;
  tracking: () => TrackingFacts;
  findDuplicatesForTarget: (target: DuplicateTarget) => DuplicateMatch<Application>[];
  onOpenExisting: (applicationId: string) => Promise<boolean>;
  onRelationshipResolved: (relationship: JobPostingRelationship | null) => void;
};

type AcknowledgedDecision = "existing" | "link" | "separate";
type Acknowledgment = {
  appId: string;
  jobKey: string;
  decision: AcknowledgedDecision;
};

function makeJobKey(url: string, text: string): string {
  return `${url.trim()}\u0000${text.trim().slice(0, 500)}`;
}

function hashKey(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(36);
}

function relationshipFor(match: DuplicateMatch<Application>): JobPostingRelationship {
  const isNotApplying = String(match.application.status) === "not_applying";
  return {
    matchedApplicationId: match.application.id,
    ...(match.application.jobPostingGroupId
      ? { jobPostingGroupId: match.application.jobPostingGroupId }
      : {}),
    confidence: match.confidence,
    ...(isNotApplying ? { matchedNotApplyingRecordId: match.application.id } : {})
  };
}

function promptFor(match: DuplicateMatch<Application>): DuplicatePreparationPrompt {
  const application = match.application;
  const roleAtCompany = `${displayRole(application)} at ${displayCompany(application)}`;
  const when = application.appliedAt || application.updatedAt;
  const evidence = match.evidence.length ? `\n${match.evidence.join("\n")}` : "";

  if (match.confidence !== "exact") {
    return {
      kind: "similar",
      title: "Similar job found",
      message: `This looks similar to ${roleAtCompany}.${evidence}\nIs this the same job posting?`
    };
  }
  if (application.status === "interested") {
    return {
      kind: "existing-draft",
      title: "Preparation already exists",
      message: `You already started preparing ${roleAtCompany}.${evidence}`
    };
  }
  if (String(application.status) === "not_applying") {
    const notApplyingAt = application.notApplyingAt;
    const reason = application.notApplyingReason
      ? `\nReason: ${NOT_APPLYING_REASON_LABEL[application.notApplyingReason]}`
      : "";
    return {
      kind: "existing-not-applying",
      title: "You previously passed on this job",
      message: `Marked Not applying on ${formatCompactDate(notApplyingAt || when)}.${reason}${evidence}`
    };
  }
  return {
    kind: "existing-application",
    title: "Previous application found",
    message: `You applied to ${roleAtCompany} on ${formatCompactDate(when)}. Continuing will create a separate application linked to the same posting.${evidence}`
  };
}

export function useDuplicateGuard({
  jobUrl,
  jobDescription,
  jobRawText,
  tracking,
  findDuplicatesForTarget,
  onOpenExisting,
  onRelationshipResolved
}: UseDuplicateGuardArgs) {
  const acknowledgmentRef = useRef<Acknowledgment | null>(null);
  const promptResolverRef = useRef<((choice: DuplicatePreparationChoice) => void) | null>(null);
  const [duplicatePrompt, setDuplicatePrompt] = useState<DuplicatePreparationPrompt | null>(null);

  useEffect(() => () => {
    promptResolverRef.current?.("cancel");
    promptResolverRef.current = null;
  }, []);

  function targetJobKey(target: Pick<DuplicateTarget, "jobUrl" | "jobText">): string {
    return makeJobKey(target.jobUrl || "", target.jobText || "");
  }

  function currentTarget(): DuplicateTarget {
    const facts = tracking();
    return {
      jobUrl: jobUrl.trim(),
      jobText: jobRawText.trim() || jobDescription,
      company: facts.company,
      role: facts.role,
      location: facts.location
    };
  }

  function currentJobKey(): string {
    return targetJobKey(currentTarget());
  }

  function currentJobKeyHash(): string {
    return hashKey(currentJobKey());
  }

  function currentMatch(): DuplicateMatch<Application> | undefined {
    return findDuplicatesForTarget(currentTarget())[0];
  }

  function acknowledgedDecision(
    appId: string,
    target: Pick<DuplicateTarget, "jobUrl" | "jobText">
  ): AcknowledgedDecision | null {
    const acknowledgment = acknowledgmentRef.current;
    return acknowledgment?.appId === appId && acknowledgment.jobKey === targetJobKey(target)
      ? acknowledgment.decision
      : null;
  }

  function acknowledge(
    appId: string,
    target: Pick<DuplicateTarget, "jobUrl" | "jobText">,
    decision: AcknowledgedDecision
  ): void {
    acknowledgmentRef.current = { appId, jobKey: targetJobKey(target), decision };
  }

  function duplicateNote(match: DuplicateMatch<Application>): string {
    const when = match.application.appliedAt || match.application.updatedAt;
    return `${STATUS_LABEL[match.application.status]} · ${formatCompactDate(when)}: ${match.evidence[0] ?? "matching posting"}`;
  }

  function requestChoice(prompt: DuplicatePreparationPrompt): Promise<DuplicatePreparationChoice> {
    if (promptResolverRef.current) return Promise.resolve("cancel");
    return new Promise((resolve) => {
      promptResolverRef.current = resolve;
      setDuplicatePrompt(prompt);
    });
  }

  function chooseDuplicate(choice: DuplicatePreparationChoice): void {
    const resolve = promptResolverRef.current;
    if (!resolve) return;
    promptResolverRef.current = null;
    setDuplicatePrompt(null);
    resolve(choice);
  }

  async function resolveMatch(
    match: DuplicateMatch<Application>,
    target: DuplicateTarget
  ): Promise<DuplicateResolution> {
    const priorDecision = acknowledgedDecision(match.application.id, target);
    if (priorDecision) {
      return {
        action: "continue",
        relationship: priorDecision === "link" ? relationshipFor(match) : null,
        ...(priorDecision === "separate"
          ? { unrelatedApplicationId: match.application.id }
          : {})
      };
    }

    const choice = await requestChoice(promptFor(match));
    if (choice === "cancel") return { action: "cancel" };
    if (choice === "open-existing" || choice === "continue-existing") {
      const opened = await onOpenExisting(match.application.id);
      return opened
        ? { action: "open-existing", applicationId: match.application.id }
        : { action: "cancel" };
    }
    if (choice === "separate") {
      acknowledge(match.application.id, target, "separate");
      onRelationshipResolved(null);
      return {
        action: "continue",
        relationship: null,
        unrelatedApplicationId: match.application.id
      };
    }

    const relationship = relationshipFor(match);
    acknowledge(match.application.id, target, "link");
    onRelationshipResolved(relationship);
    return { action: "continue", relationship };
  }

  async function confirmDuplicateGate(
    target: DuplicateTarget,
    _nextStage: "Job analysis" | "Resume Polish"
  ): Promise<DuplicateGateResult> {
    const match = findDuplicatesForTarget(target)[0];
    if (!match) return { proceed: true, note: null };

    const resolution = await resolveMatch(match, target);
    if (resolution.action === "continue") {
      return { proceed: true, note: duplicateNote(match) };
    }
    return {
      proceed: false,
      note: duplicateNote(match),
      handled: resolution.action === "open-existing"
    };
  }

  function ackApplication(
    application: Pick<Application, "id" | "jobUrl" | "jobDescription" | "rawJobDescription">
  ): void {
    acknowledgmentRef.current = {
      appId: application.id,
      jobKey: makeJobKey(
        application.jobUrl || "",
        (application.rawJobDescription ?? "").trim() || application.jobDescription || ""
      ),
      decision: "existing"
    };
  }

  async function confirmDuplicateBeforeJobAnalysis(
    url: string,
    text: string,
    facts: TrackingFacts
  ): Promise<DuplicateGateResult> {
    return confirmDuplicateGate({
      jobUrl: url,
      jobText: text,
      company: facts.company,
      role: facts.role,
      location: facts.location
    }, "Job analysis");
  }

  async function confirmDuplicateAfterJobAnalysis(
    url: string,
    text: string,
    facts: TrackingFacts
  ): Promise<DuplicateGateResult> {
    return confirmDuplicateGate({
      jobUrl: url,
      jobText: text,
      company: facts.company,
      role: facts.role,
      location: facts.location
    }, "Resume Polish");
  }

  async function confirmDuplicateBeforePolish(): Promise<boolean> {
    return (await confirmDuplicateGate(currentTarget(), "Resume Polish")).proceed;
  }

  async function resolveApplyDuplicate(): Promise<DuplicateResolution> {
    const target = currentTarget();
    const match = currentMatch();
    return match ? resolveMatch(match, target) : { action: "continue", relationship: null };
  }

  return {
    duplicatePrompt,
    chooseDuplicate,
    currentJobKeyHash,
    confirmDuplicateBeforeJobAnalysis,
    confirmDuplicateAfterJobAnalysis,
    confirmDuplicateBeforePolish,
    resolveApplyDuplicate,
    ackApplication
  };
}
