import { createServer } from "node:net";
import { win32 } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { RoleFitHealthExpectation } from "../server/health-contract.js";

export type RoleFitServerOwnership = "owned" | "reused";

export type DesktopUtilityProcess = {
  readonly pid?: number;
  kill(): boolean;
  postMessage(message: unknown): void;
  once(event: "exit", listener: (code: number) => void): unknown;
  off(event: "exit", listener: (code: number) => void): unknown;
};

export type DesktopServerHandle = {
  origin: string;
  ownership: RoleFitServerOwnership;
  pid?: number;
  updateProviderSnapshot(snapshot: unknown): boolean;
  close(): Promise<void>;
  terminateNow(): void;
};

export type DesktopServerOptions = {
  appRoot: string;
  serverEntry: string;
  serverCwd: string;
  workspaceDir: string;
  sourceEnvironment?: NodeJS.ProcessEnv;
  mode: "development" | "production";
  host: "127.0.0.1";
  port: number;
  startupTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  onUnexpectedExit?: (code: number) => void;
  forkServer(options: {
    modulePath: string;
    cwd: string;
    env: NodeJS.ProcessEnv;
  }): DesktopUtilityProcess;
};

type HealthState = "compatible" | "incompatible" | "unreachable";
type HealthMatcher = (value: unknown) => boolean;

const INHERITED_SERVER_ENV_KEYS = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TERM",
  "COLORTERM",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "APPDATA",
  "LOCALAPPDATA",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "SSH_AUTH_SOCK",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR",
  "AI_PROVIDER",
  "AI_MODEL",
  "OPENAI_MODEL",
  "ANTHROPIC_MODEL",
  "CLAUDE_CLI_MODEL",
  "CODEX_CLI_MODEL",
  "ANTIGRAVITY_CLI_MODEL",
  "EXTENSION_ALLOWED_ORIGINS"
] as const;

const BLOCKED_SERVER_ENV_KEYS = new Set([
  "ELECTRON_RUN_AS_NODE",
  "NODE_OPTIONS",
  "NODE_PATH",
  "OPENAI_API_KEY",
  "OPENAI_ACCESS_TOKEN",
  "CODEX_API_KEY",
  "CODEX_ACCESS_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_APPLICATION_CREDENTIALS"
]);

export function buildDesktopServerEnvironment(
  source: NodeJS.ProcessEnv,
  overrides: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  const caseInsensitiveSource = platform === "win32"
    ? new Map(
        Object.entries(source).map(([key, value]) => [key.toUpperCase(), value] as const)
      )
    : null;
  for (const key of INHERITED_SERVER_ENV_KEYS) {
    const value = source[key] ?? caseInsensitiveSource?.get(key.toUpperCase());
    if (value !== undefined) environment[key] = value;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (!BLOCKED_SERVER_ENV_KEYS.has(key.toUpperCase()) && value !== undefined) {
      environment[key] = value;
    }
  }
  if (platform === "win32") {
    const configuredRoot = environment.SYSTEMROOT;
    const systemRoot = configuredRoot && win32.isAbsolute(configuredRoot) && !configuredRoot.includes("\0")
      ? configuredRoot
      : "C:\\Windows";
    environment.SYSTEMROOT = systemRoot;
    environment.COMSPEC = win32.join(systemRoot, "System32", "cmd.exe");
  }
  return environment;
}

function validatePort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Desktop server port must be an integer from 1 through 65535.");
  }
}

async function probeHealth(origin: string, matches: HealthMatcher): Promise<HealthState> {
  try {
    const response = await fetch(`${origin}/api/health`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(750)
    });
    if (
      !response.ok ||
      response.redirected ||
      !response.headers.get("content-type")?.toLowerCase().includes("application/json")
    ) {
      return "incompatible";
    }
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > 4_096) return "incompatible";
    const body = await response.text();
    if (body.length > 4_096) return "incompatible";
    return matches(JSON.parse(body)) ? "compatible" : "incompatible";
  } catch {
    return "unreachable";
  }
}

async function canBind(host: string, port: number): Promise<boolean> {
  return new Promise((resolveBind, rejectBind) => {
    const server = createServer();
    server.unref();
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") resolveBind(false);
      else rejectBind(error);
    });
    server.once("listening", () => {
      server.close((error) => {
        if (error) rejectBind(error);
        else resolveBind(true);
      });
    });
    server.listen(port, host);
  });
}

