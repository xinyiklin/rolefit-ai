export type ApplicationMutation = {
  id: string;
  operation: "upsert" | "delete";
  baseUpdatedAt: string | null;
};

/**
 * Build the sparse record portion of a tracker mutation request. The mutation
 * list is authoritative for intent; only upserts need record bodies.
 */
export function applicationMutationRecords<T extends { id: string }>(
  applications: readonly T[],
  mutations: readonly ApplicationMutation[]
): T[] {
  const byId = new Map(applications.map((application) => [application.id, application]));
  return mutations.flatMap((mutation) => {
    if (mutation.operation === "delete") return [];
    const application = byId.get(mutation.id);
    if (!application) {
      throw new Error(`Missing application record for upsert ${mutation.id}.`);
    }
    return [application];
  });
}

/**
 * Adopt server order and sanitized changed rows after this tab's own write,
 * while retaining unchanged objects for downstream memoization.
 */
export function reconcileApplicationWriteResponse<T extends { id: string; updatedAt: string }>(
  previous: readonly T[],
  incoming: readonly T[]
): T[] {
  const previousById = new Map(previous.map((application) => [application.id, application]));
  return incoming.map((application) => {
    const prior = previousById.get(application.id);
    return prior?.updatedAt === application.updatedAt ? prior : application;
  });
}
