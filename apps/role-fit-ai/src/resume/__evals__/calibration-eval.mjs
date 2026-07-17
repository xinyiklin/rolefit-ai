// Local-vs-AI fit-score calibration over the real application corpus.
//
//   node src/resume/__evals__/calibration-eval.mjs [path/to/applications.json]
//   node src/resume/__evals__/calibration-eval.mjs --search   (refit weights, LOO)
//   node src/resume/__evals__/calibration-eval.mjs --json     (also write a report)
//
// Measures how well the deterministic LOCAL engine (src/resume/scoring.ts) tracks
// the AI's judgment, scoring the SAME (tailored resume, job description) pairs the
// AI already scored. Two ground-truth signals live in the corpus:
//   - numeric  : tailoredFitScore when fitScoreSource === "ai"   (28 apps)
//   - ordinal  : review.verdict (STRONG/REASONABLE/STRETCH/DON'T) (45 apps)
// For each app we recompute analyzeResumeText(polishedText, jobDescription) with
// the REAL engine (esbuild-bundled, not re-implemented — zero drift) and compare.
//
// PRIVACY: prints only scores, tracker labels (company/title), and aggregate
// stats — never resume bullets or JD prose. The corpus it reads is gitignored.
//
// scoring.ts imports ./keywords + ./text, and fitVerdict.ts imports a type from
// ../resume/types, so both must be BUNDLED (not just transformed) before import.

import { Buffer } from "node:buffer";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..", "..");

async function loadModule(relFromHere) {
  const entry = fileURLToPath(new URL(relFromHere, import.meta.url));
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

const { analyzeResumeText } = await loadModule("../scoring.ts");
const { verdictFromScore } = await loadModule("../../lib/fitVerdict.ts");

// ── args ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const wantSearch = args.includes("--search");
const wantJson = args.includes("--json");
const pathArg = args.find((a) => !a.startsWith("--"));
const CORPUS = pathArg ? resolve(process.cwd(), pathArg) : join(ROOT, "job-search-workspace", "applications.json");

if (!existsSync(CORPUS)) {
  // An explicitly-passed path that's missing is a real user error.
  if (pathArg) {
    console.error(`calibration-eval: corpus not found at ${pathArg} (${CORPUS})`);
    process.exit(2);
  }
  // No path given and the default corpus is absent (clean checkout / CI). This is
  // a calibration tool over gitignored LOCAL data, not a clean-room regression
  // gate — so SKIP (exit 0) instead of failing the offline `npm test` suite that
  // auto-discovers it. It still gates drift on machines that have the corpus.
  console.log("calibration-eval: SKIP — no local corpus (job-search-workspace/applications.json absent).");
  process.exit(0);
}

// ── stats helpers ─────────────────────────────────────────────────────────────
const num = (n) => typeof n === "number" && Number.isFinite(n);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const median = (xs) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const std = (xs) => {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};
function pearson(xs, ys) {
  const n = xs.length;
  if (n < 2) return NaN;
  const mx = mean(xs);
  const my = mean(ys);
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  return vx > 0 && vy > 0 ? cov / Math.sqrt(vx * vy) : NaN;
}
function rankify(xs) {
  const idx = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1].v === idx[i].v) j += 1;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) ranks[idx[k].i] = avg;
    i = j + 1;
  }
  return ranks;
}
const spearman = (xs, ys) => pearson(rankify(xs), rankify(ys));
const pad = (s, w) => (String(s).length >= w ? String(s).slice(0, w) : String(s) + " ".repeat(w - String(s).length));
const padl = (s, w) => (String(s).length >= w ? String(s).slice(0, w) : " ".repeat(w - String(s).length) + String(s));

const VERDICT_ORDER = ["DON'T APPLY", "STRETCH", "REASONABLE FIT", "STRONG FIT"];
const verdictRank = (v) => VERDICT_ORDER.indexOf(v);

// ── build rows ────────────────────────────────────────────────────────────────
const parsed = JSON.parse(readFileSync(CORPUS, "utf8"));
const apps = Array.isArray(parsed) ? parsed : parsed.applications ?? [];

