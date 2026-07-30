import { useCallback, useEffect, useRef, useState } from "react";

export function useCoverLetterPreTailorSnapshot(
  currentFingerprint: string | null
) {
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const appliedBaselineRef = useRef<string | null>(null);

  const drop = useCallback(() => {
    setSnapshot(null);
    appliedBaselineRef.current = null;
  }, []);

  const capture = useCallback((value: string | null) => {
    setSnapshot(value);
    appliedBaselineRef.current = null;
  }, []);

  // The first fingerprint after Tailor is its applied baseline. Any later
  // document or style change retires the one-click replacement snapshot.
  useEffect(() => {
    if (!snapshot || currentFingerprint === null) return;
    if (appliedBaselineRef.current === null) {
      appliedBaselineRef.current = currentFingerprint;
      return;
    }
    if (appliedBaselineRef.current !== currentFingerprint) drop();
  }, [currentFingerprint, drop, snapshot]);

  return { snapshot, capture, drop };
}
