// Behavior eval for the ONE prepared-resume resolution — the coordinator that
// replaced a pre-fit picker plus a separate post-Prepare ranking effect.
//
// These are executed sequences, not source-text guards: every case below is a
// real failure the old split produced, and a regex over App.tsx could not have
// caught any of them. The scenarios mirror the reported bug and its neighbours:
//
//   - an extension import reaching Prepare while the workspace is still loading
//   - exactly one saved variant (nothing to "recommend", so nothing was chosen)
//   - only the bundled starter loaded (long enough to pass every length test)
//   - two rankings disagreeing about which variant wins
//   - the document going dirty, application-owned, or busy mid-resolution
//   - an adoption that fails after being chosen
//
//   node src/hooks/__evals__/prepared-resume-resolution.mjs

import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

// No imports of its own, so it loads directly through Node's type stripping.
import { contentFingerprint } from "../../lib/contentFingerprint.ts";

// preparedResume.ts reaches the keyword ranker, whose own imports are
// extensionless; bundle it the way variant-recommendation-eval.mjs does rather
// than duplicating the module's resolution rules here.
const bundled = await esbuild.build({
  entryPoints: [fileURLToPath(new URL("../../lib/preparedResume.ts", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent"
});
const {
  MINIMUM_PREPARED_RESUME_LENGTH,
  currentResumeSelection,
  decidePreparedResume,
  resolvePreparedResumeSelection,
  resumeOriginAfterEdit,
  resumeIsApplicantOwned
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

let checks = 0;
const check = (actual, expected, message) => {
  checks += 1;
  assert.deepEqual(actual, expected, message);
};
const checkOk = (value, message) => {
  checks += 1;
  assert.ok(value, message);
};

// A resume long enough to clear every usable-length floor, tagged so each
// variant's identity is visible in the assertions.
const resumeText = (tag, extra = "") =>
  `${tag} Engineer. ${extra} `.padEnd(MINIMUM_PREPARED_RESUME_LENGTH + 120, `${tag} experience shipping production software. `);

const STARTER = resumeText(
  "Sample",
  "React Node.js PostgreSQL sample projects at Sample Company with placeholder accomplishments."
);

function baseState(overrides = {}) {
  return {
    baseResumeName: "",
    options: [],
    excludedVariants: {},
    resumeOrigin: "blank",
    applicationOwned: false,
    currentText: "",
    documentTitle: "Resume",
    documentDirty: false,
    manualSelectionInFlight: false,
    savingBaseResume: false,
    candidateRevision: 0,
    ...overrides
  };
}

// Same-filename overwrites must invalidate candidate bytes just like option
// additions/deletions. The ordered names and loaded filename remain identical;
// only the authoritative candidate revision can reveal this change.
{
  const staleFrontend = {
    fileName: "frontend.resume",
    label: "Frontend",
    text: resumeText("Frontend stale", "Go Postgres Kubernetes distributed systems")
  };
  const staleBackend = {
    fileName: "backend.resume",
    label: "Backend",
    text: resumeText("Backend stale", "React TypeScript accessibility")
  };
  const freshFrontend = {
    fileName: staleFrontend.fileName,
    label: staleFrontend.label,
    text: resumeText("Frontend fresh", "React TypeScript accessibility")
  };
  const freshBackend = {
    fileName: staleBackend.fileName,
    label: staleBackend.label,
    text: resumeText("Backend fresh", "Go Postgres Kubernetes distributed systems")
  };
  let reads = 0;
  const run = harness({
    state: baseState({
      options: [
        { fileName: staleFrontend.fileName, label: staleFrontend.label },
        { fileName: staleBackend.fileName, label: staleBackend.label }
      ]
    }),
    candidates: [freshFrontend, freshBackend],
    onReadCandidates: (_options, state) => {
      reads += 1;
      if (reads === 1) {
        state.candidateRevision += 1;
        return [staleFrontend, staleBackend];
      }
      return [freshFrontend, freshBackend];
    }
  }).setJobText("Job title:\nBackend Engineer\nTech stack / keywords:\n- Go\n- Postgres\n- Kubernetes");
  const resolution = await resolvePreparedResumeSelection(run.deps);
  check(reads, 2, "a same-filename overwrite retries the candidate read once");
  check(resolution.selection?.fileName, freshBackend.fileName, "ranking uses the overwritten candidate bytes");
}

// A harness that records what the resolution actually did, so ordering claims
// ("waits for hydration", "adopts before returning") are observed, not asserted
// about source text.
function harness({ state, candidates = [], hydrate, adoptSucceeds = true, onAdopt, onReadCandidates, onBeforeCommit }) {
  const log = [];
  let live = state;
  let bootstrapped = false;
  const deps = {
    jobText: "",
    whenWorkspaceBootstrapped: async () => {
      log.push("bootstrap:start");
      if (hydrate) live = (await hydrate()) ?? live;
      bootstrapped = true;
      log.push("bootstrap:done");
    },
    readState: () => {
      log.push(`readState:${bootstrapped ? "hydrated" : "pre-hydration"}`);
      return live;
    },
    readCandidates: async (options) => {
      log.push(`readCandidates:${options.map((option) => option.fileName).join(",")}`);
      return onReadCandidates ? onReadCandidates(options, live) : candidates;
    },
    adopt: async (fileName, poolChanged) => {
      log.push(`adopt:${fileName}`);
      // The guarded loader's final commit boundary rechecks its cancel signal.
      if (onBeforeCommit) live = onBeforeCommit(live) ?? live;
      if (poolChanged()) {
        log.push("adopt:cancelled");
        return null;
      }
      if (adoptSucceeds) {
        const candidate = candidates.find((entry) => entry.fileName === fileName);
        live = { ...live, baseResumeName: fileName, resumeOrigin: "saved", currentText: candidate?.text ?? live.currentText };
      }
      if (onAdopt) live = onAdopt(live) ?? live;
      return adoptSucceeds
        ? {
            fileName: live.baseResumeName,
            label: live.options.find((option) => option.fileName === live.baseResumeName)?.label ?? live.documentTitle,
            text: live.currentText
          }
        : null;
    },
    isCurrent: () => true
  };
  return {
    log,
    deps,
    setJobText(jobText) {
      deps.jobText = jobText;
      return this;
    },
    state: () => live
  };
}

// â”€â”€ Candidate reads and option metadata must describe one snapshot â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
{
  const frontend = { fileName: "frontend.resume", label: "Frontend", text: resumeText("Frontend", "React TypeScript") };
  const backend = { fileName: "backend.resume", label: "Backend", text: resumeText("Backend", "Go Postgres Kubernetes") };
  let live;
  const run = harness({
    state: baseState({
      baseResumeName: frontend.fileName,
      options: [{ fileName: frontend.fileName, label: frontend.label }],
      resumeOrigin: "saved",
      currentText: frontend.text
    }),
    candidates: [frontend, backend],
    onReadCandidates: (options, state) => {
      live = state;
      if (options.length === 1) {
        live.options = [
          { fileName: frontend.fileName, label: frontend.label },
          { fileName: backend.fileName, label: backend.label }
        ];
        return [frontend];
      }
      return [frontend, backend];
    }
  }).setJobText("Job title:\nBackend Engineer\nTech stack / keywords:\n- Go\n- Postgres\n- Kubernetes");
  const resolution = await resolvePreparedResumeSelection(run.deps);
  check(
    run.log.filter((entry) => entry.startsWith("readCandidates:")).length,
    2,
    "adding an option during the read retries once instead of mixing snapshots"
  );
  check(resolution.selection?.fileName, backend.fileName, "the retry ranks the newly complete option set");
}

{
  const stale = { fileName: "deleted.resume", label: "Deleted", text: resumeText("Deleted", "React") };
  const remaining = { fileName: "backend.resume", label: "Backend", text: resumeText("Backend", "Go Postgres") };
  const run = harness({
    state: baseState({
      options: [
        { fileName: stale.fileName, label: stale.label },
        { fileName: remaining.fileName, label: remaining.label }
      ]
    }),
    candidates: [stale, remaining],
    onReadCandidates: (options, state) => {
      if (options.length === 2) {
        state.options = [{ fileName: remaining.fileName, label: remaining.label }];
        return [stale, remaining];
      }
      return [remaining];
    }
  });
  const resolution = await resolvePreparedResumeSelection(run.deps);
  check(
    run.log.filter((entry) => entry.startsWith("readCandidates:")).length,
    2,
    "deleting an option during the read retries once instead of adopting a stale candidate"
  );
  check(resolution.selection?.fileName, remaining.fileName, "the retry adopts the sole remaining option");
}

// ── The reported bug: an import lands while the workspace is still hydrating ──
{
  // Before the fix, resolution read the editor's text at this instant — empty,
  // because loadWorkspace(true) had not returned — and reported "no resume".
  const pending = harness({
    state: baseState(),
    candidates: [{ fileName: "general-sde.resume", label: "General SDE", text: resumeText("Backend") }],
    hydrate: async () => {
      await Promise.resolve();
      return baseState({
        baseResumeName: "general-sde.resume",
        options: [{ fileName: "general-sde.resume", label: "General SDE" }],
        resumeOrigin: "saved",
        currentText: resumeText("Backend")
      });
    }
  });
  const resolution = await resolvePreparedResumeSelection(pending.deps);
  checkOk(resolution?.selection, "an import during workspace bootstrap still resolves the saved resume");
  check(resolution.selection.label, "General SDE", "the resolved resume is the saved variant, not an empty editor");
  check(resolution.blocker, null, "hydrating is never reported as a missing resume");
  checkOk(
    pending.log.indexOf("bootstrap:done") < pending.log.findIndex((entry) => entry.startsWith("readState")),
    "no state is read before workspace hydration settles"
  );
}

// ── The resolver cannot compensate for a promise that resolves too early ────
{
  // Named explicitly because this WAS the shipped bug: the workspace hook
  // settled its bootstrap promise inside loadWorkspace's finally, in the same
  // task as the state updates, while React republishes the state ref on a
  // later commit. The waiter's microtask won, so the resolver read the
  // pre-hydration state and reported "no resume" with one plainly loaded.
  // Nothing here can detect that — an empty editor and a not-yet-published
  // editor are the same two values — which is exactly why the hook must settle
  // from an effect that runs after the commit.
  const run = harness({
    state: baseState(),
    hydrate: async () => undefined
  });
  const resolution = await resolvePreparedResumeSelection(run.deps);
  check(
    resolution.selection,
    null,
    "a bootstrap that resolves before the document is published looks identical to no document"
  );
  check(
    resolution.blocker,
    "no-resume",
    "so the ordering guarantee belongs to the hook, not to a heuristic here"
  );
}

// ── Exactly one saved variant, not yet loaded, is adopted rather than ranked ──
{
  const only = { fileName: "general-sde.resume", label: "General SDE", text: resumeText("Backend") };
  const run = harness({
    state: baseState({ options: [{ fileName: only.fileName, label: only.label }], currentText: "" }),
    candidates: [only]
  });
  const resolution = await resolvePreparedResumeSelection(run.deps);
  check(resolution.selection.origin, "sole-saved", "one saved variant is the answer, not a ranking problem");
  check(resolution.selection.text, only.text, "the sole saved variant's real bytes are what the request carries");
  check(resolution.recommendation, null, "a single variant produces no recommendation note");
  checkOk(run.log.includes(`adopt:${only.fileName}`), "the sole saved variant is loaded into the editor, not just screened");
  check(
    resolution.selection.contentFingerprint,
    contentFingerprint(only.text),
    "the selection carries the fingerprint of exactly the text it returned"
  );
}

// ── A sole saved variant already loaded is used without a redundant load ─────
{
  const only = { fileName: "general-sde.resume", label: "General SDE", text: resumeText("Backend") };
  const run = harness({
    state: baseState({
      baseResumeName: only.fileName,
      options: [{ fileName: only.fileName, label: only.label }],
      resumeOrigin: "saved",
      currentText: only.text
    }),
    candidates: [only]
  });
  const resolution = await resolvePreparedResumeSelection(run.deps);
  check(resolution.selection.origin, "current", "the already-loaded sole variant is used in place");
  checkOk(!run.log.some((entry) => entry.startsWith("adopt:")), "no redundant workspace load is issued");
}

// ── The bundled starter is never the applicant's resume ─────────────────────
{
  const run = harness({ state: baseState({ resumeOrigin: "starter", currentText: STARTER }) });
  const resolution = await resolvePreparedResumeSelection(run.deps);
  check(resolution.selection, null, "a starter-only workspace resolves no resume");
  check(resolution.blocker, "starter-only", "the blocker names the starter rather than claiming nothing is loaded");
  check(
    resumeIsApplicantOwned(baseState({ resumeOrigin: "starter", currentText: STARTER })),
    false,
    "the starter is sample content however long it is"
  );
  check(
    currentResumeSelection(baseState({ resumeOrigin: "starter", currentText: STARTER })),
    null,
    "the starter can never become a current selection"
  );
  check(
    currentResumeSelection(baseState({ resumeOrigin: "blank", currentText: resumeText("Edited blank") })),
    null,
    "a blank origin remains neutral until the editor records a substantive authored transition"
  );
  check(
    resumeOriginAfterEdit("blank", true, resumeText("Edited blank")),
    "authored",
    "substantive edits promote a blank document to applicant-authored"
  );
  check(
    resumeOriginAfterEdit("blank", false, resumeText("Edited blank")),
    "blank",
    "text without an editor-dirty receipt does not claim applicant authorship"
  );
  check(
    currentResumeSelection(baseState({ resumeOrigin: "authored", currentText: resumeText("Edited blank") }))?.origin,
    "current",
    "an applicant-authored blank document becomes eligible for Fit and Polish"
  );
  check(
    currentResumeSelection(baseState({ resumeOrigin: "saved", currentText: "x".repeat(60) })),
    null,
    "a 40-79 character saved stub is unavailable for Fit Assessment"
  );
  for (const origin of ["saved", "uploaded", "application", "authored"]) {
    check(
      resumeIsApplicantOwned(baseState({ resumeOrigin: origin, currentText: STARTER })),
      true,
      `a ${origin} document is the applicant's own`
    );
  }
}

// ── An explicitly uploaded resume is authoritative for this preparation ─────
{
  const uploadedText = resumeText("Specialized upload", "React accessibility design systems");
  const olderSaved = {
    fileName: "general.resume",
    label: "General",
    text: resumeText("General saved", "Go Postgres Kubernetes")
  };
  const run = harness({
    state: baseState({
      options: [{ fileName: olderSaved.fileName, label: olderSaved.label }],
      resumeOrigin: "uploaded",
      currentText: uploadedText,
      documentTitle: "My specialized resume"
    }),
    candidates: [olderSaved]
  });
  const resolution = await resolvePreparedResumeSelection(run.deps);
  check(resolution.selection?.text, uploadedText, "Prepare keeps the resume the user explicitly uploaded");
  check(resolution.selection?.origin, "current", "an upload remains the authoritative current selection");
  checkOk(
    !run.log.some((entry) => entry.startsWith("readCandidates") || entry.startsWith("adopt:")),
    "an uploaded resume is neither ranked against nor replaced by saved variants"
  );
}

// ── Two rankings can disagree; one resolution cannot ────────────────────────
{
  // The raw posting and the prepared brief weight different words. The old code
  // ranked the fit against one and the editor adoption against the other, so
  // Fit Assessment could describe a resume the editor never loaded.
  const frontend = {
    fileName: "frontend.resume",
    label: "Frontend",
    text: resumeText("Frontend", "React TypeScript accessibility design systems browser rendering")
  };
  const backend = {
    fileName: "backend.resume",
    label: "Backend",
    text: resumeText("Backend", "Go Postgres Kubernetes distributed systems throughput latency")
  };
  const options = [
    { fileName: frontend.fileName, label: frontend.label },
    { fileName: backend.fileName, label: backend.label }
  ];
  const brief = [
    "Job title:",
    "Senior Backend Engineer",
    "Required qualifications:",
    "- Go services at scale",
    "- Postgres schema design",
    "Tech stack / keywords:",
    "- Go",
    "- Postgres",
    "- Kubernetes"
  ].join("\n");

  const run = harness({
    state: baseState({ options, currentText: frontend.text, baseResumeName: frontend.fileName, resumeOrigin: "saved" }),
    candidates: [frontend, backend]
  }).setJobText(brief);
  const resolution = await resolvePreparedResumeSelection(run.deps);
  check(resolution.selection.label, "Backend", "the winner is chosen from the prepared brief's weighted sections");
  check(resolution.selection.origin, "ranked", "a multi-variant winner is reported as ranked");
  check(resolution.recommendation.fileName, backend.fileName, "the note names the same variant that was loaded");
  check(
    resolution.selection.text,
    run.state().currentText,
    "the text sent to the provider is the text now in the editor — one answer, not two"
  );
}

// ── Adoption returns the committed document, not earlier ranking bytes ──────
{
  const original = { fileName: "backend.resume", label: "Backend", text: resumeText("Backend", "Go Postgres") };
  const changedBeforeCommit = resumeText("Backend live", "Go Postgres Kubernetes production ownership");
  const run = harness({
    state: baseState({ options: [{ fileName: original.fileName, label: original.label }] }),
    candidates: [original],
    onAdopt: (state) => ({ ...state, currentText: changedBeforeCommit })
  });
  const resolution = await resolvePreparedResumeSelection(run.deps);
  check(resolution.selection.text, changedBeforeCommit, "a file changed before adoption returns the committed editor text");
  check(
    resolution.selection.contentFingerprint,
    contentFingerprint(changedBeforeCommit),
    "the adoption fingerprint describes the committed editor text"
  );
}

// ── An incomplete candidate read cannot crown a winner ──────────────────────
{
  const readable = {
    fileName: "frontend.resume",
    label: "Frontend",
    text: resumeText("Frontend", "React TypeScript accessibility")
  };
  const run = harness({
    state: baseState({
      options: [
        { fileName: "frontend.resume", label: "Frontend" },
        { fileName: "broken.resume", label: "Broken" }
      ],
      baseResumeName: "frontend.resume",
      resumeOrigin: "saved",
      currentText: readable.text
    }),
    // Only one of the two variants came back: the other failed to parse.
    candidates: [readable]
  }).setJobText("Job title:\nFrontend Engineer\nTech stack / keywords:\n- React");
  const resolution = await resolvePreparedResumeSelection(run.deps);
  check(resolution.recommendation, null, "a partial candidate read produces no recommendation");
  check(resolution.selection.origin, "current", "an incomplete comparison keeps the current document");
  checkOk(!run.log.some((entry) => entry.startsWith("adopt:")), "an incomplete comparison never replaces the editor");
}

// ── A protected document is never replaced ──────────────────────────────────
for (const [label, overrides] of [
  ["unsaved edits", { documentDirty: true }],
  ["an application of record", { applicationOwned: true }],
  ["a manual selection in flight", { manualSelectionInFlight: true }],
  ["a save in flight", { savingBaseResume: true }]
]) {
  const other = { fileName: "backend.resume", label: "Backend", text: resumeText("Backend", "Go Postgres") };
  const mine = resumeText("Frontend", "React TypeScript");
  const run = harness({
    state: baseState({
      baseResumeName: "frontend.resume",
      options: [
        { fileName: "frontend.resume", label: "Frontend" },
        { fileName: "backend.resume", label: "Backend" }
      ],
      resumeOrigin: "saved",
      currentText: mine,
      ...overrides
    }),
    candidates: [other]
  }).setJobText("Job title:\nBackend Engineer\nTech stack / keywords:\n- Go\n- Postgres");
  const resolution = await resolvePreparedResumeSelection(run.deps);
  checkOk(!run.log.some((entry) => entry.startsWith("adopt:")), `${label} blocks automatic adoption`);
  check(resolution.selection.text, mine, `${label} keeps the document the user is looking at`);
  checkOk(
    !run.log.some((entry) => entry.startsWith("readCandidates")),
    `${label} does not even pay for a candidate read`
  );
}

// ── Editing during resolution stops the adoption that was already chosen ────
{
  const winner = { fileName: "backend.resume", label: "Backend", text: resumeText("Backend", "Go Postgres Kubernetes") };
  const mine = resumeText("Frontend", "React TypeScript");
  const current = { fileName: "frontend.resume", label: "Frontend", text: mine };
  const run = harness({
    state: baseState({
      baseResumeName: "frontend.resume",
      options: [
        { fileName: "frontend.resume", label: "Frontend" },
        { fileName: "backend.resume", label: "Backend" }
      ],
      resumeOrigin: "saved",
      currentText: mine
    }),
    candidates: [current, winner],
    adoptSucceeds: false
  }).setJobText("Job title:\nBackend Engineer\nTech stack / keywords:\n- Go\n- Postgres\n- Kubernetes");
  // The guarded loader refuses (the user started typing); resolution must report
  // the document that is actually on screen, never the variant it wanted.
  const resolution = await resolvePreparedResumeSelection(run.deps);
  checkOk(run.log.includes(`adopt:${winner.fileName}`), "the ranked winner reached the guarded adoption boundary");
  check(resolution.selection.text, mine, "a refused adoption reports the document the editor still holds");
  check(resolution.selection.origin, "current", "a refused adoption is not reported as a ranked selection");
  check(resolution.recommendation, null, "a refused adoption does not advertise a winner that was never loaded");
}

// ── A superseded resolution publishes nothing ───────────────────────────────
{
  const run = harness({
    state: baseState({ resumeOrigin: "saved", currentText: resumeText("Backend") })
  });
  run.deps.isCurrent = () => false;
  check(await resolvePreparedResumeSelection(run.deps), null, "a superseded resolution returns nothing to publish");
}

// ── The Settings pool limits what Prepare may read, rank, and adopt ────────
{
  const backendJob = "Job title:\nBackend Engineer\nTech stack / keywords:\n- Go\n- Postgres\n- Kubernetes\n- Python";
  const frontend = { fileName: "frontend.resume", label: "Frontend", text: resumeText("Frontend", "React TypeScript accessibility") };
  const backend = { fileName: "backend.resume", label: "Backend", text: resumeText("Backend", "Go Postgres Kubernetes Python") };
  const data = { fileName: "data.resume", label: "Data", text: resumeText("Data", "Python Postgres") };
  const all = [frontend, backend, data];
  const optionsOf = (variants) => variants.map(({ fileName, label }) => ({ fileName, label }));
  const readOnly = (options) => all.filter((variant) => options.some((option) => option.fileName === variant.fileName));
  const readsOf = (run) => run.log.filter((entry) => entry.startsWith("readCandidates:"));
  const pooled = (excludedVariants, overrides = {}) => harness({
    state: baseState({ options: optionsOf(all), excludedVariants, ...overrides.state }),
    candidates: all,
    onReadCandidates: overrides.onReadCandidates ?? ((options) => readOnly(options)),
    onBeforeCommit: overrides.onBeforeCommit
  }).setJobText(backendJob);

  // AC1 and AC6: an unset pool, or one naming only deleted variants, is today's behavior.
  const unset = pooled({});
  const unsetResolution = await resolvePreparedResumeSelection(unset.deps);
  check(unsetResolution.selection?.fileName, backend.fileName, "an unset pool still adopts the ranked winner");
  const stale = pooled({ "deleted.resume": true });
  const staleResolution = await resolvePreparedResumeSelection(stale.deps);
  check(stale.log, unset.log, "a pool naming a deleted variant reads and adopts exactly as an unset pool");
  check(staleResolution, unsetResolution, "a deleted variant in the pool changes nothing and raises no error");

  // AC2: the excluded variant would rank first, yet is never read, recommended, or adopted.
  const excluded = pooled({ "backend.resume": true });
  const excludedResolution = await resolvePreparedResumeSelection(excluded.deps);
  check(readsOf(excluded), ["readCandidates:frontend.resume,data.resume"], "an excluded variant is never read for ranking");
  checkOk(excludedResolution.recommendation?.fileName !== backend.fileName, "an excluded variant is never recommended");
  checkOk(!excluded.log.includes(`adopt:${backend.fileName}`), "an excluded variant is never adopted");
  check(excludedResolution.selection?.fileName, data.fileName, "the best eligible variant is adopted instead");
  check(excludedResolution.selection?.origin, "ranked", "several eligible variants are still ranked");

  // AC3: one eligible variant is adopted without ranking; none keeps the current document.
  const sole = pooled({ "frontend.resume": true, "data.resume": true });
  const soleResolution = await resolvePreparedResumeSelection(sole.deps);
  check(readsOf(sole), ["readCandidates:backend.resume"], "only the sole eligible variant is read");
  check(soleResolution.selection?.fileName, backend.fileName, "the sole eligible variant is adopted");
  check(soleResolution.selection?.origin, "sole-saved", "a sole eligible variant is adopted without ranking");

  const everyVariant = { "frontend.resume": true, "backend.resume": true, "data.resume": true };
  const keptCurrent = pooled(everyVariant, {
    state: { baseResumeName: frontend.fileName, resumeOrigin: "saved", currentText: frontend.text }
  });
  const keptResolution = await resolvePreparedResumeSelection(keptCurrent.deps);
  check(readsOf(keptCurrent), [], "with nothing eligible no variant is read");
  checkOk(!keptCurrent.log.some((entry) => entry.startsWith("adopt:")), "with nothing eligible nothing is adopted");
  check(keptResolution.selection?.origin, "current", "with nothing eligible the open, excluded document is kept");
  check(keptResolution.recommendation, null, "with nothing eligible there is no automatic pick to report");
  const nothingOpen = pooled(everyVariant);
  const nothingOpenResolution = await resolvePreparedResumeSelection(nothingOpen.deps);
  check(
    [nothingOpenResolution.selection, nothingOpenResolution.blocker],
    [null, "no-resume"],
    "with nothing eligible and nothing open, no resume resolves"
  );

  // AC5: a pool change while reading re-reads under the new pool, never adopting the old pick.
  let reads = 0;
  const changedWhileReading = pooled({}, {
    onReadCandidates: (options, state) => {
      reads += 1;
      if (reads === 1) state.excludedVariants = { "backend.resume": true };
      return readOnly(options);
    }
  });
  const changedResolution = await resolvePreparedResumeSelection(changedWhileReading.deps);
  check(
    readsOf(changedWhileReading),
    ["readCandidates:frontend.resume,backend.resume,data.resume", "readCandidates:frontend.resume,data.resume"],
    "a pool change during the read retries under the new pool"
  );
  checkOk(!changedWhileReading.log.includes(`adopt:${backend.fileName}`), "the winner under the old pool is never adopted");
  check(changedResolution.selection?.fileName, data.fileName, "the retry adopts under the new pool");

  let flips = 0;
  const changedTwice = pooled({}, {
    onReadCandidates: (options, state) => {
      flips += 1;
      state.excludedVariants = flips === 1 ? { "backend.resume": true } : { "data.resume": true };
      return readOnly(options);
    }
  });
  const changedTwiceResolution = await resolvePreparedResumeSelection(changedTwice.deps);
  checkOk(!changedTwice.log.some((entry) => entry.startsWith("adopt:")), "a pool that keeps changing adopts nothing");
  check(changedTwiceResolution.recommendation, null, "a pool that keeps changing reports no pick");

  const changedBeforeCommit = pooled({}, {
    state: { baseResumeName: frontend.fileName, resumeOrigin: "saved", currentText: frontend.text },
    onBeforeCommit: (state) => ({ ...state, excludedVariants: { "data.resume": true } })
  });
  const beforeCommitResolution = await resolvePreparedResumeSelection(changedBeforeCommit.deps);
  checkOk(changedBeforeCommit.log.includes("adopt:cancelled"), "a pool change before commit cancels the chosen adoption");
  check(beforeCommitResolution.selection?.fileName, frontend.fileName, "a cancelled adoption reports the document still open");
  check(beforeCommitResolution.selection?.origin, "current", "a cancelled adoption is not reported as a pick");
  check(beforeCommitResolution.recommendation, null, "a cancelled adoption does not advertise the old pool's winner");

  // AC6: a renamed variant is a new name, so it is eligible even if its old name was excluded.
  const renamed = { ...backend, fileName: "backend-2026.resume", label: "Backend 2026" };
  const renamedRun = harness({
    state: baseState({ options: optionsOf([frontend, renamed]), excludedVariants: { "backend.resume": true } }),
    candidates: [frontend, renamed],
    onReadCandidates: () => [frontend, renamed]
  }).setJobText(backendJob);
  const renamedResolution = await resolvePreparedResumeSelection(renamedRun.deps);
  check(renamedResolution.selection?.fileName, renamed.fileName, "a renamed variant is eligible under its new name");

  // AC7: excluding the open document never replaces unsaved work in it.
  const dirtyExcluded = pooled({ "frontend.resume": true }, {
    state: { baseResumeName: frontend.fileName, resumeOrigin: "saved", currentText: frontend.text, documentDirty: true }
  });
  const dirtyResolution = await resolvePreparedResumeSelection(dirtyExcluded.deps);
  checkOk(!dirtyExcluded.log.some((entry) => entry.startsWith("adopt:")), "an excluded document with unsaved edits is never replaced");
  check(dirtyResolution.selection?.fileName, frontend.fileName, "the excluded open document keeps speaking for the preparation");
}

// ── The decision itself, at the boundaries ──────────────────────────────────
{
  const shortText = "Too short to screen.";
  check(
    decidePreparedResume({
      jobText: "",
      savedOptionCount: 0,
      candidates: [],
      loadedFileName: "",
      currentText: shortText,
      currentIsApplicantOwned: true,
      canAdopt: true
    }).decision,
    { kind: "none", reason: "no-resume" },
    "a stub-length document is not a resume"
  );
  check(
    decidePreparedResume({
      jobText: "",
      savedOptionCount: 0,
      candidates: [],
      loadedFileName: "",
      currentText: "x".repeat(MINIMUM_PREPARED_RESUME_LENGTH),
      currentIsApplicantOwned: true,
      canAdopt: true
    }).decision,
    { kind: "current" },
    "the usable floor is inclusive, matching the ranker's own floor"
  );
  check(
    decidePreparedResume({
      jobText: "",
      savedOptionCount: 1,
      candidates: [{ fileName: "only.resume", label: "Only", text: shortText }],
      loadedFileName: "",
      currentText: "",
      currentIsApplicantOwned: true,
      canAdopt: true
    }).decision,
    { kind: "none", reason: "no-resume" },
    "a sole saved variant too short to screen is not adopted"
  );
}

// The harness honors `poolChanged` itself, so pin that the real hook passes it
// into the guarded loader's cancel predicate.
const resumeHookSource = readFileSync(new URL("../usePreparedResume.ts", import.meta.url), "utf8");
checkOk(
  /adopt: \(fileName, poolChanged\) =>\s*loadBaseResumeVersion\(fileName, true, \(\) => \{[\s\S]{0,400}?\|\|\s*poolChanged\(\)\s*\);/.test(resumeHookSource),
  "the hook's loader cancel predicate includes the resolver's pool check"
);

console.log(`Prepared resume resolution eval: ${checks}/${checks} checks passed`);
