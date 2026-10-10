// Manual, live-provider Resume import benchmark: AI structure interpretation of
// the synthetic import corpus, scored against each fixture's known structure
// beside the local reading, with latency and the provider's own token counts.
// Every fixture is synthetic; console output is aggregate-only, and each run
// writes summary.json beneath the gitignored workspace/resume-import-eval/.
// Never part of `npm test`: it calls a real provider.
//
//   EVAL_PROVIDER=claude-cli EVAL_MODEL=claude-sonnet-5-5 EVAL_REASONING_EFFORT=low \
//     npm run eval:live:resume-import --workspace apps/role-fit-ai
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { interpretResumeImport } from "../resumeImport.ts";
import { importResumePdf } from "../../../src/resume/pdfImport/importResumePdf.ts";
import { importRequestLines, interpretedImport } from "../../../src/resume/pdfImport/importStructure.ts";
import {
  engineFixtures,
  foreignFixtures,
  foreignTruth,
  renderEngineFixture,
  renderForeign,
  score
} from "../../../src/resume/pdfImport/__evals__/support/importCorpus.mjs";
import { sumUsage } from "./support/prepare-benchmark.mjs";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const request = {
  provider: process.env.EVAL_PROVIDER || "claude-cli",
  model: process.env.EVAL_MODEL || "claude-sonnet-5-5",
  reasoningEffort: process.env.EVAL_REASONING_EFFORT || "low"
};

const fixtures = [
  ...await Promise.all(engineFixtures.map(async (fixture) => ({ name: fixture.name, bytes: (await renderEngineFixture(fixture)).bytes, truth: fixture.data }))),
  ...await Promise.all(foreignFixtures.map(async (fixture) => ({ name: fixture.name, bytes: await renderForeign(fixture.spec), truth: foreignTruth(fixture.spec) })))
];

const accuracy = (scored) => {
  const totals = Object.values(scored.perClass).reduce((sum, counts) => ({ tp: sum.tp + counts.tp, predicted: sum.predicted + counts.predicted, truth: sum.truth + counts.truth }), { tp: 0, predicted: 0, truth: 0 });
  return { precision: totals.predicted ? totals.tp / totals.predicted : 1, recall: totals.truth ? totals.tp / totals.truth : 1, order: scored.order };
};

const records = [];
for (const fixture of fixtures) {
  const local = await importResumePdf(fixture.bytes, pdfjs);
  const record = { fixture: fixture.name, local: accuracy(score(fixture.truth, local.data)) };
  const stats = {};
  const started = performance.now();
  try {
    const structure = await interpretResumeImport({ lines: importRequestLines(local.lines).lines, body: request, stats });
    const outcome = interpretedImport(structure, local);
    Object.assign(record, outcome.ok
      ? { used: true, ai: accuracy(score(fixture.truth, outcome.result.data)), unplacedWords: outcome.result.audit.unplacedWords }
      : { used: false, rejected: outcome.reason });
  } catch (error) {
    Object.assign(record, { used: false, error: error instanceof Error ? error.message : String(error) });
  }
  Object.assign(record, { elapsedMs: Math.round(performance.now() - started), attempts: stats.attempts ?? 1, usage: stats.usage ?? null });
  records.push(record);
  const ai = record.ai ? `P ${record.ai.precision.toFixed(3)} R ${record.ai.recall.toFixed(3)} order ${record.ai.order.toFixed(3)}` : record.rejected ? `rejected: ${record.rejected}` : `failed: ${record.error}`;
  console.log(`${fixture.name.padEnd(46)} ${String(record.elapsedMs).padStart(6)} ms  ${ai}`);
}

const used = records.filter((record) => record.used);
const latencies = records.map((record) => record.elapsedMs).sort((a, b) => a - b);
const mean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
const summary = {
  request,
  fixtures: records.length,
  usable: used.length,
  latencyMs: { median: latencies[Math.floor(latencies.length / 2)], max: latencies[latencies.length - 1] },
  usage: sumUsage(records.map((record) => record.usage)),
  meanRecall: { local: mean(records.map((record) => record.local.recall)), ai: mean(used.map((record) => record.ai.recall)) },
  meanPrecision: { local: mean(records.map((record) => record.local.precision)), ai: mean(used.map((record) => record.ai.precision)) },
  records
};
const directory = join(APP_ROOT, "workspace", "resume-import-eval", `${new Date().toISOString().replace(/[:.]/g, "-")}-${request.provider}-${request.model}`.replace(/[^a-z0-9._-]/gi, "_"));
mkdirSync(directory, { recursive: true });
writeFileSync(join(directory, "summary.json"), JSON.stringify(summary, null, 2));
console.log(`usable ${used.length}/${records.length}; median ${summary.latencyMs.median} ms; usage ${JSON.stringify(summary.usage)}; receipt ${directory}`);
