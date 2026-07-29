import {
  APPLICATION_ID_RE,
  MAX_APPLICATIONS,
  ApplicationsStorageError,
  duplicateApplicationId,
  sanitizeApplications
} from "./schema.ts";

export type ApplicationMutation = {
  id: string;
  operation: "upsert" | "delete";
  baseUpdatedAt: string | null;
};

function parseApplicationMutations(raw: unknown): ApplicationMutation[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_APPLICATIONS) {
    throw new ApplicationsStorageError(
      "Each tracker save must name between 1 and 500 application mutations.",
      400
    );
  }

  const ids = new Set<string>();
  return raw.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new ApplicationsStorageError(
        "One or more application mutations are invalid.",
        400
      );
    }
    const record = value as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : "";
    const operation = record.operation;
    const baseUpdatedAt = record.baseUpdatedAt;
    if (
      !APPLICATION_ID_RE.test(id) ||
      (operation !== "upsert" && operation !== "delete") ||
      (baseUpdatedAt !== null &&
        (typeof baseUpdatedAt !== "string" || baseUpdatedAt.length > 100)) ||
      ids.has(id)
    ) {
      throw new ApplicationsStorageError(
        "One or more application mutations are invalid.",
        400
      );
    }
    ids.add(id);
    return { id, operation, baseUpdatedAt };
  });
}

/**
 * Apply an explicitly described client mutation set to the latest disk state.
 * The client sends only records named by upsert mutations. Unchanged rows
 * always come from `existing`.
 */
export function reconcileApplicationMutations(
  existing: ReturnType<typeof sanitizeApplications>,
  incoming: ReturnType<typeof sanitizeApplications>,
  rawMutations: unknown
) {
  if (duplicateApplicationId(existing) || duplicateApplicationId(incoming)) {
    throw new ApplicationsStorageError(
      "Application ids must be unique. No tracker changes were saved.",
      400
    );
  }

  const mutations = parseApplicationMutations(rawMutations);
  const mutationById = new Map(
    mutations.map((mutation) => [mutation.id, mutation])
  );
  const existingById = new Map(
    existing.map((application) => [application.id, application])
  );
  const incomingById = new Map(
    incoming.map((application) => [application.id, application])
  );

  for (const mutation of mutations) {
    const current = existingById.get(mutation.id);
    const requested = incomingById.get(mutation.id);
    if (mutation.operation === "upsert" && !requested) {
      throw new ApplicationsStorageError(
        "An upsert mutation must include its application record.",
        400
      );
    }
    if (mutation.operation === "delete" && requested) {
      throw new ApplicationsStorageError(
        "A delete mutation must omit its application record.",
        400
      );
    }
    if (
      mutation.operation === "upsert" &&
      current &&
      requested?.updatedAt === current.updatedAt
    ) {
      throw new ApplicationsStorageError(
        "A changed application must advance its updatedAt revision. No tracker changes were saved.",
        400
      );
    }

    const revisionMatches = current
      ? mutation.baseUpdatedAt === current.updatedAt
      : mutation.baseUpdatedAt === null;
    if (!revisionMatches) {
      throw new ApplicationsStorageError(
        "This application changed in another tab. The latest saved tracker has been restored; review it before trying again.",
        409,
        existing
      );
    }
  }

  for (const application of incoming) {
    if (mutationById.get(application.id)?.operation !== "upsert") {
      throw new ApplicationsStorageError(
        "Application records must correspond exactly to upsert mutations. No tracker changes were saved.",
        400
      );
    }
  }

  const reconciled = incoming.filter(
    (application) =>
      !existingById.has(application.id) &&
      mutationById.get(application.id)?.operation === "upsert"
  );
  for (const current of existing) {
    const mutation = mutationById.get(current.id);
    if (mutation?.operation === "delete") continue;
    reconciled.push(
      mutation?.operation === "upsert"
        ? incomingById.get(current.id)!
        : current
    );
  }
  return reconciled;
}
