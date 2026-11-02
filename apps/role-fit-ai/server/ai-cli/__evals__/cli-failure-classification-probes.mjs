// CLI failure classification. Claude and Codex failures map to distinct,
// user-safe auth, rate-limit, overload, model, and timeout cases without
// leaking provider diagnostics, and an echoed prompt never decides the class.
// Fake CLIs only: no provider is called.
import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { callCodexCli, classifyClaudeFailure, classifyCodexFailure, runCli } from "../index.ts";
import { UserSafeAiError } from "../../ai/errors.ts";

const isWindows = process.platform === "win32";
// The client's rate-limit headline needs 429 or this wording (src/lib/failures.ts).
const RATE_LIMIT_WORDING = /rate limit|quota/i;
const PRIVATE_DIAGNOSTIC = "synthetic-private-diagnostic";

// ----- Claude Code -----

const claudeEnvelope = (fields) => JSON.stringify({ type: "result", is_error: true, ...fields });
for (const [label, stdout] of [
  ["api_error_status 429", claudeEnvelope({ api_error_status: 429, result: `API Error: 429 rate_limit_error ${PRIVATE_DIAGNOSTIC}` })],
  ["usage limit result", claudeEnvelope({ result: "Claude AI usage limit reached|1761840000" })]
]) {
  const error = classifyClaudeFailure(stdout);
  assert(error instanceof UserSafeAiError, `${label}: user-safe`);
  assert.equal(error.status, 429, `${label}: rate-limit status`);
  assert.match(error.message, RATE_LIMIT_WORDING, `${label}: rate-limit wording`);
  assert.doesNotMatch(error.message, /claude update|connection/i, `${label}: a working CLI is not sent to reinstall`);
  assert.equal(error.message.includes(PRIVATE_DIAGNOSTIC), false, `${label}: no provider text`);
}
const overloaded = classifyClaudeFailure(claudeEnvelope({ api_error_status: 529, result: "API Error: 529 Overloaded" }));
assert.equal(overloaded.status, 503, "an overloaded provider is its own temporary case");
assert.match(overloaded.message, /overloaded/i);
assert.doesNotMatch(overloaded.message, /claude update/i);
assert.equal(
  classifyClaudeFailure("", { stderr: "API Error: 429 Too Many Requests", message: "claude exited with code 1" }).status,
  429,
  "Claude stderr participates in private rate-limit classification"
);
assert.equal(classifyClaudeFailure(claudeEnvelope({ api_error_status: 401, result: "Unauthorized" })).status, 401, "auth stays auth");
assert.equal(classifyClaudeFailure("", { timedOut: true, message: "claude timed out" }).status, 504, "timeout stays timeout");
assert.equal(classifyClaudeFailure(claudeEnvelope({ result: "synthetic failure" })).status, 500, "an unknown failure stays generic");

// ----- Codex (classifier) -----

const codexExit = (stderr, stdout = "") => Object.assign(new Error("codex exited with code 1. Check CLI authentication and model access, then try again."), { exitCode: 1, stdout, stderr });
const codexCases = [
  ["usage limit", "[2026-10-30T00:00:00] ERROR: You've hit your usage limit. Try again later.", 429],
  ["retry limit 429", "ERROR: exceeded retry limit, last status: 429 Too Many Requests", 429],
  ["signed out", "ERROR: unexpected status 401 Unauthorized", 401],
  ["not logged in", "Error: Not logged in. Run codex login.", 401],
  ["model unavailable", `ERROR: unexpected status 400 Bad Request: {"detail":"The 'gpt-synthetic' model is not supported when using Codex with a ChatGPT account. ${PRIVATE_DIAGNOSTIC}"}`, 400]
];
for (const [label, stderr, status] of codexCases) {
  const error = classifyCodexFailure(codexExit(stderr));
  assert(error instanceof UserSafeAiError, `${label}: user-safe`);
  assert.equal(error.status, status, `${label}: status`);
  assert.equal(error.message.includes(PRIVATE_DIAGNOSTIC), false, `${label}: no provider text`);
  if (status === 429) assert.match(error.message, RATE_LIMIT_WORDING, `${label}: rate-limit wording`);
}
// Codex echoes the prompt; a posting that mentions 401(k) or rate limits is not a diagnosis.
const echoedPrompt = "Error budgets and rate limit dashboards.\nERROR: 401(k) matching, unauthorized access audits.";
const unrelated = codexExit("ERROR: synthetic unrelated failure", `user\n${echoedPrompt}\n`);
assert.equal(classifyCodexFailure(unrelated, echoedPrompt), unrelated, "the echoed prompt never classifies a failure");
const unmarked = codexExit("", "codex\nMentions a usage limit and 401 outside an error line.");
assert.equal(classifyCodexFailure(unmarked), unmarked, "unmarked transcript lines never classify a failure");
const timedOut = Object.assign(new Error("codex timed out after 240s. Try again or switch to a faster model."), { timedOut: true, stderr: "ERROR: usage limit" });
assert.equal(classifyCodexFailure(timedOut), timedOut, "a timeout is left for the route's timeout mapping");

