import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  unlink
} from "node:fs/promises";
import { join } from "node:path";
import {
  ROLEFIT_API_PROVIDER_IDS,
  ROLEFIT_CLI_PROVIDER_IDS,
  isRoleFitApiProviderId,
  isRoleFitCliProviderId,
  isRoleFitProviderId,
  type RoleFitApiProviderId,
  type RoleFitCliProviderId,
  type RoleFitProviderId
} from "./ipc-contract.cjs";

type RoleFitManagedProviderId = RoleFitProviderId;

export type ProviderVaultSafeStorage = Readonly<{
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(plainText: string): Promise<Uint8Array>;
  decryptStringAsync(encrypted: Buffer): Promise<Readonly<{
    result: string;
    shouldReEncrypt: boolean;
  }>>;
  getSelectedStorageBackend?(): string;
}>;

export type ProviderVaultConfiguredProvider = Readonly<{
  id: RoleFitManagedProviderId;
  kind: "api" | "cli";
  configured: boolean;
}>;

export type ProviderVaultConfiguredState = Readonly<{
  schemaVersion: 1;
  providers: readonly ProviderVaultConfiguredProvider[];
}>;

/**
 * Main-process-only decrypted credentials. This value must never cross renderer
 * IPC or the public loopback HTTP boundary.
 */
export type ProviderVaultCredentialSnapshot = Readonly<
  Partial<Record<RoleFitApiProviderId, string>>
>;

export type ProviderVault = Readonly<{
  getConfiguredState(): Promise<ProviderVaultConfiguredState>;
  saveApiCredential(
    providerId: RoleFitApiProviderId,
    apiKey: string
  ): Promise<ProviderVaultConfiguredState>;
  removeProvider(
    providerId: RoleFitManagedProviderId
  ): Promise<ProviderVaultConfiguredState>;
  setCliProviderEnabled(
    providerId: RoleFitCliProviderId,
    enabled: boolean
  ): Promise<ProviderVaultConfiguredState>;
  decryptApiCredentialSnapshot(): Promise<ProviderVaultCredentialSnapshot>;
}>;

export type ProviderVaultOptions = Readonly<{
  userDataDirectory: string;
  safeStorage: ProviderVaultSafeStorage;
  platform?: NodeJS.Platform;
}>;

type PersistedVault = {
  schemaVersion: 1;
  apiCredentials: Partial<Record<RoleFitApiProviderId, string>>;
  enabledCliProviders: RoleFitCliProviderId[];
};

const VAULT_SCHEMA_VERSION = 1 as const;
const VAULT_DIRECTORY_NAME = "provider-vault";
const VAULT_FILE_NAME = "providers.json";
const MAX_API_KEY_BYTES = 16 * 1_024;
const MAX_CIPHERTEXT_BYTES = 64 * 1_024;
const MAX_VAULT_FILE_BYTES = 256 * 1_024;

const ROOT_KEYS = new Set([
  "schemaVersion",
  "apiCredentials",
  "enabledCliProviders"
]);

export class ProviderVaultUnavailableError extends Error {
  readonly code = "ROLEFIT_PROVIDER_VAULT_UNAVAILABLE";

  constructor(message = "Secure operating-system credential storage is unavailable.") {
    super(message);
    this.name = "ProviderVaultUnavailableError";
  }
}

export class ProviderVaultCorruptError extends Error {
  readonly code = "ROLEFIT_PROVIDER_VAULT_CORRUPT";

  constructor(message = "The saved provider vault is invalid.") {
    super(message);
    this.name = "ProviderVaultCorruptError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: Set<string>): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.size && actual.every((key) => keys.has(key));
}

function emptyVault(): PersistedVault {
  return {
    schemaVersion: VAULT_SCHEMA_VERSION,
    apiCredentials: {},
    enabledCliProviders: []
  };
}

function normalizeApiKey(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("API key must be a string.");
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new TypeError("API key cannot be empty.");
  }
  if (Buffer.byteLength(normalized, "utf8") > MAX_API_KEY_BYTES) {
    throw new RangeError("API key is too large.");
  }
  if (/\p{Cc}/u.test(normalized)) {
    throw new TypeError("API key cannot contain control characters.");
  }
  return normalized;
}

function validateProviderId(value: unknown): RoleFitManagedProviderId {
  if (!isRoleFitProviderId(value)) {
    throw new TypeError("Unsupported provider id.");
  }
  return value;
}

function validateApiProviderId(value: unknown): RoleFitApiProviderId {
  if (!isRoleFitApiProviderId(value)) {
    throw new TypeError("Unsupported API provider id.");
  }
  return value;
}

function validateCliProviderId(value: unknown): RoleFitCliProviderId {
  if (!isRoleFitCliProviderId(value)) {
    throw new TypeError("Unsupported CLI provider id.");
  }
  return value;
}

