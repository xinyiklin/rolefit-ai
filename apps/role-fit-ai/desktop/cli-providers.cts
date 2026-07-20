import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { delimiter, isAbsolute, posix, win32 } from "node:path";
import type { ChildProcess } from "node:child_process";
import type {
  RoleFitCliAuthState,
  RoleFitCliProviderId,
  RoleFitCliProviderStatus,
  RoleFitCliSignInResult,
  RoleFitCliTerminalSignInResult
} from "./ipc-contract.cjs";

const PROBE_TIMEOUT_MS = 5_000;
const PROBE_OUTPUT_LIMIT_BYTES = 16 * 1_024;
const SIGN_IN_TERMINATE_GRACE_MS = 2_000;
const SIGN_IN_SHUTDOWN_LIMIT_MS = 3_000;
const SIGN_IN_MAX_DURATION_MS = 10 * 60_000;
const TERMINAL_LAUNCH_TIMEOUT_MS = 15_000;

const CLI_CHILD_ENV_BLOCKLIST = new Set([
  // Electron/Node launch controls must not change how a vendor CLI executable
  // starts merely because its parent is Electron.
  "ELECTRON_RUN_AS_NODE",
  "NODE_OPTIONS",
  "NODE_PATH",
  // The companion manages account-backed CLI sessions, not API/access-token
  // login. Keep vendor keychain/config locations, but do not forward these
  // alternate credential channels into status or sign-in commands.
  "OPENAI_API_KEY",
  "OPENAI_ACCESS_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CODEX_ACCESS_TOKEN",
  "CODEX_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_APPLICATION_CREDENTIALS"
]);

type ProviderSpec = Readonly<{
  id: RoleFitCliProviderId;
  label: string;
  command: "claude" | "codex" | "agy";
  versionArgs: readonly string[];
  statusArgs: readonly string[] | null;
  signInArgs: readonly string[] | null;
  terminalSignInArgs: readonly string[];
}>;

const PROVIDER_SPECS: readonly ProviderSpec[] = Object.freeze([
  Object.freeze({
    id: "claude-cli",
    label: "Claude Code",
    command: "claude",
    versionArgs: Object.freeze(["--version"]),
    statusArgs: Object.freeze(["auth", "status", "--json"]),
    // Pin the subscription path. The alternative --console flow uses API billing
    // and is not the account-backed CLI connection RoleFit offers.
    signInArgs: Object.freeze(["auth", "login", "--claudeai"]),
    terminalSignInArgs: Object.freeze(["auth", "login", "--claudeai"])
  }),
  Object.freeze({
    id: "codex-cli",
    label: "Codex CLI",
    command: "codex",
    versionArgs: Object.freeze(["--version"]),
    statusArgs: Object.freeze(["login", "status"]),
    // Deliberately exclude --with-api-key and --with-access-token. RoleFit uses
    // the CLI's normal account-backed browser flow and never handles its token.
    signInArgs: Object.freeze(["login"]),
    terminalSignInArgs: Object.freeze(["login"])
  }),
  Object.freeze({
    id: "antigravity-cli",
    label: "Antigravity CLI",
    command: "agy",
    versionArgs: Object.freeze(["--version"]),
    // agy 1.1.x has no auth-only command or machine-readable auth status. Its
    // first-run sign-in is part of the interactive TUI, so it remains manual.
    statusArgs: null,
    signInArgs: null,
    terminalSignInArgs: Object.freeze([])
  })
]);

const PROVIDER_SPEC_BY_ID = new Map<RoleFitCliProviderId, ProviderSpec>(
  PROVIDER_SPECS.map((spec) => [spec.id, spec])
);

export type CliProbeRequest = Readonly<{
  command: ProviderSpec["command"];
  args: readonly string[];
  timeoutMs: number;
  outputLimitBytes: number;
  environment: Readonly<NodeJS.ProcessEnv>;
}>;

export type CliProbeResult = Readonly<{
  kind: "completed" | "not-found" | "failed";
  exitCode: number | null;
  stdout: string;
  stderr: string;
}>;

export type CliProbeRunner = (request: CliProbeRequest) => Promise<CliProbeResult>;

