// Fit findings on the client: which assessment Polish may be told about, how a
// Resume gap statement follows the user's decisions, the client's own check of
// returned statements, and the live terminology coverage view's grouping.
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

import { resumeFitGapRows } from "../resumeProposalDecisionState.ts";
import { terminologyCoverage } from "../../resume/terminology.ts";
import { sanitizeResumePolishWireResult } from "../../../shared/resumePolishContract.ts";

// The lifecycle module uses extensionless imports, so it is bundled as its own eval does.
const bundled = await esbuild.build({
  entryPoints: [fileURLToPath(new URL("../fitAssessmentLifecycle.ts", import.meta.url))],
  bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent"
});
const { fitFindingsForPolish } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

const assessed = {
  status: "ASSESSED",
  verdict: "REASONABLE",
  summary: "s",
  matches: [{ jobExcerpt: "Build Python services", candidateSource: "RESUME", candidateExcerpt: "Built Python services", relationship: "direct" }],
  gaps: ["Operate Kubernetes clusters", "Own PostgreSQL migrations"],
  gapDetails: [{ jobExcerpt: "Operate Kubernetes clusters", note: "No Kubernetes shown." }]
};
const state = (completed, extra = {}) => ({ latestCompleted: completed, activeRun: null, lastError: null, ...extra });
const completed = (overrides = {}) => ({ snapshot: { result: assessed, resumeLabel: "r" }, origin: "current", changes: [], previousPreparation: false, ...overrides });

// --- Which assessment Polish may be told about ---------------------------------
assert.deepEqual(fitFindingsForPolish(state(completed())), {
  earlierVersion: false,
  matches: [{ jobExcerpt: "Build Python services", relationship: "direct" }],
  gaps: [{ id: "gap-1", jobExcerpt: "Operate Kubernetes clusters" }, { id: "gap-2", jobExcerpt: "Own PostgreSQL migrations" }]
}, "posting excerpts only: no candidate excerpts, notes, verdict, or summary");
assert.equal(fitFindingsForPolish(state(null)), null, "no assessment, no findings");
assert.equal(fitFindingsForPolish(state(completed({ previousPreparation: true }))), null, "another preparation's assessment is never sent");
assert.equal(fitFindingsForPolish(state(completed({ changes: ["job"] }))), null, "a changed posting sends nothing");
assert.equal(fitFindingsForPolish(state(completed({ changes: ["resume", "job"] }))), null);
assert.equal(fitFindingsForPolish(state(completed({ snapshot: { result: { status: "INSUFFICIENT_JOB_INFORMATION", summary: "x", matches: [], gaps: [] }, resumeLabel: "r" } }))), null);
assert.equal(fitFindingsForPolish(state(completed({ snapshot: { result: { ...assessed, matches: [], gaps: [] }, resumeLabel: "r" } }))), null, "an empty assessment sends nothing");
for (const changes of [["resume"], ["candidate-context"]]) {
  assert.equal(fitFindingsForPolish(state(completed({ changes }))).earlierVersion, true, `${changes[0]} changed: still sent, labelled earlier`);
}
assert.equal(fitFindingsForPolish(state(completed({ changes: ["settings"] }))).earlierVersion, false, "a Fit settings change does not make the findings earlier");
assert.equal(fitFindingsForPolish(state(completed({ origin: "saved" }))).earlierVersion, true, "a saved assessment cannot confirm its inputs");
assert.ok(fitFindingsForPolish(state(completed(), { activeRun: { id: "x" } })), "a reassessment in flight keeps the completed findings");
const unsafe = { ...assessed, gaps: ["Operate <b>Kubernetes</b>", "Own PostgreSQL migrations"] };
assert.deepEqual(fitFindingsForPolish(state(completed({ snapshot: { result: unsafe, resumeLabel: "r" } }))).gaps,
  [{ id: "gap-1", jobExcerpt: "Own PostgreSQL migrations" }], "an excerpt the server would refuse is left out, and ids stay in sequence");

// --- A Resume gap statement follows the decisions --------------------------------
const suggestion = (id) => ({ id, target: { sectionId: "exp", entryId: "a", bulletId: id, field: "bullet" }, sectionHeading: "Experience", currentText: "x", proposedText: "y", reason: "" });
const result = {
  fitFindings: { earlierVersion: false, matches: [], gaps: [{ id: "gap-1", jobExcerpt: "Kubernetes" }, { id: "gap-2", jobExcerpt: "PostgreSQL" }, { id: "gap-3", jobExcerpt: "Go" }] },
  fitGaps: [{ gap: "gap-1", status: "NO_EVIDENCE", targetIds: [] }, { gap: "gap-2", status: "ADDRESSED", targetIds: ["target-1", "target-2"] }]
};
const rows = (states, visible = [suggestion("target-1"), suggestion("target-2")]) =>
  resumeFitGapRows(result, visible, (item) => states[item.id] ?? "pending").map((row) => [row.id, row.status, row.suggestions.map((item) => item.id)]);
