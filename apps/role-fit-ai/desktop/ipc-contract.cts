export const ROLEFIT_DESKTOP_API_VERSION = 10 as const;
export const ROLEFIT_DESKTOP_SETTINGS_SCHEMA_VERSION = 1 as const;
export const ROLEFIT_PROVIDER_GUIDANCE_MAX_LENGTH = 240 as const;
export const ROLEFIT_API_KEY_MAX_BYTES = 16_384 as const;
export const ROLEFIT_EXTENSION_ORIGIN_MAX_LENGTH = 128 as const;
export const ROLEFIT_EXTENSION_ORIGIN_MAX_COUNT = 4 as const;
export const ROLEFIT_EXTENSION_PAIRING_REQUEST_MAX_COUNT = 8 as const;
// Mirrors MAX_WORKSPACE_BACKUP_JSON_BYTES in src/lib/workspaceBackupContract.ts.
// The desktop TypeScript project cannot import app src modules, so the probe
// suite cross-checks this mirror against the shared contract source.
export const ROLEFIT_WORKSPACE_BACKUP_MAX_JSON_BYTES = 96_000_000 as const;
export const ROLEFIT_WORKSPACE_MESSAGE_MAX_LENGTH = 240 as const;
export const ROLEFIT_WORKSPACE_PATH_MAX_LENGTH = 1_024 as const;
export const ROLEFIT_WORKSPACE_BACKUP_FILE_NAME_MAX_LENGTH = 255 as const;
// Mirrors MAX_WORKSPACE_BACKUP_FILE_BYTES in src/lib/workspaceBackupContract.ts;
// caps the applications.json read used for the shape-only application count.
export const ROLEFIT_WORKSPACE_STAT_FILE_MAX_BYTES = 10_000_000 as const;

// Directory-entry mirrors of the managed base-resume naming in
// src/lib/workspaceBackupContract.ts (and server/workspaceBackup.ts). The
// desktop project cannot import app src modules; the probe suite cross-checks
// these mirrors against the shared contract source. They classify names only —
// file contents never cross this boundary.
export const ROLEFIT_WORKSPACE_BASE_RESUME_RE =
  /^base-resume(?:-[A-Za-z0-9][A-Za-z0-9_-]*)?\.resume$/;
export const ROLEFIT_WORKSPACE_LEGACY_BASE_RESUME_RE = /^base-resume\.(?:txt|md|csv)$/;

// Const enums inline into the compiled sandboxed preload, so this file remains
// the one source of truth without emitting a forbidden neighboring require.
export const enum RoleFitDesktopBridge {
  GlobalKey = "roleFitDesktop"
}

export const enum RoleFitDesktopIpcChannel {
  GetRuntimeInfo = "rolefit:companion:get-runtime-info",
  GetLocalSiteSettings = "rolefit:companion:get-local-site-settings",
  ApplyLocalSitePort = "rolefit:companion:apply-local-site-port",
  GetExtensionPairingSettings = "rolefit:companion:get-extension-pairing-settings",
  SaveExtensionOrigin = "rolefit:companion:save-extension-origin",
  RemoveExtensionOrigin = "rolefit:companion:remove-extension-origin",
  GetProviderConnections = "rolefit:companion:get-provider-connections",
  SaveApiProvider = "rolefit:companion:save-api-provider",
  RemoveProvider = "rolefit:companion:remove-provider",
  SetCliProviderEnabled = "rolefit:companion:set-cli-provider-enabled",
  OpenCliSignInTerminal = "rolefit:companion:open-cli-sign-in-terminal",
  OpenProviderInstallGuide = "rolefit:companion:open-provider-install-guide",
  OpenExtensionDirectory = "rolefit:companion:open-extension-directory",
  OpenBrowserApp = "rolefit:companion:open-browser-app",
  GetWorkspaceOverview = "rolefit:companion:get-workspace-overview",
  BackupWorkspaceToFile = "rolefit:companion:backup-workspace-to-file",
  RestoreWorkspaceFromFile = "rolefit:companion:restore-workspace-from-file",
  OpenWorkspaceFolder = "rolefit:companion:open-workspace-folder",
  GetConnectionStatus = "rolefit:companion:get-connection-status"
}

