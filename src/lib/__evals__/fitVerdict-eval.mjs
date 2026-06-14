// Offline lock for fit-verdict CONSISTENCY across surfaces (resume header,
// review rail, application tracker). The recurring bug was the tracker showing
// a different "status" than strict review. These checks pin: (a) score->verdict
// boundaries mirror the server bands, (b) the verdict-derived tone matches the
// fitTone color band for the same score (so label and color never disagree),
// (c) a stored AI verdict wins over the score.
//
//   node src/lib/__evals__/fitVerdict-eval.mjs

import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Buffer } from "node:buffer";
import * as esbuild from "esbuild";

// Bundle (not transform): applicationDisplay.ts now imports ./fitVerdict, so the
// relative dependency must be resolved. Type-only imports are erased by esbuild.
async function load(rel) {
  const result = await esbuild.build({
    entryPoints: [fileURLToPath(new URL(rel, import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false
  });
  const code = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

const { verdictFromScore, VERDICT_LABEL, VERDICT_TONE, verdictPillClass } = await load("../fitVerdict.ts");
const { appFitVerdict, fitTone } = await load("../applicationDisplay.ts");

let pass = 0;
let fail = 0;
const check = (name, cond) => {
  if (cond) { pass += 1; console.log(`PASS ${name}`); }
  else { fail += 1; console.error(`FAIL ${name}`); }
};

// (a) score -> verdict boundaries mirror server verdictForScore.
check("85 -> STRONG FIT", verdictFromScore(85) === "STRONG FIT");
check("84 -> REASONABLE FIT", verdictFromScore(84) === "REASONABLE FIT");
check("70 -> REASONABLE FIT", verdictFromScore(70) === "REASONABLE FIT");
check("69 -> STRETCH", verdictFromScore(69) === "STRETCH");
check("46 -> STRETCH", verdictFromScore(46) === "STRETCH");
check("45 -> DON'T APPLY", verdictFromScore(45) === "DON'T APPLY");
check("null -> null", verdictFromScore(null) === null);

// (b) verdict-derived tone == fitTone(score) for every band — label and color
// come out of the same band, so a card can't show one band's word in another
// band's color.
for (const score of [95, 78, 55, 20]) {
  const v = verdictFromScore(score);
  check(`tone agrees at ${score}`, VERDICT_TONE[v] === fitTone(score));
}

// (c) a stored AI verdict wins over the score (the tracker shows the real,
// gap-capped verdict captured at apply time — e.g. a BLOCKER DON'T APPLY even if
// a stale score reads higher).
{
  const app = { fitScore: 82, review: { verdict: "DON'T APPLY", verdictReason: "", riskFlags: [], gaps: [], recommendation: {} } };
  const r = appFitVerdict(app);
  check("stored verdict wins over score", r?.verdict === "DON'T APPLY" && r?.label === "Don't apply");
}
{
  const app = { fitScore: 78 };
  const r = appFitVerdict(app);
  check("no stored verdict -> derive from score", r?.verdict === "REASONABLE FIT" && r?.label === "Reasonable fit");
}
{
  const app = { fitScore: null };
  check("no score, no verdict -> null", appFitVerdict(app) === null);
}

// invalid stored verdict string falls back to the score, not a crash.
{
  const app = { fitScore: 90, review: { verdict: "MAYBE", verdictReason: "", riskFlags: [], gaps: [], recommendation: {} } };
  check("garbage verdict falls back to score", appFitVerdict(app)?.verdict === "STRONG FIT");
}

// pill-class transform matches the review rail's (don-t-apply).
check("pill class for DON'T APPLY", verdictPillClass("DON'T APPLY") === "verdict-pill--don-t-apply");
check("label map complete", VERDICT_LABEL["STRETCH"] === "Stretch");

console.log(`\n${pass}/${pass + fail} fit-verdict checks passed.`);
assert.equal(fail, 0, `${fail} fit-verdict checks failed`);
