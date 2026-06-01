import { useEffect, useState } from "react";

// Defers a fast-changing value so expensive derivations don't recompute on
// every keystroke. Used for the live pre-polish analysis only.
export function useDebouncedValue<T>(value: T, delayMs = 280): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}
