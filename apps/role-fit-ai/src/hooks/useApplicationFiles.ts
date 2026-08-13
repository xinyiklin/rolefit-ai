import { useCallback, useRef, useState } from "react";

import type { Application } from "./useApplications";
import {
  deleteApplicationAttachment,
  deleteApplicationDocument,
  uploadApplicationAttachment,
  uploadApplicationDocument,
  type ApplicationDocumentKind,
  type DocumentUpload
} from "../lib/applicationDocumentRequests";

type ApplicationFileActionResult = { ok: true } | { ok: false; error: string };

type UseApplicationFilesArgs = {
  getApplication: (id: string) => Application | undefined;
  refreshApplications: () => Promise<boolean>;
};

// Owns browser-to-server mutations for files attached to an application. The
// server commits file bytes and tracker metadata together; refreshing only
// adopts that authoritative transaction into the current tab.
export function useApplicationFiles({
  getApplication,
  refreshApplications
}: UseApplicationFilesArgs) {
  // Every mutation advances the same application revision. Queue same-tab file
  // actions so a rapid Resume + Cover letter save uses the first mutation's
  // confirmed revision instead of manufacturing an avoidable 409 conflict.
  const mutationQueue = useRef<Promise<void>>(Promise.resolve());
  const [pendingOperations, setPendingOperations] = useState(0);
  const enqueue = useCallback(<T,>(mutation: () => Promise<T>): Promise<T> => {
    setPendingOperations((count) => count + 1);
    const run = mutationQueue.current.then(mutation, mutation);
    const tracked = run.finally(() => setPendingOperations((count) => count - 1));
    mutationQueue.current = tracked.then(() => undefined, () => undefined);
    return tracked;
  }, []);

  const saveDocument = useCallback(
    (
      id: string,
      kind: ApplicationDocumentKind,
      upload: DocumentUpload,
      sourceOrigin: "editor" | "upload" = "editor"
    ): Promise<ApplicationFileActionResult> =>
      enqueue(async () => {
        if (!(await refreshApplications())) {
          return { ok: false, error: "The latest applications could not be loaded. Nothing was changed." };
        }
        const application = getApplication(id);
        if (!application) return { ok: false, error: "That application no longer exists." };
        const result = await uploadApplicationDocument(
          id,
          kind,
          upload,
          application.updatedAt,
          sourceOrigin
        );
        await refreshApplications();
        return result.ok ? { ok: true } : { ok: false, error: result.error };
      }),
    [enqueue, getApplication, refreshApplications]
  );

  const removeDocument = useCallback(
    (id: string, kind: ApplicationDocumentKind): Promise<ApplicationFileActionResult> =>
      enqueue(async () => {
        if (!(await refreshApplications())) {
          return { ok: false, error: "The latest applications could not be loaded. Nothing was changed." };
        }
        const application = getApplication(id);
        if (!application) return { ok: false, error: "That application no longer exists." };
        const result = await deleteApplicationDocument(id, kind, application.updatedAt);
        await refreshApplications();
        return result.ok ? { ok: true } : { ok: false, error: result.error };
      }),
    [enqueue, getApplication, refreshApplications]
  );

  const saveAttachment = useCallback(
    (id: string, file: File): Promise<ApplicationFileActionResult> =>
      enqueue(async () => {
        if (!(await refreshApplications())) {
          return { ok: false, error: "The latest applications could not be loaded. Nothing was changed." };
        }
        const application = getApplication(id);
        if (!application) return { ok: false, error: "That application no longer exists." };
        const result = await uploadApplicationAttachment(id, file, application.updatedAt);
        await refreshApplications();
        return result.ok ? { ok: true } : { ok: false, error: result.error };
      }),
    [enqueue, getApplication, refreshApplications]
  );

  const removeAttachment = useCallback(
    (id: string, fileName: string): Promise<ApplicationFileActionResult> =>
      enqueue(async () => {
        if (!(await refreshApplications())) {
          return { ok: false, error: "The latest applications could not be loaded. Nothing was changed." };
        }
        const application = getApplication(id);
        if (!application) return { ok: false, error: "That application no longer exists." };
        const result = await deleteApplicationAttachment(id, fileName, application.updatedAt);
        await refreshApplications();
        return result.ok ? { ok: true } : { ok: false, error: result.error };
      }),
    [enqueue, getApplication, refreshApplications]
  );

  return {
    saveDocument,
    removeDocument,
    saveAttachment,
    removeAttachment,
    isBusy: pendingOperations > 0
  };
}
