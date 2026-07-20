// Subscription-CLI providers. Lets the polish route use Claude Max (via
// Claude Code), ChatGPT/Codex Plus (via Codex CLI), or Google Gemini (via the
// Antigravity CLI `agy`, which replaced the retired Gemini CLI) without burning
// paid API tokens. Each helper spawns the local CLI binary and returns the model
// response as a string (the polish route then parses it as JSON).

import { spawnSync } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import crossSpawn from "cross-spawn";

import {
  CLAUDE_CLI_AUTH_MESSAGE,
  CLAUDE_CLI_FAILED_MESSAGE,
  CLAUDE_CLI_TIMEOUT_MESSAGE,
  UserSafeAiError
} from "../ai/errors.ts";
import { RequestAbortedError } from "../http.ts";

type RunCliOptions = { timeoutMs?: number; cwd?: string; signal?: AbortSignal };
type RunCliResult = { stdout: string; stderr: string };
// runCli rejects with a plain Error carrying captured streams / classification
// flags so callers (classifyClaudeFailure) can inspect them.
type CliError = Error & {
  timedOut?: boolean;
  code?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
};
// The resolved provider config passed to each CLI helper (subset of the shared
// dispatch args; the CLIs use their own subscription auth, no apiKey).
type CliArgs = {
  model?: string;
  reasoningEffort?: string | null;
  systemPrompt?: string;
  userPrompt?: string;
  signal?: AbortSignal;
};

// Subscription CLIs should never be able to exhaust the local server by writing
// an unbounded transcript or diagnostic stream. Normal structured replies are a
// few KB; this leaves ample headroom while bounding both captured streams.
const MAX_CLI_STREAM_BYTES = 2_000_000;

// RoleFit's CLI providers authenticate through their provider-owned account
// stores. Node/Electron launch controls, native API keys, and alternate token
// channels must not hitchhike into a Claude/Codex/Antigravity subprocess. Keep
// PATH, HOME, and vendor config/session *locations* intact so the installed CLIs
// can still find their account-backed sessions.
const AI_CLI_CHILD_BLOCKED_ENV_KEYS = new Set([
  // These can preload arbitrary code, alter module resolution, or change how an
  // Electron-backed executable starts. Keep this fixed list aligned with the
  // desktop CLI subprocess boundary.
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
  // This is a service-account credential pointer, not Antigravity's local
  // provider-owned session location. Do not let it silently switch auth modes.
  "GOOGLE_APPLICATION_CREDENTIALS"
]);

export function buildAiCliProcessEnvironment(
  source: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (!AI_CLI_CHILD_BLOCKED_ENV_KEYS.has(key.toUpperCase()) && value !== undefined) {
      environment[key] = value;
    }
  }
  return environment;
}

function environmentValue(
  environment: Readonly<NodeJS.ProcessEnv>,
  name: string
): string | undefined {
  const key = Object.keys(environment).find((candidate) => candidate.toUpperCase() === name);
  return key ? environment[key] : undefined;
}

export function resolveWindowsCliTreeKill(
  pid: number,
  environment: Readonly<NodeJS.ProcessEnv>
): Readonly<{ executable: string; args: readonly string[] }> {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error("Invalid owned AI CLI process id.");
  const configuredRoot = environmentValue(environment, "SYSTEMROOT");
  const systemRoot = configuredRoot && win32.isAbsolute(configuredRoot) && !configuredRoot.includes("\0")
    ? configuredRoot
    : "C:\\Windows";
  return Object.freeze({
    executable: win32.join(systemRoot, "System32", "taskkill.exe"),
    args: Object.freeze(["/pid", String(pid), "/t", "/f"])
  });
}

function terminateChild(
  child: ChildProcessWithoutNullStreams,
  environment: Readonly<NodeJS.ProcessEnv>
): void {
  if (process.platform === "win32" && child.pid !== undefined) {
    const launch = resolveWindowsCliTreeKill(child.pid, environment);
    const outcome = spawnSync(launch.executable, [...launch.args], {
      stdio: "ignore",
      windowsHide: true,
      env: { ...environment },
      timeout: 5_000,
      killSignal: "SIGKILL"
    });
    if (!outcome.error && outcome.status === 0) return;
  }
  child.kill("SIGTERM");
  setTimeout(() => child.kill("SIGKILL"), 2_000).unref?.();
}

async function readBoundedFile(path: string): Promise<string> {
  const info = await stat(path).catch(() => null);
  if (!info) return "";
  if (info.size > MAX_CLI_STREAM_BYTES) {
    throw new Error("Codex returned too much output. Try again or choose another provider.");
  }
  return readFile(path, "utf8");
}

