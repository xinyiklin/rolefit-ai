/**
 * useDuplicateGuard — the duplicate-application warning ladder for the CURRENT
 * job target, extracted from App.tsx so the acknowledgment state and the two
 * blocking dialogs live behind one boundary:
 *
 *   1. confirmDuplicateBeforeDistill — blocking gate before Distill
 *   2. confirmDuplicateBeforePolish — blocking gate before Tailor / Review
 *   3. resolveApplyDuplicate — Apply-time confirm + merge-target resolution
 *
 * A confirmed warning is acknowledged once per job target: the ack is keyed by
 * the target's identity (URL + text prefix), so loading a different job
 * self-invalidates it with no reset bookkeeping, and Apply skips the identical
 * dialog the user already confirmed at the polish gate. Loading a tracked
 * application back into the studio pre-acknowledges its own record — merging
 * back into it is the point, not a duplicate.
 *
 * Merge-safety contract (same as the matcher's): only exact/high matches ever
 * produce a merge target, and only after the user confirms when the record was
 * already acted on; "possible" matches never merge.
 */
import { useRef } from "react";
import type { Application } from "./useApplications";
import type { DuplicateMatch, DuplicateTarget } from "../lib/jobIdentity";
import type { ConfirmOptions } from "./useDialog";
import { STATUS_LABEL, displayCompany, displayRole, formatCompactDate } from "../lib/applicationDisplay";

type TrackingFacts = { company?: string; role?: string; location?: string };

type UseDuplicateGuardArgs = {
  jobUrl: string;
  jobDescription: string;
  jobRawText: string;
  // Lazily evaluated so declaration order in the caller doesn't matter.
  tracking: () => TrackingFacts;
  findDuplicatesForTarget: (target: DuplicateTarget) => DuplicateMatch<Application>[];
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
};

export type ApplyDuplicateResolution = {
  proceed: boolean;
  // The application to merge this apply into (exact/high match), or null for a
  // normal new-record apply. Never set for "possible" matches.
  mergeTargetId: string | null;
};

export type DuplicateGateResult = {
  proceed: boolean;
  note: string | null;
};

// Identity of a job target for duplicate-warning acknowledgments — URL plus a
// text prefix is enough to detect "the same target is still loaded". The
// separator is an escape sequence (not a raw control byte) so this file stays
// plain text to grep/diff tooling.
function makeJobKey(url: string, text: string): string {
  return `${url.trim()}\u0000${text.trim().slice(0, 500)}`;
}

