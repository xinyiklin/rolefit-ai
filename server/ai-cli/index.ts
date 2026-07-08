// Subscription-CLI providers. Lets the polish route use Claude Max (via
// Claude Code), ChatGPT/Codex Plus (via Codex CLI), or Google Gemini (via the
// Antigravity CLI `agy`, which replaced the retired Gemini CLI) without burning
// paid API tokens. Each helper spawns the local CLI binary and returns the model
// response as a string (the polish route then parses it as JSON).

import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref?.();
      const error = new Error(`${command} timed out after ${Math.round(timeoutMs / 1000)}s. Try again or switch to a faster model.`) as CliError;
      error.timedOut = true;
      reject(error);
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (err) => {
      clearTimeout(timer);
      if ((err as CliError).code === "ENOENT") {
        reject(new Error(`${command} is not installed or not on PATH.`));
      } else {
        reject(new Error(`${command} could not be started. Check the CLI installation and try again.`));
      }
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        // Include the first line of stderr so the actual CLI error is visible in logs.
        const hint = stderr.trim().split("\n")[0]?.slice(0, 200) ?? "";
        const detail = hint ? ` (${hint})` : "";
        const error = new Error(`${command} exited with code ${code}${detail}. Check CLI authentication and model access, then try again.`) as CliError;
        // Attach the captured streams so callers can classify the failure — e.g.
        // claude writes its JSON result (incl. auth/401 errors) to stdout even on
        // a non-zero exit, which would otherwise be lost.
        error.stdout = stdout;
        error.stderr = stderr;
        error.exitCode = code;
        reject(error);
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

export async function callClaudeCli({ model, reasoningEffort, systemPrompt, userPrompt }: CliArgs): Promise<string> {
  const args = ["-p", "--tools", "", "--output-format", "json"];
  if (systemPrompt) args.push("--append-system-prompt", systemPrompt);
  if (model && model !== "default") args.push("--model", model);
  // Default to LOW reasoning effort. With no --effort flag the CLI runs at its
  // session default (high), which spends ~17K thinking tokens on a structured
  // resume rewrite and pushes a single call past 5 minutes. Polish is a bounded
  // rewrite/audit, not open-ended reasoning — low effort cuts each call to ~70s
  // with no loss in suggestion quality. An explicit reasoningEffort still wins.
  args.push("--effort", reasoningEffort || "low");

  let stdout;
  try {
    ({ stdout } = await runCli("claude", args, userPrompt));
  } catch (error) {
    // Keep the actionable "not installed" hint (it's in the SAFE set). claude
    // also writes its JSON result — including auth/401 errors — to stdout even on
    // a non-zero exit (attached to the error by runCli), so classify from that.
    // Pass the error too so a timeout (no CLI stdout) maps to its own hint
    // instead of the generic auth-flavored failure message.
    const err = error as CliError;
    if (/is not installed or not on PATH/.test(err?.message ?? "")) throw error;
    throw classifyClaudeFailure(typeof err?.stdout === "string" ? err.stdout : "", err);
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
// errors.mjs' SAFE set so /api/polish surfaces them verbatim instead of "did not
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

export async function callCodexCli({ model, reasoningEffort, systemPrompt, userPrompt }: CliArgs): Promise<string> {
  const combined = systemPrompt
    ? `${systemPrompt}\n\n---\n\n${userPrompt}`
    : userPrompt;

  const workdir = await mkdtemp(join(tmpdir(), "rolefit-codex-"));
  const outputPath = join(workdir, "last-message.txt");
  const args = ["exec", "--skip-git-repo-check", "--sandbox", "read-only", "--output-last-message", outputPath];
  if (model && model !== "default") args.push("--model", model);
  if (reasoningEffort) args.push("-c", `model_reasoning_effort="${reasoningEffort}"`);

  try {
    const { stdout } = await runCli("codex", args, combined);
    const directOutput = await readFile(outputPath, "utf8").catch(() => "");
    return directOutput.trim() || extractCodexFinalOutput(stdout);
  } finally {
    await rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}

// ----- Antigravity CLI (agy — Google's Gemini CLI successor, non-interactive) -----

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
  //   renders (agy is an agentic harness). Auto-approving is safe here because the
  //   CLI runs in a throwaway empty temp dir with nothing to read or write, and
  //   the task only asks for a JSON answer. The runCli timeout still bounds any
  //   hang. (All verified against agy 1.0.16.)
  const args = ["-p", ""];
  if (model && model !== "default") args.push("--model", model);
  args.push("--dangerously-skip-permissions");

  // Throwaway working dir: agy can't pick up project context (AGENTS.md/AGY.md)
  // or touch project files. UX/color warnings go to stderr, so stdout stays clean.
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
