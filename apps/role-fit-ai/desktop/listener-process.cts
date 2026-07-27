import { execFile } from "node:child_process";
import { win32 } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const LOOKUP_TIMEOUT_MS = 2_000;
const LOOKUP_MAX_BUFFER_BYTES = 64 * 1_024;

export type ListenerLookupCommand = (
  executable: string,
  args: readonly string[]
) => Promise<string>;

export type ListenerLookupOptions = Readonly<{
  platform?: NodeJS.Platform;
  runCommand?: ListenerLookupCommand;
}>;

function validatePort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new RangeError("Listener port must be an integer from 1 through 65535.");
  }
}

function onePid(values: Iterable<number>): number | null {
  const pids = new Set(values);
  return pids.size === 1 ? [...pids][0] ?? null : null;
}

export function parseLsofListenerPid(stdout: string): number | null {
  return onePid(
    stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => /^\d+$/u.test(line))
      .map(Number)
      .filter((pid) => Number.isSafeInteger(pid) && pid > 0)
  );
}

export function parseNetstatListenerPid(stdout: string, port: number): number | null {
  validatePort(port);
  const pids: number[] = [];
  for (const line of stdout.split(/\r?\n/u)) {
    const columns = line.trim().split(/\s+/u);
    if (columns.length < 5 || columns[0]?.toUpperCase() !== "TCP") continue;
    const localAddress = columns[1] ?? "";
    const localPort = Number(localAddress.match(/:(\d+)$/u)?.[1]);
    const state = columns.at(-2)?.toUpperCase();
    const pid = Number(columns.at(-1));
    if (
      localPort === port &&
      state === "LISTENING" &&
      Number.isSafeInteger(pid) &&
      pid > 0
    ) {
      pids.push(pid);
    }
  }
  return onePid(pids);
}

async function runLookupCommand(
  executable: string,
  args: readonly string[]
): Promise<string> {
  const { stdout } = await execFileAsync(executable, [...args], {
    encoding: "utf8",
    maxBuffer: LOOKUP_MAX_BUFFER_BYTES,
    timeout: LOOKUP_TIMEOUT_MS,
    windowsHide: true
  });
  return stdout;
}

export async function findLoopbackListenerPid(
  port: number,
  options: ListenerLookupOptions = {}
): Promise<number | null> {
  validatePort(port);
  const platform = options.platform ?? process.platform;
  const runCommand = options.runCommand ?? runLookupCommand;
  try {
    if (platform === "darwin" || platform === "linux") {
      const stdout = await runCommand(platform === "darwin" ? "/usr/sbin/lsof" : "/usr/bin/lsof", [
        "-nP",
        `-iTCP@127.0.0.1:${port}`,
        "-sTCP:LISTEN",
        "-t"
      ]);
      return parseLsofListenerPid(stdout);
    }
    if (platform === "win32") {
      const configuredRoot = process.env.SYSTEMROOT;
      const systemRoot = configuredRoot && win32.isAbsolute(configuredRoot) &&
          !configuredRoot.includes("\0")
        ? configuredRoot
        : "C:\\Windows";
      return parseNetstatListenerPid(
        await runCommand(
          win32.join(systemRoot, "System32", "netstat.exe"),
          ["-ano", "-p", "tcp"]
        ),
        port
      );
    }
  } catch {
    return null;
  }
  return null;
}