assert.deepEqual(rows({}), [["gap-1", "NO_EVIDENCE", []], ["gap-2", "ADDRESSED", ["target-1", "target-2"]], ["gap-3", "NOT_REPORTED", []]],
  "one row per gap sent; a gap without a statement is Not reported");
assert.deepEqual(rows({ "target-1": "accepted", "target-2": "discarded" })[1], ["gap-2", "ADDRESSED", ["target-1"]], "an accepted edit keeps it addressed");
assert.deepEqual(rows({ "target-1": "discarded", "target-2": "discarded" })[1], ["gap-2", "NOT_REPORTED", []], "discarding every cited edit drops Addressed");
assert.deepEqual(rows({ "target-1": "changed", "target-2": "discarded" })[1], ["gap-2", "NOT_REPORTED", []], "an edit overwritten in the document no longer addresses it");
assert.deepEqual(rows({}, [])[1], ["gap-2", "NOT_REPORTED", []], "held-back edits that are not restored address nothing");
assert.deepEqual(rows({}, [suggestion("target-2")])[1], ["gap-2", "ADDRESSED", ["target-2"]], "a restored held-back edit counts again");
assert.deepEqual(resumeFitGapRows({ fitGaps: result.fitGaps }, [], () => "pending"), [], "no findings sent, no rows");
assert.deepEqual(resumeFitGapRows(null, [], () => "pending"), []);

// --- The client re-checks returned statements ---------------------------------------
const wire = (fitGaps, review) => sanitizeResumePolishWireResult({
  status: "PROPOSAL", changes: [{ targetId: "target-1", replacement: "Owned PostgreSQL migrations." }], summary: [],
  omittedTargetCount: 0, withheld: { count: 0, reasons: [] }, ...(review ? { review } : {}), fitGaps
});
assert.deepEqual(wire([{ gap: "gap-1", status: "ADDRESSED", targetIds: ["target-1", "target-9"] }, { gap: "gap-7", status: "NO_EVIDENCE" }]).fitGaps,
  [{ gap: "gap-1", status: "ADDRESSED", targetIds: ["target-1"] }], "unknown references and gap ids are dropped");
assert.equal(wire([{ gap: "gap-1", status: "ADDRESSED", targetIds: ["target-9"] }]).fitGaps, undefined, "an ADDRESSED citing nothing real is dropped");
assert.equal(wire("not a list").changes.length, 1, "malformed statements never invalidate the edits");
const held = { outcome: "REVIEWED", attempts: 1, heldBack: [{ change: { targetId: "target-2", replacement: "Ran Go services." }, reason: "INCORRECT" }] };
assert.deepEqual(wire([{ gap: "gap-1", status: "ADDRESSED", targetIds: ["target-2"] }], held).fitGaps,
  [{ gap: "gap-1", status: "ADDRESSED", targetIds: ["target-2"] }], "a held-back edit stays citable because Restore can bring it back");

// --- Terminology coverage ----------------------------------------------------------
const posting = "Required qualifications:\n- Python and PostgreSQL\n- Kubernetes\n- CI/CD pipelines\nPreferred qualifications:\n- Docker";
const coverage = terminologyCoverage(posting, "Built Python services on Postgres.\nSet up continuous integration.\nI have not used Kubernetes.");
const keys = (terms) => terms.map((term) => term.keyword).sort();
assert.ok(keys(coverage.onResume).includes("python"));
assert.ok(keys(coverage.onResume).includes("postgresql"), "a true alias counts as on the resume");
assert.ok(keys(coverage.relatedOnly).includes("ci/cd"), "a related practice is only a related term");
assert.ok(keys(coverage.notOnResume).includes("kubernetes"), "a denied mention is not on the resume");
assert.ok(keys(coverage.notOnResume).includes("docker"));
assert.ok(coverage.limitations.length >= 1, "the catalog's limits travel with the view");
assert.deepEqual(terminologyCoverage("", "Python").onResume, [], "no posting, no terms");

// --- Request wiring: findings are sent only when present ------------------------------
const pipeline = readFileSync(new URL("../../hooks/useResumePolishPipeline.ts", import.meta.url), "utf8");
assert.match(pipeline, /\.\.\.\(context\.fitFindings \? \{ fitFindings: context\.fitFindings \} : \{\}\)/, "Resume Polish omits the field without findings");
const cover = readFileSync(new URL("../../hooks/useCoverLetter.ts", import.meta.url), "utf8");
assert.match(cover, /const fitFindings = getFitFindings\?\.\(\) \?\? null;/, "Cover Polish reads the findings once, when the run starts");
assert.match(cover, /\.\.\.\(fitFindings \? \{ fitFindings \} : \{\}\)/, "Cover Polish omits the field without findings");

console.log("Polish Fit findings client eval passed: selection, decision-following statements, wire re-check, terminology coverage, request wiring.");