export type RoleFitDesktopPlatform = "darwin" | "win32" | "linux" | "other";

export type RoleFitDesktopRuntimeInfo = Readonly<{
  apiVersion: typeof ROLEFIT_DESKTOP_API_VERSION;
  runtime: "electron-companion";
  platform: RoleFitDesktopPlatform;
  appVersion: string;
  electronVersion: string;
}>;

export type RoleFitDesktopSiteSettingsSource = "default" | "saved" | "environment";
export type RoleFitDesktopSiteSettingsWarning =
  | "saved-settings-invalid"
  | "saved-settings-unreadable";

/**
 * Shape-only, non-secret companion configuration. Workspace paths and provider
 * credentials deliberately have no representation in this settings contract.
 */
export type RoleFitDesktopSiteSettings = Readonly<{
  schemaVersion: typeof ROLEFIT_DESKTOP_SETTINGS_SCHEMA_VERSION;
  localSitePort: number;
  source: RoleFitDesktopSiteSettingsSource;
  locked: boolean;
  warning: RoleFitDesktopSiteSettingsWarning | null;
}>;

/**
 * Exact, non-secret browser-extension origins approved by the user. The local
 * server reflects only these origins on extension analyze/import responses.
 */
export type RoleFitExtensionPairingSettings = Readonly<{
  schemaVersion: typeof ROLEFIT_DESKTOP_SETTINGS_SCHEMA_VERSION;
  origins: readonly string[];
  pendingOrigins: readonly string[];
}>;

export const ROLEFIT_CLI_PROVIDER_IDS = Object.freeze([
  "claude-cli",
  "codex-cli",
  "antigravity-cli"
] as const);
export const ROLEFIT_API_PROVIDER_IDS = Object.freeze([
  "openai",
  "anthropic"
] as const);
export const ROLEFIT_PROVIDER_IDS = Object.freeze([
  ...ROLEFIT_CLI_PROVIDER_IDS,
  ...ROLEFIT_API_PROVIDER_IDS
] as const);

export type RoleFitCliProviderId = (typeof ROLEFIT_CLI_PROVIDER_IDS)[number];
export type RoleFitApiProviderId = (typeof ROLEFIT_API_PROVIDER_IDS)[number];
export type RoleFitProviderId = RoleFitCliProviderId | RoleFitApiProviderId;
export type RoleFitProviderKind = "cli" | "api";
export type RoleFitProviderAuthState =
  | "signed-in"
  | "signed-out"
  | "unknown"
  | "not-applicable";
export type RoleFitProviderSetupFlow =
  | "managed-login"
  | "manual-login"
  | "api-key";

// Internal CLI probing still uses this narrower status before the main process
// merges it with the configured-provider vault. It is not exposed by preload.
export type RoleFitCliAuthState = Exclude<
  RoleFitProviderAuthState,
  "not-applicable"
>;
export type RoleFitCliProviderStatus = Readonly<{
  id: RoleFitCliProviderId;
  label: string;
  installed: boolean;
  authState: RoleFitCliAuthState;
  signInFlow: "managed" | "manual";
  guidance: string;
}>;

/**
 * The only provider data exposed to the companion renderer. Credentials and
 * provider output deliberately have no representation in this contract.
 */
export type RoleFitProviderConnection = Readonly<{
  id: RoleFitProviderId;
  kind: RoleFitProviderKind;
  configured: boolean;
  ready: boolean;
  installed: boolean | null;
  authState: RoleFitProviderAuthState;
  setupFlow: RoleFitProviderSetupFlow;
  guidance: string;
}>;

export type RoleFitCliTerminalSignInResult = Readonly<{
  status: "opened";
  guidance: string;
}>;

