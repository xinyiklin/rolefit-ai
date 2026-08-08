import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const bundled = await esbuild.build({
  entryPoints: [fileURLToPath(new URL("../../lib/quickFitLifecycle.ts", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent"
});
const {
  createQuickFitProvenance,
  dispatchQuickFitRetry,
  quickFitProvenanceIsStale,
  quickFitRequestFingerprint,
  quickFitRetryIsAvailable
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

const requirement = {
  requirementId: "required-1",
  sourceRequirement: "Build reliable JavaScript services.",
  importance: "CORE",
  kind: "RESPONSIBILITY"
};
const resumeText = "Software engineer who built reliable JavaScript services for internal operations teams. ".repeat(2);
const request = {
  resumeText,
  resumeLabel: "Backend",
  candidateContext: "Authorized to work in the United States.",
  requiredRequirements: [requirement]
};
const rawPosting = "Software Engineer\nBuild reliable JavaScript services.\nPartner with finance.";
const rawPostingWithDifferentUnselectedWork = `${rawPosting}\nOwn quarterly incident reviews.`;
assert.notEqual(
  quickFitRequestFingerprint(rawPosting, request),
  quickFitRequestFingerprint(rawPostingWithDifferentUnselectedWork, request),
  "the complete provider screening text participates even when selected requirements are unchanged"
);

const finalPreparedBrief = [
  "Job title:",
  "Software Engineer",
  "Core responsibilities:",
  "- Build reliable JavaScript services.",
  "- Partner with finance."
].join("\n");
const provenance = createQuickFitProvenance(rawPosting, finalPreparedBrief, request);
assert.equal(
  quickFitProvenanceIsStale(
    provenance,
    finalPreparedBrief,
    { text: resumeText },
    request.candidateContext
  ),
  false,
  "a combined request remains current after the provider returns a different prepared brief"
);
assert.equal(
  quickFitProvenanceIsStale(
    provenance,
    finalPreparedBrief.replace("Software Engineer", "Senior Software Engineer"),
    { text: resumeText },
    request.candidateContext
  ),
  true,
  "editing a prepared role outside the selected requirements invalidates the fit"
);
assert.equal(
  quickFitProvenanceIsStale(
    provenance,
    `${finalPreparedBrief}\n- Own quarterly incident reviews.`,
    { text: resumeText },
    request.candidateContext
  ),
  true,
  "editing an unselected prepared responsibility invalidates the fit"
);
assert.equal(
  quickFitProvenanceIsStale(provenance, finalPreparedBrief, null, request.candidateContext),
  true,
  "clearing the authoritative current resume hides the old ready verdict"
);

const preparedJob = { localJobText: finalPreparedBrief, fitJobText: rawPosting };
assert.equal(quickFitRetryIsAvailable(false, preparedJob), false);
assert.equal(
  quickFitRetryIsAvailable(true, preparedJob),
  true,
  "re-enabling Initial Fit restores Retry from the retained prepared-job receipt"
);

const unavailableCases = [
  ["starter-only", { resumeOrigin: "starter", currentText: resumeText }],
  ["blank-origin edited", { resumeOrigin: "blank", currentText: resumeText }],
  ["40-79 character stub", { resumeOrigin: "saved", currentText: "x".repeat(60) }]
];
for (const [label, state] of unavailableCases) {
  let refreshCalls = 0;
  const currentResume = state.resumeOrigin === "saved" && state.currentText.length >= 80
    ? { text: state.currentText, label: "Current" }
    : null;
  const dispatched = await dispatchQuickFitRetry({
    preparedJob,
    displayedPreparedJobText: finalPreparedBrief,
    currentResume: () => currentResume,
    resolvePreparedResume: async () => null,
    candidateContext: () => "",
    onUnavailable: () => undefined,
    refresh: async () => { refreshCalls += 1; }
  });
  assert.equal(dispatched, false, `${label} has no retry request`);
  assert.equal(refreshCalls, 0, `${label} makes no provider call`);
}

console.log("Initial Fit lifecycle probes: passed");
