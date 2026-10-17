// Prompt delivery through CLI argv. cmd.exe (which runs npm .cmd shims on
// Windows) ends a command line at its first newline and refuses one over 8,191
// characters, so prompt text must never reach Claude or Codex argv, and
// Antigravity's argv-only prompt must fail honestly when it cannot be passed.
// Fake CLIs only: no provider is called.
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
  buildClaudeCliArgs,
  buildCodexCliArgs,
  callAntigravityCli,
  callClaudeCli,
  runCli
} from "../index.ts";
import {
  ANTIGRAVITY_CLI_PROMPT_TOO_LONG_MESSAGE,
  ANTIGRAVITY_CLI_SCRIPT_MESSAGE,
  UserSafeAiError
} from "../../ai/errors.ts";

const isWindows = process.platform === "win32";
const MARKER = "rolefit-probe-private-marker";
// Multi-line, longer than cmd.exe's limit, with every cmd.exe metacharacter.
const SYSTEM_PROMPT = Array.from(
  { length: 60 },
  (_, line) => `Rule ${line}: ${MARKER} & | < > ^ %PATH% ! " ( ) , ; * ? [ ] \\tail ${"x".repeat(160)} é ☃`
).join("\n") + "\r\nlast line\n";
const USER_PROMPT = `Resume line one ${MARKER}\nJob line two & "quoted"\n`;
// Model ids, efforts, flags, and temp paths are short; a prompt-sized element is a leak.
const ARGV_ELEMENT_LIMIT = 512;

function assertArgvCarriesNoPrompt(args, label) {
  for (const arg of args) {
    assert.equal(/[\r\n]/.test(arg), false, `${label}: no argv element carries a newline`);
    assert(arg.length <= ARGV_ELEMENT_LIMIT, `${label}: argv element of ${arg.length} characters`);
    assert.equal(arg.includes(MARKER), false, `${label}: prompt text stays out of argv`);
  }
}

// ----- Argv builders (every platform) -----

const claudeArgs = buildClaudeCliArgs(
  { model: "claude-sonnet-5-5", reasoningEffort: "high", systemPrompt: SYSTEM_PROMPT, userPrompt: USER_PROMPT },
  join(tmpdir(), "rolefit-claude-probe", "system-prompt.txt")
);
assertArgvCarriesNoPrompt(claudeArgs, "Claude argv");
assert.equal(claudeArgs.includes("--append-system-prompt"), false, "Claude never takes the system prompt as an argv value");
assert.equal(claudeArgs[claudeArgs.indexOf("--append-system-prompt-file") + 1], join(tmpdir(), "rolefit-claude-probe", "system-prompt.txt"));
assert.equal(claudeArgs[claudeArgs.indexOf("--model") + 1], "claude-sonnet-5-5");
assert.equal(claudeArgs[claudeArgs.indexOf("--effort") + 1], "high");
assert.equal(
  buildClaudeCliArgs({ model: "claude-sonnet-5-5", reasoningEffort: "low" }).includes("--append-system-prompt-file"),
  false,
  "a request without a system prompt passes no prompt file"
);

const codexWorkdir = join(tmpdir(), "rolefit-codex-probe");
const codexArgs = buildCodexCliArgs(
  { model: "gpt-6.1-sol", reasoningEffort: "ultra", systemPrompt: SYSTEM_PROMPT, userPrompt: USER_PROMPT },
  codexWorkdir,
  join(codexWorkdir, "last-message.txt")
);
assertArgvCarriesNoPrompt(codexArgs, "Codex argv");

// ----- Over-long direct launches (every platform) -----

// Past Windows' 32,767-character command line, Linux's per-argument limit, and
// macOS's total argument space: Node refuses before any process exists.
const oversized = "x".repeat(4_200_000);
const directRefusal = await runCli(process.execPath, ["-e", "", oversized], undefined, { timeoutMs: 5_000 }).then(
  () => null,
  (error) => error
);
assert(directRefusal, "an over-long direct launch is refused");
assert.equal(directRefusal.launchRefused, "too-long");
assert.equal(directRefusal.message.includes("xxxx"), false, "the refusal carries no argument text");

// ----- Fake CLIs on PATH -----

const root = await mkdtemp(join(tmpdir(), "rolefit argv-delivery "));
const launchLog = join(root, "launches.log");
const originalPath = process.env.PATH;

