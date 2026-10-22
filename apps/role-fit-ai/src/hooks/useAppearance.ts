import { useCallback, useEffect, useState } from "react";

// Light/dark is a view preference of this browser, like zoom: it never enters
// workspace preferences or document files. "system" follows the OS.
export type Appearance = "system" | "light" | "dark";

export const APPEARANCE_OPTIONS: readonly Appearance[] = ["system", "light", "dark"];

const APPEARANCE_KEY = "rolefit:appearance";

function isAppearance(value: unknown): value is Appearance {
  return APPEARANCE_OPTIONS.includes(value as Appearance);
}

export function readAppearance(): Appearance {
  try {
    const stored = window.localStorage.getItem(APPEARANCE_KEY);
    return isAppearance(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

// tokens.css keys `color-scheme` off this attribute; without it the OS decides.
export function applyAppearance(value: Appearance): void {
  const root = document.documentElement;
  if (value === "system") delete root.dataset.theme;
  else root.dataset.theme = value;
}

export function useAppearance(): [Appearance, (next: Appearance) => void] {
  const [appearance, setAppearanceState] = useState<Appearance>(readAppearance);

  // Another RoleFit tab changed it: follow along.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== APPEARANCE_KEY) return;
      const next = isAppearance(event.newValue) ? event.newValue : "system";
      setAppearanceState(next);
      applyAppearance(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setAppearance = useCallback((next: Appearance) => {
    setAppearanceState(next);
    applyAppearance(next);
    try {
      if (next === "system") window.localStorage.removeItem(APPEARANCE_KEY);
      else window.localStorage.setItem(APPEARANCE_KEY, next);
    } catch {
      // Storage can be unavailable; the choice still applies for this page.
    }
  }, []);

  return [appearance, setAppearance];
}
