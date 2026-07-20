import { useCallback, useEffect, useRef, useState } from "react";
import { providerLabel, type AiProviderValue } from "../config/aiOptions.ts";

export type AvailableProviderConnection = Readonly<{
  id: AiProviderValue;
  kind: "cli" | "api";
  configured: true;
  ready: boolean;
  authState: "signed-in" | "signed-out" | "unknown" | "not-applicable";
  guidance: string;
}>;

export type ProviderAvailabilityStatus = "loading" | "ready" | "unavailable" | "error";

export type ParsedProviderConnections = Readonly<{
  schemaVersion: 1;
  companionManaged: boolean;
  providers: readonly AvailableProviderConnection[];
}>;

export type AvailableProvidersState = Readonly<{
  status: ProviderAvailabilityStatus;
  companionManaged: boolean;
  providers: readonly AvailableProviderConnection[];
  message: string;
  refresh(): Promise<void>;
  ensureProvider(provider: AiProviderValue): Promise<ProviderReadiness>;
}>;

export type ProviderReadiness = Readonly<{
  ready: boolean;
  message: string;
}>;

type ProviderSnapshot = Omit<AvailableProvidersState, "refresh" | "ensureProvider">;

const PROVIDER_ORDER = Object.freeze([
  "claude-cli",
  "codex-cli",
  "antigravity-cli",
  "openai",
  "anthropic"
] as const satisfies readonly AiProviderValue[]);
const PROVIDER_INDEX = new Map<AiProviderValue, number>(
  PROVIDER_ORDER.map((id, index) => [id, index])
);
const PROVIDER_KIND: Readonly<Record<AiProviderValue, "cli" | "api">> = Object.freeze({
  "claude-cli": "cli",
  "codex-cli": "cli",
  "antigravity-cli": "cli",
  openai: "api",
  anthropic: "api"
});
const ROOT_KEYS = new Set(["schemaVersion", "companionManaged", "providers"]);
const PROVIDER_KEYS = new Set(["id", "kind", "configured", "ready", "authState", "guidance"]);
const MAX_RESPONSE_BYTES = 16 * 1_024;
const MAX_GUIDANCE_LENGTH = 240;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 4_000;
const INITIAL_PROVIDER_SNAPSHOT: ProviderSnapshot = Object.freeze({
  status: "loading",
  companionManaged: false,
  providers: Object.freeze([]),
  message: "Checking the local provider companion…"
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, expected: ReadonlySet<string>): boolean {
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.size && keys.every(
    (key) => typeof key === "string" && expected.has(key)
  );
}

function isProviderId(value: unknown): value is AiProviderValue {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PROVIDER_KIND, value);
}

function parseProvider(value: unknown): AvailableProviderConnection {
  if (!isPlainObject(value) || !hasExactKeys(value, PROVIDER_KEYS) || !isProviderId(value.id)) {
    throw new TypeError("Invalid provider status response.");
  }
  const id = value.id;
  const kind = PROVIDER_KIND[id];
  const authState = value.authState;
  const guidance = value.guidance;
  const validAuthState = kind === "api"
    ? authState === "not-applicable"
    : authState === "signed-in" || authState === "signed-out" || authState === "unknown";
  if (
    value.kind !== kind ||
    value.configured !== true ||
    typeof value.ready !== "boolean" ||
    !validAuthState ||
    typeof guidance !== "string" ||
    !guidance ||
    guidance.length > MAX_GUIDANCE_LENGTH ||
    guidance.trim() !== guidance ||
    /\p{Cc}/u.test(guidance)
  ) {
    throw new TypeError("Invalid provider status response.");
  }
  return Object.freeze({
    id,
    kind,
    configured: true,
    ready: value.ready,
    authState,
    guidance
  }) as AvailableProviderConnection;
}

