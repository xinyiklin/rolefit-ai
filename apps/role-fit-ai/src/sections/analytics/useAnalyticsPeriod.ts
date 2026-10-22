import { useCallback, useState } from "react";
import { ANALYTICS_PERIODS, type AnalyticsPeriod } from "../../lib/applicationAnalytics";

const STORAGE_KEY = "rolefit:analyticsPeriod.v1";
const DEFAULT_PERIOD: AnalyticsPeriod = "12w";

function readStoredPeriod(): AnalyticsPeriod {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return ANALYTICS_PERIODS.find((option) => option.id === stored)?.id ?? DEFAULT_PERIOD;
  } catch {
    return DEFAULT_PERIOD;
  }
}

// A per-viewer convenience: the remembered period never leaves this browser.
export function useAnalyticsPeriod() {
  const [period, setPeriod] = useState<AnalyticsPeriod>(readStoredPeriod);
  const choosePeriod = useCallback((next: AnalyticsPeriod) => {
    setPeriod(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Blocked storage only costs the remembered choice.
    }
  }, []);
  return [period, choosePeriod] as const;
}
