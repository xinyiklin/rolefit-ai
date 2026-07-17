// Subscription-CLI providers. Lets the polish route use Claude Max (via
// Claude Code), ChatGPT/Codex Plus (via Codex CLI), or Google Gemini (via the
// Antigravity CLI `agy`, which replaced the retired Gemini CLI) without burning
// paid API tokens. Each helper spawns the local CLI binary and returns the model
// response as a string (the polish route then parses it as JSON).

import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CLAUDE_CLI_AUTH_MESSAGE, CLAUDE_CLI_FAILED_MESSAGE, CLAUDE_CLI_TIMEOUT_MESSAGE } from "../ai/errors.ts";

type RunCliOptions = { timeoutMs?: number; cwd?: string };
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
};

// Subscription CLIs should never be able to exhaust the local server by writing
// an unbounded transcript or diagnostic stream. Normal structured replies are a
// few KB; this leaves ample headroom while bounding both captured streams.
const MAX_CLI_STREAM_BYTES = 2_000_000;

function terminateChild(child: ChildProcessWithoutNullStreams): void {
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

function runCli(
  command: string,
  args: string[],
  stdinPayload?: string,
  { timeoutMs = 240_000, cwd }: RunCliOptions = {}
): Promise<RunCliResult> {
  return new Promise<RunCliResult>((resolve, reject) => {
    // stdio ["pipe","pipe","pipe"] guarantees non-null stdin/stdout/stderr at runtime.
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], cwd }) as ChildProcessWithoutNullStreams;
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const rejectOnce = (error: Error): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const appendBounded = (stream: "stdout" | "stderr", chunk: Buffer): void => {
      if (settled) return;
      const bytes = chunk.length;
      if (stream === "stdout") stdoutBytes += bytes;
      else stderrBytes += bytes;
      if ((stream === "stdout" ? stdoutBytes : stderrBytes) > MAX_CLI_STREAM_BYTES) {
        terminateChild(child);
        rejectOnce(new Error(`${command} returned too much output. Try again or choose another provider.`));
        return;
      }
      if (stream === "stdout") stdout += chunk.toString();
      else stderr += chunk.toString();
    };
    const timer = setTimeout(() => {
      terminateChild(child);
      const error = new Error(`${command} timed out after ${Math.round(timeoutMs / 1000)}s. Try again or switch to a faster model.`) as CliError;
      error.timedOut = true;
      rejectOnce(error);
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => appendBounded("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => appendBounded("stderr", chunk));
    child.on("error", (err) => {
      clearTimeout(timer);
      if ((err as CliError).code === "ENOENT") {
        rejectOnce(new Error(`${command} is not installed or not on PATH.`));
      } else {
        rejectOnce(new Error(`${command} could not be started. Check the CLI installation and try again.`));
      }
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      if (code === 0) {
        settled = true;
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
    "--setting-sources", "", "--strict-mcp-config", "--mcp-config", "{}",
    "--disable-slash-commands", "--no-chrome", "--output-format", "json"
  ];
  if (systemPrompt) args.push("--append-system-prompt", systemPrompt);
  if (model && model !== "default") args.push("--model", model);
  args.push("--effort", reasoningEffort || "low");
  return args;
}

export async function callClaudeCli({ model, reasoningEffort, systemPrompt, userPrompt }: CliArgs): Promise<string> {
  // Default to LOW reasoning effort. With no --effort flag the CLI runs at its
  // session default (high), which spends ~17K thinking tokens on a structured
  // resume rewrite and pushes a single call past 5 minutes. Polish is a bounded
  // rewrite/audit, not open-ended reasoning — low effort cuts each call to ~70s
  // with no loss in suggestion quality. An explicit reasoningEffort still wins.
  const args = buildClaudeCliArgs({ model, reasoningEffort, systemPrompt });

  const workdir = await mkdtemp(join(tmpdir(), "rolefit-claude-"));
  let stdout;
  try {
    ({ stdout } = await runCli("claude", args, userPrompt, { cwd: workdir }));
  } catch (error) {
    // Keep the actionable "not installed" hint (it's in the SAFE set). claude
    // also writes its JSON result — including auth/401 errors — to stdout even on
    // a non-zero exit (attached to the error by runCli), so classify from that.
    // Pass the error too so a timeout (no CLI stdout) maps to its own hint
    // instead of the generic auth-flavored failure message.
    const err = error as CliError;
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
function classifyClaudeFailure(stdout: string, sourceError?: CliError): Error {
  let message = "";
  let authStatus = 0;
  try {
    const envelope = JSON.parse(stdout);
    message = String(envelope.result ?? envelope.error ?? "");
    authStatus = Number(envelope.api_error_status) || 0;
  } catch {
    // stdout wasn't JSON (e.g. an empty/garbled non-zero exit).
  }
  if (authStatus === 401 || /not logged in|please run \/login|invalid authentication|failed to authenticate|unauthorized|\b401\b/i.test(message)) {
    return new Error(CLAUDE_CLI_AUTH_MESSAGE);
  }
  // No CLI-reported error to classify and the call timed out → the actionable
  // cause is the timeout, not a generic CLI error.
  if (!message && (sourceError?.timedOut || /timed out/i.test(sourceError?.message ?? ""))) {
    return new Error(CLAUDE_CLI_TIMEOUT_MESSAGE);
  }
  return new Error(CLAUDE_CLI_FAILED_MESSAGE);
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

export async function callCodexCli({ model, reasoningEffort, systemPrompt, userPrompt }: CliArgs): Promise<string> {
  const combined = systemPrompt
    ? `${systemPrompt}\n\n---\n\n${userPrompt}`
    : userPrompt;

  const workdir = await mkdtemp(join(tmpdir(), "rolefit-codex-"));
  const outputPath = join(workdir, "last-message.txt");
  const args = buildCodexCliArgs({ model, reasoningEffort }, workdir, outputPath);

  try {
    const { stdout } = await runCli("codex", args, combined, { cwd: workdir });
    const directOutput = await readBoundedFile(outputPath);
    return directOutput.trim() || extractCodexFinalOutput(stdout);
  } finally {
    await rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}

// ----- Antigravity CLI (agy — Google's Gemini CLI successor, non-interactive) -----

export function buildAntigravityCliArgs({ model }: CliArgs): string[] {
  const args = ["-p", ""];
  if (model && model !== "default") args.push("--model", model);
  // --sandbox supplies the terminal restrictions that the throwaway cwd alone
  // cannot provide. Permission auto-approval remains necessary in print mode.
  args.push("--sandbox", "--dangerously-skip-permissions");
  return args;
}

export async function callAntigravityCli({ model, systemPrompt, userPrompt }: CliArgs): Promise<string> {
  // agy has no separate system-prompt flag, so combine like Codex/Gemini.
  const combined = systemPrompt ? `${systemPrompt}\n\n---\n\n${userPrompt}` : userPrompt;

  // -p "": print mode — run a single prompt non-interactively and print the
  //   plain-text response. An empty -p value keeps print mode selected while the
  //   prompt is fed on stdin, so the sensitive resume + job text never lands in
  //   argv (world-readable in a local process listing). This mirrors the Gemini
  //   CLI helper; agy is Gemini's direct successor. If a future agy build needs
  //   the prompt as the -p value instead, pass `combined` there — but that would
  //   reintroduce the argv leak this avoids.
  // --model: model id. agy has NO `-m` short alias (it errors "flags provided
  //   but not defined: -m"); the ids are the exact display names from `agy
  //   models`, e.g. "Gemini 3.5 Flash (High)" (spaces + parens — passed as one
  //   argv element, so no shell parsing). --dangerously-skip-permissions: a
  //   non-interactive spawn otherwise blocks on a tool-approval prompt that never
  //   renders (agy is an agentic harness). The CLI also receives --sandbox and a
  //   throwaway cwd to reduce access; this is defense in depth, not a claim of
  //   absolute OS isolation. The runCli timeout still bounds any hang.
  const args = buildAntigravityCliArgs({ model });

  // Throwaway working dir keeps project instruction files out of automatic
  // discovery. Together with --sandbox it reduces filesystem exposure, but it
  // is not an OS-level guarantee against absolute reads or network access.
  // UX/color warnings go to stderr, so stdout stays clean.
  const workdir = await mkdtemp(join(tmpdir(), "rolefit-antigravity-"));
  try {
    const { stdout } = await runCli("agy", args, combined, { cwd: workdir });
    return stdout.trim();
  } catch (error) {
    // Keep the actionable "not installed" hint (it's in the SAFE set); turn any
    // other non-zero exit — most often an unauthenticated CLI or an inaccessible
    // model — into a specific, actionable hint instead of a generic 500.
    const message = error instanceof Error ? error.message : "";
    if (/is not installed or not on PATH/.test(message)) throw error;
    throw new Error(
      "Antigravity CLI could not complete the request. Run `agy auth login` to sign in, confirm the selected model is available, then try again."
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
