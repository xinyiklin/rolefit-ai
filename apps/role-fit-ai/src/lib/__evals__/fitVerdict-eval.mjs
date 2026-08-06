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
const { activityCount, appFitVerdict, fitTone, matchesActivityFilter } = await load("../applicationDisplay.ts");
const { displayVerdictReason } = await load("../verdictReason.ts");
const {
  FIT_VERDICTS,
  LEGACY_VERDICT_TOKEN,
  deriveRecommendation,
  fitVerdictFromLegacyScore,
  fitVerdictRank,
  importantGaps,
  normalizeFitVerdict,
  normalizeLegacyVerdict,
  readStoredFitVerdict,
  strongestMatches,
  uncertainRequirements
} = await load("../../../shared/fitAssessmentContract.ts");
const {
  FIT_VERDICT_LABEL,
  FIT_VERDICT_TONE,
  RECOMMENDATION_LABEL,
  fitVerdictPillClass
} = await load("../fitAssessment.ts");

let pass = 0;
let fail = 0;
const check = (name, cond) => {
  if (cond) { pass += 1; console.log(`PASS ${name}`); }
  else { fail += 1; console.error(`FAIL ${name}`); }
};

// (a) score -> verdict boundaries mirror the band check in server/ai/sanitize.ts
// (sanitizeAiFitScore); the server has no verdict-from-score function of its own.
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

const lifecycleApplications = [
  { status: "interested" },
  { status: "applied" },
  { status: "interviewing" },
  { status: "offer" },
  { status: "rejected" },
  { status: "withdrawn" }
];
check("all includes every application status", lifecycleApplications.every((app) => matchesActivityFilter(app, "all")));
check("active excludes rejected and withdrawn", activityCount(lifecycleApplications, "active") === 4);
check("inactive contains rejected and withdrawn", activityCount(lifecycleApplications, "inactive") === 2);
check("exact active category filters to one stage", activityCount(lifecycleApplications, "interviewing") === 1);
check("exact inactive category filters to one stage", activityCount(lifecycleApplications, "withdrawn") === 1);
check(
  "exact category does not include neighboring stages",
  lifecycleApplications.filter((app) => matchesActivityFilter(app, "applied")).every((app) => app.status === "applied")
);

check(
  "legacy server cap reason becomes concise user copy",
  displayVerdictReason("Server verdict: 1 missing required qualification capped the fit score at 79, setting the REASONABLE FIT band.")
    === "One required qualification is missing. Fit score capped at 79."
);
check(
  "legacy stretch reason drops backend jargon",
  displayVerdictReason("Server verdict: recomputed from requirement-coverage evidence to the STRETCH band (score 62).")
    === "Important requirement gaps remain. Fit score: 62."
);
check(
  "legacy don't-apply reason drops backend jargon",
  displayVerdictReason("Server verdict: recomputed from requirement-coverage evidence to the DON'T APPLY band (score 32).")
    === "The reviewed evidence does not cover enough key requirements. Fit score: 32."
);
check("model-authored reason passes through", displayVerdictReason("The role needs production Go experience.") === "The role needs production Go experience.");

// ---------------------------------------------------------------------------
// New four-level vocabulary (shared/fitAssessmentContract.ts). The legacy
// checks above must keep passing unchanged: this PR introduces the words, it
// does not switch any surface over to them.
// ---------------------------------------------------------------------------

// Exactly four levels, strongest first. A fifth tier is the thing this
// vocabulary exists to prevent, so pin the list itself.
check("exactly four fit levels", FIT_VERDICTS.length === 4);
check(
  "fit levels are ordered strongest first",
  fitVerdictRank("STRONG_FIT") === 0 &&
    fitVerdictRank("REASONABLE_FIT") === 1 &&
    fitVerdictRank("STRETCH") === 2 &&
    fitVerdictRank("LIMITED_FIT") === 3
);

// Legacy -> new. "DON'T APPLY" was a recommendation, not a fit level.
check("legacy STRONG FIT normalizes", normalizeLegacyVerdict("STRONG FIT") === "STRONG_FIT");
check("legacy REASONABLE FIT normalizes", normalizeLegacyVerdict("REASONABLE FIT") === "REASONABLE_FIT");
check("legacy STRETCH normalizes", normalizeLegacyVerdict("STRETCH") === "STRETCH");
check("legacy DON'T APPLY becomes LIMITED_FIT", normalizeLegacyVerdict("DON'T APPLY") === "LIMITED_FIT");
check("garbage legacy verdict is null", normalizeLegacyVerdict("MAYBE") === null);
check("new token is not accepted as legacy", normalizeLegacyVerdict("STRONG_FIT") === null);
check("legacy string is not accepted as new", normalizeFitVerdict("STRONG FIT") === null);

// Saved records may hold either vocabulary during the migration.
check("stored reader accepts the new token", readStoredFitVerdict("LIMITED_FIT") === "LIMITED_FIT");
check("stored reader accepts the legacy string", readStoredFitVerdict("DON'T APPLY") === "LIMITED_FIT");
check("stored reader rejects anything else", readStoredFitVerdict("") === null);

