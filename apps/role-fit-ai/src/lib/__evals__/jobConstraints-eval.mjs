// Offline checks for the lifestyle/logistical constraint extractor. No network.
//
//   node src/lib/__evals__/jobConstraints-eval.mjs
//
// These conditions feed the "Before you apply" advisory ONLY — never the fit
// verdict. The eval pins that (a) common conditions are detected with the real
// JD wording, and (b) plain qualification text does NOT trip a false advisory.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import * as esbuild from "esbuild";

async function load() {
  const source = await readFile(new URL("../jobConstraints.ts", import.meta.url), "utf8");
  const output = await esbuild.transform(source, { loader: "ts", format: "esm" });
  return import(`data:text/javascript;base64,${Buffer.from(output.code).toString("base64")}`);
}

const { extractJobConstraints } = await load();

const kinds = (text) => extractJobConstraints(text).map((c) => c.kind).sort();
let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass += 1; console.log(`PASS ${name}`); }
  else { fail += 1; console.error(`FAIL ${name}`); }
}

// --- positive detections ---
check("travel percentage", kinds("Requires travel up to 50% to client sites.").includes("travel"));
check("travel willingness", kinds("Must be willing to travel for quarterly onsites.").includes("travel"));
check("relocation", kinds("Relocation is required; candidate must relocate to Austin.").includes("relocation"));
check("onsite days", kinds("This is an on-site role, 5 days per week in office.").includes("onsite"));
check("night shift", kinds("Supports overnight operations on a rotating night shift.").includes("shift"));
check("on-call", kinds("Participate in a weekly on-call rotation for production support.").includes("oncall"));
check("weekends", kinds("Weekend availability required during peak season.").includes("weekends"));
check("overtime", kinds("Overtime may be required to meet deadlines.").includes("overtime"));
check("physical lift", kinds("Must be able to lift up to 50 lbs repeatedly.").includes("physical"));
check("commute license", kinds("A valid driver's license and reliable transportation are required.").includes("commute"));

// detail carries the real wording
{
  const c = extractJobConstraints("Position requires travel up to 50% domestically.");
  check("detail keeps JD wording", c.length === 1 && /50\s*%/.test(c[0].detail));
}

// multiple conditions in one JD, deduped to one per kind
{
  const jd = "On-site 4 days per week. Travel up to 25%. On-call rotation. On-call duties shared across the team.";
  const k = kinds(jd);
  check("multiple kinds detected", k.includes("onsite") && k.includes("travel") && k.includes("oncall"));
  check("deduped one-per-kind", extractJobConstraints(jd).filter((c) => c.kind === "oncall").length === 1);
}

// --- negatives: pure qualification text must NOT trip an advisory ---
check("plain skills text → none", kinds("Strong Python, React, and PostgreSQL experience. Build REST APIs.").length === 0);
check("'travel' as a domain word → none", kinds("Build software for the corporate travel booking platform.").length === 0);
check("empty JD → none", kinds("").length === 0);

console.log(`\n${pass}/${pass + fail} constraint checks passed.`);
assert.equal(fail, 0, `${fail} constraint checks failed`);
