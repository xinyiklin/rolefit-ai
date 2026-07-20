import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "./http.ts";

export const ROLEFIT_PROVIDER_SNAPSHOT_SCHEMA_VERSION = 1 as const;
export const ROLEFIT_PROVIDER_CONNECTIONS_SCHEMA_VERSION = 1 as const;

export type RoleFitManagedApiProviderId = "openai" | "anthropic";
export type RoleFitManagedCliProviderId =
  | "claude-cli"
  | "codex-cli"
  | "antigravity-cli";
export type RoleFitManagedProviderId =
  | RoleFitManagedCliProviderId
  | RoleFitManagedApiProviderId;
export type RoleFitManagedProviderKind = "cli" | "api";
export type RoleFitManagedProviderAuthState =
  | "signed-in"
  | "signed-out"
  | "unknown"
  | "not-applicable";

export type RoleFitPublicProviderConnection = Readonly<{
  id: RoleFitManagedProviderId;
  kind: RoleFitManagedProviderKind;
  configured: true;
  ready: boolean;
  authState: RoleFitManagedProviderAuthState;
  guidance: string;
}>;

export type RoleFitProviderConnectionsPayload = Readonly<{
  schemaVersion: typeof ROLEFIT_PROVIDER_CONNECTIONS_SCHEMA_VERSION;
  companionManaged: boolean;
  providers: readonly RoleFitPublicProviderConnection[];
}>;

const PROVIDER_ORDER = Object.freeze([
  "claude-cli",
  "codex-cli",
  "antigravity-cli",
  "openai",
  "anthropic"
] as const);
const PROVIDER_ORDER_INDEX = new Map<RoleFitManagedProviderId, number>(
  PROVIDER_ORDER.map((providerId, index) => [providerId, index])
);
const PROVIDER_KIND = Object.freeze({
  "claude-cli": "cli",
  "codex-cli": "cli",
  "antigravity-cli": "cli",
  openai: "api",
  anthropic: "api"
} satisfies Record<RoleFitManagedProviderId, RoleFitManagedProviderKind>);
const API_PROVIDER_IDS = new Set<RoleFitManagedApiProviderId>([
  "openai",
  "anthropic"
]);
const CLI_AUTH_STATES = new Set<RoleFitManagedProviderAuthState>([
  "signed-in",
  "signed-out",
  "unknown"
]);
const PROVIDER_RECORD_KEYS = new Set([
  "id",
  "kind",
  "configured",
  "ready",
  "authState",
  "guidance"
]);
const SNAPSHOT_KEYS = new Set([
  "type",
  "schemaVersion",
  "providers",
  "credentials"
]);
const MAX_API_KEY_BYTES = 16_384;
const MAX_GUIDANCE_LENGTH = 240;

type ParsedProviderSnapshot = Readonly<{
  providers: readonly RoleFitPublicProviderConnection[];
  credentials: ReadonlyMap<RoleFitManagedApiProviderId, string>;
}>;

let activeSnapshot: ParsedProviderSnapshot | null = null;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactStringKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>
): boolean {
  const keys = Reflect.ownKeys(value);
  return keys.length === allowed.size && keys.every(
    (key) => typeof key === "string" && allowed.has(key)
  );
}

function isProviderId(value: unknown): value is RoleFitManagedProviderId {
  return typeof value === "string" && Object.hasOwn(PROVIDER_KIND, value);
}

function isApiProviderId(value: unknown): value is RoleFitManagedApiProviderId {
  return typeof value === "string" && API_PROVIDER_IDS.has(
    value as RoleFitManagedApiProviderId
  );
}

function validateGuidance(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_GUIDANCE_LENGTH ||
    value.trim() !== value ||
    /\p{Cc}/u.test(value)
  ) {
    throw new TypeError("Provider guidance is invalid.");
  }
  return value;
}

function validateProviderRecord(value: unknown): RoleFitPublicProviderConnection {
  if (!isPlainObject(value) || !hasExactStringKeys(value, PROVIDER_RECORD_KEYS)) {
    throw new TypeError("Provider snapshot record has an invalid shape.");
  }
  if (!isProviderId(value.id)) {
    throw new TypeError("Provider snapshot contains an unsupported provider.");
  }
  const id = value.id;
  const expectedKind = PROVIDER_KIND[id];
  if (value.kind !== expectedKind || value.configured !== true) {
    throw new TypeError("Provider snapshot record is inconsistent.");
  }
  if (typeof value.ready !== "boolean") {
    throw new TypeError("Provider readiness must be boolean.");
  }
  const authState = value.authState;
  if (
    typeof authState !== "string" ||
    (expectedKind === "api"
      ? authState !== "not-applicable"
      : !CLI_AUTH_STATES.has(authState as RoleFitManagedProviderAuthState))
  ) {
    throw new TypeError("Provider authentication state is invalid.");
  }

  return Object.freeze({
    id,
    kind: expectedKind,
    configured: true,
    ready: value.ready,
    authState: authState as RoleFitManagedProviderAuthState,
    guidance: validateGuidance(value.guidance)
  });
}

