import { useEffect, useRef, useState } from "react";

export type DraftAutosaveState = "idle" | "pending" | "saved" | "error";

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
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(save);
  const [state, setState] = useState<DraftAutosaveState>("idle");
  saveRef.current = save;

  useEffect(() => {
    if (!shouldSave) {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setState("idle");
      return;
    }

    if (timerRef.current !== null) clearTimeout(timerRef.current);
    setState("pending");
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      try {
        setState(saveRef.current() ? "saved" : "error");
      } catch {
        // Strict serialization failures must never escape an async timer or
        // advertise a recovery draft the document parser cannot reopen.
        setState("error");
      }
    }, delayMs);

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [delayMs, revision, shouldSave]);

  return state;
}
