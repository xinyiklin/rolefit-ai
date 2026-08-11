import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const bundled = await esbuild.build({
  entryPoints: [fileURLToPath(new URL("../useDuplicateGuard.ts", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent",
  plugins: [{
    name: "duplicate-relationship-harness",
    setup(build) {
      build.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "harness" }));
      build.onLoad({ filter: /.*/, namespace: "harness" }, () => ({
        loader: "js",
        contents: [
          "export const useState = (initial) => globalThis.__duplicateHarness.useState(initial);",
          "export const useRef = (initial) => globalThis.__duplicateHarness.useRef(initial);",
          "export const useEffect = () => undefined;"
        ].join("\n")
      }));
    }
  }]
});

const { useDuplicateGuard } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

const targetUrl = "https://jobs.example.test/software-engineer";
const targetText = "Software Engineer at Acme. Build reliable TypeScript services for customers.";
const application = (overrides = {}) => ({
  id: "application-1",
  title: "Software Engineer at Acme",
  company: "Acme",
  role: "Software Engineer",
  status: "applied",
  createdAt: "2026-05-01T12:00:00.000Z",
  updatedAt: "2026-05-04T12:00:00.000Z",
  appliedAt: "2026-05-04T12:00:00.000Z",
  jobUrl: targetUrl,
  jobDescription: targetText,
  ...overrides
});
const duplicate = (overrides = {}) => ({
  application: application(),
  level: "same-posting",
  confidence: "exact",
  evidence: ["Same canonical posting URL"],
  ...overrides
});

function createHarness(match) {
  const state = [];
  const refs = [];
  const opened = [];
  const relationships = [];
  let stateCursor = 0;
  let refCursor = 0;

  globalThis.__duplicateHarness = {
    useState(initial) {
      const index = stateCursor++;
      if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
      return [state[index], (next) => {
        state[index] = typeof next === "function" ? next(state[index]) : next;
      }];
    },
    useRef(initial) {
      const index = refCursor++;
      if (!(index in refs)) refs[index] = { current: initial };
      return refs[index];
    }
  };

  const args = {
    jobUrl: targetUrl,
    jobDescription: targetText,
    jobRawText: targetText,
    tracking: () => ({ company: "Acme", role: "Software Engineer" }),
    findDuplicatesForTarget: () => [match],
    onOpenExisting: async (id) => {
      opened.push(id);
      return true;
    },
    onRelationshipResolved: (relationship) => relationships.push(relationship)
  };

  return {
    opened,
    relationships,
    render() {
      stateCursor = 0;
      refCursor = 0;
      return useDuplicateGuard(args);
    }
  };
}

async function pendingGate(harness) {
  const first = harness.render();
  const pending = first.confirmDuplicateBeforeJobAnalysis(
    targetUrl,
    targetText,
    { company: "Acme", role: "Software Engineer" }
  );
  const prompted = harness.render();
  assert.ok(prompted.duplicatePrompt, "a duplicate choice pauses the gate");
  return { pending, prompted };
}

{
  const harness = createHarness(duplicate({
    application: application({ jobPostingGroupId: "posting-existing" })
  }));
  const { pending, prompted } = await pendingGate(harness);
  assert.equal(prompted.duplicatePrompt.kind, "existing-application");
  prompted.chooseDuplicate("continue-new");
  const result = await pending;
  assert.deepEqual(result, {
    proceed: true,
    note: "Applied · May 4: Same canonical posting URL"
  });
  assert.deepEqual(harness.relationships, [{
    matchedApplicationId: "application-1",
    jobPostingGroupId: "posting-existing",
    confidence: "exact"
  }]);
  const acknowledged = await harness.render().resolveApplyDuplicate();
  assert.deepEqual(acknowledged, {
    action: "continue",
    relationship: harness.relationships[0]
  }, "Apply reuses the confirmed relationship without another prompt");
}

{
  const harness = createHarness(duplicate({
    application: application({ status: "interested", appliedAt: undefined })
  }));
  const { pending, prompted } = await pendingGate(harness);
  assert.equal(prompted.duplicatePrompt.kind, "existing-draft");
  prompted.chooseDuplicate("continue-existing");
  assert.deepEqual(await pending, {
    proceed: false,
    note: "Saved · May 4: Same canonical posting URL",
    handled: true
  });
  assert.deepEqual(harness.opened, ["application-1"]);
  assert.deepEqual(harness.relationships, []);
}

{
  const harness = createHarness(duplicate({ confidence: "high" }));
  const { pending, prompted } = await pendingGate(harness);
  assert.equal(prompted.duplicatePrompt.kind, "similar");
  prompted.chooseDuplicate("separate");
  assert.equal((await pending).proceed, true);
  assert.deepEqual(harness.relationships, [null]);
  assert.deepEqual(
    await harness.render().resolveApplyDuplicate(),
    {
      action: "continue",
      relationship: null,
      unrelatedApplicationId: "application-1"
    },
    "a same-session keep-separate decision remains acknowledged"
  );
}

{
  const harness = createHarness(duplicate({ confidence: "possible" }));
  const { pending, prompted } = await pendingGate(harness);
  assert.equal(prompted.duplicatePrompt.kind, "similar");
  prompted.chooseDuplicate("link");
  assert.equal((await pending).proceed, true);
  assert.deepEqual(harness.relationships[0], {
    matchedApplicationId: "application-1",
    confidence: "possible"
  }, "a possible match links only after an explicit Yes choice");
}

const applyFlow = readFileSync(new URL("../useApplyFlow.ts", import.meta.url), "utf8");
const dialog = readFileSync(
  new URL("../../sections/PreparationDuplicateDialog.tsx", import.meta.url),
  "utf8"
);
const trackerStore = readFileSync(new URL("../useApplications.ts", import.meta.url), "utf8");

assert.doesNotMatch(applyFlow, /mergeTargetId|mergeApplications/, "normal Apply never merges attempts");
assert.match(
  applyFlow,
  /commit\.operation === "create"[\s\S]{0,320}?await createApplication\(app\)[\s\S]{0,900}?await linkPostingRecords/,
  "a new attempt is created by id before a separate atomic relationship write"
);
assert.match(
  applyFlow,
  /applyUnrelatedApplicationIdRef\.current[\s\S]{0,500}?await markPostingRecordsUnrelated/,
  "a confirmed Keep separate choice is persisted after the new id exists"
);
assert.match(dialog, /Continue with new preparation/);
assert.match(dialog, /Open existing application/);
assert.match(dialog, /Continue existing preparation/);
assert.match(dialog, /Yes, link records/);
assert.match(dialog, /No, keep separate/);
assert.match(
  trackerStore,
  /const mergeApplications = useCallback/,
  "manual destructive merge remains an explicitly separate tracker operation"
);
assert.match(
  trackerStore,
  /const markPostingRecordsUnrelated = useCallback[\s\S]{0,1800}?return persist\(next, mutations\)/,
  "Keep separate is persisted symmetrically through one revision-checked mutation"
);

console.log("Duplicate relationship resolution passed");