function decodeCiphertext(value: unknown): Buffer {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > Math.ceil(MAX_CIPHERTEXT_BYTES / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw new ProviderVaultCorruptError();
  }

  const ciphertext = Buffer.from(value, "base64");
  if (
    ciphertext.length === 0 ||
    ciphertext.length > MAX_CIPHERTEXT_BYTES ||
    ciphertext.toString("base64") !== value
  ) {
    throw new ProviderVaultCorruptError();
  }
  return ciphertext;
}

function parsePersistedVault(value: unknown): PersistedVault {
  if (!isPlainObject(value) || !hasExactKeys(value, ROOT_KEYS)) {
    throw new ProviderVaultCorruptError();
  }
  if (value.schemaVersion !== VAULT_SCHEMA_VERSION) {
    throw new ProviderVaultCorruptError("Unsupported provider vault version.");
  }
  if (!isPlainObject(value.apiCredentials)) {
    throw new ProviderVaultCorruptError();
  }

  const apiCredentials: Partial<Record<RoleFitApiProviderId, string>> = {};
  for (const [providerId, encoded] of Object.entries(value.apiCredentials)) {
    if (!isRoleFitApiProviderId(providerId)) {
      throw new ProviderVaultCorruptError();
    }
    decodeCiphertext(encoded);
    apiCredentials[providerId] = encoded as string;
  }

  if (!Array.isArray(value.enabledCliProviders)) {
    throw new ProviderVaultCorruptError();
  }
  const enabledCliProviders: RoleFitCliProviderId[] = [];
  const seenCliProviders = new Set<RoleFitCliProviderId>();
  for (const providerId of value.enabledCliProviders) {
    if (!isRoleFitCliProviderId(providerId) || seenCliProviders.has(providerId)) {
      throw new ProviderVaultCorruptError();
    }
    seenCliProviders.add(providerId);
    enabledCliProviders.push(providerId);
  }

  return {
    schemaVersion: VAULT_SCHEMA_VERSION,
    apiCredentials,
    enabledCliProviders
  };
}

function configuredState(vault: PersistedVault): ProviderVaultConfiguredState {
  const providers: ProviderVaultConfiguredProvider[] = [
    ...ROLEFIT_CLI_PROVIDER_IDS.map((id) => Object.freeze({
      id,
      kind: "cli" as const,
      configured: vault.enabledCliProviders.includes(id)
    })),
    ...ROLEFIT_API_PROVIDER_IDS.map((id) => Object.freeze({
      id,
      kind: "api" as const,
      configured: typeof vault.apiCredentials[id] === "string"
    }))
  ];
  return Object.freeze({
    schemaVersion: VAULT_SCHEMA_VERSION,
    providers: Object.freeze(providers)
  });
}