export type CliSignInRequest = Readonly<{
  command: ProviderSpec["command"];
  args: readonly string[];
  environment: Readonly<NodeJS.ProcessEnv>;
}>;

export type CliSignInProcess = Pick<
  ChildProcess,
  "kill" | "once" | "off"
>;

export type CliSignInSpawner = (request: CliSignInRequest) => CliSignInProcess;

export type CliTerminalSignInRequest = Readonly<{
  providerId: RoleFitCliProviderId;
  command: ProviderSpec["command"];
  args: readonly string[];
  environment: Readonly<NodeJS.ProcessEnv>;
}>;

export type CliTerminalLauncher = (
  request: CliTerminalSignInRequest
) => Promise<void>;

export type CliProviderManagerDependencies = Readonly<{
  runProbe?: CliProbeRunner;
  spawnSignIn?: CliSignInSpawner;
  launchTerminal?: CliTerminalLauncher;
  processPlatform?: NodeJS.Platform;
  terminalPlatform?: NodeJS.Platform;
  processEnvironment?: NodeJS.ProcessEnv;
  additionalSearchPaths?: readonly string[];
  createOperationId?: () => string;
  signInMaxDurationMs?: number;
  signInTerminateGraceMs?: number;
}>;

export type CliProviderManager = Readonly<{
  getStatuses(): Promise<readonly RoleFitCliProviderStatus[]>;
  beginSignIn(id: RoleFitCliProviderId): Promise<RoleFitCliSignInResult>;
  openSignInInTerminal(
    id: RoleFitCliProviderId
  ): Promise<RoleFitCliTerminalSignInResult>;
  cancelSignIn(operationId: string): Promise<boolean>;
  shutdown(): Promise<void>;
}>;

type ActiveSignIn = {
  operationId: string;
  providerId: RoleFitCliProviderId;
  child: CliSignInProcess;
  lifetimeTimer: NodeJS.Timeout | null;
  forceTimer: NodeJS.Timeout | null;
  settled: boolean;
  closed: Promise<void>;
  resolveClosed(): void;
  onExit: () => void;
  onError: () => void;
};

export function buildCliProcessEnvironment(
  source: NodeJS.ProcessEnv,
  additionalSearchPaths: readonly string[] = []
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (!CLI_CHILD_ENV_BLOCKLIST.has(key.toUpperCase()) && value !== undefined) {
      environment[key] = value;
    }
  }
  if (additionalSearchPaths.length > 0) {
    const pathKey = Object.keys(environment).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
    const existing = (environment[pathKey] ?? "").split(delimiter).filter(Boolean);
    const additions = additionalSearchPaths.filter((value) => isAbsolute(value) && !value.includes("\0"));
    environment[pathKey] = [...new Set([...additions, ...existing])].join(delimiter);
  }
  return environment;
}

export function packagedCliSearchPaths(
  platform: NodeJS.Platform,
  homeDirectory: string,
  environment: NodeJS.ProcessEnv
): readonly string[] {
  const platformPath = platform === "win32" ? win32 : posix;
  if (!platformPath.isAbsolute(homeDirectory)) {
    throw new Error("CLI home directory must be absolute.");
  }
  if (platform === "darwin") {
    return Object.freeze([
      "/opt/homebrew/bin",
      "/usr/local/bin",
      posix.join(homeDirectory, ".local", "bin"),
      posix.join(homeDirectory, ".npm-global", "bin"),
      posix.join(homeDirectory, ".volta", "bin"),
      posix.join(homeDirectory, ".asdf", "shims"),
      posix.join(homeDirectory, ".bun", "bin"),
      "/usr/bin",
      "/bin"
    ]);
  }
  if (platform === "win32") {
    const candidates = [
      win32.join(homeDirectory, ".local", "bin"),
      environment.APPDATA ? win32.join(environment.APPDATA, "npm") : null,
      environment.LOCALAPPDATA ? win32.join(environment.LOCALAPPDATA, "agy", "bin") : null,
      environment.LOCALAPPDATA
        ? win32.join(environment.LOCALAPPDATA, "Microsoft", "WinGet", "Links")
        : null
    ];
    return Object.freeze(candidates.filter((value): value is string => Boolean(value)));
  }
  if (platform === "linux") {
    return Object.freeze([
      posix.join(homeDirectory, ".local", "bin"),
      posix.join(homeDirectory, ".npm-global", "bin"),
      posix.join(homeDirectory, ".volta", "bin"),
      posix.join(homeDirectory, ".asdf", "shims"),
      posix.join(homeDirectory, ".bun", "bin"),
      "/usr/local/bin",
      "/usr/bin",
      "/bin"
    ]);
  }
  return Object.freeze([]);
}

