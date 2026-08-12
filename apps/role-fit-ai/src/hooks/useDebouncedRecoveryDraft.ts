import { useEffect, useRef, useState } from "react";

export type DraftAutosaveState = "idle" | "pending" | "saved" | "error";

type SettledDraftAutosave = {
  revision: object;
  state: "saved" | "error";
};

type CurrentDraftAutosaveRequest = {
  shouldSave: boolean;
  revision: object;
  save: () => boolean;
};

export function draftAutosaveStateForRevision(
  shouldSave: boolean,
  revision: object,
  settledRevision: object | null,
  settledState: "saved" | "error" | null
): DraftAutosaveState {
  if (!shouldSave) return "idle";
  return settledRevision === revision && settledState ? settledState : "pending";
}

type UseDebouncedRecoveryDraftArgs = {
  shouldSave: boolean;
  // Hosts memoize the complete set of values that should restart the debounce.
  revision: object;
  save: () => boolean;
  delayMs?: number;
};

export function useDebouncedRecoveryDraft({
  shouldSave,
  revision,
  save,
  delayMs = 1200
}: UseDebouncedRecoveryDraftArgs): DraftAutosaveState {
  const currentRequestRef = useRef<CurrentDraftAutosaveRequest>({
    shouldSave,
    revision,
    save
  });
  const [settled, setSettled] = useState<SettledDraftAutosave | null>(null);
  currentRequestRef.current = { shouldSave, revision, save };

  useEffect(() => {
    if (!shouldSave) {
      setSettled(null);
      return;
    }

    const timer = setTimeout(() => {
      const currentRequest = currentRequestRef.current;
      if (!currentRequest.shouldSave || currentRequest.revision !== revision) return;
      try {
        setSettled({
          revision,
          state: currentRequest.save() ? "saved" : "error"
        });
      } catch {
        // Strict serialization failures must never escape an async timer or
        // advertise a recovery draft the document parser cannot reopen.
        setSettled({ revision, state: "error" });
      }
    }, delayMs);

    return () => clearTimeout(timer);
  }, [delayMs, revision, shouldSave]);

  return draftAutosaveStateForRevision(
    shouldSave,
    revision,
    settled?.revision ?? null,
    settled?.state ?? null
  );
}
