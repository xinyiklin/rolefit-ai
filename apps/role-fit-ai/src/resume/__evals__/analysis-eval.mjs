// Probes for analyzeResumeText (src/resume/analysis.ts) — the deterministic
// mechanical document analysis the editor/tailor workflow reads for
// missing-keyword hints and over-limit bullet groups. This module deliberately
// excludes fit scoring/verdict (AI Review owns those); lock that it returns
// only the two mechanical fields and stays well-behaved on empty input.
//
//   node src/resume/__evals__/analysis-eval.mjs
//
// analysis.ts imports ./keywords and ./text (extensionless), so it must be
// BUNDLED before import, same as keywords-eval.mjs.

import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

async function loadAnalysis() {
  const entry = fileURLToPath(new URL("../analysis.ts", import.meta.url));
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

const { analyzeResumeText } = await loadAnalysis();

const JD = "Required: React, TypeScript, PostgreSQL, AWS, Kubernetes, Docker, GraphQL, and Terraform experience.";

// ── missingKeywords: keywords present in the JD but absent from the resume ──
{
  const { missingKeywords } = analyzeResumeText("Built things with React and TypeScript for two years.", JD);
  assert.ok(missingKeywords.includes("postgresql"), "a JD keyword absent from the resume is reported missing");
  assert.ok(missingKeywords.includes("aws"), "the aws catalog alias is reported missing when absent");
  assert.ok(!missingKeywords.includes("react"), "a JD keyword the resume actually uses is not reported missing");
  assert.ok(!missingKeywords.includes("typescript"), "typescript is present in the resume and excluded from the miss list");
}

// ── Every job keyword is missing when the resume text is empty ─────────────
{
  const { missingKeywords, trimmedBulletGroups } = analyzeResumeText("", JD);
  assert.ok(missingKeywords.includes("react"), "an empty resume is missing every JD keyword, including react");
  assert.ok(missingKeywords.includes("typescript"), "an empty resume is missing typescript too");
  assert.equal(trimmedBulletGroups, 0, "an empty resume has no bullet groups to trim");
}

// ── Both inputs empty: no keywords, no trimmed groups, never throws ────────
assert.deepEqual(analyzeResumeText("", ""), { missingKeywords: [], trimmedBulletGroups: 0 }, "empty resume and empty job text yields an all-empty, well-formed result");

// ── missingKeywords is capped at 10 and never invents a keyword absent from the JD ──
{
  const bigJd = "Required: React, TypeScript, PostgreSQL, AWS, Azure, Google Cloud, Docker, Kubernetes, GraphQL, MongoDB, MySQL, Redis, Kafka, Terraform, Node.js, Python.";
  const { missingKeywords } = analyzeResumeText("", bigJd);
  assert.ok(missingKeywords.length <= 10, "missingKeywords never exceeds the 10-item cap");
  assert.ok(!missingKeywords.includes("golang"), "a technology never mentioned in the JD is never fabricated into the miss list");
}

// ── trimmedBulletGroups: a \n{2,}-separated group with MORE than 5 bullet lines counts ──
{
  const overLimitGroup = Array.from({ length: 7 }, (_, i) => `- Did thing ${i}`).join("\n");
  const { trimmedBulletGroups } = analyzeResumeText(overLimitGroup, "");
  assert.equal(trimmedBulletGroups, 1, "a single blank-line-delimited group with 7 bullets (over the 5-bullet limit) counts once");
}
{
  const atLimitGroup = Array.from({ length: 5 }, (_, i) => `- Did thing ${i}`).join("\n");
  const { trimmedBulletGroups } = analyzeResumeText(atLimitGroup, "");
  assert.equal(trimmedBulletGroups, 0, "exactly 5 bullets in a group is AT the limit, not over it — not counted");
}
{
  const twoOverLimitGroups = Array.from({ length: 2 }, () => Array.from({ length: 6 }, (_, i) => `- Did thing ${i}`).join("\n")).join("\n\n");
  const { trimmedBulletGroups } = analyzeResumeText(twoOverLimitGroups, "");
  assert.equal(trimmedBulletGroups, 2, "two separate over-limit groups both count independently");
}
{
  // Non-bullet lines mixed into a group do not count toward the bullet total.
  const mixedGroup = ["Software Engineer | Acme", ...Array.from({ length: 5 }, (_, i) => `- Did thing ${i}`)].join("\n");
  const { trimmedBulletGroups } = analyzeResumeText(mixedGroup, "");
  assert.equal(trimmedBulletGroups, 0, "a title line mixed into a 5-bullet group does not push the bullet count over the limit");
}

// ── Result shape: exactly the two mechanical fields, no fit/verdict/score ──
{
  const result = analyzeResumeText("Built things with React.", JD);
  assert.deepEqual(
    Object.keys(result).sort(),
    ["missingKeywords", "trimmedBulletGroups"],
    "analyzeResumeText returns only the two mechanical fields — no score, verdict, coverage, or recommendation (AI Review's sole responsibility)"
  );
}

console.log("resume analysis probes passed");
