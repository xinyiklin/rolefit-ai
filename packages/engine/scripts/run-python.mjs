#!/usr/bin/env node
// Resolve a Python 3 interpreter and run a font script through it.
//
// CI puts the `.font-tools` virtualenv on PATH and calls `python3`, which
// Windows installs do not provide — they ship `python.exe` and a `py` launcher,
// and a bare `python` may resolve to the Microsoft Store alias stub that exits
// without running anything. Prefer the repository virtualenv, then probe the
// remaining candidates and require a real "Python 3" banner before using one.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const engineRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = dirname(dirname(engineRoot));
const [scriptPath, ...scriptArgs] = process.argv.slice(2);

if (!scriptPath) {
  console.error("run-python: expected a script path.");
  process.exit(2);
}

const interpreter = resolveInterpreter();
if (!interpreter) {
  console.error(
    "run-python: no Python 3 interpreter found. Create the pinned toolchain first:\n"
      + "  python3 -m venv .font-tools\n"
      + "  .font-tools/bin/pip install --requirement"
      + " packages/engine/scripts/requirements-fonts.txt\n"
      + "On Windows use .font-tools\\Scripts\\ instead of .font-tools/bin/.",
  );
  process.exit(1);
}

const result = spawnSync(
  interpreter.command,
  [...interpreter.args, scriptPath, ...scriptArgs],
  { cwd: engineRoot, stdio: "inherit" },
);

if (result.error) {
  console.error(`run-python: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);

function resolveInterpreter() {
  for (const candidate of candidates()) {
    if (isPython3(candidate)) return candidate;
  }
  return undefined;
}

function* candidates() {
  // The repository virtualenv owns the pinned fontTools/brotli versions the
  // generators assert, so it always wins over an ambient interpreter.
  for (const relative of [".font-tools/bin/python", ".font-tools/Scripts/python.exe"]) {
    const command = join(repositoryRoot, ...relative.split("/"));
    if (existsSync(command)) yield { command, args: [] };
  }
  yield { command: "python3", args: [] };
  yield { command: "python", args: [] };
  yield { command: "py", args: ["-3"] };
}

function isPython3(candidate) {
  const probe = spawnSync(candidate.command, [...candidate.args, "--version"], {
    encoding: "utf8",
  });
  if (probe.error || probe.status !== 0) return false;
  // The Store alias stub exits non-zero, but check the banner too so a future
  // shim that exits cleanly cannot masquerade as an interpreter.
  return /^Python 3\./m.test(`${probe.stdout ?? ""}${probe.stderr ?? ""}`);
}