export function runCli(
  command: string,
  args: string[],
  stdinPayload?: string,
  { timeoutMs = 240_000, cwd, signal }: RunCliOptions = {}
): Promise<RunCliResult> {
  if (signal?.aborted) return Promise.reject(new RequestAbortedError());
  return new Promise<RunCliResult>((resolve, reject) => {
    const childEnvironment = buildAiCliProcessEnvironment(process.env);
    // stdio ["pipe","pipe","pipe"] guarantees non-null stdin/stdout/stderr at runtime.
    // cross-spawn preserves argv-array semantics on native binaries and safely
    // resolves/escapes npm .cmd shims on Windows. Never replace it with a joined
    // shell string: args can contain paths, model labels, and private prompts.
    const child = crossSpawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd,
      env: childEnvironment
    }) as ChildProcessWithoutNullStreams;
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let timer: NodeJS.Timeout;
    const cleanup = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const rejectOnce = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = (): void => {
      terminateChild(child, childEnvironment);
      rejectOnce(new RequestAbortedError());
    };
    const appendBounded = (stream: "stdout" | "stderr", chunk: Buffer): void => {
      if (settled) return;
      const bytes = chunk.length;
      if (stream === "stdout") stdoutBytes += bytes;
      else stderrBytes += bytes;
      if ((stream === "stdout" ? stdoutBytes : stderrBytes) > MAX_CLI_STREAM_BYTES) {
        terminateChild(child, childEnvironment);
        rejectOnce(new Error(`${command} returned too much output. Try again or choose another provider.`));
        return;
      }
      if (stream === "stdout") stdout += chunk.toString();
      else stderr += chunk.toString();
    };
    timer = setTimeout(() => {
      terminateChild(child, childEnvironment);
      const error = new Error(`${command} timed out after ${Math.round(timeoutMs / 1000)}s. Try again or switch to a faster model.`) as CliError;
      error.timedOut = true;
      error.stdout = stdout;
      error.stderr = stderr;
      rejectOnce(error);
    }, timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => appendBounded("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => appendBounded("stderr", chunk));
    child.on("error", (err) => {
      if ((err as CliError).code === "ENOENT") {
        rejectOnce(new Error(`${command} is not installed or not on PATH.`));
      } else {
        rejectOnce(new Error(`${command} could not be started. Check the CLI installation and try again.`));
      }
    });
    child.on("close", (code) => {
      if (settled) return;
      if (code === 0) {
        settled = true;
        cleanup();
        resolve({ stdout, stderr });
      } else {
        // Never put raw CLI stderr into the Error message: route-level logging
        // records that message, and a CLI diagnostic may echo sensitive prompt
        // text. Claude classification still receives bounded stdout privately.
        const error = new Error(`${command} exited with code ${code}. Check CLI authentication and model access, then try again.`) as CliError;
        // Attach the captured streams so callers can classify the failure — e.g.
        // claude writes its JSON result (incl. auth/401 errors) to stdout even on
        // a non-zero exit, which would otherwise be lost.
        error.stdout = stdout;
        error.stderr = stderr;
        error.exitCode = code;
        rejectOnce(error);
      }
    });
    // Swallow EPIPE if the child exits before draining stdin — the real failure is
    // already surfaced by the 'error'/'close' handlers above. Without this handler
    // the unhandled stream error would crash the whole server process.
    child.stdin.on("error", () => {});
    if (stdinPayload) child.stdin.write(stdinPayload);
    child.stdin.end();
  });
}

// ----- Claude Code (claude --print) -----

export function buildClaudeCliArgs({ model, reasoningEffort, systemPrompt }: CliArgs): string[] {
  const args = [
    "-p", "--tools", "", "--no-session-persistence",
    "--setting-sources", "", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
    "--disable-slash-commands", "--no-chrome", "--output-format", "json"
  ];
  if (systemPrompt) args.push("--append-system-prompt", systemPrompt);
  if (model && model !== "default") args.push("--model", model);
  args.push("--effort", reasoningEffort || "low");
  return args;
}

