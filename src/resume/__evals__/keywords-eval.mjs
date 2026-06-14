// Offline probes for keyword matching/extraction — the inputs to scoreKeywordFit
// and analyzeMatchBreakdown. No personal data, no network.
//
//   node src/resume/__evals__/keywords-eval.mjs
//
// keywords.ts imports ./text, so (unlike the self-contained jobExtract eval) it
// must be BUNDLED, not just transformed, before it can be imported.

import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

async function loadKeywords() {
  const entry = fileURLToPath(new URL("../keywords.ts", import.meta.url));
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

const { includesKeyword, extractKeywords } = await loadKeywords();

const checks = [
  // --- includesKeyword: a keyword ending a sentence with a period now matches.
  // (Regression guard for the boundary-period fix: normalizeText keeps '.', so
  // "Used Python." used to miss because the match is space-boundary anchored.)
  ["trailing period matches: 'Used Python.' ~ python", includesKeyword("Used Python.", "python")],
  ["trailing period matches: 'in C++.' ~ c++", includesKeyword("Wrote code in C++.", "c++")],
  ["trailing period matches: 'wrote SQL.' ~ sql", includesKeyword("She wrote SQL.", "sql")],

  // --- internal periods must stay intact (the fix only touches boundary dots).
  ["internal period preserved: Node.js ~ node.js", includesKeyword("Built with Node.js services", "node.js")],
  [".net preserved", includesKeyword("Shipped a .NET backend", ".net")],
  ["node.js at sentence end still matches", includesKeyword("All built on Node.js.", "node.js")],

  // --- no NEW false positives from the boundary-period change.
  ["no false match: 'guava.' !~ java", !includesKeyword("I love guava.", "java")],
  ["space-boundary still required: 'javascript' !~ java", !includesKeyword("Strong JavaScript skills", "java")],

  // --- slash/alias matching unchanged.
  ["html/css matches", includesKeyword("strong HTML/CSS skills", "html/css")],

  // --- extractKeywords: a bigram needs a repeat (2 x 1.5 = 3) to rank; a
  // one-off bigram is sentence noise and must NOT appear.
  ["repeated bigram extracted", extractKeywords("machine learning models and machine learning pipelines").includes("machine learning")],
  // A one-off bigram of CONTENT words (not stop-words) must be dropped — this
  // actually exercises the count >= 3 frequency threshold, unlike a stop-word
  // pair that never forms a bigram at all.
  ["single-occurrence content bigram dropped", !extractKeywords("payment reconciliation across ledgers").includes("payment reconciliation")],

  // --- KNOWN LIMITATION, locked so a future change is deliberate: extractKeywords'
  // token path requires length > 3 and 'c#' is not a ROLE_KEYWORD, so a bare 'c#'
  // is not surfaced as an extracted keyword. (See keywords.ts isContentWord.)
  ["known gap: bare c# is not extracted", !extractKeywords("Strong C# and SQL experience").includes("c#")]
];

const failures = checks.filter(([, ok]) => !ok);
if (failures.length) {
  for (const [name] of failures) console.error(`FAIL ${name}`);
  process.exit(1);
}

assert.equal(failures.length, 0);
console.log(`keywords probes passed (${checks.length}/${checks.length})`);
