export const ROLEFIT_DESKTOP_API_VERSION = 6 as const;
export const ROLEFIT_DESKTOP_SETTINGS_SCHEMA_VERSION = 1 as const;
export const ROLEFIT_PROVIDER_GUIDANCE_MAX_LENGTH = 240 as const;
export const ROLEFIT_API_KEY_MAX_BYTES = 16_384 as const;
export const ROLEFIT_EXTENSION_ORIGIN_MAX_LENGTH = 128 as const;
export const ROLEFIT_EXTENSION_ORIGIN_MAX_COUNT = 4 as const;
export const ROLEFIT_EXTENSION_PAIRING_REQUEST_MAX_COUNT = 8 as const;

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
  BeginCliSignIn = "rolefit:companion:begin-cli-sign-in",
  CancelCliSignIn = "rolefit:companion:cancel-cli-sign-in",
  OpenCliSignInTerminal = "rolefit:companion:open-cli-sign-in-terminal",
  OpenProviderInstallGuide = "rolefit:companion:open-provider-install-guide",
  OpenBrowserApp = "rolefit:companion:open-browser-app"
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
  signInRunning: boolean;
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
  signInRunning: boolean;
  guidance: string;
}>;

export type RoleFitCliSignInResult = Readonly<{
  status: "started" | "manual" | "already-running";
  operationId: string | null;
  guidance: string;
}>;

export type RoleFitCliTerminalSignInResult = Readonly<{
  status: "opened";
  guidance: string;
}>;

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
export type RoleFitBeginCliSignInRequest = readonly [RoleFitCliProviderId];
export type RoleFitCancelCliSignInRequest = readonly [string];
export type RoleFitOpenCliSignInTerminalRequest = readonly [RoleFitCliProviderId];
export type RoleFitOpenProviderInstallGuideRequest = readonly [RoleFitCliProviderId];
export type RoleFitOpenBrowserAppRequest = readonly [];

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
  beginCliSignIn(provider: RoleFitCliProviderId): Promise<RoleFitCliSignInResult>;
  cancelCliSignIn(operationId: string): Promise<boolean>;
  openCliSignInTerminal(
    provider: RoleFitCliProviderId
  ): Promise<RoleFitCliTerminalSignInResult>;
  openProviderInstallGuide(provider: RoleFitCliProviderId): Promise<void>;
  openBrowserApp(): Promise<void>;
}>;

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