const rows = [];
for (const app of apps) {
  const resumeText = (app.polishedText ?? "").trim();
  const jobText = (app.jobDescription ?? "").trim();
  if (!resumeText || !jobText) continue;
  const analysis = analyzeResumeText(resumeText, jobText);
  const localOverall = analysis.score.overall;
  rows.push({
    label: `${app.company ?? "?"} — ${app.title ?? "?"}`.slice(0, 42),
    source: app.fitScoreSource ?? "?",
    aiTailored: num(app.tailoredFitScore) ? app.tailoredFitScore : null,
    aiVerdict: app.review?.verdict ?? null,
    localOverall,
    localBand: verdictFromScore(localOverall),
    sub: analysis.score,
    missingLocal: analysis.missingKeywords.length
  });
}

const setA = rows.filter((r) => r.source === "ai" && r.aiTailored !== null);
const setB = rows.filter((r) => r.aiVerdict !== null);

// ── report ─────────────────────────────────────────────────────────────────────
function bandStats() {
  let exact = 0;
  let offByOne = 0;
  let localHigher = 0;
  let localLower = 0;
  const matrix = new Map();
  for (const r of setB) {
    const gap = verdictRank(r.localBand) - verdictRank(r.aiVerdict);
    if (gap === 0) exact += 1;
    if (Math.abs(gap) === 1) offByOne += 1;
    if (gap > 0) localHigher += 1;
    if (gap < 0) localLower += 1;
    matrix.set(`${r.aiVerdict}|${r.localBand}`, (matrix.get(`${r.aiVerdict}|${r.localBand}`) ?? 0) + 1);
  }
  return { exact, offByOne, localHigher, localLower, matrix };
}

function report() {
  const out = [];
  const p = (s = "") => out.push(s);
  const localA = setA.map((r) => r.localOverall);
  const aiA = setA.map((r) => r.aiTailored);
  const deltas = setA.map((r) => r.localOverall - r.aiTailored);
  const absErr = deltas.map(Math.abs);

  p("=".repeat(78));
  p("  LOCAL-vs-AI FIT CALIBRATION   (real engine over real application corpus)");
  p("=".repeat(78));
  p(`  apps total ${apps.length}   scored ${rows.length}   Set A (numeric ai) ${setA.length}   Set B (verdict) ${setB.length}`);
  p("");
  p("-".repeat(78));
  p(`  A. NUMERIC  local overall vs AI tailoredFitScore   (n=${setA.length})`);
  p("-".repeat(78));
  p(`  Pearson r ${pearson(localA, aiA).toFixed(3)}   Spearman rho ${spearman(localA, aiA).toFixed(3)}`);
  p(`  MAE ${mean(absErr).toFixed(1)}   median|err| ${median(absErr).toFixed(1)}   max|err| ${Math.max(...absErr)}`);
  p(`  signed bias ${mean(deltas) >= 0 ? "+" : ""}${mean(deltas).toFixed(1)} (local ${mean(deltas) >= 0 ? "OVER" : "UNDER"}-scores AI; sd ${std(deltas).toFixed(1)})`);
  p(`  local mean ${mean(localA).toFixed(1)} vs AI mean ${mean(aiA).toFixed(1)}`);
  const within = (t) => `${absErr.filter((e) => e <= t).length}/${setA.length}`;
  p(`  within +/-5 ${within(5)}   +/-10 ${within(10)}   +/-15 ${within(15)}`);
  p("");
  p("  Largest divergences (local-AI) with local sub-scores kwFit/bul/sen/str/con:");
  const worst = [...setA].sort((a, b) => Math.abs(b.localOverall - b.aiTailored) - Math.abs(a.localOverall - a.aiTailored)).slice(0, 12);
  for (const r of worst) {
    const d = r.localOverall - r.aiTailored;
    const s = r.sub;
    p("  " + pad(r.label, 42) + padl(r.aiTailored, 4) + padl(r.localOverall, 5) + padl((d >= 0 ? "+" : "") + d, 5) + `   ${s.keywordFit}/${s.bulletQuality}/${s.seniority}/${s.structure}/${s.concision}`);
  }
  p("");
  p("-".repeat(78));
  p(`  B. VERDICT  verdictFromScore(local) vs AI review.verdict   (n=${setB.length})`);
  p("-".repeat(78));
  const { exact, offByOne, localHigher, localLower, matrix } = bandStats();
  p(`  exact band ${exact}/${setB.length} (${((exact / setB.length) * 100).toFixed(0)}%)   within one ${exact + offByOne}/${setB.length} (${(((exact + offByOne) / setB.length) * 100).toFixed(0)}%)`);
  p(`  disagreements: local more generous ${localHigher}   local harsher ${localLower}`);
  p("");
  const short = { "DON'T APPLY": "DONT", STRETCH: "STRTCH", "REASONABLE FIT": "REASON", "STRONG FIT": "STRONG" };
  p("  confusion (row = AI verdict / truth, col = local band):");
  p("  " + pad("AI \\ local", 14) + VERDICT_ORDER.map((v) => padl(short[v], 8)).join("") + padl("Sum", 6));
  for (const ai of VERDICT_ORDER) {
    if (!setB.some((r) => r.aiVerdict === ai)) continue;
    let rowSum = 0;
    const cells = VERDICT_ORDER.map((loc) => {
      const c = matrix.get(`${ai}|${loc}`) ?? 0;
      rowSum += c;
      return padl(c ? c : ".", 8);
    });
    p("  " + pad(short[ai], 14) + cells.join("") + padl(rowSum, 6));
  }
  p("");
  p("-".repeat(78));
  p(`  C. LOCAL SUB-SCORE behaviour across all ${rows.length} scored apps`);
  p("-".repeat(78));
  p("  " + pad("sub-score", 16) + padl("mean", 7) + padl("median", 8) + padl("min", 6) + padl("max", 6) + padl("sd", 7));
  for (const k of ["overall", "keywordFit", "bulletQuality", "seniority", "structure", "concision"]) {
    const vs = rows.map((r) => r.sub[k]);
    p("  " + pad(k, 16) + padl(mean(vs).toFixed(1), 7) + padl(median(vs), 8) + padl(Math.min(...vs), 6) + padl(Math.max(...vs), 6) + padl(std(vs).toFixed(1), 7));
  }
  p("=".repeat(78));
  console.log(out.join("\n"));

  if (wantJson) {
    const jsonPath = join(ROOT, "job-search-workspace", "tailor-eval", "calibration-report.json");
    writeFileSync(
      jsonPath,
      JSON.stringify(
        {
          counts: { apps: apps.length, scored: rows.length, setA: setA.length, setB: setB.length },
          numeric: { pearson: pearson(localA, aiA), spearman: spearman(localA, aiA), mae: mean(absErr), signedBias: mean(deltas), localMean: mean(localA), aiMean: mean(aiA) },
          verdict: { exact, offByOne, localHigher, localLower, n: setB.length },
          rows: rows.map((r) => ({ label: r.label, source: r.source, aiTailored: r.aiTailored, aiVerdict: r.aiVerdict, localOverall: r.localOverall, localBand: r.localBand, sub: r.sub }))
        },
        null,
        2
      )
    );
    console.log(`\n[wrote JSON report -> ${jsonPath}]`);
  }
}

