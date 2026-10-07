// Prepare cover-letter selection and replacement ownership.

import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const bundled = await esbuild.build({
  entryPoints: [fileURLToPath(new URL("../../lib/preparedCoverLetter.ts", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent"
});
const {
  MINIMUM_PREPARED_COVER_LETTER_LENGTH,
  resolvePreparedCoverLetterSelection
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

let checks = 0;
const check = (actual, expected, message) => {
  checks += 1;
  assert.deepEqual(actual, expected, message);
};

const letterText = (tag, keywords = "") =>
  `${tag} cover letter. ${keywords} `.padEnd(
    MINIMUM_PREPARED_COVER_LETTER_LENGTH + 90,
    `${tag} candidate-authored experience. `
  );

const frontend = {
  fileName: "frontend.cover",
  label: "Frontend",
  text: letterText("Frontend", "React TypeScript accessibility")
};
const backend = {
  fileName: "backend.cover",
  label: "Backend",
  text: letterText("Backend", "Python Django FastAPI PostgreSQL AWS")
};

function baseState(overrides = {}) {
  return {
    activeFileName: "",
    options: [
      { fileName: frontend.fileName, label: frontend.label },
      { fileName: backend.fileName, label: backend.label }
    ],
    applicationOwned: false,
    documentDirty: false,
    documentFingerprint: "blank-body",
    workspaceSaving: false,
    candidateRevision: 1,
    excludedVariants: {},
    ...overrides
  };
}

function harness({
  state = baseState(),
  candidates = [frontend, backend],
  adoptSucceeds = true,
  onReadCandidates,
  onBeforeAdopt
} = {}) {
  let live = state;
  let reads = 0;
  const readNames = [];
  const adopted = [];
  const deps = {
    jobText: [
      "Job title:",
      "Backend Engineer",
      "Tech stack / keywords:",
      "- Python",
      "- Django",
      "- FastAPI",
      "- PostgreSQL",
      "- AWS"
    ].join("\n"),
    readState: () => live,
    readCandidates: async (options) => {
      reads += 1;
      readNames.push(options.map((option) => option.fileName));
      return onReadCandidates
        ? onReadCandidates(options, live, reads, (next) => {
            live = next;
          })
        : candidates;
    },
    adopt: async (fileName, shouldCancel) => {
      if (onBeforeAdopt) live = onBeforeAdopt(live) ?? live;
      if (shouldCancel()) return false;
      adopted.push(fileName);
      if (adoptSucceeds) {
        live = { ...live, activeFileName: fileName };
      }
      return adoptSucceeds;
    },
    isCurrent: () => true
  };
  return {
    deps,
    adopted,
    reads: () => reads,
    readNames,
    setState(next) {
      live = next;
    }
  };
}

{
  const staleFrontend = { ...frontend, text: backend.text };
  const staleBackend = { ...backend, text: frontend.text };
  const run = harness({
    onReadCandidates: (_options, state, readNumber, setState) => {
      if (readNumber === 1) {
        setState({ ...state, candidateRevision: state.candidateRevision + 1 });
        return [staleFrontend, staleBackend];
      }
      return [frontend, backend];
    }
  });
  const result = await resolvePreparedCoverLetterSelection(run.deps);
  check(run.reads(), 2, "a same-filename overwrite retries the candidate read once");
  check(result?.adoptedFileName, backend.fileName, "the retry adopts from the current candidate bytes");
}

{
  const run = harness();
  const result = await resolvePreparedCoverLetterSelection(run.deps);
  check(result?.adoptedFileName, backend.fileName, "a title-only retitle does not veto the ranked winner");
  check(run.adopted, [backend.fileName], "the ranked saved letter is loaded into the editor");
}

{
  const only = backend;
  const run = harness({
    state: baseState({ options: [{ fileName: only.fileName, label: only.label }] }),
    candidates: [only]
  });
  const result = await resolvePreparedCoverLetterSelection(run.deps);
  check(result?.adoptedFileName, only.fileName, "the sole saved letter is adopted");
  check(result?.recommendation, null, "a sole saved letter does not invent a ranking receipt");
}

{
  const run = harness({
    onReadCandidates: (_options, state, _readNumber, setState) => {
      setState({
        ...state,
        activeFileName: frontend.fileName,
        documentFingerprint: "manually-opened-body"
      });
      return [frontend, backend];
    }
  });
  const result = await resolvePreparedCoverLetterSelection(run.deps);
  check(result?.adoptedFileName, null, "a manual open during ranking keeps the user's letter");
  check(run.adopted, [], "ranking cannot adopt from a document snapshot it did not start with");
}

{
  const run = harness({
    state: baseState({
      activeFileName: backend.fileName,
      options: [{ fileName: backend.fileName, label: backend.label }]
    }),
    candidates: [backend]
  });
  const result = await resolvePreparedCoverLetterSelection(run.deps);
  check(run.reads(), 0, "an already-open sole variant is not fetched again");
  check(result?.adoptedFileName, null, "an already-open sole variant is retained");
}

for (const [label, blocked] of [
  ["content edit", { documentDirty: true }],
  ["application source", { applicationOwned: true }],
  ["workspace save", { workspaceSaving: true }]
]) {
  const run = harness({ state: baseState(blocked) });
  const result = await resolvePreparedCoverLetterSelection(run.deps);
  check(result?.adoptedFileName, null, `${label} prevents automatic replacement`);
  check(run.adopted, [], `${label} never reaches the editor loader`);
}

{
  const run = harness({
    onBeforeAdopt: (state) => ({ ...state, documentFingerprint: "edited-body" })
  });
  const result = await resolvePreparedCoverLetterSelection(run.deps);
  check(result?.adoptedFileName, null, "a replaced document cancels adoption even before dirty state commits");
  check(run.adopted, [], "the content fingerprint is rechecked at the editor boundary");
}

{
  const run = harness({
    onBeforeAdopt: (state) => ({ ...state, documentDirty: true })
  });
  const result = await resolvePreparedCoverLetterSelection(run.deps);
  check(result?.adoptedFileName, null, "an edit that lands during adoption cancels replacement");
  check(run.adopted, [], "the editor loader rechecks live body ownership before commit");
  check(result?.recommendation?.fileName, backend.fileName, "an edit-cancelled adoption keeps its non-mutating recommendation");
}

{
  const run = harness({ adoptSucceeds: false });
  const result = await resolvePreparedCoverLetterSelection(run.deps);
  check(result?.adoptedFileName, null, "a failed guarded open is not reported as selected");
  check(result?.recommendation?.fileName, backend.fileName, "a failed open keeps the non-mutating recommendation");
}

{
  const run = harness({ state: baseState({ documentDirty: true }) });
  const result = await resolvePreparedCoverLetterSelection(run.deps);
  check(result?.recommendation?.fileName, backend.fileName, "dirty work can retain a non-mutating recommendation");
}

{
  const run = harness({ candidates: [backend] });
  const result = await resolvePreparedCoverLetterSelection(run.deps);
  check(result?.recommendation, null, "an incomplete candidate read has no recommendation");
  check(run.adopted, [], "an incomplete candidate read does not adopt");
}

{
  const tiedFrontend = { ...frontend, text: backend.text };
  const run = harness({ candidates: [tiedFrontend, backend] });
  const result = await resolvePreparedCoverLetterSelection(run.deps);
  check(result?.recommendation, null, "a tie has no recommendation");
  check(run.adopted, [], "a tie keeps the current selection");
}

// ── The Settings pool limits what Prepare may read, rank, and adopt ────────
{
  const readOnly = (options) => [frontend, backend].filter((letter) => options.some((option) => option.fileName === letter.fileName));

  const stale = harness({ state: baseState({ excludedVariants: { "deleted.cover": true } }), onReadCandidates: readOnly });
  const staleResult = await resolvePreparedCoverLetterSelection(stale.deps);
  check(staleResult?.adoptedFileName, backend.fileName, "a pool naming a deleted letter ranks exactly as an unset pool");

  const excluded = harness({ state: baseState({ excludedVariants: { "backend.cover": true } }), onReadCandidates: readOnly });
  const excludedResult = await resolvePreparedCoverLetterSelection(excluded.deps);
  check(excluded.readNames, [[frontend.fileName]], "an excluded letter is never read, even when it would rank first");
  check(excludedResult?.recommendation, null, "the sole eligible letter carries no ranking receipt");
  check(excluded.adopted, [frontend.fileName], "the sole eligible letter is adopted, never the excluded one");

  const none = harness({
    state: baseState({ excludedVariants: { "frontend.cover": true, "backend.cover": true } }),
    onReadCandidates: readOnly
  });
  const noneResult = await resolvePreparedCoverLetterSelection(none.deps);
  check(none.reads(), 0, "with no eligible letter nothing is read");
  check([noneResult?.adoptedFileName, noneResult?.recommendation], [null, null], "with no eligible letter the current one is kept");

  const changedWhileReading = harness({
    onReadCandidates: (options, state, readNumber, setState) => {
      if (readNumber === 1) setState({ ...state, excludedVariants: { "backend.cover": true } });
      return readOnly(options);
    }
  });
  await resolvePreparedCoverLetterSelection(changedWhileReading.deps);
  check(
    changedWhileReading.readNames,
    [[frontend.fileName, backend.fileName], [frontend.fileName]],
    "a pool change during the read retries under the new pool"
  );
  check(changedWhileReading.adopted, [frontend.fileName], "the winner under the old pool is never adopted");

  let flips = 0;
  const changedTwice = harness({
    onReadCandidates: (options, state, _readNumber, setState) => {
      flips += 1;
      setState({ ...state, excludedVariants: flips === 1 ? { "backend.cover": true } : { "frontend.cover": true } });
      return readOnly(options);
    }
  });
  const changedTwiceResult = await resolvePreparedCoverLetterSelection(changedTwice.deps);
  check(
    [changedTwiceResult?.recommendation, changedTwiceResult?.adoptedFileName],
    [null, null],
    "a pool that keeps changing reports and adopts nothing"
  );
  check(changedTwice.adopted, [], "a pool that keeps changing never reaches the editor loader");

  const changedBeforeAdopt = harness({
    onReadCandidates: readOnly,
    onBeforeAdopt: (state) => ({ ...state, excludedVariants: { "backend.cover": true } })
  });
  const changedBeforeAdoptResult = await resolvePreparedCoverLetterSelection(changedBeforeAdopt.deps);
  check(changedBeforeAdopt.adopted, [], "excluding the winner at the editor boundary cancels its adoption");
  check(changedBeforeAdoptResult?.adoptedFileName, null, "a cancelled adoption is not reported as selected");
  check(changedBeforeAdoptResult?.recommendation, null, "the just-excluded winner is not offered as a recommendation");
}

const appSource = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const toolbarSource = readFileSync(
  new URL("../../sections/cover-letter/CoverLetterToolbar.tsx", import.meta.url),
  "utf8"
);
const applicationOpenSource = appSource.slice(
  appSource.indexOf("async function handleLoadApplication"),
  appSource.indexOf("function handleOpenApplicationDetail")
);
assert.match(
  appSource,
  /const preparedCoverLetterState = \{[\s\S]{0,350}?documentDirty: coverLetterEditor\.dirty,[\s\S]{0,120}?documentFingerprint: coverLetterEditor\.draftPayload \?\? ""/,
  "Prepare guards replacement with body/style identity rather than the output title"
);
const coverHookSource = readFileSync(new URL("../usePreparedCoverLetter.ts", import.meta.url), "utf8");
const inputKeySource = coverHookSource.slice(
  coverHookSource.indexOf("const inputKey ="),
  coverHookSource.indexOf("const inputKeyRef")
);
assert.ok(inputKeySource.includes("JSON.stringify"), "the cover hook's input key was located");
assert.doesNotMatch(
  inputKeySource,
  /excluded|pool/i,
  "the pool is a snapshot input, never a trigger that re-resolves a settled preparation"
);
assert.match(
  appSource,
  /options: baseResumeOptions,\s*excludedVariants: excludedResumeVariants,/,
  "the resume resolver reads only the resume pool"
);
assert.match(
  appSource,
  /const preparedCoverLetterState = \{[\s\S]{0,500}?excludedVariants: excludedCoverLetterVariants\s*\};/,
  "the cover-letter resolver reads only the cover-letter pool"
);
assert.match(
  appSource,
  /coverManualVariantSelectionInFlightRef\.current = true;\s*preemptPreparedCoverLetterResolution\(\);/,
  "manual selection synchronously preempts the dedicated resolver"
);
assert.match(
  toolbarSource,
  /onDocumentChoice\(\);\s*await editor\.openWorkspaceCoverLetter/,
  "the editor's saved-letter menu also preempts automatic selection"
);
assert.match(
  applicationOpenSource,
  /preemptPreparedCoverLetterResolution\(\);\s*const approvedResumeVersion/,
  "opening a tracked application preempts automatic selection before document reads"
);

console.log(`Prepared cover-letter resolution passed (${checks} checks)`);
