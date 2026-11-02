const SETTINGS_KEY = "rolefitExtensionSettings";
const SETTINGS_SCHEMA_VERSION = 1;
const DEFAULT_LOCAL_SITE_PORT = 5_181;
// Ports browsers refuse to connect to (the Fetch standard's bad ports). The
// companion refuses the same list (desktop/ipc-contract.cts); keep them aligned.
const FETCH_BLOCKED_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104,
  109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515,
  526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049,
  3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080
]);
const PORT_INPUT_PATTERN = /^\d+$/;
// A keyboard import runs with no popup open, so its failure is recorded here and
// shown once the next time the popup opens. Bounded and short-lived: a stale
// notice must never resurface as if it described the current state.
const NOTICE_KEY = "rolefitShortcutNotice";
const NOTICE_MAX_LENGTH = 240;
const NOTICE_TTL_MS = 15 * 60 * 1000;

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function getStorageLocal() {
  const storageLocal = globalThis.chrome?.storage?.local;
  if (!storageLocal) {
    throw new Error("chrome.storage.local is unavailable.");
  }
  return storageLocal;
}

function storageOperationError(operation, error) {
  if (error instanceof Error) return error;
  const message = error && typeof error.message === "string"
    ? error.message
    : String(error);
  return new Error(`chrome.storage.local.${operation} failed: ${message}`);
}

function callStorage(operation, args) {
  const storageLocal = getStorageLocal();
  const method = storageLocal[operation];
  if (typeof method !== "function") {
    throw new Error(`chrome.storage.local.${operation} is unavailable.`);
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (error, value) => {
      if (settled) return;
      settled = true;
      if (error) reject(storageOperationError(operation, error));
      else resolve(value);
    };

    const callback = (value) => {
      let lastError;
      try {
        // Chrome only exposes runtime.lastError while this callback runs.
        lastError = globalThis.chrome?.runtime?.lastError;
      } catch (error) {
        settle(error);
        return;
      }
      if (lastError) {
        settle(new Error(
          `chrome.storage.local.${operation} failed: ${lastError.message || "unknown error"}`
        ));
        return;
      }
      settle(null, value);
    };

    let returned;
    try {
      returned = method.call(storageLocal, ...args, callback);
    } catch (error) {
      settle(error);
      return;
    }

    // Promise-returning implementations are supported as a compatibility aid;
    // callback completion remains the authoritative path for Chrome APIs.
    if (returned && typeof returned.then === "function") {
      returned.then(
        (value) => settle(null, value),
        (error) => settle(error)
      );
    }
  });
}

function createSettingsRecord(port) {
  return Object.freeze({
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    localSitePort: port
  });
}

function parseStoredSettings(value) {
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value);
  if (
    keys.length !== 2 ||
    !keys.includes("schemaVersion") ||
    !keys.includes("localSitePort") ||
    value.schemaVersion !== SETTINGS_SCHEMA_VERSION ||
    !Number.isInteger(value.localSitePort)
  ) {
    return null;
  }

  try {
    return createSettingsRecord(validateLocalSitePort(value.localSitePort));
  } catch {
    return null;
  }
}

function getInstallSeedPort() {
  const runtimeConfig = globalThis.ROLEFIT_EXTENSION_RUNTIME_CONFIG;
  if (!isPlainObject(runtimeConfig) || runtimeConfig.schemaVersion !== SETTINGS_SCHEMA_VERSION) {
    throw new Error("RoleFit extension install configuration is invalid.");
  }

  try {
    // The generated install seed is a numeric record, not user-facing input.
    if (!Number.isInteger(runtimeConfig.localSitePort)) {
      throw new TypeError("RoleFit extension install port must be an integer.");
    }
    return validateLocalSitePort(runtimeConfig.localSitePort);
  } catch {
    throw new Error("RoleFit extension install configuration is invalid.");
  }
}

async function readSavedSettings() {
  const result = await callStorage("get", [SETTINGS_KEY]);
  if (!isPlainObject(result) || !Object.prototype.hasOwnProperty.call(result, SETTINGS_KEY)) {
    return null;
  }
  const settings = parseStoredSettings(result[SETTINGS_KEY]);
  if (!settings) {
    throw new Error("Saved RoleFit extension settings are invalid.");
  }
  return settings;
}

async function writeSettings(settings) {
  await callStorage("set", [{ [SETTINGS_KEY]: settings }]);
}

async function initializeSettings() {
  const settings = createSettingsRecord(getInstallSeedPort());
  await writeSettings(settings);
  return settings;
}

let operationTail = Promise.resolve();

function enqueue(operation) {
  const result = operationTail.then(operation, operation);
  operationTail = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

/**
 * Validate a user-entered localhost port and return its canonical number.
 * Numeric values are accepted for validated internal/runtime records.
 */
export function validateLocalSitePort(value) {
  let port;
  if (typeof value === "string") {
    if (!PORT_INPUT_PATTERN.test(value)) {
      throw new TypeError("Local RoleFit port must contain digits only.");
    }
    port = Number(value);
  } else if (typeof value === "number") {
    port = value;
  } else {
    throw new TypeError("Local RoleFit port must contain digits only.");
  }

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new RangeError("Local RoleFit port must be an integer from 1 through 65535.");
  }
  if (FETCH_BLOCKED_PORTS.has(port)) {
    throw new RangeError(`Port ${port} is one browsers refuse to connect to. Choose another port.`);
  }
  return port;
}

export function createLocalSiteOrigin(port) {
  return `http://localhost:${validateLocalSitePort(port)}`;
}

export function loadExtensionSettings() {
  return enqueue(async () => {
    const saved = await readSavedSettings();
    if (saved) return saved;
    return initializeSettings();
  });
}

export function saveExtensionPort(port) {
  return enqueue(async () => {
    const settings = createSettingsRecord(validateLocalSitePort(port));
    await writeSettings(settings);
    return settings;
  });
}

export function resetExtensionSettings() {
  return saveExtensionPort(DEFAULT_LOCAL_SITE_PORT);
}

/**
 * Record why a keyboard import failed. Stored separately from the port record so
 * a transient notice can never invalidate the settings the popup needs to load.
 */
export function saveShortcutNotice(message, now = Date.now()) {
  const text = typeof message === "string" ? message.trim().slice(0, NOTICE_MAX_LENGTH) : "";
  if (!text) return clearShortcutNotice();
  return enqueue(() => callStorage("set", [{
    [NOTICE_KEY]: { schemaVersion: SETTINGS_SCHEMA_VERSION, message: text, at: now }
  }]));
}

export function clearShortcutNotice() {
  return enqueue(() => callStorage("remove", [[NOTICE_KEY]]));
}

/**
 * Read the pending keyboard-import notice, or null. An unreadable or expired
 * record resolves to null rather than throwing: a failed notice must never be
 * the reason the popup cannot open.
 */
export function readShortcutNotice(now = Date.now()) {
  return enqueue(async () => {
    let result;
    try {
      result = await callStorage("get", [NOTICE_KEY]);
    } catch {
      return null;
    }
    const record = isPlainObject(result) ? result[NOTICE_KEY] : null;
    if (
      !isPlainObject(record) ||
      record.schemaVersion !== SETTINGS_SCHEMA_VERSION ||
      typeof record.message !== "string" ||
      !record.message.trim() ||
      !Number.isFinite(record.at) ||
      now - record.at > NOTICE_TTL_MS ||
      record.at > now
    ) {
      return null;
    }
    return record.message.slice(0, NOTICE_MAX_LENGTH);
  });
}