// ── --search: fit the corpus-calibration affine map ───────────────────────────
// The rubric (a fixed weighted blend of the engine's sub-scores) scores on a
// stricter, compressed curve than the AI requirement-coverage judge. This fits
// the affine map  calibrated = clamp(SLOPE * rubric + OFFSET)  that best aligns
// the rubric to the AI on THIS user's own applications. Objective is primarily
// VERDICT-BAND agreement (the user-facing signal — the UI shows a band, not a
// number) on Set B, with numeric MAE on Set A as the tie-break. It is validated
// leave-one-out so the reported agreement is generalisation, not in-sample fit.
// These RUBRIC_WEIGHTS MIRROR scoreResume in src/resume/scoring.ts — keep in sync.
const RUBRIC_WEIGHTS = { keywordFit: 0.45, bulletQuality: 0.18, seniority: 0.15, structure: 0.07, concision: 0.15 };
const rubricOf = (sub) => Object.entries(RUBRIC_WEIGHTS).reduce((acc, [k, w]) => acc + w * sub[k], 0);
const calibrate = (rubric, slope, offset) => Math.max(0, Math.min(100, Math.round(slope * rubric + offset)));

// Over-generous band errors (local claims a HIGHER fit than the AI) are worse
// than conservative ones: a local "Strong fit" where the AI says "Don't apply"
// pushes the user toward a bad application, against the app's truthful-fit ethos.
// So the ordinal tie-break weights over-claims more heavily than under-claims.
const OVERCLAIM_COST = 2.5;
const UNDERCLAIM_COST = 1.0;
function bandObjective(rowsB, slope, offset) {
  // EXACT band matches (maximise) and an asymmetric ordinal cost (minimise).
  // Exact-as-primary makes the objective ungameable by compression: a map that
  // squashes every app into the middle band scores high on "within one" but
  // tanks exact, so it can never win here.
  let exact = 0;
  let cost = 0;
  let overclaims = 0;
  for (const r of rowsB) {
    const band = verdictFromScore(calibrate(rubricOf(r.sub), slope, offset));
    const gap = verdictRank(band) - verdictRank(r.aiVerdict); // + => local more generous
    if (gap === 0) exact += 1;
    else if (gap > 0) {
      cost += gap * OVERCLAIM_COST;
      overclaims += 1;
    } else cost += -gap * UNDERCLAIM_COST;
  }
  return { exact, cost, overclaims };
}
function maeObjective(rowsA, slope, offset) {
  return mean(rowsA.map((r) => Math.abs(calibrate(rubricOf(r.sub), slope, offset) - r.aiTailored)));
}
function fitAffine(rowsA, rowsB) {
  let best = null;
  for (let slope = 0.8; slope <= 2.0001; slope += 0.05) {
    for (let offset = -30; offset <= 30; offset += 1) {
      const { exact, cost, overclaims } = bandObjective(rowsB, slope, offset);
      const mae = rowsA.length ? maeObjective(rowsA, slope, offset) : 0;
      // maximise exact band matches; tie-break on lower asymmetric cost, then MAE.
      const better =
        !best ||
        exact > best.exact ||
        (exact === best.exact && cost < best.cost - 1e-9) ||
        (exact === best.exact && Math.abs(cost - best.cost) < 1e-9 && mae < best.mae);
      if (better) best = { slope: Number(slope.toFixed(2)), offset, exact, cost, overclaims, mae };
    }
  }
  return best;
}

