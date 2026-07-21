import { normalizeSettings } from "./settings.ts";

export const WORKSPACE_BACKUP_FORMAT = "rolefit-workspace-backup" as const;
export const WORKSPACE_BACKUP_SCHEMA_VERSION = 1 as const;
export const WORKSPACE_BACKUP_EXTENSION = ".rolefit-backup";

export const BROWSER_PREFERENCES_FORMAT = "rolefit-browser-preferences" as const;
export const BROWSER_PREFERENCES_SCHEMA_VERSION = 1 as const;
export const BROWSER_PREFERENCES_FILE_NAME = "browser-preferences.json";
export const MAX_BROWSER_PREFERENCES_JSON_BYTES = 120_000;

export const WORKSPACE_RESTORE_MARKER_FORMAT = "rolefit-workspace-restore" as const;
export const WORKSPACE_RESTORE_MARKER_SCHEMA_VERSION = 1 as const;
export const WORKSPACE_RESTORE_MARKER_FILE_NAME = "workspace-restore.json";

export const MAX_WORKSPACE_BACKUP_FILES = 1_100;
export const MAX_WORKSPACE_BACKUP_FILE_BYTES = 10_000_000;
export const MAX_WORKSPACE_BACKUP_BYTES = 64_000_000;
export const MAX_WORKSPACE_BACKUP_JSON_BYTES = 96_000_000;

export type WorkspaceBackupFile = {
  path: string;
  encoding: "utf8" | "base64";
  byteLength: number;
  sha256: string;
  data: string;
};

export type PortableBrowserPreferences = {
  settings: Record<string, unknown>;
  lastBaseResume: string;
};

export type WorkspaceBackupEnvelope = {
  format: typeof WORKSPACE_BACKUP_FORMAT;
  schemaVersion: typeof WORKSPACE_BACKUP_SCHEMA_VERSION;
  createdAt: string;
  files: WorkspaceBackupFile[];
  browser?: PortableBrowserPreferences;
};

const ROOT_BASE_RESUME_RE = /^base-resume(?:-[A-Za-z0-9][A-Za-z0-9_-]*)?\.resume$/;
const LEGACY_BASE_RESUME_RE = /^base-resume\.(?:txt|md|csv)$/;
const HISTORY_BASE_RESUME_RE = /^\.trash\/[A-Za-z0-9T-]+Z__base-resume(?:-[A-Za-z0-9][A-Za-z0-9_-]*)?\.(?:resume|txt|md|csv)$/;
const APPLICATION_PDF_RE = /^applications\/[A-Za-z0-9_-]{1,80}\/resume\.pdf$/;
const SHA256_RE = /^[a-f0-9]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasExactKeys(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && Object.keys(value).every((key) => allowed.has(key));
}

export function isManagedWorkspaceBackupPath(path: string): boolean {
  return path === "applications.json"
    || ROOT_BASE_RESUME_RE.test(path)
    || LEGACY_BASE_RESUME_RE.test(path)
    || HISTORY_BASE_RESUME_RE.test(path)
    || APPLICATION_PDF_RE.test(path);
}

export function workspaceBackupEncodingForPath(path: string): "utf8" | "base64" {
  return path.endsWith(".pdf") ? "base64" : "utf8";
}

// The workspace-resident mirror of allowlisted browser preferences. The browser
// pushes it so companion-driven backups can include preferences, and restore
// stages it so the browser can adopt restored preferences on its next load.
export type StoredBrowserPreferences = {
  format: typeof BROWSER_PREFERENCES_FORMAT;
  schemaVersion: typeof BROWSER_PREFERENCES_SCHEMA_VERSION;
  updatedAt: string;
  source: "mirror" | "restore";
  settings: Record<string, unknown>;
  lastBaseResume: string;
};

export type StoredWorkspaceRestoreMarker = {
  format: typeof WORKSPACE_RESTORE_MARKER_FORMAT;
  schemaVersion: typeof WORKSPACE_RESTORE_MARKER_SCHEMA_VERSION;
  restoredAt: string;
};

export function parseStoredWorkspaceRestoreMarker(value: unknown): StoredWorkspaceRestoreMarker {
  if (!isRecord(value) || !hasExactKeys(value, ["format", "schemaVersion", "restoredAt"])) {
    throw new Error("The workspace restore marker is invalid.");
  }
  if (value.format !== WORKSPACE_RESTORE_MARKER_FORMAT ||
      value.schemaVersion !== WORKSPACE_RESTORE_MARKER_SCHEMA_VERSION) {
    throw new Error("The workspace restore marker uses an unsupported format version.");
  }
  if (typeof value.restoredAt !== "string" || !Number.isFinite(Date.parse(value.restoredAt))) {
    throw new Error("The workspace restore marker timestamp is invalid.");
  }
  return {
    format: WORKSPACE_RESTORE_MARKER_FORMAT,
    schemaVersion: WORKSPACE_RESTORE_MARKER_SCHEMA_VERSION,
    restoredAt: value.restoredAt
  };
}

