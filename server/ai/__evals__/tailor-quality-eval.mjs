// Live tailor quality + consistency harness: drives the real handlePolish
// route N times with IDENTICAL input (the local base resume vs a captured job
// description) and grades the runs on consistency, style, grounding, and fit
// movement.
//
// Privacy: prints ONLY shape-level metrics (counts, scores, target ids,
// flagged tokens). Full route responses are written to the gitignored
// job-search-workspace/tailor-eval/ for manual inspection. Never prints resume
// or JD text.
//
// Usage:
//   node server/ai/__evals__/tailor-quality-eval.mjs <jd-file> [runs] [resume.tex]
//     jd-file    - .json with a `tailoringText` field (job-import capture) or a
//                  plain .txt job description. Samples live in
//                  job-search-workspace/tailor-eval/samples/.
//     runs       - concurrent identical runs (default 3)
//     resume.tex - LaTeX resume (default job-search-workspace/base-resume.tex)
//   EVAL_PROVIDER / EVAL_MODEL override the provider (default claude-cli/opus).
//
// Reading the output:
//   - suggestionCounts + targetJaccard: do runs converge on the same weak spots
//   - aiTailored spread: scoring consistency (post arithmetic-bucket derivation)
//   - banned / suspectNewTokens: brochure vocabulary / possible ungrounded terms
//     (suspect tokens are heuristic — verbs like "Hardened" are benign; any
//     TECH-looking token here warrants opening the saved run JSON)
//   - localBase/localTailored: deterministic keyword-engine score (built from
//     src/resumeEngine.ts via esbuild when available; skipped otherwise)

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { handlePolish } from "../polish.mjs";
import { extractPlainTextFromLatex } from "../../latex/parseResumeText.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const PROVIDER = process.env.EVAL_PROVIDER || "claude-cli";
const MODEL = process.env.EVAL_MODEL ?? (PROVIDER === "claude-cli" ? "opus" : "");

const jdArg = process.argv[2];
if (!jdArg) {
  console.error("Usage: node server/ai/__evals__/tailor-quality-eval.mjs <jd-file> [runs] [resume.tex]");
  process.exit(2);
}
const RUNS = Number(process.argv[3] || 3);
const jdPath = isAbsolute(jdArg) ? jdArg : join(ROOT, jdArg);
const resumePath = process.argv[4]
  ? (isAbsolute(process.argv[4]) ? process.argv[4] : join(ROOT, process.argv[4]))
  : join(ROOT, "job-search-workspace/base-resume.tex");
const OUT_DIR = join(ROOT, "job-search-workspace/tailor-eval");
mkdirSync(OUT_DIR, { recursive: true });

