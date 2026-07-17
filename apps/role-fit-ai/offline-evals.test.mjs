// Repo-wide offline regression gate — the suite `npm test` runs.
//
//   npm test
//   node --test offline-evals.test.mjs
//
// It auto-discovers every deterministic, offline eval/probe under any
// `__evals__` directory in the repo and runs each as a child process, asserting
// exit 0 (every eval already exits non-zero on a failed case). A new offline
// eval — or a whole new `__evals__` directory — is gated automatically; no edit
// here is needed to add one.
//
// Design: black-box subprocess per eval, NOT in-process import. The evals use
// several internal styles (a `checks` array, inline node:assert, custom
// reporters) and call process.exit; spawning each preserves that contract with
// zero edits to the eval files. On any failure (non-zero exit, signal kill,
// timeout, or output overflow) the child's last output lines and the cause are
// attached to the assertion so the failing case is visible without a re-run.
//
// LIVE evals (real provider, tokens, a configured key) are excluded via LIVE
// below and must stay out of `npm test`. If you add a network/model-driven
// eval, add its filename to LIVE.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";

const repoRoot = dirname(fileURLToPath(import.meta.url));

// Eval scripts that drive a real AI provider — never run in `npm test`.
const LIVE = new Set(["fabrication-eval.mjs", "tailor-quality-eval.mjs"]);

// Directories never worth walking when hunting for `__evals__` dirs.
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".trash", "job-search-workspace"]);

// Every .mjs in an __evals__ dir is a standalone eval (there are no shared-helper
// .mjs files), so match on extension rather than a name convention — the evals
// are named for what they test (linkify.mjs, escape-tex.mjs, ...), not with a
// uniform -eval/-probes suffix, and a name filter silently dropped real gates.
// Other test files (*.test.mjs) are excluded so a future one is not run twice.
const isEvalScript = (name) => name.endsWith(".mjs") && !name.endsWith(".test.mjs");

// Walk the repo for every `__evals__` directory. Recursive discovery (vs a hard
// list) means a new module's eval dir is gated the moment it lands — the static
// list could silently drift out of sync with the tree.
function findEvalDirs(dir, found = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (!ent.isDirectory() || SKIP_DIRS.has(ent.name) || ent.name.startsWith(".")) continue;
    const full = join(dir, ent.name);
    if (ent.name === "__evals__") found.push(full);
    else findEvalDirs(full, found);
  }
  return found;
}

const discovered = [];
for (const evalDir of findEvalDirs(repoRoot).sort()) {
  for (const name of readdirSync(evalDir).sort()) {
    if (!isEvalScript(name) || LIVE.has(name)) continue;
    const file = join(evalDir, name);
    discovered.push({ rel: relative(repoRoot, file).split(sep).join("/"), file });
  }
}

assert.ok(discovered.length > 0, "no offline evals discovered — check repo layout / SKIP_DIRS");

for (const { rel, file } of discovered) {
  test(rel, () => {
    const r = spawnSync(process.execPath, [file], {
      encoding: "utf8",
      cwd: repoRoot,
      // 64 MB: well past any eval's real output, so a chatty-but-passing eval
      // never trips ENOBUFS and gets mis-reported as a failure.
      maxBuffer: 64 * 1024 * 1024,
      // Bound a hung eval so it fails the suite instead of wedging it forever.
      timeout: 60_000,
      killSignal: "SIGKILL"
    });
    if (r.status === 0) return;

    const tail = `${r.stdout ?? ""}\n${r.stderr ?? ""}`.trim().split("\n").slice(-25).join("\n");
    const cause = r.error
      ? `${r.error.code === "ETIMEDOUT" ? "timed out" : r.error.code ?? r.error.message}`
      : r.signal
        ? `killed by ${r.signal}`
        : `exited ${r.status}`;
    assert.fail(`${rel} ${cause}\n--- last output ---\n${tail || "(no output captured)"}`);
  });
}
