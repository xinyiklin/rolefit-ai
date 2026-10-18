// Points git at the tracked .githooks/ directory (run by `npm install`). A
// hooks path the developer already set is left alone, and a checkout without
// git (an exported tarball) is skipped rather than failing the install.
import { execFileSync } from "node:child_process";

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

try {
  git("rev-parse", "--is-inside-work-tree");
} catch {
  process.exit(0);
}

let current = "";
try {
  current = git("config", "--get", "core.hooksPath");
} catch {
  // Unset: git exits 1.
}

if (!current) {
  git("config", "core.hooksPath", ".githooks");
} else if (current !== ".githooks") {
  console.warn(`install-git-hooks: core.hooksPath is "${current}"; leaving it. Run .githooks/commit-msg from it to keep the attribution guard.`);
}