export async function callClaudeCli({ model, reasoningEffort, systemPrompt, userPrompt, signal }: CliArgs): Promise<string> {
  // Default to LOW reasoning effort. With no --effort flag the CLI runs at its
  // session default (high), which spends ~17K thinking tokens on a structured
  // resume rewrite and pushes a single call past 5 minutes. Polish is a bounded
  // rewrite/audit, not open-ended reasoning — low effort cuts each call to ~70s
  // with no loss in suggestion quality. An explicit reasoningEffort still wins.
  const args = buildClaudeCliArgs({ model, reasoningEffort, systemPrompt });

  const workdir = await mkdtemp(join(tmpdir(), "rolefit-claude-"));
  let stdout;
  try {
    ({ stdout } = await runCli("claude", args, userPrompt, { cwd: workdir, signal }));
  } catch (error) {
    // Keep the actionable "not installed" hint (it's in the SAFE set). claude
    // also writes its JSON result — including auth/401 errors — to stdout even on
    // a non-zero exit (attached to the error by runCli), so classify from that.
    // Pass the error too so a timeout (no CLI stdout) maps to its own hint
    // instead of the generic auth-flavored failure message.
    const err = error as CliError;
    if (err?.name === "AbortError") throw error;
    if (/is not installed or not on PATH/.test(err?.message ?? "")) throw error;
    throw classifyClaudeFailure(typeof err?.stdout === "string" ? err.stdout : "", err);
  } finally {
    await rm(workdir, { recursive: true, force: true }).catch(() => {});
  }

  let envelope;
  try {
    envelope = JSON.parse(stdout);
  } catch (parseError) {
    throw new Error("Claude Code returned output the app could not read. Try again or choose another provider.");
  }

  if (envelope.is_error) throw classifyClaudeFailure(stdout);

  return String(envelope.result ?? "");
}

// Map a claude CLI failure to an actionable, SAFE message: a 401 / auth failure
// points at sign-in; a timeout (no CLI stdout to classify) points at a faster
// model; anything else is the generic "couldn't complete" hint. All three are in
// errors.ts' SAFE set so /api/polish surfaces them verbatim instead of "did not
// return a usable draft". `stdout` is claude's JSON result (present on a non-zero
// exit); `sourceError` is the rejected runCli error (carries the timeout flag).
export function classifyClaudeFailure(stdout: string, sourceError?: CliError): Error {
  let message = "";
  let authStatus = 0;
  try {
    const envelope = JSON.parse(stdout) as Record<string, unknown>;
    message = String(envelope.result ?? envelope.error ?? "");
    authStatus = Number(envelope.api_error_status) || 0;
  } catch {
    // stdout wasn't JSON (e.g. an empty/garbled non-zero exit).
  }
  // Stderr remains private and is only inspected for the same narrow auth
  // category as Claude's JSON envelope. Never return or log it.
  const diagnostic = `${message}\n${sourceError?.stderr ?? ""}`;
  if (
    authStatus === 401 ||
    /not logged in|please run \/login|invalid authentication|failed to authenticate|unauthorized|\b401\b/i.test(diagnostic)
  ) {
    return new UserSafeAiError(CLAUDE_CLI_AUTH_MESSAGE, 401);
  }
  // No CLI-reported error to classify and the call timed out → the actionable
  // cause is the timeout, not a generic CLI error.
  if (!message && (sourceError?.timedOut || /timed out/i.test(sourceError?.message ?? ""))) {
    return new UserSafeAiError(CLAUDE_CLI_TIMEOUT_MESSAGE, 504);
  }
  return new UserSafeAiError(CLAUDE_CLI_FAILED_MESSAGE, 500);
}

// ----- Codex CLI (codex exec) -----

export function buildCodexCliArgs({ model, reasoningEffort }: CliArgs, workdir: string, outputPath: string): string[] {
  const args = [
    "exec",
    "--skip-git-repo-check",
    "--sandbox", "read-only",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "-C", workdir,
    "--output-last-message", outputPath
  ];
  if (model && model !== "default") args.push("--model", model);
  if (reasoningEffort) args.push("-c", `model_reasoning_effort="${reasoningEffort}"`);
  return args;
}