/**
 * Shape-only workspace state for the companion Workspace tab. The absolute
 * workspace path and its home-relative display form are the only file paths
 * the companion renderer may receive; the stat fields are name-derived counts
 * computed in main — file contents never cross this boundary.
 * `activeBrowserTabs` is null whenever the local server's activity endpoint is
 * unreachable or unimplemented; `applicationCount` is null when
 * applications.json is missing, oversized, or unreadable.
 */
export type RoleFitWorkspaceOverview = Readonly<{
  workspacePath: string;
  workspaceDisplayPath: string;
  activeBrowserTabs: number | null;
  serverReady: boolean;
  workspaceTransferReady: boolean;
  hasBaseResume: boolean;
  applicationCount: number | null;
}>;

export type RoleFitConnectionServerState =
  | "owned"
  | "reused"
  | "starting"
  | "unreachable";

/**
 * Live loopback truth for the Connection tab: the active port, the canonical
 * browser URL, whether the responding server is companion-owned, a reused
 * standalone listener, still starting, or not answering health probes, and
 * the beaconed browser-tab count (null when unknown).
 */
export type RoleFitConnectionStatus = Readonly<{
  port: number;
  siteUrl: string;
  serverState: RoleFitConnectionServerState;
  activeBrowserTabs: number | null;
}>;

/**
 * Result of the main-owned backup flow. `filePath` carries only the chosen
 * file's name (never a directory); error messages are sanitized in main.
 */
export type RoleFitWorkspaceBackupResult = Readonly<
  | {
      status: "saved";
      filePath: string;
      fileCount: number;
      includesPreferences: boolean;
    }
  | { status: "cancelled" }
  | { status: "error"; message: string }
>;

export type RoleFitWorkspaceRestoreResult = Readonly<
  | {
      status: "restored";
      restoredFiles: number;
      previousWorkspaceKept: boolean;
    }
  | { status: "cancelled" }
  | { status: "error"; message: string }
>;

export type RoleFitDesktopRuntimeInfoRequest = readonly [];
export type RoleFitDesktopSiteSettingsRequest = readonly [];
export type RoleFitApplyLocalSitePortRequest = readonly [number];
export type RoleFitExtensionPairingSettingsRequest = readonly [];
export type RoleFitSaveExtensionOriginRequest = readonly [string];
export type RoleFitRemoveExtensionOriginRequest = readonly [string];
export type RoleFitProviderConnectionsRequest = readonly [];
export type RoleFitSaveApiProviderRequest = readonly [RoleFitApiProviderId, string];
export type RoleFitRemoveProviderRequest = readonly [RoleFitProviderId];
export type RoleFitSetCliProviderEnabledRequest = readonly [RoleFitCliProviderId, boolean];
export type RoleFitOpenCliSignInTerminalRequest = readonly [RoleFitCliProviderId];
export type RoleFitOpenProviderInstallGuideRequest = readonly [RoleFitCliProviderId];
export type RoleFitOpenExtensionDirectoryRequest = readonly [];
export type RoleFitOpenBrowserAppRequest = readonly [];
export type RoleFitWorkspaceOverviewRequest = readonly [];
export type RoleFitBackupWorkspaceToFileRequest = readonly [];
export type RoleFitRestoreWorkspaceFromFileRequest = readonly [];
export type RoleFitOpenWorkspaceFolderRequest = readonly [];
export type RoleFitConnectionStatusRequest = readonly [];

