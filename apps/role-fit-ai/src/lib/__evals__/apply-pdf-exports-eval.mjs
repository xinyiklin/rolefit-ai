import assert from "node:assert/strict";

import { runApplyPdfExports } from "../applyPdfExports.ts";

function deferred() {
  let resolve;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

assert.deepEqual(await runApplyPdfExports({}), [], "no selections do no work");

{
  const calls = [];
  const failed = await runApplyPdfExports({
    resume: async () => {
      calls.push("resume");
      return true;
    }
  });
  assert.deepEqual(calls, ["resume"], "resume-only runs the resume exporter");
  assert.deepEqual(failed, [], "a successful resume is not reported as failed");
}

{
  const calls = [];
  const failed = await runApplyPdfExports({
    coverLetter: async () => {
      calls.push("cover letter");
      return true;
    }
  });
  assert.deepEqual(calls, ["cover letter"], "cover-only runs the cover exporter");
  assert.deepEqual(failed, [], "a successful cover letter is not reported as failed");
}

{
  const calls = [];
  const failed = await runApplyPdfExports({
    resume: async () => {
      calls.push("resume");
      return true;
    },
    coverLetter: async () => {
      calls.push("cover letter");
      return true;
    }
  });
  assert.deepEqual(calls, ["resume", "cover letter"], "both exporters run in document order");
  assert.deepEqual(failed, [], "two successful exports have no failures");
}

for (const firstFailure of [
  async () => false,
  async () => {
    throw new Error("resume render rejected");
  }
]) {
  const calls = [];
  const failed = await runApplyPdfExports({
    resume: async () => {
      calls.push("resume");
      return firstFailure();
    },
    coverLetter: async () => {
      calls.push("cover letter");
      return true;
    }
  });
  assert.deepEqual(calls, ["resume", "cover letter"], "a failed first export does not suppress the second");
  assert.deepEqual(failed, ["resume"], "false and rejection both report the failed first kind");
}

for (const secondFailure of [
  async () => false,
  async () => {
    throw new Error("cover render rejected");
  }
]) {
  const failed = await runApplyPdfExports({
    resume: async () => true,
    coverLetter: secondFailure
  });
  assert.deepEqual(failed, ["cover letter"], "false and rejection both report the failed second kind");
}

{
  const first = deferred();
  let coverStarted = false;
  const exportsDone = runApplyPdfExports({
    resume: () => first.promise,
    coverLetter: async () => {
      coverStarted = true;
      return true;
    }
  });
  await Promise.resolve();
  assert.equal(coverStarted, false, "the second export does not start while the first is pending");
  first.resolve(true);
  assert.deepEqual(await exportsDone, [], "the controlled sequential export completes after release");
  assert.equal(coverStarted, true, "the second export starts after the first settles");
}

console.log("apply-pdf-exports-eval: passed");
