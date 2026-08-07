import { useCallback, useEffect, useRef, useState } from "react";

import { documentSourceFingerprint } from "../lib/documentSourceFingerprint.ts";

export type PreparedResumeSelectionSource = "automatic" | "manual";

export type PreparedResumeSelectionState =
  | { status: "idle" }
  | { status: "selecting"; preparationId: string; source: PreparedResumeSelectionSource }
  | {
      status: "settled";
      preparationId: string;
      resumeFileName: string;
      resumeDocumentVersion: string;
      source: PreparedResumeSelectionSource;
      sequence: number;
    }
  | { status: "needs-user"; preparationId: string; reason: string };

type PendingSelection = {
  preparationId: string;
  resumeFileName: string;
  source: PreparedResumeSelectionSource;
  sequence: number;
};

type ResolveSelectionInput = PendingSelection & {
  busy: boolean;
  currentFileName: string;
  currentDocumentVersion: string;
  resumeReady: boolean;
};

export function resolvePreparedResumeSelection(
  input: ResolveSelectionInput
): PreparedResumeSelectionState | null {
  if (input.busy) return null;
  if (!input.resumeFileName || !input.resumeReady) {
    return {
      status: "needs-user",
      preparationId: input.preparationId,
      reason: "Choose a complete resume before running Initial Fit."
    };
  }
  if (input.currentFileName !== input.resumeFileName) {
    return {
      status: "needs-user",
      preparationId: input.preparationId,
      reason: "The recommended resume did not finish loading. Choose a resume to continue."
    };
  }
  return {
    status: "settled",
    preparationId: input.preparationId,
    resumeFileName: input.resumeFileName,
    resumeDocumentVersion: documentSourceFingerprint(input.currentDocumentVersion),
    source: input.source,
    sequence: input.sequence
  };
}

type UsePreparedResumeSelectionArgs = {
  preparationId: string;
  currentFileName: string;
  currentDocumentVersion: string;
  resumeReady: boolean;
  busy: boolean;
};

export function usePreparedResumeSelection({
  preparationId,
  currentFileName,
  currentDocumentVersion,
  resumeReady,
  busy
}: UsePreparedResumeSelectionArgs) {
  const [state, setState] = useState<PreparedResumeSelectionState>({ status: "idle" });
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const sequenceRef = useRef(0);

  useEffect(() => {
    sequenceRef.current += 1;
    setPending(null);
    setState(preparationId
      ? { status: "selecting", preparationId, source: "automatic" }
      : { status: "idle" });
  }, [preparationId]);

  useEffect(() => {
    if (!pending || pending.preparationId !== preparationId) return;
    const resolved = resolvePreparedResumeSelection({
      ...pending,
      busy,
      currentFileName,
      currentDocumentVersion,
      resumeReady
    });
    if (!resolved) return;
    setPending(null);
    setState(resolved);
  }, [busy, currentDocumentVersion, currentFileName, pending, preparationId, resumeReady]);

  const begin = useCallback((source: PreparedResumeSelectionSource): number => {
    if (!preparationId) return 0;
    const sequence = sequenceRef.current + 1;
    sequenceRef.current = sequence;
    setPending(null);
    setState({ status: "selecting", preparationId, source });
    return sequence;
  }, [preparationId]);

  const complete = useCallback((
    sequence: number,
    resumeFileName: string,
    source: PreparedResumeSelectionSource
  ) => {
    if (!preparationId || !sequence || sequence !== sequenceRef.current) return;
    setPending({ preparationId, resumeFileName, source, sequence });
  }, [preparationId]);

  return { state, begin, complete };
}
