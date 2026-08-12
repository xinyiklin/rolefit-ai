import { useEffect, useRef } from "react";
import {
  EXTENSION_IMPORT_PARAM,
  extensionImportClaimTokenFromHref
} from "../lib/extensionImportClaim";
import { getTabId } from "../lib/tabPresence";

/**
 * One pending browser-extension import. The server only prepares `text`
 * (resolving the raw capture, e.g. fetching the full JD for a Greenhouse link).
 * The receiving tab owns provider-backed AI job analysis with its selected settings.
 */
export type ExtensionImport = {
  text: string;
  url: string;
};

// Strip the one-shot claim once its import is delivered or definitively gone.
function clearExtensionImportParam(): void {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(EXTENSION_IMPORT_PARAM)) return;
    url.searchParams.delete(EXTENSION_IMPORT_PARAM);
    window.history.replaceState(window.history.state, "", url.toString());
  } catch {
    // URL cleanup is best-effort; inbox routing remains server-authoritative.
  }
}

/**
 * Polls /api/extension/inbox once enabled, then on window focus and tab
 * visibility.
 * The server prepares an import's text in the BACKGROUND (resolving the raw
 * capture, no AI call), so the inbox reports `{status:"preparing"}` first; this
 * hook keeps polling (and calls `onPreparing` for a progress affordance) until
 * the text is ready, then calls `onImport({text, url})`. The receiving tab runs
 * provider-backed job analysis. The background prepare is independent of the
 * popup, so closing it or switching tabs never strands an import.
 *
 * Callback refs keep the latest closures without re-subscribing the listeners
 * for callback identity changes.
 */
export function useExtensionInbox(
  onImport: (item: ExtensionImport) => void | Promise<void>,
  onPreparing?: () => void,
  enabled = true
): void {
  const onImportRef = useRef(onImport);
  onImportRef.current = onImport;
  const onPreparingRef = useRef(onPreparing);
  onPreparingRef.current = onPreparing;

  useEffect(() => {
    // A successful poll drains this one-shot import. Wait until local preflights
    // that inspect durable state are ready; duplicate detection in particular
    // must not run against useApplications' mount-time empty array.
    if (!enabled) return;

    const claimToken = extensionImportClaimTokenFromHref(window.location.href);
    let timer: ReturnType<typeof setTimeout> | null = null;
    let preparing = false;
    // A fresh extension tab (one carrying a claim token) owns an in-flight import
    // until that import is delivered OR the server reports it gone (TTL-pruned
    // while still "preparing", etc). Tracked as a MUTABLE flag, not `claimToken`
    // directly, so it resets on delivery or on a null/no-entry response: once the
    // reservation is drained or no longer exists server-side, this tab must revert
    // to the hidden-tab hands-off rule instead of staying permitted to poll (and
    // potentially being handed an unrelated import via the server's oldest-
    // unclaimed fallback) while hidden for the rest of its life.
    let claimActive = Boolean(claimToken);
    let cancelled = false;
    let checking = false;
    let transientRetries = 0;
    const schedule = (ms: number) => {
      if (!cancelled) timer = setTimeout(() => void checkInbox(), ms);
    };
    const scheduleTransientRetry = () => {
      if (preparing || claimActive || transientRetries < 3) {
        transientRetries += 1;
        schedule(Math.min(4_000, 1_000 * transientRetries));
      }
    };

    async function checkInbox(): Promise<void> {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (cancelled || checking) return;
      // Hidden tabs stay hands-off for NEW, unclaimed imports so a backgrounded
      // tab never claims one meant for the visible tab. But a tab that already
      // owns an in-flight import KEEPS polling while hidden: otherwise the
      // background preparation settles server-side yet the tab only notices when the
      // user switches back, stranding the tailoring until the tab is refocused.
      // "Owns an in-flight import" = the server already reported "preparing" to
      // us, or this is a fresh extension tab whose (not-yet-delivered) claim-token
      // import is reserved server-side for this exact tab and can never divert to
      // another session — so polling while hidden can't steal anyone else's import.
      // Both flags are reset the moment that ownership ends (delivery, or the
      // server reporting the reservation is gone) — see the null-response branch
      // below — so a tab can't stay permitted to poll-while-hidden indefinitely.
      const ownsInFlightImport = preparing || claimActive;
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden" &&
        !ownsInFlightImport
      ) {
        return;
      }
      checking = true;
      try {
        // Carry this tab's session id so the server hands each import to exactly
        // one tab — the one that claimed it — instead of every polling tab.
        const params = new URLSearchParams({ tabId: getTabId() });
        if (claimToken) params.set("claimToken", claimToken);
        const res = await fetch(`/api/extension/inbox?${params.toString()}`);
        const data: unknown = await res.json();
        if (!res.ok) {
          // Keep an owned claim alive across transient server failures. A failed
          // poll is not a delivery and must never clear the token or reservation.
          if (res.status === 408 || res.status === 425 || res.status === 429 || res.status >= 500) {
            scheduleTransientRetry();
          }
          return;
        }
        transientRetries = 0;
        if (data === null || typeof data !== "object") {
          preparing = false;
          if (claimToken) {
            claimActive = false;
            clearExtensionImportParam();
          }
          return;
        }
        const obj = data as {
          status?: unknown;
          text?: unknown;
          url?: unknown;
        };
        // "preparing" = the background prepare hasn't finished. Treat ANY other
        // status string without delivered text the same way (keep polling): a
        // newer server may rename or add progress tokens, and an unknown status
        // must never strand an import by falling through without a reschedule.
        // This also keeps older/newer progress-token generations compatible.
        if (typeof obj.status === "string" && typeof obj.text !== "string") {
          preparing = true;
          onPreparingRef.current?.();
          schedule(1500); // keep polling until the background prepare finishes
          return;
        }
        if (typeof obj.text === "string" && typeof obj.url === "string") {
          preparing = false;
          await onImportRef.current({
            text: obj.text,
            url: obj.url
          });
          // Delivered once — this tab no longer owns an in-flight import, so the
          // hidden-tab hands-off guard is restored; also drop the claim token from
          // the URL so a reload can't re-present a drained token and re-claim.
          claimActive = false;
          if (claimToken) clearExtensionImportParam();
        }
      } catch {
        // A claim-token tab already owns this import even before the first
        // successful progress response, so network/JSON failures must retry for
        // either ownership signal. Tokenless idle tabs still avoid polling forever.
        scheduleTransientRetry();
      } finally {
        checking = false;
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
  }, [enabled]);
}