export function parseStoredBrowserPreferences(value: unknown): StoredBrowserPreferences {
  if (!isRecord(value) || !hasExactKeys(value, ["format", "schemaVersion", "updatedAt", "source", "settings", "lastBaseResume"])) {
    throw new Error("The stored browser preferences are invalid.");
  }
  if (value.format !== BROWSER_PREFERENCES_FORMAT || value.schemaVersion !== BROWSER_PREFERENCES_SCHEMA_VERSION) {
    throw new Error("The stored browser preferences use an unsupported format version.");
  }
  if (typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt))) {
    throw new Error("The stored browser preferences timestamp is invalid.");
  }
  if (value.source !== "mirror" && value.source !== "restore") {
    throw new Error("The stored browser preferences source is invalid.");
  }
  const portable = parsePortableBrowserPreferences({
    settings: value.settings,
    lastBaseResume: value.lastBaseResume
  });
  return {
    format: BROWSER_PREFERENCES_FORMAT,
    schemaVersion: BROWSER_PREFERENCES_SCHEMA_VERSION,
    updatedAt: value.updatedAt,
    source: value.source,
    settings: portable.settings,
    lastBaseResume: portable.lastBaseResume
  };
}

export function parsePortableBrowserPreferences(value: unknown): PortableBrowserPreferences {
  if (!isRecord(value) || !hasExactKeys(value, ["settings", "lastBaseResume"])) {
    throw new Error("The backup's browser preferences are invalid.");
  }
  if (!isRecord(value.settings)) {
    throw new Error("The backup's settings are invalid.");
  }
  const inputSettings = value.settings;
  const settingsJson = JSON.stringify(inputSettings);
  if (new TextEncoder().encode(settingsJson).byteLength > 100_000) {
    throw new Error("The backup's settings are too large.");
  }
  const settings = normalizeSettings(inputSettings);
  const inputKeys = Object.keys(inputSettings);
  const normalizedKeys = Object.keys(settings);
  if (inputKeys.length !== normalizedKeys.length || inputKeys.some((key) =>
    !Object.prototype.hasOwnProperty.call(settings, key) ||
    JSON.stringify(inputSettings[key]) !== JSON.stringify((settings as Record<string, unknown>)[key])
  )) {
    throw new Error("The backup's settings contain unsupported or invalid values.");
  }
  const lastBaseResume = typeof value.lastBaseResume === "string" ? value.lastBaseResume.trim() : "";
  if (lastBaseResume.length > 200 ||
      (lastBaseResume && !ROOT_BASE_RESUME_RE.test(lastBaseResume) && !LEGACY_BASE_RESUME_RE.test(lastBaseResume))) {
    throw new Error("The backup's selected base resume is invalid.");
  }
  return { settings, lastBaseResume };
}

export function parseWorkspaceBackupEnvelope(value: unknown): WorkspaceBackupEnvelope {
  if (!isRecord(value) || !hasExactKeys(value, ["format", "schemaVersion", "createdAt", "files"], ["browser"])) {
    throw new Error("This is not a valid RoleFit workspace backup.");
  }
  if (value.format !== WORKSPACE_BACKUP_FORMAT || value.schemaVersion !== WORKSPACE_BACKUP_SCHEMA_VERSION) {
    throw new Error("This RoleFit workspace backup uses an unsupported format version.");
  }
  if (typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))) {
    throw new Error("The backup creation date is invalid.");
  }
  if (!Array.isArray(value.files) || value.files.length > MAX_WORKSPACE_BACKUP_FILES) {
    throw new Error("The backup contains too many files.");
  }

  const seen = new Set<string>();
  let totalBytes = 0;
  const files = value.files.map((candidate): WorkspaceBackupFile => {
    if (!isRecord(candidate) || !hasExactKeys(candidate, ["path", "encoding", "byteLength", "sha256", "data"])) {
      throw new Error("The backup contains an invalid file record.");
    }
    const path = typeof candidate.path === "string" ? candidate.path : "";
    if (!isManagedWorkspaceBackupPath(path) || path.includes("\\") || path.startsWith("/") || path.includes("..")) {
      throw new Error("The backup contains an unsupported file path.");
    }
    if (seen.has(path)) throw new Error("The backup contains a duplicate file path.");
    seen.add(path);

    const encoding = candidate.encoding;
    if ((encoding !== "utf8" && encoding !== "base64") || encoding !== workspaceBackupEncodingForPath(path)) {
      throw new Error("The backup contains an invalid file encoding.");
    }
    const byteLength = candidate.byteLength;
    if (typeof byteLength !== "number" || !Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > MAX_WORKSPACE_BACKUP_FILE_BYTES) {
      throw new Error("The backup contains an invalid file size.");
    }
    totalBytes += byteLength;
    if (totalBytes > MAX_WORKSPACE_BACKUP_BYTES) {
      throw new Error("The workspace backup is larger than the supported 64 MB limit.");
    }
    if (typeof candidate.sha256 !== "string" || !SHA256_RE.test(candidate.sha256)) {
      throw new Error("The backup contains an invalid file checksum.");
    }
    if (typeof candidate.data !== "string") {
      throw new Error("The backup contains invalid file data.");
    }
    return {
      path,
      encoding,
      byteLength,
      sha256: candidate.sha256,
      data: candidate.data
    };
  });

  return {
    format: WORKSPACE_BACKUP_FORMAT,
    schemaVersion: WORKSPACE_BACKUP_SCHEMA_VERSION,
    createdAt: value.createdAt,
    files,
    ...(value.browser === undefined ? {} : { browser: parsePortableBrowserPreferences(value.browser) })
  };
}