function result(
  kind: CliProbeResult["kind"],
  exitCode: number | null,
  stdout = "",
  stderr = ""
): CliProbeResult {
  return Object.freeze({ kind, exitCode, stdout, stderr });
}

type CliProcessLaunch = Readonly<{
  executable: string;
  args: readonly string[];
}>;

type WindowsTreeKillLaunch = Readonly<{
  executable: string;
  args: readonly string[];
}>;

function environmentValue(
  environment: Readonly<NodeJS.ProcessEnv>,
  name: string
): string | undefined {
  const key = Object.keys(environment).find((candidate) => candidate.toUpperCase() === name);
  return key ? environment[key] : undefined;
}

export function resolveWindowsTreeKillLaunch(
  pid: number,
  environment: Readonly<NodeJS.ProcessEnv>
): WindowsTreeKillLaunch {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error("Invalid owned CLI process id.");
  return Object.freeze({
    executable: resolveWindowsSystemExecutable(environment, "taskkill.exe"),
    args: Object.freeze(["/pid", String(pid), "/t", "/f"])
  });
}

function resolveWindowsSystemExecutable(
  environment: Readonly<NodeJS.ProcessEnv>,
  fileName: "cmd.exe" | "taskkill.exe"
): string {
  const configuredRoot = environmentValue(environment, "SYSTEMROOT");
  const systemRoot = configuredRoot && win32.isAbsolute(configuredRoot) && !configuredRoot.includes("\0")
    ? configuredRoot
    : "C:\\Windows";
  return win32.join(systemRoot, "System32", fileName);
}

function terminateOwnedCliProcess(
  child: Pick<ChildProcess, "pid" | "kill">,
  platform: NodeJS.Platform,
  environment: Readonly<NodeJS.ProcessEnv>,
  signal: NodeJS.Signals = "SIGTERM"
): boolean {
  if (platform === "win32" && child.pid !== undefined) {
    const launch = resolveWindowsTreeKillLaunch(child.pid, environment);
    const outcome = spawnSync(launch.executable, [...launch.args], {
      stdio: "ignore",
      windowsHide: true,
      env: { ...environment },
      timeout: 5_000,
      killSignal: "SIGKILL"
    });
    if (!outcome.error && outcome.status === 0) return true;
  }
  return child.kill(signal);
}

export function resolveCliProcessLaunch(
  platform: NodeJS.Platform,
  command: ProviderSpec["command"],
  args: readonly string[],
  environment: Readonly<NodeJS.ProcessEnv> = process.env
): CliProcessLaunch {
  const tokens = [command, ...args];
  if (tokens.some((token) => !/^[A-Za-z0-9._-]+$/.test(token))) {
    throw new Error("Unsupported CLI process command.");
  }
  if (platform === "win32") {
    // npm-installed CLIs are .cmd shims on Windows. Node cannot execute those
    // directly without a shell, so use the fixed system command interpreter.
    // Every token is manager-owned and restricted above; no renderer text or
    // shell metacharacter can enter this command line.
    return Object.freeze({
      executable: resolveWindowsSystemExecutable(environment, "cmd.exe"),
      args: Object.freeze(["/d", "/s", "/c", tokens.join(" ")])
    });
  }
  return Object.freeze({ executable: command, args: Object.freeze([...args]) });
}

