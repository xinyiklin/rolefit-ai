// Job analysis and Fit Assessment are two independently sanitized halves of ONE
// provider response. The server already treats them that way; the client used
// to throw the screening away whenever the job half fell back to the local
// brief, turning a complete answer into "Fit Assessment unavailable" and inviting
// a second assessment-only request the combined call existed to avoid.
//
//   node src/lib/__evals__/job-analysis-fallback-fit-eval.mjs

import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const bundled = await esbuild.build({
  entryPoints: [fileURLToPath(new URL("../aiJobAnalysis.ts", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent"
});
const { extractedFromAiOrLocal } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

let checks = 0;
const check = (actual, expected, message) => {
  checks += 1;
  assert.deepEqual(actual, expected, message);
};

const POSTING = [
  "Senior Backend Engineer at Northwind.",
  "You will build Go services on Postgres and own their reliability.",
  "Requires five years of backend experience and production on-call."
].join("\n");

const VALID_FIT = {
  verdict: "REASONABLE",
  summary: "Provider-owned summary is ignored.",
  matches: ["Go services in production"],
  gaps: ["Formal on-call rotation ownership"],
  eligibility: { status: "CLEAR" }
};

const USABLE_JOB_FIELDS = {
  source: "ai",
  title: "Senior Backend Engineer",
  company: "Northwind",
  requiredQualifications: ["Five years of backend experience"],
  techKeywords: ["Go", "Postgres"],
  responsibilities: ["Build Go services on Postgres"]
};

// The half that fails: every grounded content list came back empty, so the app
// honestly labels the brief "local" — but the screening beside it is intact.
const UNUSABLE_JOB_FIELDS = { source: "ai", title: "Senior Backend Engineer", fitAssessment: VALID_FIT };

{
  const result = extractedFromAiOrLocal(
    { ...USABLE_JOB_FIELDS, fitAssessment: VALID_FIT },
    POSTING,
    undefined,
    undefined,
    undefined,
    true
  );
  check(result.source, "ai", "usable job content is reported as AI-analyzed");
  check(result.fitAssessment?.verdict, "REASONABLE", "a valid screening survives the AI branch");
}

{
  const result = extractedFromAiOrLocal(UNUSABLE_JOB_FIELDS, POSTING, undefined, undefined, undefined, true);
  check(result.source, "local", "unusable job content still falls back to the local brief");
  check(Boolean(result.failure), true, "the job-analysis failure is still reported honestly");
  check(
    result.fitAssessment?.summary,
    "Your background aligns well, with a few material gaps.",
    "a valid screening survives a local job-analysis fallback — the halves are independent"
  );
  check(result.fitAssessment?.matches, VALID_FIT.matches, "the surviving screening keeps its grounded matches");
}

{
  const result = extractedFromAiOrLocal(
    { source: "ai", title: "Senior Backend Engineer", fitAssessment: { verdict: "NOT_A_VERDICT" } },
    POSTING,
    undefined,
    undefined,
    undefined,
    true
  );
  check(result.fitAssessment, null, "an unusable screening beside an unusable brief stays unavailable");
}

{
  const result = extractedFromAiOrLocal(
    { ...USABLE_JOB_FIELDS, fitAssessment: VALID_FIT },
    POSTING,
    undefined,
    undefined,
    undefined,
    false
  );
  check(result.fitAssessment, null, "a screening nobody asked for is never adopted");
  check(result.fitAssessmentRequested, false, "the request flag reports what was actually asked for");
}

{
  const result = extractedFromAiOrLocal(null, POSTING, undefined, undefined, undefined, true);
  check(result.source, "local", "an absent response falls back locally");
  check(result.fitAssessment, null, "an absent response carries no screening to preserve");
}

console.log(`Job analysis fallback fit eval: ${checks}/${checks} checks passed`);
