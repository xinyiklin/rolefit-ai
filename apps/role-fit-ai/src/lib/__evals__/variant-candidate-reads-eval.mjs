// Behavior eval for the saved-variant candidate reads both material kinds use
// before ranking.
//
// The property under test is REQUEST COUNT, not just parsing. Each variant used
// to cost its own `/select` round trip, and every one of those answers with a
// whole workspace snapshot behind the server's serialized workspace lock — so
// `Promise.all` on the client bought no parallelism at all, only N sequential
// snapshots in front of the first AI result. A source guard can pin the call
// shape; only counting requests proves the cost.
//
//   node src/lib/__evals__/variant-candidate-reads-eval.mjs

import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

import {
  COVER_LETTER_STYLE_DEFAULTS,
  parseCoverLetterText,
  serializeCoverLetterFile
} from "../../../../../packages/engine/src/lib/coverLetter.ts";
import { DOC_STYLE_DEFAULTS } from "../../../../../packages/engine/src/lib/documentStyle.ts";
import { serializeResumeFile } from "../../../../../packages/engine/src/lib/resumeFile.ts";
import { buildStarterResume } from "../../../../../packages/engine/src/sampleResume.ts";

async function load(relativePath) {
  const bundled = await esbuild.build({
    entryPoints: [fileURLToPath(new URL(relativePath, import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent"
  });
  return import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
}

const { fetchBaseResumeCandidates } = await load("../baseResumeWorkspaceRepository.ts");
const { readCoverLetterVariantCandidates } = await load("../coverLetterWorkspaceRepository.ts");

let checks = 0;
const check = (actual, expected, message) => {
  checks += 1;
  assert.deepEqual(actual, expected, message);
};

const resumeFile = serializeResumeFile(buildStarterResume(), DOC_STYLE_DEFAULTS);
const coverFile = serializeCoverLetterFile(
  parseCoverLetterText("Dear Hiring Team,\n\nA short but real letter body."),
  COVER_LETTER_STYLE_DEFAULTS
);

// One recording fetch stands in for the loopback server: it asserts the request
// shape and answers with exactly the documents that were asked for.
function recordingFetch({ path, file, missing = new Set(), broken = new Set(), ok = true }) {
  const calls = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push(url);
      assert.equal(url, path, "candidate reads use the dedicated batch route");
      assert.equal(init.method, "POST");
      const requested = JSON.parse(init.body).fileNames;
      assert.ok(Array.isArray(requested), "the batch request names the exact files to read");
      return {
        ok,
        json: async () => ({
          candidates: requested
            .filter((fileName) => !missing.has(fileName))
            .map((fileName) => ({
              fileName,
              label: fileName.replace(/\.(resume|cover)$/, ""),
              kind: fileName.endsWith(".resume") ? "resume" : "cover",
              text: broken.has(fileName) ? "{not a document" : file
            }))
        })
      };
    }
  };
}

const originalFetch = globalThis.fetch;
try {
  // ── One request per read, whatever the variant count ──────────────────────
  for (const count of [1, 5, 20]) {
    const options = Array.from({ length: count }, (_, index) => ({
      fileName: index === 0 ? "default.resume" : `variant-${index}.resume`,
      label: index === 0 ? "Default" : `Variant ${index}`
    }));
    const recorder = recordingFetch({ path: "/api/workspace/base-resume/candidates", file: resumeFile });
    globalThis.fetch = recorder.fetch;
    const candidates = await fetchBaseResumeCandidates(options);
    check(recorder.calls.length, 1, `${count} resume variants cost exactly one request`);
    check(candidates.length, count, `${count} resume variants all come back from that one request`);
    check(
      candidates.map((candidate) => candidate.label),
      options.map((option) => option.label),
      "each candidate keeps the friendly label the selector shows"
    );
  }

  for (const count of [1, 5, 20]) {
    const options = Array.from({ length: count }, (_, index) => ({
      fileName: index === 0 ? "default.cover" : `variant-${index}.cover`,
      label: index === 0 ? "Default" : `Variant ${index}`
    }));
    const recorder = recordingFetch({ path: "/api/workspace/cover-letter/candidates", file: coverFile });
    globalThis.fetch = recorder.fetch;
    const candidates = await readCoverLetterVariantCandidates(options);
    check(recorder.calls.length, 1, `${count} cover-letter variants cost exactly one request`);
    check(candidates.length, count, `${count} cover-letter variants all come back from that one request`);
  }

  // ── Duplicates collapse before the request is made ────────────────────────
  {
    const recorder = recordingFetch({ path: "/api/workspace/base-resume/candidates", file: resumeFile });
    globalThis.fetch = recorder.fetch;
    const candidates = await fetchBaseResumeCandidates([
      { fileName: "default.resume", label: "Default" },
      { fileName: "default.resume", label: "Default" }
    ]);
    check(candidates.length, 1, "a repeated variant is read once");
  }

  // ── One unreadable variant is skipped, never ranked as empty ──────────────
  {
    const options = [
      { fileName: "default.resume", label: "Default" },
      { fileName: "broken.resume", label: "Broken" },
      { fileName: "missing.resume", label: "Missing" }
    ];
    const recorder = recordingFetch({
      path: "/api/workspace/base-resume/candidates",
      file: resumeFile,
      broken: new Set(["broken.resume"]),
      missing: new Set(["missing.resume"])
    });
    globalThis.fetch = recorder.fetch;
    const candidates = await fetchBaseResumeCandidates(options);
    check(
      candidates.map((candidate) => candidate.fileName),
      ["default.resume"],
      "unparseable and absent variants are dropped rather than ranked with empty text"
    );
    check(recorder.calls.length, 1, "a partial result still costs one request");
  }

  // ── A failed or unreachable workspace yields no ranking, not a throw ──────
  {
    globalThis.fetch = async () => ({ ok: false, json: async () => ({ error: "nope" }) });
    check(
      await fetchBaseResumeCandidates([{ fileName: "default.resume", label: "Default" }]),
      [],
      "a non-ok response produces no candidates instead of failing preparation"
    );
    globalThis.fetch = async () => {
      throw new Error("offline");
    };
    check(
      await fetchBaseResumeCandidates([{ fileName: "default.resume", label: "Default" }]),
      [],
      "an unreachable workspace produces no candidates instead of failing preparation"
    );
    check(
      await readCoverLetterVariantCandidates([{ fileName: "default.cover", label: "Default" }]),
      [],
      "cover-letter ranking degrades the same way"
    );
  }

  // ── An empty option list never reaches the network ────────────────────────
  {
    let called = 0;
    globalThis.fetch = async () => {
      called += 1;
      throw new Error("should not be called");
    };
    check(await fetchBaseResumeCandidates([]), [], "no options means no candidates");
    check(await readCoverLetterVariantCandidates([]), [], "no letters means no candidates");
    check(called, 0, "an empty option list is answered without a request");
  }
} finally {
  globalThis.fetch = originalFetch;
}

console.log(`Variant candidate reads eval: ${checks}/${checks} checks passed`);