function runProbeWithSpawn(
  platform: NodeJS.Platform,
  request: CliProbeRequest
): Promise<CliProbeResult> {
  return new Promise((resolveProbe) => {
    let child: ChildProcess;
    try {
      const launch = resolveCliProcessLaunch(
        platform,
        request.command,
        request.args,
        request.environment
      );
      child = spawn(launch.executable, [...launch.args], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env: request.environment
      });
    } catch {
      resolveProbe(result("failed", null));
      return;
    }

    let stdout = "";
    let stderr = "";
    let totalBytes = 0;
    let settled = false;
    let timer: NodeJS.Timeout;

    const finish = (probeResult: CliProbeResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveProbe(probeResult);
    };
    const append = (stream: "stdout" | "stderr", chunk: Buffer): void => {
      if (settled) return;
      totalBytes += chunk.byteLength;
      if (totalBytes > request.outputLimitBytes) {
        terminateOwnedCliProcess(child, platform, request.environment);
        finish(result("failed", null));
        return;
      }
      if (stream === "stdout") stdout += chunk.toString("utf8");
      else stderr += chunk.toString("utf8");
    };

    timer = setTimeout(() => {
      terminateOwnedCliProcess(child, platform, request.environment);
      finish(result("failed", null));
    }, request.timeoutMs);
    timer.unref?.();

    child.stdout?.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr?.on("data", (chunk: Buffer) => append("stderr", chunk));
    child.once("error", (error: NodeJS.ErrnoException) => {
      finish(result(error.code === "ENOENT" ? "not-found" : "failed", null));
    });
    child.once("close", (code) => {
      finish(result("completed", code, stdout, stderr));
    });
  });
}

function spawnManagedSignIn(
  platform: NodeJS.Platform,
  request: CliSignInRequest
): CliSignInProcess {
  const launch = resolveCliProcessLaunch(
    platform,
    request.command,
    request.args,
    request.environment
  );
  const child = spawn(launch.executable, [...launch.args], {
    stdio: "ignore",
    windowsHide: true,
    env: request.environment
  });
  return {
    kill: (signal = "SIGTERM") => terminateOwnedCliProcess(
      child,
      platform,
      request.environment,
      typeof signal === "string" ? signal : "SIGTERM"
    ),
    once: child.once.bind(child) as CliSignInProcess["once"],
    off: child.off.bind(child) as CliSignInProcess["off"]
  };
}

type TerminalProcessRequest = Readonly<{
  executable: string;
  args: readonly string[];
  detached: boolean;
  waitForExit: boolean;
  environment: Readonly<NodeJS.ProcessEnv>;
}>;

function fixedTerminalCommand(request: CliTerminalSignInRequest): string {
  const tokens = [request.command, ...request.args];
  if (tokens.some((token) => !/^[A-Za-z0-9._-]+$/.test(token))) {
    throw new Error("Unsupported CLI terminal command.");
  }
  return tokens.join(" ");
}

function terminalProcessRequests(
  platform: NodeJS.Platform,
  request: CliTerminalSignInRequest
): readonly TerminalProcessRequest[] {
  const commandLine = fixedTerminalCommand(request);
  if (platform === "darwin") {
    if (request.providerId === "antigravity-cli") {
      return [Object.freeze({
        executable: "/usr/bin/open",
        args: Object.freeze(["-a", "Terminal"]),
        detached: false,
        waitForExit: true,
        environment: request.environment
      })];
    }
    const appleScript = [
      'tell application "Terminal"',
      "activate",
      `do script "${commandLine}"`,
      "end tell"
    ].join("\n");
    return [Object.freeze({
      executable: "/usr/bin/osascript",
      args: Object.freeze(["-e", appleScript]),
      detached: false,
      waitForExit: true,
      environment: request.environment
    })];
  }
  if (platform === "win32") {
    const commandInterpreter = resolveWindowsSystemExecutable(
      request.environment,
      "cmd.exe"
    );
    return [Object.freeze({
      executable: commandInterpreter,
      args: Object.freeze([
        "/d",
        "/s",
        "/c",
        "start",
        "",
        commandInterpreter,
        "/d",
        "/k",
        commandLine
      ]),
      detached: true,
      waitForExit: true,
      environment: request.environment
    })];
  }
  if (platform === "linux") {
    const shellCommand = `${commandLine}; exec bash`;
    return Object.freeze([
      Object.freeze({
        executable: "x-terminal-emulator",
        args: Object.freeze(["-e", "bash", "-lc", shellCommand]),
        detached: true,
        waitForExit: false,
        environment: request.environment
      }),
      Object.freeze({
        executable: "gnome-terminal",
        args: Object.freeze(["--", "bash", "-lc", shellCommand]),
        detached: true,
        waitForExit: false,
        environment: request.environment
      }),
      Object.freeze({
        executable: "konsole",
        args: Object.freeze(["-e", "bash", "-lc", shellCommand]),
        detached: true,
        waitForExit: false,
        environment: request.environment
      })
    ]);
  }
  return Object.freeze([]);
}