function search() {
  if (setB.length < 6) {
    console.error("search needs more verdict-bearing apps than available");
    process.exit(2);
  }
  const best = fitAffine(setA, setB);

  // In-sample band agreement at the fitted map.
  let exact = 0;
  let within = 0;
  for (const r of setB) {
    const gap = Math.abs(verdictRank(verdictFromScore(calibrate(rubricOf(r.sub), best.slope, best.offset))) - verdictRank(r.aiVerdict));
    if (gap === 0) exact += 1;
    if (gap <= 1) within += 1;
  }
  // Leave-one-out over Set B: refit the map without app i, then predict its band.
  let looExact = 0;
  for (let i = 0; i < setB.length; i += 1) {
    const trainB = setB.filter((_, j) => j !== i);
    // Hold the same app out of the numeric training set by object identity
    // (setA and setB share row references) — labels can collide after truncation.
    const trainA = setA.filter((r) => r !== setB[i]);
    const fit = fitAffine(trainA, trainB);
    if (verdictFromScore(calibrate(rubricOf(setB[i].sub), fit.slope, fit.offset)) === setB[i].aiVerdict) looExact += 1;
  }
  const localA = setA.map((r) => calibrate(rubricOf(r.sub), best.slope, best.offset));
  const aiA = setA.map((r) => r.aiTailored);

  const out = [];
  out.push("=".repeat(78));
  out.push("  --search: fitted corpus-calibration affine map  clamp(SLOPE*rubric + OFFSET)");
  out.push("=".repeat(78));
  out.push(`  rubric weights ${JSON.stringify(RUBRIC_WEIGHTS)}`);
  out.push(`  BEST  SLOPE ${best.slope}   OFFSET ${best.offset}   (over-claim band errors: ${best.overclaims})`);
  out.push(`  in-sample verdict band: exact ${exact}/${setB.length} (${((exact / setB.length) * 100).toFixed(0)}%)   within one ${within}/${setB.length} (${((within / setB.length) * 100).toFixed(0)}%)`);
  out.push(`  leave-one-out verdict band: exact ${looExact}/${setB.length} (${((looExact / setB.length) * 100).toFixed(0)}%)`);
  out.push(`  numeric MAE ${maeObjective(setA, best.slope, best.offset).toFixed(1)}   Pearson r ${pearson(localA, aiA).toFixed(3)}   Spearman rho ${spearman(localA, aiA).toFixed(3)}`);
  out.push("");
  out.push("  Frontier (best OFFSET per SLOPE; pick the conservative knee, not the global max):");
  out.push("  " + pad("slope", 7) + padl("off", 5) + padl("exact%", 8) + padl("overcl", 8) + padl("bias", 7) + padl("MAE", 6) + padl("locMax", 8) + padl("reachesStrong", 15));
  for (let slope = 0.9; slope <= 1.4001; slope += 0.1) {
    let bo = null;
    for (let offset = -25; offset <= 25; offset += 1) {
      const { exact: ex, cost } = bandObjective(setB, slope, offset);
      if (!bo || ex > bo.ex || (ex === bo.ex && cost < bo.cost)) bo = { offset, ex, cost };
    }
    const s = Number(slope.toFixed(2));
    const calA = setA.map((r) => calibrate(rubricOf(r.sub), s, bo.offset));
    const bias = mean(calA.map((v, i) => v - aiA[i]));
    const mae = maeObjective(setA, s, bo.offset);
    const { overclaims: oc } = bandObjective(setB, s, bo.offset);
    const locMax = Math.max(...rows.map((r) => calibrate(rubricOf(r.sub), s, bo.offset)));
    const strong = rows.filter((r) => calibrate(rubricOf(r.sub), s, bo.offset) >= 85).length;
    out.push("  " + pad(s, 7) + padl(bo.offset, 5) + padl(`${((bo.ex / setB.length) * 100).toFixed(0)}%`, 8) + padl(oc, 8) + padl(bias.toFixed(1), 7) + padl(mae.toFixed(1), 6) + padl(locMax, 8) + padl(`${strong} apps`, 15));
  }
  out.push("=".repeat(78));
  console.log(out.join("\n"));
}

