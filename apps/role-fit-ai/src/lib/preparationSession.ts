export type JobPostingRelationship = {
  matchedApplicationId: string;
  jobPostingGroupId?: string;
  confidence: "exact" | "high" | "possible";
  matchedNotApplyingRecordId?: string;
};

export type PreparationSession =
  | {
      mode: "new";
      applicationId: null;
      pendingRelationship: JobPostingRelationship | null;
    }
  | {
      mode: "update";
      applicationId: string;
      pendingRelationship: null;
    };

export type PreparationPrimaryAction = {
  kind: "apply" | "update-application" | "update-job";
  label: string;
  busyLabel: string;
  successVerb: string;
};

export function newPreparationSession(
  pendingRelationship: JobPostingRelationship | null = null
): PreparationSession {
  return { mode: "new", applicationId: null, pendingRelationship };
}

export function preparationSessionForApplication(application: {
  id: string;
}): PreparationSession {
  return {
    mode: "update",
    applicationId: application.id,
    pendingRelationship: null
  };
}

export function preparationCommitIdentity({
  session,
  jobUrl,
  preparedJobDescription,
  jobRawText
}: {
  session: PreparationSession;
  jobUrl: string;
  preparedJobDescription: string;
  jobRawText: string;
}): string {
  return [
    session.mode,
    session.applicationId ?? "",
    jobUrl.trim(),
    preparedJobDescription.trim(),
    jobRawText.trim()
  ].join("\u0000");
}

export function preparationPrimaryAction(
  session: PreparationSession,
  recordStatus?: string
): PreparationPrimaryAction {
  if (session.mode !== "update") {
    return {
      kind: "apply",
      label: "Apply",
      busyLabel: "Applying…",
      successVerb: "Applied"
    };
  }
  if (recordStatus === "not_applying") {
    return {
      kind: "update-job",
      label: "Save job updates",
      busyLabel: "Saving…",
      successVerb: "Saved"
    };
  }
  return {
    kind: "update-application",
    label: "Update application",
    busyLabel: "Updating…",
    successVerb: "Updated"
  };
}
