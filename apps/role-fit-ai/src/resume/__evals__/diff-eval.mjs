// Probes for buildResumeDiff (src/resume/diff.ts) — the inline before/after
// diff the review rail renders so a user can vet every AI change directly,
// rather than trusting a summary. Locks: identical inputs produce no diff, a
// pure insert/delete/replace, empty-both-sides, and the metricPrompts capture
// (max 6, only lines the polisher tagged "[add metric: ...]").
//
//   node src/resume/__evals__/diff-eval.mjs
//
// diff.ts imports ./text (extensionless), so it must be BUNDLED before import,
// same as keywords-eval.mjs.

import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

async function loadDiff() {
  const entry = fileURLToPath(new URL("../diff.ts", import.meta.url));
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent"
  });
  const code = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

const { buildResumeDiff } = await loadDiff();

// ── Identical inputs: no diff, one equal segment ────────────────────────────
{
  const { segments, metricPrompts } = buildResumeDiff("Built the checkout flow.", "Built the checkout flow.");
  assert.deepEqual(segments, [{ type: "equal", text: "Built the checkout flow." }], "identical text collapses to a single equal segment");
  assert.deepEqual(metricPrompts, [], "no metric prompts when nothing was tagged");
}

// ── Both sides empty ─────────────────────────────────────────────────────────
assert.deepEqual(buildResumeDiff("", ""), { segments: [], metricPrompts: [] }, "empty source and empty polished text yields an empty diff");

// ── Pure insert (source empty) ──────────────────────────────────────────────
assert.deepEqual(
  buildResumeDiff("", "Shipped the new onboarding flow."),
  { segments: [{ type: "added", text: "Shipped the new onboarding flow." }], metricPrompts: [] },
  "an empty source against real polished text is a pure insert"
);

// ── Pure delete (polished empty) ────────────────────────────────────────────
assert.deepEqual(
  buildResumeDiff("Shipped the new onboarding flow.", ""),
  { segments: [{ type: "removed", text: "Shipped the new onboarding flow." }], metricPrompts: [] },
  "real source text against an empty polished result is a pure delete"
);

// ── Replace: unchanged prefix/suffix, one changed word in the middle ───────
{
  const { segments } = buildResumeDiff("Led a team of engineers.", "Led a group of engineers.");
  assert.deepEqual(
    segments,
    [
      { type: "equal", text: "Led a" },
      { type: "removed", text: " team" },
      { type: "added", text: " group" },
      { type: "equal", text: " of engineers." }
    ],
    "a single-word substitution renders as equal/removed/added/equal, not a whole-line rewrite"
  );
}

// ── Pure insertion in the middle keeps both flanks equal ────────────────────
{
  const { segments } = buildResumeDiff("Reduced latency.", "Reduced p99 latency significantly.");
  assert.equal(segments[0].type, "equal");
  assert.equal(segments[0].text, "Reduced");
  assert.ok(segments.some((s) => s.type === "added" && s.text.includes("p99")), "inserted words appear as their own added segment");
}

// ── metricPrompts: only "[add metric: ...]" lines, capped at 6 ─────────────
{
  const manyMetricLines = Array.from({ length: 8 }, (_, i) => `Line ${i} [add metric: users impacted]`).join("\n");
  const { metricPrompts } = buildResumeDiff("", manyMetricLines);
  assert.equal(metricPrompts.length, 6, "metricPrompts caps at 6 even when more tagged lines exist");
  assert.equal(metricPrompts[0], "Line 0 [add metric: users impacted]", "metricPrompts preserves original line order");
}
{
  const { metricPrompts } = buildResumeDiff("", "Just a plain bullet with no tag.\nAnother plain line.");
  assert.deepEqual(metricPrompts, [], "no '[add metric:' tag anywhere yields an empty metricPrompts list");
}
{
  // metricPrompts is scanned case-insensitively and reads from the POLISHED
  // side only — an untagged source line never contributes.
  const { metricPrompts } = buildResumeDiff("Some source line [add metric: ignored].", "Grew revenue [ADD METRIC: dollar amount].");
  assert.deepEqual(metricPrompts, ["Grew revenue [ADD METRIC: dollar amount]."], "metricPrompts matches case-insensitively and reads only the polished text, not the source");
}

console.log("diff probes passed");
