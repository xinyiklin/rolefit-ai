// Subscription-CLI providers. Lets the polish route use Claude Max (via
// Claude Code), ChatGPT/Codex Plus (via Codex CLI), or Google Gemini (via the
// Gemini CLI / Antigravity) without burning paid API tokens. Each helper spawns
// the local CLI binary and returns the model response as a string (the polish
// route then parses it as JSON).

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function runCli(command, args, stdinPayload, { timeoutMs = 240_000, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], cwd });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref?.();
      reject(new Error(`${command} timed out after ${Math.round(timeoutMs / 1000)}s. Try again or switch to a faster model.`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (err) => {
      clearTimeout(timer);
      if (err.code === "ENOENT") {
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
        reject(new Error(`${command} exited with code ${code}${detail}. Check CLI authentication and model access, then try again.`));
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

export async function callClaudeCli({ model, reasoningEffort, systemPrompt, userPrompt }) {
  const args = ["-p", "--tools", "", "--output-format", "json"];
  if (systemPrompt) args.push("--append-system-prompt", systemPrompt);
  if (model && model !== "default") args.push("--model", model);
  // Default to LOW reasoning effort. With no --effort flag the CLI runs at its
  // session default (high), which spends ~17K thinking tokens on a structured
  // resume rewrite and pushes a single call past 5 minutes. Polish is a bounded
  // rewrite/audit, not open-ended reasoning — low effort cuts each call to ~70s
  // with no loss in suggestion quality. An explicit reasoningEffort still wins.
  args.push("--effort", reasoningEffort || "low");

  const { stdout } = await runCli("claude", args, userPrompt);

  let envelope;
  try {
    envelope = JSON.parse(stdout);
  } catch (parseError) {
    throw new Error("Claude Code returned output the app could not read. Try again or choose another provider.");
  }

  if (envelope.is_error) {
    const message = String(envelope.result ?? envelope.error ?? "Claude Code returned an error.");
    if (/not logged in|please run \/login/i.test(message)) {
      throw new Error("Claude Code is not authenticated. Run `claude auth login` and try again.");
    }
    throw new Error("Claude Code could not complete the request. Check your selected model and Claude Max access, then try again.");
  }

  return String(envelope.result ?? "");
}

// ----- Codex CLI (codex exec) -----

export async function callCodexCli({ model, reasoningEffort, systemPrompt, userPrompt }) {
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

// ----- Gemini CLI (Google Gemini / Antigravity, non-interactive) -----

export async function callGeminiCli({ model, systemPrompt, userPrompt }) {
  // The Gemini CLI has no separate system-prompt flag, so combine like Codex.
  const combined = systemPrompt ? `${systemPrompt}\n\n---\n\n${userPrompt}` : userPrompt;

  // --skip-trust: required for headless runs (the CLI otherwise refuses in an
  //   untrusted workspace). -o text: print only the model's text response.
  //   -p: non-interactive (headless) mode with the prompt (passed via argv).
  const args = ["--skip-trust", "-o", "text"];
  if (model && model !== "default") args.push("-m", model);
  args.push("-p", combined);

  // Run in a throwaway working dir so --skip-trust only ever trusts an empty
  // directory: the CLI cannot pick up project context (GEMINI.md) or touch
  // project files. Color/UX warnings go to stderr, so stdout stays clean JSON.
  const workdir = await mkdtemp(join(tmpdir(), "rolefit-gemini-"));
  try {
    const { stdout } = await runCli("gemini", args, "", { cwd: workdir });
    return stdout.trim();
  } catch (error) {
    // Keep the "not installed" message (it's surfaced as actionable config
    // guidance); turn any other non-zero exit — most often an unauthenticated
    // CLI or an inaccessible model — into a specific, actionable hint instead
    // of the generic "did not return a usable draft" 500.
    const message = error instanceof Error ? error.message : "";
    if (/is not installed or not on PATH/.test(message)) throw error;
    throw new Error(
      "Gemini CLI could not complete the request. Run `gemini` once to sign in, confirm the selected model is available, then try again."
    );
  } finally {
    await rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}

// Codex exec writes a structured transcript: preamble → "user" → prompt →
// "codex" → response → "tokens used" → count → final response. Strategy:
// prefer the trailing block after "tokens used N", else fall back to the
// block after the last "codex" marker.
function extractCodexFinalOutput(stdout) {
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