function spawnTerminalProcess(
  request: TerminalProcessRequest
): Promise<"opened" | "not-found"> {
  return new Promise((resolveLaunch, rejectLaunch) => {
    let child: ChildProcess;
    try {
      child = spawn(request.executable, [...request.args], {
        stdio: "ignore",
        windowsHide: false,
        detached: request.detached,
        env: request.environment
      });
    } catch {
      rejectLaunch(new Error("Terminal launch failed."));
      return;
    }

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      rejectLaunch(new Error("Terminal launch timed out."));
    }, TERMINAL_LAUNCH_TIMEOUT_MS);
    timer.unref?.();
    const finish = (outcome: "opened" | "not-found"): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveLaunch(outcome);
    };
    child.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") finish("not-found");
      else if (!settled) {
        settled = true;
        clearTimeout(timer);
        rejectLaunch(new Error("Terminal launch failed."));
      }
    });
    if (request.waitForExit) {
      child.once("close", (code) => {
        if (code === 0) finish("opened");
        else if (!settled) {
          settled = true;
          clearTimeout(timer);
          rejectLaunch(new Error("Terminal launch failed."));
        }
      });
    } else {
      child.once("spawn", () => {
        child.unref();
        finish("opened");
      });
    }
  });
}

async function launchInSystemTerminal(
  platform: NodeJS.Platform,
  request: CliTerminalSignInRequest
): Promise<void> {
  const candidates = terminalProcessRequests(platform, request);
  for (const candidate of candidates) {
    const outcome = await spawnTerminalProcess(candidate);
    if (outcome === "opened") return;
  }
  throw new Error("No supported terminal application is available.");
}

function isBoundedProbeResult(value: CliProbeResult): boolean {
  return Buffer.byteLength(value.stdout, "utf8") + Buffer.byteLength(value.stderr, "utf8") <=
    PROBE_OUTPUT_LIMIT_BYTES;
}

async function safeProbe(
  runner: CliProbeRunner,
  spec: ProviderSpec,
  args: readonly string[],
  environment: Readonly<NodeJS.ProcessEnv>
): Promise<CliProbeResult> {
  try {
    const probe = await runner(Object.freeze({
      command: spec.command,
      args,
      timeoutMs: PROBE_TIMEOUT_MS,
      outputLimitBytes: PROBE_OUTPUT_LIMIT_BYTES,
      environment
    }));
    return isBoundedProbeResult(probe) ? probe : result("failed", null);
  } catch {
    return result("failed", null);
  }
}

function parseClaudeAuth(probe: CliProbeResult): RoleFitCliAuthState {
  if (probe.kind !== "completed") return "unknown";
  try {
    const parsed: unknown = JSON.parse(probe.stdout);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "unknown";
    const loggedIn = (parsed as Record<string, unknown>).loggedIn;
    if (loggedIn === true) return "signed-in";
    if (loggedIn === false) return "signed-out";
  } catch {
    // A changed or non-JSON CLI contract is unknown, never optimistically signed in.
  }
  return "unknown";
}

function parseCodexAuth(probe: CliProbeResult): RoleFitCliAuthState {
  if (probe.kind !== "completed") return "unknown";
  const output = `${probe.stdout}\n${probe.stderr}`;
  if (/\bnot logged in\b/i.test(output)) return "signed-out";
  if (/\blogged in\b/i.test(output)) return "signed-in";
  return "unknown";
}

function authStateFor(id: RoleFitCliProviderId, probe: CliProbeResult): RoleFitCliAuthState {
  if (id === "claude-cli") return parseClaudeAuth(probe);
  if (id === "codex-cli") return parseCodexAuth(probe);
  return "unknown";
}

