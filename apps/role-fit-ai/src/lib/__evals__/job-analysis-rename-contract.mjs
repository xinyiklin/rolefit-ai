import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
const retiredTerm = ["dis", "till"].join("");
const retiredPattern = new RegExp(retiredTerm, "gi");
const textExtensions = new Set([
  ".cjs", ".css", ".html", ".js", ".json", ".jsx", ".md", ".mjs",
  ".ts", ".tsx", ".txt", ".yaml", ".yml"
]);

// Exact counts make this an intentional compatibility ledger, not a broad
// file-level exemption. Adding even one stale mention requires a reviewed edit
// here, while deleting a compatibility shim requires removing its old receipt.
const expectedCounts = new Map([
  ["CONTINUITY.md", 3],
  ["apps/role-fit-ai/__evals__/extension-popup-contract.mjs", 1],
  ["apps/role-fit-ai/__evals__/extension-settings-contract.mjs", 2],
  ["apps/role-fit-ai/docs/engineering/ai-server.md", 7],
  ["apps/role-fit-ai/docs/engineering/testing.md", 1],
  ["apps/role-fit-ai/docs/releases/0.5.0-beta.11.md", 1],
  ["apps/role-fit-ai/extension/settings.js", 1],
  ["apps/role-fit-ai/server/ai/__evals__/job-analysis-route-contract.mjs", 4],
  ["apps/role-fit-ai/server/applications/__evals__/sanitize-applications.mjs", 7],
  ["apps/role-fit-ai/server/extension/__evals__/inbox-probes.mjs", 1],
  ["apps/role-fit-ai/server/runtime.ts", 1],
  ["apps/role-fit-ai/src/hooks/__evals__/client-workflow-guards.mjs", 3],
  ["apps/role-fit-ai/src/hooks/useApplications.ts", 2],
  ["apps/role-fit-ai/src/lib/__evals__/ai-workflow-eval.mjs", 2],
  ["apps/role-fit-ai/src/lib/__evals__/stage-settings-eval.mjs", 24],
  ["apps/role-fit-ai/src/lib/__evals__/workspace-backup-contract-eval.mjs", 5],
  ["apps/role-fit-ai/src/lib/aiUsage.ts", 4],
  ["apps/role-fit-ai/src/lib/settings.ts", 7],
  ["apps/role-fit-ai/src/lib/tabPresence.ts", 1],
  ["apps/role-fit-ai/src/sections/SessionsRail.tsx", 2]
]);

// Driven by git rather than a directory walk: git reports POSIX separators, so
// the ledger keys below match on Windows as well as Linux CI, and git's ignore
// rules define the scope instead of a hardcoded skip list — finer-grained, so an
// un-ignored file inside an otherwise ignored directory is still scanned.
// `--exclude-standard` filters untracked files only: a force-added personal file
// would still be read, and the exact counts fail on it rather than leak it
// quietly. `--others` keeps a new source file in scope before it is staged.
function scannedTextFiles() {
  let listed;
  try {
    listed = execFileSync(
      "git",
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "CONTINUITY.md", "apps/role-fit-ai"],
      { cwd: repoRoot, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
    );
  } catch (cause) {
    throw new Error(
      "this contract reads its file list from git: `git ls-files` failed. Is git on PATH and is this a repository?",
      { cause }
    );
  }
  const files = listed.split("\0").filter(Boolean);
  // An empty list would satisfy the ledger vacuously instead of failing.
  assert.ok(files.length, "git listed no files to scan");
  return files.filter((file) => textExtensions.has(extname(file)));
}

const actualCounts = new Map();
for (const file of scannedTextFiles()) {
  const absolute = resolve(repoRoot, file);
  // Tracked but deleted in the working tree: there is nothing to scan.
  if (!existsSync(absolute)) continue;
  const count = readFileSync(absolute, "utf8").match(retiredPattern)?.length ?? 0;
  if (count > 0) actualCounts.set(file, count);
}

assert.deepEqual(
  [...actualCounts.entries()].sort(([a], [b]) => a.localeCompare(b)),
  [...expectedCounts.entries()].sort(([a], [b]) => a.localeCompare(b)),
  "retired stage terminology is limited to the explicit compatibility, migration, test, and release-note ledger"
);

console.log(`job-analysis residual-name contract passed (${actualCounts.size} allowlisted files)`);