const jdRaw = readFileSync(jdPath, "utf8");
const jobText = jdPath.endsWith(".json") ? JSON.parse(jdRaw).tailoringText : jdRaw;
const resumePlain = extractPlainTextFromLatex(readFileSync(resumePath, "utf8"));
const label = jdPath.replace(/^.*\//, "").replace(/\.(json|txt)$/, "");

// Optional deterministic scorer: bundle src/resumeEngine.ts on demand.
let analyzeResumeText = null;
try {
  const bundle = join(tmpdir(), "rolefit-engine-bundle.mjs");
  if (!existsSync(bundle)) {
    execSync(`npx esbuild "${join(ROOT, "src/resumeEngine.ts")}" --bundle --format=esm --platform=node --outfile="${bundle}" --log-level=error`, { cwd: ROOT, stdio: "pipe" });
  }
  ({ analyzeResumeText } = await import(bundle));
} catch {
  console.log("(local-engine scoring skipped: esbuild bundle unavailable)");
}

// --- plain text -> tailorScope, mirroring the frontend defaults: tailor
// experience/projects/skills, omit education/identity/contact ---
function buildScope(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const sections = [];
  let cs = null, ce = null, si = 0, ei = 0, bi = 0;
  for (const line of lines) {
    if (!line) continue;
    if (/^[A-Z][A-Z &/]+$/.test(line) && line.length < 40) {
      si++; ei = 0;
      cs = { id: `section-${si}`, heading: line, type: /skills/i.test(line) ? "skills" : "standard", entries: [] };
      sections.push(cs); ce = null; continue;
    }
    if (!cs) continue;
    if (cs.type === "skills") {
      ei++;
      const m = line.match(/^([^:]{2,40}):\s*(.+)$/);
      cs.entries.push({ id: `entry-${si}-${ei}`, titleLeft: m ? m[1] : "Skills", titleRight: "", subtitleLeft: m ? m[2] : line, subtitleRight: "", bullets: [] });
      continue;
    }
    if (/^[-*•]\s+/.test(line)) {
      if (!ce) { ei++; ce = { id: `entry-${si}-${ei}`, titleLeft: "", titleRight: "", subtitleLeft: "", subtitleRight: "", bullets: [] }; cs.entries.push(ce); }
      bi++; ce.bullets.push({ id: `bullet-${bi}`, text: line.replace(/^[-*•]\s+/, "") });
      continue;
    }
    ei++; ce = { id: `entry-${si}-${ei}`, titleLeft: line, titleRight: "", subtitleLeft: "", subtitleRight: "", bullets: [] };
    cs.entries.push(ce);
  }
  const include = /\b(experience|projects?|skills)\b/i;
  const exclude = /\b(education|certifications?|awards?)\b/i;
  const selected = sections.filter((s) => include.test(s.heading) && !exclude.test(s.heading));
  const omitted = sections.filter((s) => !selected.includes(s)).map((s) => s.heading);
  return { version: 1, locked: { omittedIdentity: true, omittedContact: true, omittedSections: omitted }, sections: selected };
}

function scopeText(scope) {
  const out = [];
  for (const s of scope.sections) {
    out.push(s.heading.toUpperCase());
    for (const e of s.entries) {
      if (s.type === "skills") { out.push(e.titleLeft && e.titleLeft !== "Skills" ? `${e.titleLeft}: ${e.subtitleLeft}` : e.subtitleLeft); continue; }
      const t = [e.titleLeft, e.titleRight].filter(Boolean).join(" | ");
      const st = [e.subtitleLeft, e.subtitleRight].filter(Boolean).join(" | ");
      if (t) out.push(t);
      if (st) out.push(st);
      for (const b of e.bullets) if (b.text) out.push(`- ${b.text}`);
    }
    out.push("");
  }
  return out.join("\n").trim();
}

const scope = buildScope(resumePlain);
const baseText = scopeText(scope);
const baseLower = `${baseText}\n${resumePlain}`.toLowerCase();

const mockReq = (b) => ({ method: "POST", on(e, cb) { if (e === "data") cb(Buffer.from(JSON.stringify(b))); if (e === "end") cb(); return this; } });
const mockRes = () => ({ statusCode: null, payload: null, writeHead(s) { this.statusCode = s; return this; }, end(t) { this.payload = t; } });

const BANNED = /\b(seamless(?:ly)?|robust|cutting[- ]edge|innovative|dynamic|passionate|world[- ]class|state[- ]of[- ]the[- ]art|spearheaded|revolutioniz\w*|leverag\w+ synerg\w+|powerful)\b/gi;
const TECH_TOKEN = /\b[A-Z][A-Za-z0-9.#+]{1,14}(?:\.[a-z]{2,3})?\b/g;
const COMMON_WORDS = /^(The|And|For|With|Via|Into|From|When|While|Across|Built|Designed|Implemented|Reduced|Added|Migrated|Automated|Debugged|Hardened|Gathered|Collected|Translated|Coordinated|Supported|Worked|Led|Wrote|Tuned|Using|Per|Each|That|This|Then|Over|Under|All|Its|Their|Real|New|More|Most|One|Two|Single|Page|Data|Code|Team|User|Users|Job|Jobs|Add|Metric)$/i;

async function runOnce(n) {
  const req = mockReq({ provider: PROVIDER, model: MODEL, tailorScope: scope, jobText, strictReview: true, includeCoverLetter: false, honestContext: "", customInstructions: "" });
  const res = mockRes();
  const t0 = Date.now();
  await handlePolish(req, res);
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  const data = JSON.parse(res.payload ?? "{}");
  writeFileSync(join(OUT_DIR, `${label}-run-${n}.json`), JSON.stringify(data, null, 2));
  if (res.statusCode !== 200) return { n, secs, status: res.statusCode, error: data.error };

  const sugg = data.suggestedChanges ?? [];
  const targets = sugg.map((s) => `${s.target.sectionId}:${s.target.entryId}:${s.target.bulletId ?? ""}:${s.target.field}`);
  const lenDeltas = sugg
    .map((s) => s.currentText ? Math.round(100 * (s.proposedText.length - s.currentText.length) / Math.max(1, s.currentText.length)) : null)
    .filter((d) => d !== null);
  const allProposed = sugg.map((s) => s.proposedText).join("\n");
  const banned = [...new Set((allProposed.match(BANNED) ?? []).map((w) => w.toLowerCase()))];
  const suspectNewTokens = [...new Set(allProposed.match(TECH_TOKEN) ?? [])]
    .filter((tok) => tok.length > 2 && !baseLower.includes(tok.toLowerCase()) && !COMMON_WORDS.test(tok));
  const local = analyzeResumeText
    ? { base: analyzeResumeText(baseText, jobText).score, tailored: analyzeResumeText(data.polishedText, jobText).score }
    : null;
  return {
    n, secs, status: 200,
    suggestions: sugg.length,
    targets,
    meanLenDelta: lenDeltas.length ? Math.round(lenDeltas.reduce((a, b) => a + b, 0) / lenDeltas.length) : 0,
    maxLenDelta: lenDeltas.length ? Math.max(...lenDeltas) : 0,
    banned,
    placeholders: (allProposed.match(/\[add[^\]]*\]/gi) ?? []).length,
    suspectNewTokens,
    evidenceAll: sugg.every((s) => (s.evidence ?? "").length > 0),
    aiBase: data.aiScore?.base ?? null,
    aiTailored: data.aiScore?.tailored ?? null,
    verdict: data.strictReview?.verdict ?? null,
    gapKeywords: (data.strictReview?.gaps ?? []).map((g) => g.gap).slice(0, 8),
    riskFlagCount: (data.strictReview?.riskFlags ?? []).length,
    localBase: local?.base.overall ?? null,
    localTailored: local?.tailored.overall ?? null,
    localKeywordFitBase: local?.base.keywordFit ?? null,
    localKeywordFitTailored: local?.tailored.keywordFit ?? null,
    changeSummaryCount: (data.changeSummary ?? []).length
  };
}

console.log(
  `Tailor quality eval — provider=${PROVIDER} model=${MODEL || "(default)"} jd=${label} (${jobText.length} chars) ` +
  `scope=[${scope.sections.map((s) => `${s.heading}:${s.entries.length}e/${s.entries.reduce((a, e) => a + e.bullets.length, 0)}b`).join(", ")}] ` +
  `omitted=[${scope.locked.omittedSections.join(", ")}] runs=${RUNS}\n`
);

const results = await Promise.all(Array.from({ length: RUNS }, (_, i) => runOnce(i + 1)));
for (const r of results) console.log(JSON.stringify(r));

const ok = results.filter((r) => r.status === 200);
let exitCode = ok.length === results.length ? 0 : 1;
if (ok.length >= 2) {
  const jac = [];
  for (let a = 0; a < ok.length; a++) {
    for (let b = a + 1; b < ok.length; b++) {
      const A = new Set(ok[a].targets), B = new Set(ok[b].targets);
      const inter = [...A].filter((x) => B.has(x)).length;
      jac.push(Math.round(100 * inter / Math.max(1, new Set([...A, ...B]).size)));
    }
  }
  const tailored = ok.map((r) => r.aiTailored).filter((v) => v !== null);
  const spread = tailored.length ? Math.max(...tailored) - Math.min(...tailored) : null;
  const bannedAny = ok.some((r) => r.banned.length);
  console.log(
    `\nConsistency: targetJaccard%=[${jac.join(",")}] suggestionCounts=[${ok.map((r) => r.suggestions).join(",")}] ` +
    `aiTailored=[${tailored.join(",")}] spread=${spread ?? "n/a"} verdicts=[${ok.map((r) => r.verdict).join(",")}] ` +
    `localDelta=[${ok.map((r) => r.localTailored !== null ? r.localTailored - r.localBase : "n/a").join(",")}]`
  );
  if (bannedAny) { console.log("FAIL: banned brochure vocabulary in proposed text"); exitCode = 1; }
  if (spread !== null && spread > 10) { console.log(`WARN: aiTailored spread ${spread} > 10`); }
}
process.exit(exitCode);