export async function callCodexCli({ model, reasoningEffort, systemPrompt, userPrompt, signal }: CliArgs): Promise<string> {
  const combined = systemPrompt
    ? `${systemPrompt}\n\n---\n\n${userPrompt}`
    : userPrompt;

  const workdir = await mkdtemp(join(tmpdir(), "rolefit-codex-"));
  const outputPath = join(workdir, "last-message.txt");
  const args = buildCodexCliArgs({ model, reasoningEffort }, workdir, outputPath);

  try {
    const { stdout } = await runCli("codex", args, combined, { cwd: workdir, signal });
    const directOutput = await readBoundedFile(outputPath);
    return directOutput.trim() || extractCodexFinalOutput(stdout);
  } finally {
    await rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}

// ----- Antigravity CLI (agy — Google's Gemini CLI successor, non-interactive) -----

export function buildAntigravityCliArgs({ model, userPrompt }: CliArgs): string[] {
  // PRIVACY TRADE-OFF (documented — agy 1.1.x offers no fix): the print prompt —
  // here the COMBINED system prompt + resume + job description, i.e. private
  // personal data — is passed as the VALUE of -p, so it lands in this process's
  // argv and is readable by any local user who lists processes (e.g. `ps -eww`).
  // The Claude and Codex helpers instead pipe the prompt on stdin, keeping it out
  // of argv; agy cannot. Verified against `agy --help` (v1.1.4): --print / -p /
  // --prompt all take the prompt as their value, and there is NO documented stdin
  // read, `-` sentinel, or prompt-file flag to route it through — `-p ""` exits
  // non-zero without dispatching. Spawn still uses an argv array (never a shell),
  // so the prompt text cannot be interpreted as flags or commands, but it is not
  // hidden from a process listing. Do not "fix" this by moving the prompt to
  // stdin without re-verifying a future agy build actually reads it there.
  const args = ["-p", userPrompt ?? "", "--print-timeout", "230s"];
  if (model && model !== "default") args.push("--model", model);
  // --sandbox supplies the terminal restrictions that the throwaway cwd alone
  // cannot provide. Permission auto-approval remains necessary in print mode.
  args.push("--sandbox", "--dangerously-skip-permissions");
  return args;
}

export async function callAntigravityCli({ model, systemPrompt, userPrompt, signal }: CliArgs): Promise<string> {
  // agy has no separate system-prompt flag, so combine like Codex/Gemini.
  const combined = systemPrompt ? `${systemPrompt}\n\n---\n\n${userPrompt}` : userPrompt;

  // agy 1.1.x has no non-argv prompt path (see buildAntigravityCliArgs for the
  // `agy --help` verification): the combined prompt is passed as -p's value and
  // therefore appears in the local process command line while agy runs — a weaker
  // boundary than the stdin delivery the Claude/Codex CLIs use, exposing private
  // resume/job text to a local `ps` listing. RoleFit documents this limitation
  // rather than claiming the Antigravity path has the stronger stdin privacy
  // boundary. The argv-array spawn, --sandbox, throwaway cwd, and runCli timeout
  // below are the mitigations that remain available.
  // --model: model id. agy has NO `-m` short alias (it errors "flags provided
  //   but not defined: -m"); the ids are the exact display names from `agy
  //   models`, e.g. "Gemini 3.5 Flash (High)" (spaces + parens — passed as one
  //   argv element, so no shell parsing). --dangerously-skip-permissions: a
  //   non-interactive spawn otherwise blocks on a tool-approval prompt that never
  //   renders (agy is an agentic harness). The CLI also receives --sandbox and a
  //   throwaway cwd to reduce access; this is defense in depth, not a claim of
  //   absolute OS isolation. The runCli timeout still bounds any hang.
  const args = buildAntigravityCliArgs({ model, userPrompt: combined });

  // Throwaway working dir keeps project instruction files out of automatic
  // discovery. Together with --sandbox it reduces filesystem exposure, but it
  // is not an OS-level guarantee against absolute reads or network access.
  // UX/color warnings go to stderr, so stdout stays clean.
  const workdir = await mkdtemp(join(tmpdir(), "rolefit-antigravity-"));
  try {
    const { stdout } = await runCli("agy", args, undefined, { cwd: workdir, signal });
    return stdout.trim();
  } catch (error) {
    // Keep the actionable "not installed" hint (it's in the SAFE set); turn any
    // other non-zero exit — most often an unauthenticated CLI or an inaccessible
    // model — into a specific, actionable hint instead of a generic 500.
    const message = error instanceof Error ? error.message : "";
    if ((error as CliError)?.name === "AbortError" || (error as CliError)?.timedOut) throw error;
    if (/is not installed or not on PATH/.test(message)) throw error;
    throw new Error(
      "Antigravity CLI could not complete the request. Run `agy` and complete Google sign-in, confirm the selected model is available, then try again."
    );
  } finally {
    await rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}

// Codex exec writes a structured transcript: preamble → "user" → prompt →
// "codex" → response → "tokens used" → count → final response. Strategy:
// prefer the trailing block after "tokens used N", else fall back to the
// block after the last "codex" marker.
function extractCodexFinalOutput(stdout: string): string {
  const tokensIdx = stdout.lastIndexOf("tokens used");
  if (tokensIdx >= 0) {
    const tail = stdout.slice(tokensIdx).split("\n");
    // Skip the "tokens used" header + numeric line.
    const result = tail.slice(2).join("\n").trim();
    if (result) return result;
  }
  const codexMarker = "\ncodex\n";
  const codexIdx = stdout.lastIndexOf(codexMarker);
  if (codexIdx >= 0) {
    return stdout.slice(codexIdx + codexMarker.length).trim();
  }
  return stdout.trim();
}
