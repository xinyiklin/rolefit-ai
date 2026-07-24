import { useEffect, useRef } from "react";
import { getTabId } from "../lib/tabPresence";

/**
 * One pending browser-extension import. The server only PREPARES `text` (resolving
 * the raw capture, e.g. fetching the full JD for a Greenhouse link) — it no longer
 * AI-distills, so the receiving tab distills `text` client-side with its own
 * selected Distill provider. `fields` is therefore null in the current protocol
 * and kept only as legacy back-compat (an older server that still sends distilled
 * structured output); the consumer handles both.
 */
export type ExtensionImport = {
  text: string;
  url: string;
  fields: Record<string, unknown> | null;
  autoTailor: boolean;
  // Whether the receiving tab should AI-distill this import. Absent from an
  // older server response → treated as true (AI distill on, the prior default).
  distillAi: boolean;
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
 * Polls /api/extension/inbox once enabled, then on window focus and tab
 * visibility.
 * The server PREPARES an import's text in the BACKGROUND (resolving the raw
 * capture, no AI call), so the inbox reports `{status:"distilling"}` first; this
 * hook keeps polling (and calls `onDistilling` for a progress affordance) until
 * the text is ready, then calls `onImport({text, url, fields})` — where `fields`
 * is null and the receiving tab runs the distill client-side with its own
 * provider. The background prepare is independent of the popup, so closing it /
 * switching tabs never strands an import.
 *
 * Callback refs keep the latest closures without re-subscribing the listeners
 * for callback identity changes.
 */
export function useExtensionInbox(
  onImport: (item: ExtensionImport) => void | Promise<void>,
  onDistilling?: () => void,
  enabled = true
): void {
  const onImportRef = useRef(onImport);
  onImportRef.current = onImport;
  const onDistillingRef = useRef(onDistilling);
  onDistillingRef.current = onDistilling;

  useEffect(() => {
    // A successful poll drains this one-shot import. Wait until local preflights
    // that inspect durable state are ready; duplicate detection in particular
    // must not run against useApplications' mount-time empty array.
    if (!enabled) return;

    const claimToken = readExtensionImportClaimToken();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let distilling = false;
    // A fresh extension tab (one carrying a claim token) owns an in-flight import
    // until that import is delivered OR the server reports it gone (TTL-pruned
    // while still "distilling", etc). Tracked as a MUTABLE flag, not `claimToken`
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
      if (distilling || claimActive || transientRetries < 3) {
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
      // background distill settles server-side yet the tab only notices when the
      // user switches back, stranding the tailoring until the tab is refocused.
      // "Owns an in-flight import" = the server already reported "distilling" to
      // us, or this is a fresh extension tab whose (not-yet-delivered) claim-token
      // import is reserved server-side for this exact tab and can never divert to
      // another session — so polling while hidden can't steal anyone else's import.
      // Both flags are reset the moment that ownership ends (delivery, or the
      // server reporting the reservation is gone) — see the null-response branch
      // below — so a tab can't stay permitted to poll-while-hidden indefinitely.
      const ownsInFlightImport = distilling || claimActive;
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
          distilling = false;
          // A poll that carried a claim token but got back null/no-entry means
          // the reserved import no longer exists server-side (e.g. TTL-pruned
          // while still "distilling"). This tab no longer owns an in-flight
          // import, so drop back to the hidden-tab hands-off rule — otherwise
          // claimActive would stay true forever and a later hidden poll could
          // be handed an unrelated tokenless import via the server's oldest-
          // unclaimed fallback. Do NOT clear the URL param here: delivery-once
          // semantics only clear it on successful delivery, unchanged below.
          if (claimToken) claimActive = false;
          return;
        }
        const obj = data as {
          status?: unknown;
          text?: unknown;
          url?: unknown;
          fields?: unknown;
          autoTailor?: unknown;
          distillAi?: unknown;
        };
        // "distilling" = the background prepare hasn't finished. Treat ANY other
        // status string without delivered text the same way (keep polling): a
        // newer server may rename or add progress tokens, and an unknown status
        // must never strand an import by falling through without a reschedule.
        // (Forward-compat half of the planned "distilling"→"preparing" rename.)
        if (typeof obj.status === "string" && typeof obj.text !== "string") {
          distilling = true;
          onDistillingRef.current?.();
          schedule(1500); // keep polling until the background prepare finishes
          return;
        }
        if (typeof obj.text === "string" && typeof obj.url === "string") {
          distilling = false;
          const fields =
            obj.fields !== null && typeof obj.fields === "object"
              ? (obj.fields as Record<string, unknown>)
              : null;
          await onImportRef.current({
            text: obj.text,
            url: obj.url,
            fields,
            autoTailor: obj.autoTailor === true,
            // Absent → true (the prior, only behavior); only an explicit
            // `false` turns off client-side AI distillation for this import.
            distillAi: obj.distillAi !== false
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