function validateCredential(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    /\p{Cc}/u.test(value)
  ) {
    throw new TypeError("Managed API credential is invalid.");
  }
  if (Buffer.byteLength(value, "utf8") > MAX_API_KEY_BYTES) {
    throw new RangeError("Managed API credential is too large.");
  }
  return value;
}

function parseProviderSnapshot(value: unknown): ParsedProviderSnapshot {
  if (!isPlainObject(value) || !hasExactStringKeys(value, SNAPSHOT_KEYS)) {
    throw new TypeError("Provider snapshot envelope has an invalid shape.");
  }
  if (
    value.type !== "rolefit-provider-snapshot" ||
    value.schemaVersion !== ROLEFIT_PROVIDER_SNAPSHOT_SCHEMA_VERSION ||
    !Array.isArray(value.providers) ||
    !isPlainObject(value.credentials)
  ) {
    throw new TypeError("Provider snapshot envelope is invalid.");
  }
  if (value.providers.length > PROVIDER_ORDER.length) {
    throw new TypeError("Provider snapshot contains too many providers.");
  }

  const providers: RoleFitPublicProviderConnection[] = [];
  const configuredIds = new Set<RoleFitManagedProviderId>();
  for (const candidate of value.providers) {
    const provider = validateProviderRecord(candidate);
    if (configuredIds.has(provider.id)) {
      throw new TypeError("Provider snapshot contains a duplicate provider.");
    }
    configuredIds.add(provider.id);
    providers.push(provider);
  }

  const credentialKeys = Reflect.ownKeys(value.credentials);
  const credentials = new Map<RoleFitManagedApiProviderId, string>();
  for (const providerId of credentialKeys) {
    if (
      typeof providerId !== "string" ||
      !isApiProviderId(providerId) ||
      !configuredIds.has(providerId)
    ) {
      throw new TypeError("Provider snapshot contains an unexpected credential.");
    }
    credentials.set(providerId, validateCredential(value.credentials[providerId]));
  }

  for (const provider of providers) {
    if (provider.kind !== "api") continue;
    const hasCredential = credentials.has(provider.id as RoleFitManagedApiProviderId);
    if (provider.ready !== hasCredential) {
      throw new TypeError("API provider readiness does not match its credential state.");
    }
  }

  providers.sort((left, right) =>
    (PROVIDER_ORDER_INDEX.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
    (PROVIDER_ORDER_INDEX.get(right.id) ?? Number.MAX_SAFE_INTEGER)
  );
  return Object.freeze({
    providers: Object.freeze(providers),
    credentials
  });
}

/**
 * Replaces the complete companion-managed provider snapshot. Validation builds
 * a detached candidate first, so a malformed message cannot partially mutate
 * the active registry or credential map.
 */
export function applyProviderSnapshot(value: unknown): void {
  const parsed = parseProviderSnapshot(value);
  activeSnapshot = parsed;
}

export function clearProviderSnapshot(): void {
  activeSnapshot = null;
}

export function getManagedApiKey(
  providerId: RoleFitManagedApiProviderId
): string | undefined {
  if (!isApiProviderId(providerId)) return undefined;
  return activeSnapshot?.credentials.get(providerId);
}

/**
 * Reports whether this server is currently governed by an Electron companion
 * snapshot. Provider resolution uses this signal to distinguish a companion-
 * managed server (where the snapshot is authoritative) from standalone/
 * headless use (where CLI sessions and provider-specific .env keys remain
 * valid fallbacks).
 */
export function isCompanionManaged(): boolean {
  return activeSnapshot !== null;
}

/**
 * Returns the configured companion record for one supported provider. The
 * caller receives a detached public-shape copy, never the snapshot's private
 * credential map.
 */
export function getManagedProviderConnection(
  providerId: RoleFitManagedProviderId
): RoleFitPublicProviderConnection | undefined {
  const provider = activeSnapshot?.providers.find(({ id }) => id === providerId);
  return provider ? copyPublicProvider(provider) : undefined;
}

function copyPublicProvider(
  provider: RoleFitPublicProviderConnection
): RoleFitPublicProviderConnection {
  return {
    id: provider.id,
    kind: provider.kind,
    configured: true,
    ready: provider.ready,
    authState: provider.authState,
    guidance: provider.guidance
  };
}

export function getProviderConnectionsPayload(): RoleFitProviderConnectionsPayload {
  return {
    schemaVersion: ROLEFIT_PROVIDER_CONNECTIONS_SCHEMA_VERSION,
    companionManaged: activeSnapshot !== null,
    providers: activeSnapshot?.providers.map(copyPublicProvider) ?? []
  };
}

export function handleProviderConnections(
  req: IncomingMessage,
  res: ServerResponse
): void {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Use GET." });
    return;
  }
  sendJson(res, 200, getProviderConnectionsPayload());
}