// ----- Codex (callCodexCli through a fake CLI on PATH) -----

const root = await mkdtemp(join(tmpdir(), "rolefit cli-failures "));
const originalPath = process.env.PATH;
try {
  await writeFile(
    join(root, "fake-codex.mjs"),
    [
      'const args = process.argv.slice(2);',
      'if (args[0] === "--rolefit-probe-sentinel") { process.stdout.write("rolefit-fake-cli codex"); process.exit(0); }',
      'let stdin = "";',
      'for await (const chunk of process.stdin) stdin += chunk;',
      'process.stdout.write(`user\\n${stdin}\\n`);',
      'const lines = {',
      '  ROLEFIT_PROBE_USAGE: "ERROR: You\'ve hit your usage limit. Try again later.",',
      '  ROLEFIT_PROBE_AUTH: "ERROR: unexpected status 401 Unauthorized",',
      '  ROLEFIT_PROBE_OTHER: "ERROR: synthetic unrelated failure"',
      '};',
      'const mode = Object.keys(lines).find((key) => stdin.includes(key));',
      'process.stderr.write(`${lines[mode]}\\n`);',
      'process.exitCode = 1;'
    ].join("\n"),
    "utf8"
  );
  if (isWindows) {
    await writeFile(join(root, "codex.cmd"), `@echo off\r\n"${process.execPath}" "%~dp0fake-codex.mjs" %*\r\n`, "utf8");
  } else {
    const launcher = join(root, "codex");
    await writeFile(launcher, `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/fake-codex.mjs" "$@"\n`, "utf8");
    await chmod(launcher, 0o755);
  }
  process.env.PATH = `${root}${delimiter}${originalPath ?? ""}`;
  // A real Codex resolved here would make this a live call; it rejects the sentinel flag.
  const sentinel = await runCli("codex", ["--rolefit-probe-sentinel"], undefined, { timeoutMs: 10_000 }).catch(() => ({ stdout: "" }));
  assert.equal(sentinel.stdout, "rolefit-fake-cli codex", "the fake codex must resolve first on PATH");

  const call = (userPrompt) => callCodexCli({ model: "gpt-synthetic", systemPrompt: "Synthetic system prompt.", userPrompt }).then(
    () => assert.fail("the fake codex always fails"),
    (error) => error
  );
  const usage = await call("ROLEFIT_PROBE_USAGE");
  assert(usage instanceof UserSafeAiError && usage.status === 429, "a Codex usage limit reaches the route as a 429");
  const auth = await call("ROLEFIT_PROBE_AUTH");
  assert(auth instanceof UserSafeAiError && auth.status === 401, "a signed-out Codex reaches the route as a 401");
  const other = await call(`ROLEFIT_PROBE_OTHER\n${echoedPrompt}`);
  assert.equal(other instanceof UserSafeAiError, false, "an unknown Codex failure keeps the route's generic handling");
  assert.match(other.message, /codex exited with code 1/);
} finally {
  process.env.PATH = originalPath;
  await rm(root, { recursive: true, force: true, maxRetries: 3 });
}

console.log("CLI failure classification probes passed");
