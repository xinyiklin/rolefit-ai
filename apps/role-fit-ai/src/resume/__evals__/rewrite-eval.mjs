// Probes for the post-AI text normalizer (rewrite.ts). The deterministic local
// polisher and cover-letter draft were REMOVED by user decision (D011) — the
// anti-fabrication probes that locked their verb/skill gates went with them.
// What remains guards normalizePolishedResume's no-data-loss contract: it may
// re-anchor the header and drop a duplicated contact LINE, but it must NEVER
// delete a real bullet or heading that merely contains an email/URL/phone.
//
//   node src/resume/__evals__/rewrite-eval.mjs
//
// rewrite.ts imports ./text, so it must be BUNDLED (not just transformed)
// before import.

import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

async function load() {
  const entry = fileURLToPath(new URL("../../resumeEngine.ts", import.meta.url));
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent"
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const { normalizePolishedResume } = await load();

// ── 1. Data loss: a real bullet that contains an email / URL / phone survives
// (only a duplicated header contact LINE is stripped).
const normalized = normalizePolishedResume(
  [
    "Jane Dev",
    "jane@example.com | github.com/jane",
    "",
    "EXPERIENCE",
    "- Cut p95 latency 30%, dashboards at github.com/jane/perf",
    "- Shipped the notify@acme.com alerting service",
    "- Built the React frontend"
  ].join("\n"),
  ""
);

// ── 2. An entry/project HEADING that contains a URL is not deleted as a contact line.
const projHeading = normalizePolishedResume(
  ["Jane Dev", "jane@example.com | github.com/jane", "", "PROJECTS", "Portfolio Site | github.com/jane/portfolio | 2024", "- Built a static site with React"].join("\n"),
  ""
);

// ── 3. A duplicated header contact line inside the body IS stripped.
const dedupedContact = normalizePolishedResume(
  ["Jane Dev", "jane@example.com | github.com/jane", "", "jane@example.com | github.com/jane", "EXPERIENCE", "- Built the React frontend"].join("\n"),
  ""
);

const checks = [
  ["URL bullet survives normalize", normalized.includes("github.com/jane/perf")],
  ["email bullet survives normalize", normalized.includes("notify@acme.com")],
  ["project heading with URL survives normalize", projHeading.includes("Portfolio Site") && projHeading.includes("github.com/jane/portfolio")],
  [
    "duplicated header contact line is stripped from the body",
    dedupedContact.split("\n").filter((l) => l.trim() === "jane@example.com | github.com/jane").length === 1
  ]
];

const failures = checks.filter(([, ok]) => !ok);
if (failures.length) {
  for (const [name] of failures) console.error(`FAIL ${name}`);
  process.exit(1);
}
console.log(`rewrite normalization probes passed (${checks.length}/${checks.length})`);
