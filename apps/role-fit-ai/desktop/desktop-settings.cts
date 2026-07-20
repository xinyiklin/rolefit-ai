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
import { createServer } from "node:net";
import { join } from "node:path";
import {
  ROLEFIT_DESKTOP_SETTINGS_SCHEMA_VERSION,
  type RoleFitDesktopSiteSettings
} from "./ipc-contract.cjs";

export const DEFAULT_ROLEFIT_LOCAL_SITE_PORT = 5_181 as const;

const SETTINGS_DIRECTORY_NAME = "desktop-settings";
const SETTINGS_FILE_NAME = "settings.json";
const MAX_SETTINGS_FILE_BYTES = 4_096;
const SETTINGS_KEYS = new Set(["schemaVersion", "localSitePort"]);

type PersistedDesktopSettings = Readonly<{
  schemaVersion: typeof ROLEFIT_DESKTOP_SETTINGS_SCHEMA_VERSION;
  localSitePort: number;
}>;

export type DesktopSettingsOptions = Readonly<{
  userDataDirectory: string;
  environmentPort?: string;
  platform?: NodeJS.Platform;
  isPortAvailable?: (port: number) => Promise<boolean>;
}>;

export type DesktopSettingsManager = Readonly<{
  load(): Promise<RoleFitDesktopSiteSettings>;
  saveLocalSitePort(port: number): Promise<RoleFitDesktopSiteSettings>;
}>;

export class DesktopSettingsLockedError extends Error {
  readonly code = "ROLEFIT_DESKTOP_SETTINGS_LOCKED";

  constructor() {
    super("ROLEFIT_DESKTOP_PORT controls the local site port for this launch.");
    this.name = "DesktopSettingsLockedError";
  }
}

export class DesktopSitePortUnavailableError extends Error {
  readonly code = "ROLEFIT_DESKTOP_PORT_UNAVAILABLE";

  constructor() {
    super("That local site port is already in use. Choose another port.");
    this.name = "DesktopSitePortUnavailableError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function validateLocalSitePort(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 65_535) {
    throw new RangeError("Local site port must be an integer from 1 through 65535.");
  }
  return value as number;
}

function parseEnvironmentPort(value: string): number {
  if (!/^\d{1,5}$/.test(value)) {
    throw new Error("ROLEFIT_DESKTOP_PORT must be an integer from 1 through 65535.");
  }
  try {
    return validateLocalSitePort(Number(value));
  } catch {
    throw new Error("ROLEFIT_DESKTOP_PORT must be an integer from 1 through 65535.");
  }
}

function createSettingsState(
  localSitePort: number,
  source: RoleFitDesktopSiteSettings["source"],
  warning: RoleFitDesktopSiteSettings["warning"] = null
): RoleFitDesktopSiteSettings {
  return Object.freeze({
    schemaVersion: ROLEFIT_DESKTOP_SETTINGS_SCHEMA_VERSION,
    localSitePort,
    source,
    locked: source === "environment",
    warning
  });
}

function parsePersistedSettings(value: unknown): PersistedDesktopSettings {
  if (!isPlainObject(value)) throw new Error("Invalid desktop settings.");
  const keys = Object.keys(value);
  if (keys.length !== SETTINGS_KEYS.size || !keys.every((key) => SETTINGS_KEYS.has(key))) {
    throw new Error("Invalid desktop settings.");
  }
  if (value.schemaVersion !== ROLEFIT_DESKTOP_SETTINGS_SCHEMA_VERSION) {
    throw new Error("Unsupported desktop settings version.");
  }
  return Object.freeze({
    schemaVersion: ROLEFIT_DESKTOP_SETTINGS_SCHEMA_VERSION,
    localSitePort: validateLocalSitePort(value.localSitePort)
  });
}