// --try=SLOPE,OFFSET : evaluate one candidate affine (band + numeric + safety).
const tryArg = args.find((a) => a.startsWith("--try"));
function tryOne() {
  const [slope, offset] = tryArg.split("=")[1].split(",").map(Number);
  let exact = 0;
  let within = 0;
  let over = 0;
  let under = 0;
  for (const r of setB) {
    const gap = verdictRank(verdictFromScore(calibrate(rubricOf(r.sub), slope, offset))) - verdictRank(r.aiVerdict);
    if (gap === 0) exact += 1;
    if (Math.abs(gap) <= 1) within += 1;
    if (gap > 0) over += 1;
    if (gap < 0) under += 1;
  }
  const calA = setA.map((r) => calibrate(rubricOf(r.sub), slope, offset));
  const aiA = setA.map((r) => r.aiTailored);
  const bias = mean(calA.map((v, i) => v - aiA[i]));
  const strong = rows.filter((r) => calibrate(rubricOf(r.sub), slope, offset) >= 85).length;
  const over2 = setB.filter((r) => verdictRank(verdictFromScore(calibrate(rubricOf(r.sub), slope, offset))) - verdictRank(r.aiVerdict) >= 2).length;
  console.log(
    `try slope ${slope} offset ${offset}: exact ${exact}/${setB.length} (${((exact / setB.length) * 100).toFixed(0)}%)  within1 ${within}/${setB.length}  over ${over} (>=2 bands: ${over2})  under ${under}  bias ${bias.toFixed(1)}  MAE ${maeObjective(setA, slope, offset).toFixed(1)}  Pearson ${pearson(calA, aiA).toFixed(3)}  STRONG-outputs ${strong}`
  );
}

// Drift guard for the hand-copied RUBRIC_WEIGHTS + (1.0, +5) affine. The
// seniority guardrail only ever LOWERS overall, so the engine's real overall
// must be <= our reconstruction (within integer rounding). Any row above it
// means this file's copy has drifted from scoring.ts and the --search fit would
// be misleading — fail loudly rather than silently misfit.
const EXPECTED_CAL = { slope: 1.0, offset: 5 };
const drift = rows.filter((r) => r.localOverall > calibrate(rubricOf(r.sub), EXPECTED_CAL.slope, EXPECTED_CAL.offset) + 1);
if (drift.length) {
  console.error(`\n!!! RUBRIC DRIFT: ${drift.length}/${rows.length} rows have engine overall ABOVE the eval's reconstruction.`);
  console.error(`    RUBRIC_WEIGHTS / the (slope,offset) affine in this file are STALE vs src/resume/scoring.ts — update them before trusting --search.\n`);
  process.exitCode = 1;
}

if (tryArg) tryOne();
else if (wantSearch) search();
else report();