async function launches() {
  return (await readFile(launchLog, "utf8").catch(() => "")).split("\n").filter(Boolean);
}

async function lastLaunch() {
  const line = (await launches()).at(-1);
  if (!line) return null;
  const [name, mode, file] = line.split("\t");
  return { name, mode, file };
}

async function installFakeCli(name) {
  if (isWindows) {
    await writeFile(
      join(root, `${name}.cmd`),
      `@echo off\r\n"${process.execPath}" "%~dp0fake-cli.mjs" ${name} %*\r\n`,
      "utf8"
    );
  } else {
    const launcher = join(root, name);
    await writeFile(launcher, `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/fake-cli.mjs" ${name} "$@"\n`, "utf8");
    await chmod(launcher, 0o755);
  }
}

try {
  await writeFile(
    join(root, "fake-cli.mjs"),
    [
      'import { appendFileSync, readFileSync, statSync } from "node:fs";',
      'import { dirname, join } from "node:path";',
      'import { fileURLToPath } from "node:url";',
      'const name = process.argv[2];',
      'const args = process.argv.slice(3);',
      'if (args[0] === "--rolefit-probe-sentinel") {',
      '  process.stdout.write(`rolefit-fake-cli ${name}`);',
      '  process.exit(0);',
      '}',
      'let stdin = "";',
      'for await (const chunk of process.stdin) stdin += chunk;',
      'const fileIndex = args.indexOf("--append-system-prompt-file");',
      'const systemPromptFile = fileIndex >= 0 ? args[fileIndex + 1] : null;',
      'const mode = stdin.includes("ROLEFIT_PROBE_HANG") ? "hang" : stdin.includes("ROLEFIT_PROBE_FAIL") ? "fail" : "ok";',
      'appendFileSync(join(dirname(fileURLToPath(import.meta.url)), "launches.log"), `${name}\\t${mode}\\t${systemPromptFile ?? ""}\\n`);',
      'if (mode === "hang") {',
      '  setInterval(() => {}, 1_000);',
      '} else if (mode === "fail") {',
      '  process.exitCode = 1;',
      '  process.stdout.write(JSON.stringify({ type: "result", is_error: true, result: "synthetic failure" }));',
      '} else {',
      '  const report = {',
      '    args,',
      '    stdin,',
      '    systemPromptFile,',
      '    systemPrompt: systemPromptFile ? readFileSync(systemPromptFile, "utf8") : null,',
      '    systemPromptMode: systemPromptFile ? statSync(systemPromptFile).mode & 0o777 : null',
      '  };',
      '  process.stdout.write(name === "claude"',
      '    ? JSON.stringify({ type: "result", is_error: false, result: JSON.stringify(report), usage: { input_tokens: 1, output_tokens: 1 } })',
      '    : JSON.stringify(report));',
      '}'
    ].join("\n"),
    "utf8"
  );
  await installFakeCli("claude");
  await installFakeCli("agy");
  process.env.PATH = `${root}${delimiter}${originalPath ?? ""}`;
  // A real CLI resolved here would make this a live provider call. Real CLIs
  // reject the sentinel flag before any request, so stop unless the fakes answer.
  for (const name of ["claude", "agy"]) {
    const { stdout } = await runCli(name, ["--rolefit-probe-sentinel"], undefined, { timeoutMs: 10_000 })
      .catch(() => ({ stdout: "" }));
    assert.equal(stdout, `rolefit-fake-cli ${name}`, `the fake ${name} must resolve first on PATH`);
  }

  // Claude Code receives the whole system prompt, every flag after it, and the
  // user prompt on stdin; through a .cmd shim on Windows this is the path that
  // used to keep only the first line and drop --model and --effort.
  const report = JSON.parse(await callClaudeCli({
    model: "claude-sonnet-5-5",
    reasoningEffort: "high",
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: USER_PROMPT
  }));
  assert.equal(report.systemPrompt, SYSTEM_PROMPT, "the system prompt file holds the exact system prompt");
  assert.equal(report.stdin, USER_PROMPT, "the user prompt stays on stdin");
  assertArgvCarriesNoPrompt(report.args, "Claude received argv");
  assert.equal(report.args[report.args.indexOf("--model") + 1], "claude-sonnet-5-5", "the requested model arrives");
  assert.equal(report.args[report.args.indexOf("--effort") + 1], "high", "the requested effort arrives");
  assert.equal(report.args[report.args.indexOf("--tools") + 1], "", "an empty tools list arrives empty");
  assert.equal(report.args[report.args.indexOf("--mcp-config") + 1], '{"mcpServers":{}}');
  if (!isWindows) assert.equal(report.systemPromptMode, 0o600, "the system prompt file is private to the user");
  assert.equal(existsSync(report.systemPromptFile), false, "the system prompt file is removed after the call");

  // The file is also removed when the CLI fails and when the request is stopped.
  await assert.rejects(
    () => callClaudeCli({ model: "claude-sonnet-5-5", systemPrompt: SYSTEM_PROMPT, userPrompt: "ROLEFIT_PROBE_FAIL" }),
    UserSafeAiError
  );
  const failed = await lastLaunch();
  assert.equal(failed?.mode, "fail");
  assert(failed.file, "the failing call received a system prompt file");
  assert.equal(existsSync(failed.file), false, "the system prompt file is removed after a CLI failure");
  const controller = new AbortController();
  const stopped = callClaudeCli({
    model: "claude-sonnet-5-5",
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: "ROLEFIT_PROBE_HANG",
    signal: controller.signal
  });
  let hanging = null;
  for (let attempt = 0; attempt < 250 && hanging?.mode !== "hang"; attempt += 1) {
    await delay(20);
    hanging = await lastLaunch();
  }
  assert.equal(hanging?.mode, "hang", "the fake Claude started before Stop");
  assert(hanging.file, "the stopped call received a system prompt file");
  controller.abort();
  await assert.rejects(stopped, { name: "AbortError" });
  assert.equal(existsSync(hanging.file), false, "the system prompt file is removed after Stop");

  if (isWindows) {
    // A multi-line argument through a command script is refused before cmd.exe
    // could truncate it, and the script never runs.
    const before = (await launches()).length;
    const multiLine = await runCli("claude", ["-p", "first line\nsecond line"], undefined, { timeoutMs: 5_000 }).then(
      () => null,
      (error) => error
    );
    assert.equal(multiLine?.launchRefused, "multi-line-script", "multi-line argv never crosses cmd.exe");
    assert.equal((await launches()).length, before, "the refused script never ran");

    // Antigravity: a single-line prompt runs through the script; RoleFit's real
    // prompts are multi-line and are refused with the script message; a line too
    // long for cmd.exe is refused as too long. Neither refusal launches agy.
    const runs = JSON.parse(await callAntigravityCli({ model: "gemini-test", userPrompt: "Return JSON & stop" }));
    assert.equal(runs.args[runs.args.indexOf("-p") + 1], "Return JSON & stop");
    const afterRun = (await launches()).length;
    await assert.rejects(
      () => callAntigravityCli({ model: "gemini-test", systemPrompt: SYSTEM_PROMPT, userPrompt: USER_PROMPT }),
      (error) => error instanceof UserSafeAiError && error.status === 400 && error.message === ANTIGRAVITY_CLI_SCRIPT_MESSAGE
    );
    await assert.rejects(
      () => callAntigravityCli({ model: "gemini-test", userPrompt: "y".repeat(9_000) }),
      (error) => error instanceof UserSafeAiError && error.status === 413 && error.message === ANTIGRAVITY_CLI_PROMPT_TOO_LONG_MESSAGE
    );
    assert.equal((await launches()).length, afterRun, "refused Antigravity prompts never launch agy");
  } else {
    // The OS refuses an over-long exec (E2BIG) before agy runs; RoleFit reports
    // the length, not a sign-in problem.
    const before = (await launches()).length;
    await assert.rejects(
      () => callAntigravityCli({ model: "gemini-test", systemPrompt: SYSTEM_PROMPT, userPrompt: oversized }),
      (error) => error instanceof UserSafeAiError && error.status === 413 && error.message === ANTIGRAVITY_CLI_PROMPT_TOO_LONG_MESSAGE
    );
    assert.equal((await launches()).length, before, "the refused prompt never launched agy");
  }
} finally {
  if (originalPath === undefined) delete process.env.PATH;
  else process.env.PATH = originalPath;
  await rm(root, { recursive: true, force: true });
}

console.log(`CLI argv delivery probes: passed${isWindows ? " (Windows .cmd shims)" : " (Windows .cmd shim checks skipped)"}`);
