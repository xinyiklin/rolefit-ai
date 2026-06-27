import { useEffect, useRef } from "react";
import { getTabId } from "../lib/tabPresence";

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

const EXTENSION_IMPORT_PARAM = "extensionImport";

function readExtensionImportClaimToken(): string {
  try {
    const url = new URL(window.location.href);
    return url.searchParams.get(EXTENSION_IMPORT_PARAM)?.trim() ?? "";
  } catch {
    return "";
  }
}

// Strip the one-shot claim token from the address bar once its import has been
// delivered. Otherwise a reload of this tab would re-present the (now drained)
// token and try to claim again, and the lingering param is just noise in the URL.
function clearExtensionImportParam(): void {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(EXTENSION_IMPORT_PARAM)) return;
    url.searchParams.delete(EXTENSION_IMPORT_PARAM);
    window.history.replaceState(window.history.state, "", url.toString());
  } catch {
    // Best-effort: a stale token is harmless once the entry is gone server-side.
  }
}

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
    const claimToken = readExtensionImportClaimToken();
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
      // Hidden tabs stay hands-off. Fresh extension imports carry a claim token
      // in the newly-opened app tab's URL; existing visible tabs skip those
      // reserved imports until the fresh tab has had a chance to claim them.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      try {
        // Carry this tab's session id so the server hands each import to exactly
        // one tab — the one that claimed it — instead of every polling tab.
        const params = new URLSearchParams({ tabId: getTabId() });
        if (claimToken) params.set("claimToken", claimToken);
        const res = await fetch(`/api/extension/inbox?${params.toString()}`);
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
          // Delivered once — drop the claim token so a reload can't re-claim.
          if (claimToken) clearExtensionImportParam();
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