export function parseProviderConnectionsPayload(value: unknown): ParsedProviderConnections {
  if (!isPlainObject(value) || !hasExactKeys(value, ROOT_KEYS)) {
    throw new TypeError("Invalid provider status response.");
  }
  if (
    value.schemaVersion !== 1 ||
    typeof value.companionManaged !== "boolean" ||
    !Array.isArray(value.providers) ||
    value.providers.length > PROVIDER_ORDER.length
  ) {
    throw new TypeError("Invalid provider status response.");
  }
  const providers = value.providers.map(parseProvider);
  const ids = new Set<AiProviderValue>();
  for (const provider of providers) {
    if (ids.has(provider.id)) throw new TypeError("Invalid provider status response.");
    ids.add(provider.id);
  }
  if (!value.companionManaged && providers.length > 0) {
    throw new TypeError("Invalid provider status response.");
  }
  providers.sort((left, right) =>
    (PROVIDER_INDEX.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
    (PROVIDER_INDEX.get(right.id) ?? Number.MAX_SAFE_INTEGER)
  );
  return Object.freeze({
    schemaVersion: 1,
    companionManaged: value.companionManaged,
    providers: Object.freeze(providers)
  });
}

export async function fetchProviderConnections(
  signal: AbortSignal,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
): Promise<ParsedProviderConnections> {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new TypeError("Invalid provider status timeout.");
  }
  const requestController = new AbortController();
  let timedOut = false;
  const abortFromCaller = (): void => requestController.abort(signal.reason);
  if (signal.aborted) abortFromCaller();
  else signal.addEventListener("abort", abortFromCaller, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    requestController.abort();
  }, timeoutMs);

  try {
    const response = await fetch("/api/providers", {
      cache: "no-store",
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: requestController.signal
    });
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (
      !response.ok ||
      !response.headers.get("content-type")?.toLowerCase().includes("application/json") ||
      declaredLength > MAX_RESPONSE_BYTES
    ) {
      throw new Error("Provider status is unavailable.");
    }
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
      throw new Error("Provider status is unavailable.");
    }
    return parseProviderConnectionsPayload(JSON.parse(body) as unknown);
  } catch (error) {
    if (timedOut && !signal.aborted) {
      throw new Error("Provider status request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abortFromCaller);
  }
}

export function providerReadiness(
  snapshot: ProviderSnapshot,
  provider: AiProviderValue
): ProviderReadiness {
  if (snapshot.status === "loading") {
    return Object.freeze({ ready: false, message: "Checking providers in RoleFit Companion…" });
  }
  if (!snapshot.companionManaged) {
    return Object.freeze({ ready: false, message: snapshot.message });
  }
  const connection = snapshot.providers.find((candidate) => candidate.id === provider);
  if (!connection) {
    return Object.freeze({ ready: false, message: `Add ${providerLabel(provider)} in RoleFit Companion.` });
  }
  return Object.freeze({
    ready: connection.ready,
    message: connection.ready ? "" : connection.guidance
  });
}

export function useAvailableProviders(
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS
): AvailableProvidersState {
  const [snapshot, setSnapshot] = useState<ProviderSnapshot>(INITIAL_PROVIDER_SNAPSHOT);
  const snapshotRef = useRef<ProviderSnapshot>(INITIAL_PROVIDER_SNAPSHOT);
  const activeRequestRef = useRef<{
    controller: AbortController;
    promise: Promise<void>;
  } | null>(null);
  const mountedRef = useRef(false);

  const commitSnapshot = useCallback((next: ProviderSnapshot): void => {
    snapshotRef.current = next;
    if (mountedRef.current) setSnapshot(next);
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    if (activeRequestRef.current) return activeRequestRef.current.promise;
    const controller = new AbortController();
    const owner = {
      controller,
      promise: Promise.resolve()
    };
    activeRequestRef.current = owner;
    owner.promise = Promise.resolve().then(async () => {
      try {
        const parsed = await fetchProviderConnections(controller.signal);
        if (!mountedRef.current || controller.signal.aborted) return;
        commitSnapshot(parsed.companionManaged
          ? {
              status: "ready",
              companionManaged: true,
              providers: parsed.providers,
              message: parsed.providers.length
                ? "Providers are managed by RoleFit Companion."
                : "Add a provider in RoleFit Companion to use AI actions."
            }
          : {
              status: "unavailable",
              companionManaged: false,
              providers: Object.freeze([]),
              message: "Start RoleFit through the local companion to manage AI providers."
            });
      } catch (error) {
        if (!mountedRef.current || controller.signal.aborted) return;
        commitSnapshot({
          status: "error",
          companionManaged: false,
          providers: Object.freeze([]),
          message: error instanceof SyntaxError
            ? "The local provider service returned an invalid response. Restart RoleFit Companion."
            : "The local provider service is unavailable. Start or restart RoleFit Companion."
        });
      } finally {
        if (activeRequestRef.current === owner) activeRequestRef.current = null;
      }
    });
    return owner.promise;
  }, [commitSnapshot]);

  // Automatic extension imports can arrive during the first provider fetch.
  // Wait for that shared in-flight request and read the committed ref directly
  // so an event callback never turns a transient loading state into a terminal
  // "Provider unavailable" workflow row.
  const ensureProvider = useCallback(async (provider: AiProviderValue): Promise<ProviderReadiness> => {
    if (snapshotRef.current.status === "loading") await refresh();
    return providerReadiness(snapshotRef.current, provider);
  }, [refresh]);

  useEffect(() => {
    mountedRef.current = true;
    let timer = 0;
    let disposed = false;
    const schedule = (): void => {
      if (disposed) return;
      timer = window.setTimeout(async () => {
        await refresh();
        schedule();
      }, Math.max(1_000, pollIntervalMs));
    };
    const handleVisibility = (): void => {
      if (document.visibilityState === "visible") void refresh();
    };
    void refresh().finally(schedule);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      disposed = true;
      mountedRef.current = false;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
      const activeRequest = activeRequestRef.current;
      activeRequest?.controller.abort();
      if (activeRequestRef.current === activeRequest) activeRequestRef.current = null;
    };
  }, [pollIntervalMs, refresh]);

  return Object.freeze({ ...snapshot, refresh, ensureProvider });
}