function guidanceFor(
  spec: ProviderSpec,
  installed: boolean,
  authState: RoleFitCliAuthState,
  signInRunning: boolean
): string {
  if (!installed) return `Install ${spec.label} to connect this provider.`;
  if (spec.id === "antigravity-cli") {
    return "Antigravity is installed. Its CLI does not expose a non-interactive sign-in check, so RoleFit verifies the session when first used.";
  }
  if (signInRunning) return `${spec.label} sign-in is open. Finish it in your browser.`;
  if (authState === "signed-in") return `${spec.label} is connected through its local CLI session.`;
  if (authState === "signed-out") return `Sign in to ${spec.label} to use this provider.`;
  return `${spec.label} is installed, but RoleFit could not confirm its sign-in status.`;
}

function signInResult(
  status: RoleFitCliSignInResult["status"],
  operationId: string | null,
  guidance: string
): RoleFitCliSignInResult {
  return Object.freeze({ status, operationId, guidance });
}

function safeOperationId(createId: () => string): string {
  const value = createId().trim();
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(value)) {
    throw new Error("Could not start CLI sign-in.");
  }
  return value;
}

export function createCliProviderManager(
  dependencies: CliProviderManagerDependencies = {}
): CliProviderManager {
  const childEnvironment = Object.freeze(
    buildCliProcessEnvironment(
      dependencies.processEnvironment ?? process.env,
      dependencies.additionalSearchPaths
    )
  );
  const processPlatform = dependencies.processPlatform ?? process.platform;
  const runProbe = dependencies.runProbe ?? ((request) =>
    runProbeWithSpawn(processPlatform, request));
  const spawnSignIn = dependencies.spawnSignIn ?? ((request) =>
    spawnManagedSignIn(processPlatform, request));
  const launchTerminal = dependencies.launchTerminal ?? ((request) =>
    launchInSystemTerminal(dependencies.terminalPlatform ?? processPlatform, request));
  const createOperationId = dependencies.createOperationId ?? randomUUID;
  const signInMaxDurationMs = dependencies.signInMaxDurationMs ?? SIGN_IN_MAX_DURATION_MS;
  const signInTerminateGraceMs = dependencies.signInTerminateGraceMs ?? SIGN_IN_TERMINATE_GRACE_MS;
  if (!Number.isInteger(signInMaxDurationMs) || signInMaxDurationMs < 1 || signInMaxDurationMs > SIGN_IN_MAX_DURATION_MS) {
    throw new Error("CLI sign-in maximum duration must be between 1ms and 10 minutes.");
  }
  if (!Number.isInteger(signInTerminateGraceMs) || signInTerminateGraceMs < 1 || signInTerminateGraceMs > SIGN_IN_TERMINATE_GRACE_MS) {
    throw new Error("CLI sign-in termination grace must be between 1ms and 2 seconds.");
  }
  let activeSignIn: ActiveSignIn | null = null;
  let shutDown = false;

  const requireActiveManager = (): void => {
    if (shutDown) throw new Error("CLI provider manager is shut down.");
  };

  const finishSignIn = (operation: ActiveSignIn): void => {
    if (operation.settled) return;
    operation.settled = true;
    if (operation.lifetimeTimer) clearTimeout(operation.lifetimeTimer);
    operation.lifetimeTimer = null;
    if (operation.forceTimer) clearTimeout(operation.forceTimer);
    operation.forceTimer = null;
    operation.child.off("exit", operation.onExit);
    operation.child.off("error", operation.onError);
    if (activeSignIn === operation) activeSignIn = null;
    operation.resolveClosed();
  };

  const requestSignInTermination = (operation: ActiveSignIn): void => {
    if (operation.settled || operation.forceTimer) return;
    operation.child.kill("SIGTERM");
    operation.forceTimer = setTimeout(() => {
      if (activeSignIn === operation && !operation.settled) {
        operation.child.kill("SIGKILL");
      }
    }, signInTerminateGraceMs);
    operation.forceTimer.unref?.();
  };

  const beginSignIn = async (id: RoleFitCliProviderId): Promise<RoleFitCliSignInResult> => {
    requireActiveManager();
    const spec = PROVIDER_SPEC_BY_ID.get(id);
    if (!spec) throw new Error("Unsupported CLI provider.");

    if (!spec.signInArgs) {
      return signInResult(
        "manual",
        null,
        "Open a terminal and run `agy` to complete or confirm Google sign-in."
      );
    }

    if (activeSignIn) {
      return signInResult(
        "already-running",
        activeSignIn.operationId,
        "A CLI sign-in is already running. Finish or cancel it before starting another."
      );
    }

    const operationId = safeOperationId(createOperationId);
    let child: CliSignInProcess;
    try {
      child = spawnSignIn(Object.freeze({
        command: spec.command,
        args: spec.signInArgs,
        environment: childEnvironment
      }));
    } catch {
      throw new Error("Could not start CLI sign-in.");
    }

    let resolveClosed = (): void => {};
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    const operation: ActiveSignIn = {
      operationId,
      providerId: id,
      child,
      lifetimeTimer: null,
      forceTimer: null,
      settled: false,
      closed,
      resolveClosed,
      onExit: () => {},
      onError: () => {}
    };
    operation.onExit = () => finishSignIn(operation);
    operation.onError = () => finishSignIn(operation);
    activeSignIn = operation;
    child.once("exit", operation.onExit);
    child.once("error", operation.onError);
    operation.lifetimeTimer = setTimeout(() => {
      requestSignInTermination(operation);
    }, signInMaxDurationMs);
    operation.lifetimeTimer.unref?.();

    return signInResult(
      "started",
      operationId,
      `${spec.label} sign-in opened. Finish it in your browser.`
    );
  };

  const openSignInInTerminal = async (
    id: RoleFitCliProviderId
  ): Promise<RoleFitCliTerminalSignInResult> => {
    requireActiveManager();
    const spec = PROVIDER_SPEC_BY_ID.get(id);
    if (!spec) throw new Error("Unsupported CLI provider.");
    try {
      await launchTerminal(Object.freeze({
        providerId: spec.id,
        command: spec.command,
        args: spec.terminalSignInArgs,
        environment: childEnvironment
      }));
    } catch {
      throw new Error(`Could not open ${spec.label} sign-in in a terminal.`);
    }
    return Object.freeze({
      status: "opened",
      guidance: spec.id === "antigravity-cli"
        ? "Terminal opened. Run `agy` to complete or confirm Google sign-in, then check again."
        : `${spec.label} sign-in opened in a terminal. Finish it there, then check again.`
    });
  };

  const cancelSignIn = async (operationId: string): Promise<boolean> => {
    const operation = activeSignIn;
    if (!operation || operation.operationId !== operationId) return false;
    requestSignInTermination(operation);
    return true;
  };

  const getStatuses = async (): Promise<readonly RoleFitCliProviderStatus[]> => {
    requireActiveManager();
    const statuses = await Promise.all(PROVIDER_SPECS.map(async (spec) => {
      const versionProbe = await safeProbe(
        runProbe,
        spec,
        spec.versionArgs,
        childEnvironment
      );
      const installed = versionProbe.kind === "completed";
      let authState: RoleFitCliAuthState = "unknown";
      if (installed && spec.statusArgs) {
        authState = authStateFor(
          spec.id,
          await safeProbe(runProbe, spec, spec.statusArgs, childEnvironment)
        );
      }
      const signInRunning = activeSignIn?.providerId === spec.id;
      return Object.freeze({
        id: spec.id,
        label: spec.label,
        installed,
        authState,
        signInFlow: spec.signInArgs ? "managed" as const : "manual" as const,
        signInRunning,
        guidance: guidanceFor(spec, installed, authState, signInRunning)
      });
    }));
    return Object.freeze(statuses);
  };

  const shutdown = async (): Promise<void> => {
    if (shutDown) return;
    shutDown = true;
    const operation = activeSignIn;
    if (!operation) return;
    await cancelSignIn(operation.operationId);
    await Promise.race([
      operation.closed,
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, SIGN_IN_SHUTDOWN_LIMIT_MS);
        timer.unref?.();
      })
    ]);
    if (activeSignIn === operation && !operation.settled) {
      operation.child.kill("SIGKILL");
      finishSignIn(operation);
    }
  };

  return Object.freeze({
    getStatuses,
    beginSignIn,
    openSignInInTerminal,
    cancelSignIn,
    shutdown
  });
}