function serializeSettings(port: number): string {
  return `${JSON.stringify({
    schemaVersion: ROLEFIT_DESKTOP_SETTINGS_SCHEMA_VERSION,
    localSitePort: validateLocalSitePort(port)
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

export async function probeLocalSitePortAvailability(
  port: number,
  host = "127.0.0.1"
): Promise<boolean> {
  validateLocalSitePort(port);
  if (host !== "127.0.0.1") {
    throw new Error("Desktop port probes are restricted to the numeric loopback host.");
  }
  return new Promise((resolveProbe, rejectProbe) => {
    const server = createServer();
    let settled = false;
    const settle = (available: boolean, error?: Error): void => {
      if (settled) return;
      settled = true;
      server.removeAllListeners();
      if (error) rejectProbe(error);
      else resolveProbe(available);
    };
    server.unref();
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE" || error.code === "EACCES") settle(false);
      else settle(false, error);
    });
    server.once("listening", () => {
      server.close((error) => {
        if (error) settle(false, error);
        else settle(true);
      });
    });
    server.listen(port, host);
  });
}

export function createDesktopSettingsManager(
  options: DesktopSettingsOptions
): DesktopSettingsManager {
  if (!options.userDataDirectory || !options.userDataDirectory.trim()) {
    throw new TypeError("A userData directory is required for desktop settings.");
  }

  const platform = options.platform ?? process.platform;
  const environmentPort = options.environmentPort;
  const settingsDirectory = join(options.userDataDirectory, SETTINGS_DIRECTORY_NAME);
  const settingsPath = join(settingsDirectory, SETTINGS_FILE_NAME);
  const isPortAvailable = options.isPortAvailable ?? probeLocalSitePortAvailability;
  let operationTail: Promise<void> = Promise.resolve();

  const queue = <T,>(operation: () => Promise<T>): Promise<T> => {
    const result = operationTail.then(operation, operation);
    operationTail = result.then(() => undefined, () => undefined);
    return result;
  };

  const loadPersisted = async (): Promise<RoleFitDesktopSiteSettings> => {
    let exists = false;
    try {
      exists = await fileExists(settingsPath);
      if (!exists) return createSettingsState(DEFAULT_ROLEFIT_LOCAL_SITE_PORT, "default");

      const metadata = await lstat(settingsPath);
      if (
        !metadata.isFile() ||
        metadata.isSymbolicLink() ||
        metadata.size > MAX_SETTINGS_FILE_BYTES
      ) {
        return createSettingsState(
          DEFAULT_ROLEFIT_LOCAL_SITE_PORT,
          "default",
          "saved-settings-invalid"
        );
      }

      const parsed = JSON.parse(await readFile(settingsPath, "utf8")) as unknown;
      const settings = parsePersistedSettings(parsed);
      return createSettingsState(settings.localSitePort, "saved");
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof RangeError) {
        return createSettingsState(
          DEFAULT_ROLEFIT_LOCAL_SITE_PORT,
          "default",
          "saved-settings-invalid"
        );
      }
      if (error instanceof Error && (
        error.message === "Invalid desktop settings." ||
        error.message === "Unsupported desktop settings version."
      )) {
        return createSettingsState(
          DEFAULT_ROLEFIT_LOCAL_SITE_PORT,
          "default",
          "saved-settings-invalid"
        );
      }
      if (exists) {
        return createSettingsState(
          DEFAULT_ROLEFIT_LOCAL_SITE_PORT,
          "default",
          "saved-settings-unreadable"
        );
      }
      throw error;
    }
  };

  const persist = async (port: number): Promise<void> => {
    await mkdir(settingsDirectory, { recursive: true, mode: 0o700 });
    if (platform !== "win32") await chmod(settingsDirectory, 0o700);

    const temporaryPath = join(
      settingsDirectory,
      `.${SETTINGS_FILE_NAME}.${randomUUID()}.tmp`
    );
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(serializeSettings(port), "utf8");
      await handle.sync();
    } catch (error) {
      await handle.close().catch(() => undefined);
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
    await handle.close();

    try {
      await rename(temporaryPath, settingsPath);
      if (platform !== "win32") await chmod(settingsPath, 0o600);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  };

  const load = (): Promise<RoleFitDesktopSiteSettings> => queue(async () => {
    if (environmentPort !== undefined) {
      return createSettingsState(parseEnvironmentPort(environmentPort), "environment");
    }
    return loadPersisted();
  });

  const saveLocalSitePort = (port: number): Promise<RoleFitDesktopSiteSettings> => queue(async () => {
    if (environmentPort !== undefined) throw new DesktopSettingsLockedError();
    const validPort = validateLocalSitePort(port);
    if (!(await isPortAvailable(validPort))) throw new DesktopSitePortUnavailableError();
    await persist(validPort);
    return createSettingsState(validPort, "saved");
  });

  return Object.freeze({ load, saveLocalSitePort });
}
