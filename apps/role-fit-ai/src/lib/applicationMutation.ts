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
 * Apply a write response to the confirmed tracker. A sparse response (`order`
 * present) is only sent when `previous` is exactly the server's pre-write
 * state, so it keeps every unchanged object for downstream memoization; an
 * unknown id throws rather than guessing. A full response means `previous` was
 * stale, so it is adopted as-is, like a fresh GET: a held row with a matching
 * updatedAt may still differ after an outside edit.
 */
export function applyApplicationWriteResponse<T extends { id: string }>(
  previous: readonly T[],
  response: { applications: readonly T[]; order?: readonly string[] }
): T[] {
  if (!response.order) return [...response.applications];
  const changed = new Map(response.applications.map((application) => [application.id, application]));
  const previousById = new Map(previous.map((application) => [application.id, application]));
  return response.order.map((id) => {
    const application = changed.get(id) ?? previousById.get(id);
    if (!application) throw new Error(`The save response named an unknown application ${id}.`);
    return application;
  });
}
