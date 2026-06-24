import { useEffect, useRef } from "react";

/**
 * One pending browser-extension import. `fields` is the AI-distilled structured
 * output produced server-side at import time (null when the server's AI distill
 * failed, in which case the app falls back to the deterministic engine on `text`).
 */
export type ExtensionImport = {
  text: string;
  url: string;
  fields: Record<string, unknown> | null;
  autoTailor: boolean;
};

/**
 * Polls /api/extension/inbox on mount, on window focus, and on tab visibility.
 * The server distills an import in the BACKGROUND, so the inbox reports
 * `{status:"distilling"}` first; this hook keeps polling (and calls `onDistilling`
 * for a progress affordance) until the brief is ready, then calls
 * `onImport({text, url, fields})`. The background distill is independent of the
 * popup, so closing it / switching tabs never strands an import.
 *
 * Callback refs keep the latest closures without re-subscribing the listeners.
 */
export function useExtensionInbox(
  onImport: (item: ExtensionImport) => void,
  onDistilling?: () => void
): void {
  const onImportRef = useRef(onImport);
  onImportRef.current = onImport;
  const onDistillingRef = useRef(onDistilling);
  onDistillingRef.current = onDistilling;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let distilling = false;
    let cancelled = false;
    const schedule = (ms: number) => {
      if (!cancelled) timer = setTimeout(() => void checkInbox(), ms);
    };

    async function checkInbox(): Promise<void> {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (cancelled) return;
      try {
        const res = await fetch("/api/extension/inbox");
        const data: unknown = await res.json();
        if (data === null || typeof data !== "object") {
          distilling = false;
          return;
        }
        const obj = data as { status?: unknown; text?: unknown; url?: unknown; fields?: unknown; autoTailor?: unknown };
        if (obj.status === "distilling") {
          distilling = true;
          onDistillingRef.current?.();
          schedule(1500); // keep polling until the background distill finishes
          return;
        }
        if (typeof obj.text === "string" && typeof obj.url === "string") {
          distilling = false;
          const fields =
            obj.fields !== null && typeof obj.fields === "object"
              ? (obj.fields as Record<string, unknown>)
              : null;
          onImportRef.current({ text: obj.text, url: obj.url, fields, autoTailor: obj.autoTailor === true });
        }
      } catch {
        // Transient error: keep retrying ONLY if a distill is in flight (so we
        // don't poll forever when the server is simply down / idle).
        if (distilling) schedule(2000);
      }
    }

    // Check on mount, and whenever this tab becomes active again. Tab activation
    // reliably fires `visibilitychange` but NOT always window `focus` (notably in
    // Firefox), which is why listening only for `focus` missed imports.
    void checkInbox();
    function handleWake() {
      void checkInbox();
    }
    function handleVisibility() {
      if (document.visibilityState === "visible") void checkInbox();
    }
    window.addEventListener("focus", handleWake);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", handleWake);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);
}
