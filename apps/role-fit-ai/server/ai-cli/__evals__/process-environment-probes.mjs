import assert from "node:assert/strict";

import {
  buildAiCliProcessEnvironment,
  runCli
} from "../index.ts";

const nodeInjectionKeys = [
  "ELECTRON_RUN_AS_NODE",
  "NODE_OPTIONS",
  "NODE_PATH"
];
const credentialKeys = [
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
];
const blockedKeys = [...nodeInjectionKeys, ...credentialKeys];
const sessionLocationKeys = [
  "HOME",
  "PATH",
  "CLAUDE_CONFIG_DIR",
  "CODEX_HOME",
  "XDG_CONFIG_HOME",
  "APPDATA"
];

const source = {
  HOME: "/synthetic/home",
  PATH: "/synthetic/bin",
  CLAUDE_CONFIG_DIR: "/synthetic/claude",
  CODEX_HOME: "/synthetic/codex",
  XDG_CONFIG_HOME: "/synthetic/xdg",
  APPDATA: "C:\\synthetic\\appdata",
  ROLEFIT_ENV_PROBE: "ordinary-value",
  OMIT_UNDEFINED: undefined,
  ...Object.fromEntries(blockedKeys.map((key) => [key, `${key.toLowerCase()}-must-not-cross`])),
  node_options: "--require case-variant-must-not-cross",
  openai_api_key: "case-variant-must-not-cross"
};

const sanitized = buildAiCliProcessEnvironment(source);
for (const key of blockedKeys) {
  assert.equal(sanitized[key], undefined, `${key} is removed from AI CLI child environments`);
}
assert.equal(sanitized.node_options, undefined, "Node launch-control names are removed case-insensitively");
assert.equal(sanitized.openai_api_key, undefined, "secret environment names are removed case-insensitively");
for (const key of sessionLocationKeys) {
  assert.equal(sanitized[key], source[key], `${key} remains available to provider-owned CLI sessions`);
}
assert.equal(sanitized.ROLEFIT_ENV_PROBE, "ordinary-value");
assert.equal("OMIT_UNDEFINED" in sanitized, false);
assert.equal(source.OPENAI_API_KEY, "openai_api_key-must-not-cross", "sanitizing does not mutate the source environment");

const previous = new Map([
  ...blockedKeys,
  "node_options",
  ...sessionLocationKeys,
  "ROLEFIT_ENV_PROBE"
].map((key) => [key, process.env[key]]));
try {
  for (const key of credentialKeys) process.env[key] = `${key.toLowerCase()}-must-not-cross`;
  process.env.ELECTRON_RUN_AS_NODE = "1";
  // If this reaches the child, Node exits before evaluating the probe because
  // the required module cannot be found. A successful run therefore verifies
  // that runCli wires the sanitized environment into the actual subprocess.
  process.env.NODE_OPTIONS = "--require rolefit-module-that-must-never-load";
  process.env.NODE_PATH = "/tmp/rolefit-injected-node-modules";
  process.env.node_options = "--require rolefit-case-variant-that-must-never-load";
  process.env.ROLEFIT_ENV_PROBE = "ordinary-value";

  const { stdout } = await runCli(
    process.execPath,
    [
      "-e",
      `process.stdout.write(JSON.stringify({
        blocked: ${JSON.stringify([...blockedKeys, "node_options"])}.filter((key) => process.env[key]),
        path: process.env.PATH,
        home: process.env.HOME,
        claudeConfigDir: process.env.CLAUDE_CONFIG_DIR,
        codexHome: process.env.CODEX_HOME,
        ordinary: process.env.ROLEFIT_ENV_PROBE
      }))`
    ],
    undefined,
    { timeoutMs: 5_000 }
  );
  const childEnvironment = JSON.parse(stdout);
  assert.deepEqual(childEnvironment.blocked, [], "runCli removes launch controls and credentials from the child process");
  assert.equal(childEnvironment.path, process.env.PATH, "runCli preserves normal PATH discovery");
  assert.equal(childEnvironment.home, process.env.HOME, "runCli preserves HOME for provider-owned sessions");
  assert.equal(childEnvironment.claudeConfigDir, process.env.CLAUDE_CONFIG_DIR);
  assert.equal(childEnvironment.codexHome, process.env.CODEX_HOME);
  assert.equal(childEnvironment.ordinary, "ordinary-value");

  await assert.rejects(
    runCli(
      process.execPath,
      ["-e", "process.stderr.write('Usage limit reached'); process.exit(1)"],
      undefined,
      { timeoutMs: 5_000 }
    ),
    (error) => error.stderr === "Usage limit reached" && !error.message.includes("Usage limit reached"),
    "runCli retains bounded stderr for private classification without exposing it in the error message"
  );
} finally {
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log("AI CLI process-environment probes passed.");
