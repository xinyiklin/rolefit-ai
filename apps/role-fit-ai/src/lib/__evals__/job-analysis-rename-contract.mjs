import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
const appRoot = resolve(repoRoot, "apps/role-fit-ai");
const retiredTerm = ["dis", "till"].join("");
const retiredPattern = new RegExp(retiredTerm, "gi");
const textExtensions = new Set([
  ".cjs", ".css", ".html", ".js", ".json", ".jsx", ".md", ".mjs",
  ".ts", ".tsx", ".txt", ".yaml", ".yml"
]);
const skippedDirectories = new Set([".forge", ".git", ".trash", "dist", "node_modules", "workspace"]);

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

function collectTextFiles(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) collectTextFiles(resolve(directory, entry.name), files);
      continue;
    }
    if (textExtensions.has(extname(entry.name))) files.push(resolve(directory, entry.name));
  }
  return files;
}

const files = [resolve(repoRoot, "CONTINUITY.md"), ...collectTextFiles(appRoot)]
  // This ignored operational archive preserves old handoff receipts; the tracked
  // root continuity file carries the current rename contract.
  .filter((file) => file !== resolve(appRoot, "CONTINUITY.md"));

const actualCounts = new Map();
for (const file of files) {
  const count = readFileSync(file, "utf8").match(retiredPattern)?.length ?? 0;
  if (count > 0) actualCounts.set(relative(repoRoot, file), count);
}

assert.deepEqual(
  [...actualCounts.entries()].sort(([a], [b]) => a.localeCompare(b)),
  [...expectedCounts.entries()].sort(([a], [b]) => a.localeCompare(b)),
  "retired stage terminology is limited to the explicit compatibility, migration, test, and release-note ledger"
);

console.log(`job-analysis residual-name contract passed (${actualCounts.size} allowlisted files)`);