// Round-trip: every new level maps back to the exact string old records hold.
check(
  "every fit level round-trips through the legacy token",
  FIT_VERDICTS.every((verdict) => normalizeLegacyVerdict(LEGACY_VERDICT_TOKEN[verdict]) === verdict)
);

// Legacy score bands survive for old records only, at the same boundaries the
// legacy checks above pin.
check("85 -> STRONG_FIT", fitVerdictFromLegacyScore(85) === "STRONG_FIT");
check("84 -> REASONABLE_FIT", fitVerdictFromLegacyScore(84) === "REASONABLE_FIT");
check("70 -> REASONABLE_FIT", fitVerdictFromLegacyScore(70) === "REASONABLE_FIT");
check("69 -> STRETCH", fitVerdictFromLegacyScore(69) === "STRETCH");
check("46 -> STRETCH", fitVerdictFromLegacyScore(46) === "STRETCH");
check("45 -> LIMITED_FIT", fitVerdictFromLegacyScore(45) === "LIMITED_FIT");
check("null score -> null", fitVerdictFromLegacyScore(null) === null);
check("NaN score -> null", fitVerdictFromLegacyScore(Number.NaN) === null);

// The legacy helper and the shared bands are now one table: same boundaries,
// legacy spelling out.
for (const score of [100, 85, 84, 70, 69, 46, 45, 0]) {
  check(
    `legacy verdictFromScore still agrees at ${score}`,
    verdictFromScore(score) === LEGACY_VERDICT_TOKEN[fitVerdictFromLegacyScore(score)]
  );
}

// AI Review owns recommendation. The shared response vocabulary may type it,
// but it must not calculate a replacement recommendation from other fields.
check("shared contract does not derive a recommendation", deriveRecommendation === undefined);

// One requirement array, so a row can never be both covered and missing.
const requirements = [
  { requirementId: "r1", status: "COVERED", importance: "CORE" },
  { requirementId: "r2", status: "ADJACENT", importance: "CORE" },
  { requirementId: "r3", status: "MISSING", importance: "CORE" },
  { requirementId: "r4", status: "MISSING", importance: "SUPPORTING" },
  { requirementId: "r5", status: "UNCERTAIN", importance: "CORE" },
  { requirementId: "r6", status: "COVERED", importance: "SUPPORTING" }
];
const matched = strongestMatches(requirements).map((item) => item.requirementId);
const gaps = importantGaps(requirements).map((item) => item.requirementId);
check("strongest matches are the covered rows", matched.join() === "r1,r6");
check("important gaps are CORE missing/adjacent only", gaps.join() === "r2,r3");
check("uncertain rows are their own bucket", uncertainRequirements(requirements).map((i) => i.requirementId).join() === "r5");
check(
  "a requirement is never both a match and a gap",
  matched.every((id) => !gaps.includes(id))
);
const duplicateRequirements = [
  { requirementId: "r7", status: "COVERED", importance: "CORE" },
  { requirementId: "r7", status: "MISSING", importance: "CORE" }
];
check(
  "duplicate requirement ids are rejected before deriving views",
  [strongestMatches, importantGaps, uncertainRequirements].every((view) => {
    try {
      view(duplicateRequirements);
      return false;
    } catch (error) {
      return error instanceof TypeError && error.message.includes('duplicate requirementId "r7"');
    }
  })
);

// Display layer: every level has a word, a tone, and a class.
check("every fit level has a label", FIT_VERDICTS.every((verdict) => Boolean(FIT_VERDICT_LABEL[verdict])));
check("Don't apply is gone from the new labels", !Object.values(FIT_VERDICT_LABEL).includes("Don't apply"));
check("LIMITED_FIT reads as Limited fit", FIT_VERDICT_LABEL.LIMITED_FIT === "Limited fit");
check("recommendation uses the Polish action name", RECOMMENDATION_LABEL.TAILOR_FIRST === "Polish first");
check(
  "new tones reuse the existing color bands",
  FIT_VERDICTS.every((verdict) => ["strong", "good", "stretch", "weak"].includes(FIT_VERDICT_TONE[verdict]))
);
check(
  "new labels and tones agree with the legacy pair for every level",
  FIT_VERDICTS.every(
    (verdict) =>
      FIT_VERDICT_TONE[verdict] === VERDICT_TONE[LEGACY_VERDICT_TOKEN[verdict]] &&
      (verdict === "LIMITED_FIT" ||
        FIT_VERDICT_LABEL[verdict] === VERDICT_LABEL[LEGACY_VERDICT_TOKEN[verdict]])
  )
);
check("new pill class matches the shipped class", fitVerdictPillClass("STRONG_FIT") === "verdict-pill--strong-fit");
check("stretch pill class matches the shipped class", fitVerdictPillClass("STRETCH") === "verdict-pill--stretch");
check("limited fit gets its own pill class", fitVerdictPillClass("LIMITED_FIT") === "verdict-pill--limited-fit");

console.log(`\n${pass}/${pass + fail} fit-verdict checks passed.`);
assert.equal(fail, 0, `${fail} fit-verdict checks failed`);