async function waitForOwnedServer(
  utility: DesktopUtilityProcess,
  origin: string,
  timeoutMs: number,
  matches: HealthMatcher
): Promise<void> {
  let exitCode: number | null = null;
  const onExit = (code: number) => {
    exitCode = code;
  };
  utility.once("exit", onExit);
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      if (exitCode !== null) {
        throw new Error(`RoleFit server stopped during startup (exit ${exitCode}).`);
      }
      const health = await probeHealth(origin, matches);
      if (health === "compatible") return;
      if (health === "incompatible") {
        throw new Error("The desktop server returned an incompatible health response.");
      }
      await delay(100);
    }
  } finally {
    utility.off("exit", onExit);
  }
  throw new Error("Timed out waiting for the RoleFit desktop server.");
}

async function stopOwnedProcess(
  utility: DesktopUtilityProcess,
  timeoutMs: number
): Promise<void> {
  const ownedPid = utility.pid;
  if (ownedPid === undefined) return;

  const waitUntilGone = async (waitMs: number): Promise<boolean> => {
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      if (utility.pid === undefined) return true;
      await delay(50);
    }
    return utility.pid === undefined;
  };

  utility.kill();
  if (await waitUntilGone(timeoutMs)) return;

  try {
    process.kill(ownedPid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
    throw error;
  }
  if (!(await waitUntilGone(2_000))) {
    throw new Error("The owned RoleFit server did not stop within the shutdown bound.");
  }
}

function reusedServer(origin: string): DesktopServerHandle {
  return {
    origin,
    ownership: "reused",
    updateProviderSnapshot: () => false,
    close: async () => undefined,
    terminateNow: () => undefined
  };
}

export async function startOrReuseDesktopServer(
  options: DesktopServerOptions
): Promise<DesktopServerHandle> {
  validatePort(options.port);
  const origin = `http://${options.host}:${options.port}`;
  const {
    ROLEFIT_DESKTOP_COMPATIBILITY_VERSION,
    ROLEFIT_HEALTH_API_VERSION,
    computeWorkspaceFingerprint,
    isCompatibleRoleFitHealth
  } = await import("../server/health-contract.js");
  const expectedHealth: RoleFitHealthExpectation = {
    apiVersion: ROLEFIT_HEALTH_API_VERSION,
    desktopCompatibilityVersion: ROLEFIT_DESKTOP_COMPATIBILITY_VERSION,
    mode: options.mode,
    workspaceFingerprint: computeWorkspaceFingerprint(options.workspaceDir)
  };
  const matchesHealth: HealthMatcher = (value) =>
    isCompatibleRoleFitHealth(value, expectedHealth);

  const initialHealth = await probeHealth(origin, matchesHealth);
  if (initialHealth === "compatible") {
    return reusedServer(origin);
  }
  if (initialHealth === "incompatible" || !(await canBind(options.host, options.port))) {
    throw new Error(
      `Port ${options.port} is already in use by a service that is not a compatible RoleFit server.`
    );
  }

  const serverProcess = options.forkServer({
    modulePath: options.serverEntry,
    cwd: options.serverCwd,
    env: buildDesktopServerEnvironment(options.sourceEnvironment ?? process.env, {
      NODE_ENV: options.mode === "production" ? "production" : "development",
      HOST: options.host,
      PORT: String(options.port),
      ROLEFIT_APP_ROOT: options.appRoot,
      ROLEFIT_WORKSPACE_DIR: options.workspaceDir
    })
  });

  let closing = false;
  let startupComplete = false;
  let lifecycleExitCode: number | null = null;
  const onLifecycleExit = (code: number) => {
    lifecycleExitCode = code;
    if (startupComplete && !closing) options.onUnexpectedExit?.(code);
  };
  serverProcess.once("exit", onLifecycleExit);

  try {
    await waitForOwnedServer(
      serverProcess,
      origin,
      options.startupTimeoutMs ?? 20_000,
      matchesHealth
    );
    startupComplete = true;
    if (lifecycleExitCode !== null) {
      throw new Error(`RoleFit server stopped during startup (exit ${lifecycleExitCode}).`);
    }
  } catch (error) {
    closing = true;
    await stopOwnedProcess(serverProcess, options.shutdownTimeoutMs ?? 5_000);
    if (await probeHealth(origin, matchesHealth) === "compatible") return reusedServer(origin);
    throw error;
  }

  let closePromise: Promise<void> | null = null;
  return {
    origin,
    ownership: "owned",
    pid: serverProcess.pid,
    updateProviderSnapshot: (snapshot) => {
      if (closing || lifecycleExitCode !== null) return false;
      serverProcess.postMessage(snapshot);
      return true;
    },
    close: () => {
      closing = true;
      closePromise ??= stopOwnedProcess(serverProcess, options.shutdownTimeoutMs ?? 5_000);
      return closePromise;
    },
    terminateNow: () => {
      closing = true;
      if (serverProcess.pid !== undefined) serverProcess.kill();
    }
  };
}