function serializeVault(vault: PersistedVault): string {
  const orderedApiCredentials: Partial<Record<RoleFitApiProviderId, string>> = {};
  for (const providerId of ROLEFIT_API_PROVIDER_IDS) {
    const ciphertext = vault.apiCredentials[providerId];
    if (ciphertext !== undefined) orderedApiCredentials[providerId] = ciphertext;
  }
  const enabled = ROLEFIT_CLI_PROVIDER_IDS.filter((providerId) =>
    vault.enabledCliProviders.includes(providerId)
  );
  return `${JSON.stringify({
    schemaVersion: VAULT_SCHEMA_VERSION,
    apiCredentials: orderedApiCredentials,
    enabledCliProviders: enabled
  })}\n`;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export function createProviderVault(options: ProviderVaultOptions): ProviderVault {
  if (
    typeof options.userDataDirectory !== "string" ||
    options.userDataDirectory.trim().length === 0
  ) {
    throw new TypeError("A userData directory is required.");
  }

  const platform = options.platform ?? process.platform;
  const vaultDirectory = join(options.userDataDirectory, VAULT_DIRECTORY_NAME);
  const vaultPath = join(vaultDirectory, VAULT_FILE_NAME);
  let operationTail: Promise<void> = Promise.resolve();

  const queue = <T,>(operation: () => Promise<T>): Promise<T> => {
    const result = operationTail.then(operation, operation);
    operationTail = result.then(() => undefined, () => undefined);
    return result;
  };

  const assertSecureStorage = async (): Promise<void> => {
    let available = false;
    try {
      available = await options.safeStorage.isAsyncEncryptionAvailable();
    } catch {
      // An initialization failure is unavailable; never attempt plaintext fallback.
    }
    if (!available) throw new ProviderVaultUnavailableError();

    if (platform === "linux") {
      let backend = "unknown";
      try {
        backend = options.safeStorage.getSelectedStorageBackend?.() ?? "unknown";
      } catch {
        // Treat an unreadable backend as unknown and fail closed below.
      }
      if (backend === "basic_text" || backend === "unknown") {
        throw new ProviderVaultUnavailableError(
          "A secure Linux credential backend is unavailable."
        );
      }
    }
  };

  const readVault = async (): Promise<PersistedVault> => {
    if (!(await fileExists(vaultPath))) return emptyVault();

    const metadata = await lstat(vaultPath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_VAULT_FILE_BYTES) {
      throw new ProviderVaultCorruptError();
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(vaultPath, "utf8"));
    } catch (error) {
      if (error instanceof SyntaxError) throw new ProviderVaultCorruptError();
      throw error;
    }
    return parsePersistedVault(parsed);
  };

  const persistVault = async (vault: PersistedVault): Promise<void> => {
    await mkdir(vaultDirectory, { recursive: true, mode: 0o700 });
    if (platform !== "win32") await chmod(vaultDirectory, 0o700);

    const temporaryPath = join(vaultDirectory, `.${VAULT_FILE_NAME}.${randomUUID()}.tmp`);
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(serializeVault(vault), "utf8");
      await handle.sync();
    } catch (error) {
      await handle.close().catch(() => undefined);
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
    await handle.close();

    try {
      await rename(temporaryPath, vaultPath);
      if (platform !== "win32") await chmod(vaultPath, 0o600);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  };

  const encryptApiKey = async (apiKey: string): Promise<string> => {
    await assertSecureStorage();
    let encrypted: Uint8Array;
    try {
      encrypted = await options.safeStorage.encryptStringAsync(apiKey);
    } catch {
      throw new ProviderVaultUnavailableError("The API key could not be encrypted.");
    }
    const ciphertext = Buffer.from(encrypted);
    if (ciphertext.length === 0 || ciphertext.length > MAX_CIPHERTEXT_BYTES) {
      throw new ProviderVaultUnavailableError("The encrypted API key is invalid.");
    }
    return ciphertext.toString("base64");
  };

  return Object.freeze({
    getConfiguredState: () => queue(async () => configuredState(await readVault())),

    saveApiCredential: (providerId, apiKey) => queue(async () => {
      const validProviderId = validateApiProviderId(providerId);
      const normalizedApiKey = normalizeApiKey(apiKey);
      const ciphertext = await encryptApiKey(normalizedApiKey);
      const vault = await readVault();
      vault.apiCredentials[validProviderId] = ciphertext;
      await persistVault(vault);
      return configuredState(vault);
    }),

    removeProvider: (providerId) => queue(async () => {
      const validProviderId = validateProviderId(providerId);
      const vault = await readVault();
      if (isRoleFitApiProviderId(validProviderId)) {
        delete vault.apiCredentials[validProviderId];
      } else {
        vault.enabledCliProviders = vault.enabledCliProviders.filter(
          (id) => id !== validProviderId
        );
      }
      await persistVault(vault);
      return configuredState(vault);
    }),

    setCliProviderEnabled: (providerId, enabled) => queue(async () => {
      const validProviderId = validateCliProviderId(providerId);
      if (typeof enabled !== "boolean") {
        throw new TypeError("CLI provider enabled state must be boolean.");
      }
      const vault = await readVault();
      const enabledProviders = new Set(vault.enabledCliProviders);
      if (enabled) enabledProviders.add(validProviderId);
      else enabledProviders.delete(validProviderId);
      vault.enabledCliProviders = ROLEFIT_CLI_PROVIDER_IDS.filter((id) =>
        enabledProviders.has(id)
      );
      await persistVault(vault);
      return configuredState(vault);
    }),

    decryptApiCredentialSnapshot: () => queue(async () => {
      await assertSecureStorage();
      const vault = await readVault();
      const snapshot: Partial<Record<RoleFitApiProviderId, string>> = {};
      let shouldPersistRotatedCiphertext = false;

      for (const providerId of ROLEFIT_API_PROVIDER_IDS) {
        const encoded = vault.apiCredentials[providerId];
        if (encoded === undefined) continue;

        let decrypted: Readonly<{ result: string; shouldReEncrypt: boolean }>;
        try {
          decrypted = await options.safeStorage.decryptStringAsync(decodeCiphertext(encoded));
        } catch {
          throw new ProviderVaultCorruptError("A saved API credential could not be decrypted.");
        }
        if (
          !isPlainObject(decrypted) ||
          typeof decrypted.result !== "string" ||
          typeof decrypted.shouldReEncrypt !== "boolean"
        ) {
          throw new ProviderVaultCorruptError("A saved API credential is invalid.");
        }

        let normalized: string;
        try {
          normalized = normalizeApiKey(decrypted.result);
        } catch {
          throw new ProviderVaultCorruptError("A saved API credential is invalid.");
        }
        if (normalized !== decrypted.result) {
          throw new ProviderVaultCorruptError("A saved API credential is invalid.");
        }
        snapshot[providerId] = normalized;

        if (decrypted.shouldReEncrypt) {
          vault.apiCredentials[providerId] = await encryptApiKey(normalized);
          shouldPersistRotatedCiphertext = true;
        }
      }

      if (shouldPersistRotatedCiphertext) await persistVault(vault);
      return Object.freeze(snapshot);
    })
  });
}
