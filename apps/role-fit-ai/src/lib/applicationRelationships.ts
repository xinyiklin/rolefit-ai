export const JOB_POSTING_GROUP_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

type PostingRelationshipRecord = {
  id: string;
  jobPostingGroupId?: string;
};

type PostingRecordUnlinkPlan = {
  detachedApplicationId: string;
  remainingApplicationIds: string[];
  applicationIds: string[];
  clearGroupApplicationIds: string[];
};

function newJobPostingGroupId(): string {
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

function explicitPostingGroups<T extends PostingRelationshipRecord>(
  applications: readonly T[]
): T[][] {
  const groups = new Map<string, T[]>();
  for (const application of applications) {
    if (!application.jobPostingGroupId) continue;
    const group = groups.get(application.jobPostingGroupId) ?? [];
    group.push(application);
    groups.set(application.jobPostingGroupId, group);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

export function postingGroupSizeByApplicationId<T extends PostingRelationshipRecord>(
  applications: readonly T[]
): Map<string, number> {
  const sizes = new Map<string, number>();
  for (const group of explicitPostingGroups(applications)) {
    for (const application of group) sizes.set(application.id, group.length);
  }
  return sizes;
}

// A relationship group is an equivalence set. Detaching one record therefore
// separates it from every remaining member. With only two members, both lose
// the now-meaningless group id; larger groups keep their relationship intact.
export function planPostingRecordUnlink<T extends PostingRelationshipRecord>(
  applications: readonly T[],
  detachedApplicationId: string
): PostingRecordUnlinkPlan | null {
  const detached = applications.find((application) => application.id === detachedApplicationId);
  if (!detached?.jobPostingGroupId) return null;
  const members = applications.filter(
    (application) => application.jobPostingGroupId === detached.jobPostingGroupId
  );
  if (members.length < 2) return null;

  const applicationIds = members.map((application) => application.id);
  const remainingApplicationIds = applicationIds.filter((id) => id !== detachedApplicationId);
  return {
    detachedApplicationId,
    remainingApplicationIds,
    applicationIds,
    clearGroupApplicationIds: members.length === 2 ? applicationIds : [detachedApplicationId]
  };
}
