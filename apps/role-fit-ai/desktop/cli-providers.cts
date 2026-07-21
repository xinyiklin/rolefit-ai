import { spawn, spawnSync } from "node:child_process";
import { isAbsolute, posix, win32 } from "node:path";
import type { ChildProcess } from "node:child_process";
import type {
  RoleFitCliAuthState,
  RoleFitCliProviderId,
  RoleFitCliProviderStatus,
  RoleFitCliTerminalSignInResult
} from "./ipc-contract.cjs";

const PROBE_TIMEOUT_MS = 5_000;
const PROBE_OUTPUT_LIMIT_BYTES = 16 * 1_024;
const TERMINAL_LAUNCH_TIMEOUT_MS = 15_000;
const PROBE_TERMINATE_GRACE_MS = 2_000;

// Account-backed provider CLIs need executable discovery, their provider-owned
// config/session locations, ordinary locale/temp state, and explicit network
// trust configuration. Copy only that closed set: a denylist would inevitably
// forward unrelated cloud, package-registry, database, or application secrets.
const CLI_CHILD_ALLOWED_ENV_KEYS = new Set([
  "PATH",
  "HOME",
  "USERPROFILE",
  "USER",
  "LOGNAME",
  "SHELL",
  "HOMEDRIVE",
  "HOMEPATH",
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
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR"
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
  launchTerminal?: CliTerminalLauncher;
  processPlatform?: NodeJS.Platform;
  terminalPlatform?: NodeJS.Platform;
  processEnvironment?: NodeJS.ProcessEnv;
  additionalSearchPaths?: readonly string[];
}>;

export type CliProviderManager = Readonly<{
  getStatuses(): Promise<readonly RoleFitCliProviderStatus[]>;
  openSignInInTerminal(
    id: RoleFitCliProviderId
  ): Promise<RoleFitCliTerminalSignInResult>;
  shutdown(): Promise<void>;
}>;

export function buildCliProcessEnvironment(
  source: NodeJS.ProcessEnv,
  additionalSearchPaths: readonly string[] = [],
  platform: NodeJS.Platform = process.platform
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  if (platform === "win32") {
    const sourceByName = new Map(
      Object.entries(source).map(([key, value]) => [key.toUpperCase(), value] as const)
    );
    for (const allowedKey of CLI_CHILD_ALLOWED_ENV_KEYS) {
      const key = allowedKey.toUpperCase();
      const value = sourceByName.get(key);
      if (!(key in environment) && value !== undefined) environment[key] = value;
    }
  } else {
    for (const [key, value] of Object.entries(source)) {
      if (CLI_CHILD_ALLOWED_ENV_KEYS.has(key) && value !== undefined) {
        environment[key] = value;
      }
    }
  }
  if (additionalSearchPaths.length > 0) {
    const pathKey = Object.keys(environment).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
    const pathDelimiter = platform === "win32" ? ";" : ":";
    const existing = (environment[pathKey] ?? "").split(pathDelimiter).filter(Boolean);
    const additions = additionalSearchPaths.filter((value) => isAbsolute(value) && !value.includes("\0"));
    environment[pathKey] = [...new Set([...additions, ...existing])].join(pathDelimiter);
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

/**
 * Stop a bounded status probe without forgetting a process that ignores
 * SIGTERM. Windows taskkill already terminates the owned tree forcibly; Unix
 * probes receive a short graceful window followed by SIGKILL. The close/error
 * listeners cancel the force timer when the process exits normally.
 */
export function terminateCliProbeWithGrace(
  child: Pick<ChildProcess, "pid" | "kill" | "once" | "off">,
  platform: NodeJS.Platform,
  environment: Readonly<NodeJS.ProcessEnv>,
  graceMs = PROBE_TERMINATE_GRACE_MS
): void {
  if (!Number.isInteger(graceMs) || graceMs < 1 || graceMs > PROBE_TERMINATE_GRACE_MS) {
    throw new Error("CLI probe termination grace must be between 1ms and 2 seconds.");
  }
  if (platform === "win32") {
    try {
      terminateOwnedCliProcess(child, platform, environment, "SIGKILL");
    } catch {
      // The probe is already settling as failed. Never let cleanup throw into an
      // output/timer callback; Windows taskkill or ChildProcess emitted failure.
    }
    return;
  }

  let settled = false;
  let forceTimer: NodeJS.Timeout | null = null;
  const finish = (): void => {
    if (settled) return;
    settled = true;
    if (forceTimer) clearTimeout(forceTimer);
    forceTimer = null;
    child.off("close", finish);
    child.off("error", finish);
  };
  child.once("close", finish);
  child.once("error", finish);
  try {
    terminateOwnedCliProcess(child, platform, environment, "SIGTERM");
  } catch {
    finish();
    return;
  }
  if (settled) return;
  forceTimer = setTimeout(() => {
    if (settled) return;
    finish();
    try {
      terminateOwnedCliProcess(child, platform, environment, "SIGKILL");
    } catch {
      // Best-effort final cleanup; the bounded probe result is already failed.
    }
  }, graceMs);
  forceTimer.unref?.();
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
        terminateCliProbeWithGrace(child, platform, request.environment);
        finish(result("failed", null));
        return;
      }
      if (stream === "stdout") stdout += chunk.toString("utf8");
      else stderr += chunk.toString("utf8");
    };

    timer = setTimeout(() => {
      terminateCliProbeWithGrace(child, platform, request.environment);
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
  authState: RoleFitCliAuthState
): string {
  if (!installed) return `Install ${spec.label} to connect this provider.`;
  if (spec.id === "antigravity-cli") {
    return "Antigravity is installed. Its CLI does not expose a non-interactive sign-in check, so RoleFit verifies the session when first used.";
  }
  if (authState === "signed-in") return `${spec.label} is connected through its local CLI session.`;
  if (authState === "signed-out") return `Sign in to ${spec.label} to use this provider.`;
  return `${spec.label} is installed, but RoleFit could not confirm its sign-in status.`;
}

export function createCliProviderManager(
  dependencies: CliProviderManagerDependencies = {}
): CliProviderManager {
  const processPlatform = dependencies.processPlatform ?? process.platform;
  const childEnvironment = Object.freeze(
    buildCliProcessEnvironment(
      dependencies.processEnvironment ?? process.env,
      dependencies.additionalSearchPaths,
      processPlatform
    )
  );
  const runProbe = dependencies.runProbe ?? ((request) =>
    runProbeWithSpawn(processPlatform, request));
  const launchTerminal = dependencies.launchTerminal ?? ((request) =>
    launchInSystemTerminal(dependencies.terminalPlatform ?? processPlatform, request));
  let shutDown = false;

  const requireActiveManager = (): void => {
    if (shutDown) throw new Error("CLI provider manager is shut down.");
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
      return Object.freeze({
        id: spec.id,
        label: spec.label,
        installed,
        authState,
        signInFlow: spec.signInArgs ? "managed" as const : "manual" as const,
        guidance: guidanceFor(spec, installed, authState)
      });
    }));
    return Object.freeze(statuses);
  };

  const shutdown = async (): Promise<void> => {
    shutDown = true;
  };

  return Object.freeze({
    getStatuses,
    openSignInInTerminal,
    shutdown
  });
}
