// Offline probes for keyword matching/extraction — the inputs to
// scoreKeywordFit. No personal data, no network.
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

  // --- catalog additions (cloud/devops/framework gaps found by auditing real
  // applications). Short / symbol / slashed terms are surfaced ONLY because they
  // are ROLE_KEYWORDS now: the generic token path drops <=3-char tokens and
  // splits on slashes, so a bare 'c#', 'aws', or 'ci/cd' would never appear
  // otherwise. (This supersedes the old "bare c# is not extracted" known-gap.)
  ["catalog: c# now extracted", extractKeywords("Strong C# and SQL experience").includes("c#")],
  ["catalog: aws now extracted", extractKeywords("Experience with AWS and Docker").includes("aws")],
  ["catalog: ci/cd now extracted", extractKeywords("Owns CI/CD pipelines and SQL").includes("ci/cd")],
  ["catalog: k8s alias matches kubernetes", includesKeyword("Deployed to k8s", "kubernetes")],
  ["catalog: gcp alias matches google cloud", includesKeyword("Ran services on GCP", "google cloud")],

  // --- false-positive guards for deliberately narrow aliases: bare English words
  // that are NOT the technology must not match (golang not bare 'go', 'spring
  // boot' not the season, 'express.js' not the verb).
  ["narrow alias: 'we go above and beyond' !~ go", !includesKeyword("we go above and beyond", "go")],
  ["narrow alias: 'graduating spring 2024' !~ spring boot", !includesKeyword("graduating spring 2024", "spring boot")],
  ["narrow alias: 'please express interest' !~ express", !includesKeyword("please express interest", "express")],

  // --- scaffold stopwords: the jobExtract distiller's own section labels are no
  // longer surfaced as required keywords (they are template furniture, not skills).
  ["scaffold dropped: 'domain signals' not extracted", !extractKeywords("Domain Signals: fintech and payments domain").includes("domain")],
  ["scaffold dropped: bare 'stack' not extracted", !extractKeywords("Tech Stack Keywords listed in the stack").includes("stack")],
  // full-stack must still match despite 'stack' being a stopword (alias path is
  // independent of STOP_WORDS).
  ["full-stack still matches", includesKeyword("Full-stack engineer", "full-stack")],

  // --- catalog collision guards (hardening audit): buildSummary/buildTechnicalSkills
  // ASSERT a skill on any match, so a unit/common-noun collision would FABRICATE
  // one. These aliases are intentionally kept OUT of ROLE_KEYWORDS — lock that.
  ["no fabricate: '5 ml per test' !~ machine learning", !includesKeyword("Reduced reagent to 5 ml per test", "machine learning")],
  ["no fabricate: 'shipping containers' !~ docker", !includesKeyword("Loaded shipping containers daily", "docker")],
  ["real Docker still matches", includesKeyword("Built images with Docker", "docker")],
  ["real machine learning still matches", includesKeyword("Trained machine learning models", "machine learning")]
];

const failures = checks.filter(([, ok]) => !ok);
if (failures.length) {
  for (const [name] of failures) console.error(`FAIL ${name}`);
  process.exit(1);
}

assert.equal(failures.length, 0);
console.log(`keywords probes passed (${checks.length}/${checks.length})`);