export type RoleFitDesktopApi = Readonly<{
  getRuntimeInfo(): Promise<RoleFitDesktopRuntimeInfo>;
  getLocalSiteSettings(): Promise<RoleFitDesktopSiteSettings>;
  applyLocalSitePort(port: number): Promise<RoleFitDesktopSiteSettings>;
  getExtensionPairingSettings(): Promise<RoleFitExtensionPairingSettings>;
  saveExtensionOrigin(origin: string): Promise<RoleFitExtensionPairingSettings>;
  removeExtensionOrigin(origin: string): Promise<RoleFitExtensionPairingSettings>;
  getProviderConnections(): Promise<readonly RoleFitProviderConnection[]>;
  saveApiProvider(
    provider: RoleFitApiProviderId,
    apiKey: string
  ): Promise<RoleFitProviderConnection>;
  removeProvider(provider: RoleFitProviderId): Promise<RoleFitProviderConnection>;
  setCliProviderEnabled(
    provider: RoleFitCliProviderId,
    enabled: boolean
  ): Promise<RoleFitProviderConnection>;
  openCliSignInTerminal(
    provider: RoleFitCliProviderId
  ): Promise<RoleFitCliTerminalSignInResult>;
  openProviderInstallGuide(provider: RoleFitCliProviderId): Promise<void>;
  openExtensionDirectory(): Promise<void>;
  openBrowserApp(): Promise<void>;
  getWorkspaceOverview(): Promise<RoleFitWorkspaceOverview>;
  backupWorkspaceToFile(): Promise<RoleFitWorkspaceBackupResult>;
  restoreWorkspaceFromFile(): Promise<RoleFitWorkspaceRestoreResult>;
  openWorkspaceFolder(): Promise<void>;
  getConnectionStatus(): Promise<RoleFitConnectionStatus>;
}>;

export function isRoleFitConnectionServerState(
  value: unknown
): value is RoleFitConnectionServerState {
  return value === "owned" ||
    value === "reused" ||
    value === "starting" ||
    value === "unreachable";
}

export function isRoleFitWorkspaceBackupFileName(value: unknown): value is string {
  return typeof value === "string" &&
    value.length <= ROLEFIT_WORKSPACE_BACKUP_FILE_NAME_MAX_LENGTH &&
    value.endsWith(".rolefit-backup") &&
    // A bare file name only: no separators, drive/stream colons, control
    // characters, or leading dots that could smuggle a path across the bridge.
    // eslint-disable-next-line no-control-regex
    /^[A-Za-z0-9][^\\\/:*?"<>|\u0000-\u001F]*$/.test(value);
}

export function normalizeRoleFitExtensionOrigin(value: unknown): string {
  const origin = typeof value === "string" ? value.trim().replace(/\/$/, "") : "";
  if (!origin || origin.length > ROLEFIT_EXTENSION_ORIGIN_MAX_LENGTH) return "";
  if (/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) return origin;
  if (/^moz-extension:\/\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(origin)) {
    return origin.toLowerCase();
  }
  return "";
}

export function isRoleFitCliProviderId(value: unknown): value is RoleFitCliProviderId {
  return value === "claude-cli" ||
    value === "codex-cli" ||
    value === "antigravity-cli";
}

export function isRoleFitApiProviderId(value: unknown): value is RoleFitApiProviderId {
  return value === "openai" || value === "anthropic";
}

export function isRoleFitProviderId(value: unknown): value is RoleFitProviderId {
  return isRoleFitCliProviderId(value) || isRoleFitApiProviderId(value);
}

export function normalizeRoleFitDesktopPlatform(platform: string): RoleFitDesktopPlatform {
  if (platform === "darwin" || platform === "win32" || platform === "linux") {
    return platform;
  }
  return "other";
}

function requireVersion(value: string, label: string): string {
  const version = value.trim();
  if (!version) throw new Error(`${label} cannot be empty.`);
  return version;
}

export function createRoleFitDesktopRuntimeInfo(
  platform: string,
  appVersion: string,
  electronVersion: string
): RoleFitDesktopRuntimeInfo {
  return Object.freeze({
    apiVersion: ROLEFIT_DESKTOP_API_VERSION,
    runtime: "electron-companion",
    platform: normalizeRoleFitDesktopPlatform(platform),
    appVersion: requireVersion(appVersion, "RoleFit app version"),
    electronVersion: requireVersion(electronVersion, "Electron version")
  });
}
