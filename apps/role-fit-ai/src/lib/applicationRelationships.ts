export const JOB_POSTING_GROUP_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

type PostingRelationshipRecord = {
  id: string;
  jobPostingGroupId?: string;
};

export function effectivePostingGroupId(application: PostingRelationshipRecord): string {
  return application.jobPostingGroupId ?? `application:${application.id}`;
}

export function newJobPostingGroupId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `posting-${crypto.randomUUID()}`;
  }
  return `posting-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function planPostingRecordLink<T extends PostingRelationshipRecord>(
  applications: readonly T[],
  requestedApplicationIds: readonly string[],
  requestedGroupId?: string
): { groupId: string; applicationIds: string[] } | null {
  const requestedIds = [...new Set(requestedApplicationIds)];
  if (requestedIds.length < 2) return null;

  const byId = new Map(applications.map((application) => [application.id, application]));
  const requested = requestedIds.map((id) => byId.get(id));
  if (requested.some((application) => !application)) return null;

  const groupId = requestedGroupId
    ?? requested.find((application) => application?.jobPostingGroupId)?.jobPostingGroupId
    ?? newJobPostingGroupId();
  if (!JOB_POSTING_GROUP_ID_RE.test(groupId)) return null;

  const joinedGroupIds = new Set(
    requested.flatMap((application) => application?.jobPostingGroupId ? [application.jobPostingGroupId] : [])
  );
  const requestedIdSet = new Set(requestedIds);
  const applicationIds = applications.flatMap((application) =>
    requestedIdSet.has(application.id)
      || Boolean(application.jobPostingGroupId && joinedGroupIds.has(application.jobPostingGroupId))
      ? [application.id]
      : []
  );

  return { groupId, applicationIds };
}
