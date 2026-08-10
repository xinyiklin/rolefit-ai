export type CoverLetterReplacementClaim = {
  generation: number;
  documentVersion: string;
};

export type CoverLetterReplacementResult =
  | "current"
  | "document-changed"
  | "superseded";

export function coverLetterDocumentVersion(payload: string | null, documentTitle: string): string {
  return JSON.stringify([payload, documentTitle]);
}

// Workspace selects and history restores are one replacement stream. A claim
// owns its response only while it is still the latest request and the exact
// document + title approved for replacement has not changed.
export function createCoverLetterReplacementOwnership() {
  let generation = 0;

  return {
    claim(documentVersion: string): CoverLetterReplacementClaim {
      generation += 1;
      return { generation, documentVersion };
    },
    invalidate(): void {
      generation += 1;
    },
    evaluate(
      claim: CoverLetterReplacementClaim,
      currentDocumentVersion: string
    ): CoverLetterReplacementResult {
      if (claim.generation !== generation) return "superseded";
      return claim.documentVersion === currentDocumentVersion
        ? "current"
        : "document-changed";
    }
  };
}

export type CoverLetterSaveClaim = {
  operationId: number;
  payload: string;
  documentTitle: string;
  documentVersion: string;
  persistenceBaselineRevision: number;
  sourceRevision: number;
  activeFileName: string;
  intendedFileName: string;
};

export type CoverLetterSaveCurrent = Pick<
  CoverLetterSaveClaim,
  "documentVersion" | "sourceRevision" | "activeFileName"
>;

export type CoverLetterSaveResult =
  | "current"
  | "document-changed"
  | "document-replaced"
  | "superseded";

// Save responses need a separate operation stream from replacement reads. A
// same-document edit may acknowledge the earlier payload as a baseline, but a
// newly opened document must keep its own active filename and baseline intact.
export function createCoverLetterSaveOwnership() {
  let operationId = 0;

  return {
    claim(identity: Omit<CoverLetterSaveClaim, "operationId">): CoverLetterSaveClaim {
      operationId += 1;
      return { operationId, ...identity };
    },
    evaluate(
      claim: CoverLetterSaveClaim,
      current: CoverLetterSaveCurrent
    ): CoverLetterSaveResult {
      if (claim.operationId !== operationId) return "superseded";
      if (
        claim.sourceRevision !== current.sourceRevision ||
        claim.activeFileName !== current.activeFileName
      ) {
        return "document-replaced";
      }
      return claim.documentVersion === current.documentVersion
        ? "current"
        : "document-changed";
    }
  };
}

type CoverLetterSaveSnapshot = {
  fileName?: string;
  label?: string;
};

type CoverLetterSaveCompletionEffects<TSnapshot extends CoverLetterSaveSnapshot> = {
  publishSnapshot: (snapshot: TSnapshot) => void;
  bindActiveFile: (fileName: string) => void;
  markClean: () => void;
  commitBaseline: (payload: string, documentTitle: string) => void;
  commitBaselineIfUnchanged: (
    expectedRevision: number,
    payload: string,
    documentTitle: string
  ) => boolean;
  clearRecovery: () => void;
  setStatus: (status: string) => void;
};

export function applyCoverLetterSaveCompletion<
  TSnapshot extends CoverLetterSaveSnapshot
>(args: {
  completion: CoverLetterSaveResult;
  claim: CoverLetterSaveClaim;
  snapshot: TSnapshot;
  effects: CoverLetterSaveCompletionEffects<TSnapshot>;
}): { published: boolean; baselineAcknowledged: boolean } {
  const { completion, claim, snapshot, effects } = args;
  if (completion === "superseded") {
    return { published: false, baselineAcknowledged: false };
  }

  effects.publishSnapshot(snapshot);
  if (completion === "current") {
    if (snapshot.fileName) effects.bindActiveFile(snapshot.fileName);
    effects.markClean();
    effects.commitBaseline(claim.payload, claim.documentTitle);
    effects.clearRecovery();
    effects.setStatus(`Saved ${snapshot.label ?? "cover letter"} to your workspace.`);
    return { published: true, baselineAcknowledged: true };
  }

  if (completion === "document-changed") {
    const baselineAcknowledged = effects.commitBaselineIfUnchanged(
      claim.persistenceBaselineRevision,
      claim.payload,
      claim.documentTitle
    );
    effects.setStatus("Earlier version saved; current changes remain unsaved.");
    return { published: true, baselineAcknowledged };
  }

  effects.setStatus("Earlier version saved; the current cover letter was kept.");
  return { published: true, baselineAcknowledged: false };
}