// djb2 over the job key — a compact identity the autosave draft can persist to
// gate provenance restores without storing JD text (a role·company label alone
// collides across reposts, the exact case the duplicate matcher exists for).
function hashKey(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

export function useDuplicateGuard({
  jobUrl,
  jobDescription,
  jobRawText,
  tracking,
  findDuplicatesForTarget,
  confirm
}: UseDuplicateGuardArgs) {
  // The duplicate the user has ALREADY confirmed past (polish gate or an apply
  // dialog) for the CURRENT job target.
  const ackRef = useRef<{ appId: string; jobKey: string } | null>(null);

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

  // Duplicate lookup for the CURRENT job target (live state). Shared by the
  // pre-polish gate and Apply so both stages see the same match.
  function currentMatch(): DuplicateMatch<Application> | undefined {
    return findDuplicatesForTarget(currentTarget())[0];
  }

  function isTargetAcked(appId: string, target: Pick<DuplicateTarget, "jobUrl" | "jobText">): boolean {
    const ack = ackRef.current;
    return Boolean(ack && ack.appId === appId && ack.jobKey === targetJobKey(target));
  }

  function ackTarget(appId: string, target: Pick<DuplicateTarget, "jobUrl" | "jobText">): void {
    ackRef.current = { appId, jobKey: targetJobKey(target) };
  }

  function duplicateNote(match: DuplicateMatch<Application>): string {
    const when = match.application.appliedAt || match.application.updatedAt;
    return `${STATUS_LABEL[match.application.status]} · ${formatCompactDate(when)}: ${match.evidence[0] ?? "duplicate application"}`;
  }

  async function confirmDuplicateGate(target: DuplicateTarget, nextStage: "Distill" | "Tailor / Review"): Promise<DuplicateGateResult> {
    const match = findDuplicatesForTarget(target)[0];
    if (!match || match.application.status === "interested") return { proceed: true, note: null };

    const note = duplicateNote(match);
    if (isTargetAcked(match.application.id, target)) return { proceed: true, note };

    const when = match.application.appliedAt || match.application.updatedAt;
    const proceed = await confirm({
      title: "Duplicate application found",
      message: [
        `${displayCompany(match.application)} · ${displayRole(match.application)} is already ${STATUS_LABEL[match.application.status].toLowerCase()} as of ${formatCompactDate(when)}.`,
        ...match.evidence,
        `Continue to ${nextStage}?`
      ].join("\n"),
      confirmLabel: "Continue pipeline",
      cancelLabel: "Stop here"
    });
    if (proceed) ackTarget(match.application.id, target);
    return { proceed, note };
  }

  // Deliberately reloading a tracked application for another pass: don't make
  // the polish/apply gates nag that it "already exists" — merging back into
  // this record is the point. Keyed from the values being SET (the caller's
  // state hasn't committed yet), mirroring currentJobKey's rawText-first
  // fallback.
  function ackApplication(app: Pick<Application, "id" | "jobUrl" | "jobDescription" | "rawJobDescription">): void {
    ackRef.current = {
      appId: app.id,
      jobKey: makeJobKey(app.jobUrl || "", (app.rawJobDescription ?? "").trim() || app.jobDescription || "")
    };
  }

  async function confirmDuplicateBeforeDistill(
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
    }, "Distill");
  }

  async function confirmDuplicateAfterDistill(
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
    }, "Tailor / Review");
  }

  // Blocking gate BEFORE any AI spend: if this job matches a tracked
  // application the user already acted on, confirm once per job target. The
  // acknowledgment carries through to Apply (which skips its own identical
  // dialog), and the auto-tailor path funnels through the caller too — so an
  // extension import of an already-applied job pauses instead of silently
  // burning a polish run on it. Resolves true when polishing may proceed.
  async function confirmDuplicateBeforePolish(): Promise<boolean> {
    return (await confirmDuplicateGate(currentTarget(), "Tailor / Review")).proceed;
  }

  // Apply-time resolution: warn/confirm as needed and name the record this
  // apply should merge into. exact/high matches merge (silently when still
  // "interested" or already acknowledged this run); "possible" matches warn
  // but always proceed as a NEW entry when confirmed.
  async function resolveApplyDuplicate(): Promise<ApplyDuplicateResolution> {
    const match = currentMatch();

    if (match && (match.confidence === "exact" || match.confidence === "high")) {
      // Skip the dialog when the user already confirmed this same duplicate at
      // the pre-polish gate — one warning per pipeline run; the merge target
      // is returned either way.
      if (match.application.status !== "interested" && !isTargetAcked(match.application.id, currentTarget())) {
        const previousDate = match.application.appliedAt ?? match.application.updatedAt;
        const proceed = await confirm({
          title: "Already applied?",
          message: [
            `${displayCompany(match.application)} · ${displayRole(match.application)}. You already have this application ${STATUS_LABEL[match.application.status].toLowerCase()} on ${formatCompactDate(previousDate)}.`,
            ...match.evidence
          ].join("\n"),
          confirmLabel: "Update existing entry"
        });
        if (!proceed) return { proceed: false, mergeTargetId: null };
        ackTarget(match.application.id, currentTarget());
      }
      return { proceed: true, mergeTargetId: match.application.id };
    }

    if (match && match.confidence === "possible" && match.application.status !== "interested" && !isTargetAcked(match.application.id, currentTarget())) {
      const previousDate = match.application.appliedAt ?? match.application.updatedAt;
      const proceed = await confirm({
        title: "Similar application found",
        message: [
          `This looks similar to ${displayCompany(match.application)} · ${displayRole(match.application)}, ${STATUS_LABEL[match.application.status].toLowerCase()} on ${formatCompactDate(previousDate)}.`,
          ...match.evidence,
          "Save as a separate application?"
        ].join("\n"),
        confirmLabel: "Save as new entry"
      });
      if (!proceed) return { proceed: false, mergeTargetId: null };
      // Confirmed: proceed as a NEW entry — "possible" matches never merge.
      ackTarget(match.application.id, currentTarget());
    }

    // No match, a "possible" match already "interested", or a duplicate the
    // user already confirmed past this run — proceed as a normal apply.
    return { proceed: true, mergeTargetId: null };
  }

  return {
    currentJobKeyHash,
    confirmDuplicateBeforeDistill,
    confirmDuplicateAfterDistill,
    confirmDuplicateBeforePolish,
    resolveApplyDuplicate,
    ackApplication
  };
}
