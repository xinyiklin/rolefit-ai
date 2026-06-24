import { useEffect, useRef } from "react";

/**
 * Polls /api/extension/inbox on mount and on window focus.
 * Calls onImport(text, url) when the server has data from the browser extension.
 *
 * The callback ref is kept stable via useRef so re-renders never cause the
 * focus listener to be re-registered. No state is held in this hook.
 */
export function useExtensionInbox(
  onImport: (text: string, url: string) => void
): void {
  const callbackRef = useRef(onImport);
  // Keep the ref current on every render without triggering re-subscriptions.
  callbackRef.current = onImport;

  useEffect(() => {
    async function checkInbox(): Promise<void> {
      try {
        const res = await fetch("/api/extension/inbox");
        const data: unknown = await res.json();
        if (
          data !== null &&
          typeof data === "object" &&
          "text" in data &&
          "url" in data &&
          typeof (data as { text: unknown }).text === "string" &&
          typeof (data as { url: unknown }).url === "string"
        ) {
          const { text, url } = data as { text: string; url: string };
          callbackRef.current(text, url);
        }
      } catch {
        // Server may not be available or inbox may be empty — fail silently.
      }
    }

    // Check once on mount.
    void checkInbox();

    // Re-check whenever the user switches back to this tab/window.
    function handleFocus() {
      void checkInbox();
    }
    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
    };
  }, []);
}
