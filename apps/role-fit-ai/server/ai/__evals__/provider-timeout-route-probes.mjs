// Resume import and Final review report a provider timeout as a timeout to
// retry, not as an AI-settings problem. A fake fetch only: no provider is called.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { FetchTimeoutError } from "../../http.ts";
import { handleApplicationReview } from "../applicationReview.ts";
import { handleResumeImport } from "../resumeImport.ts";

class Req extends EventEmitter {
  method = "POST";
  aborted = false;
}
class Res extends EventEmitter {
  writableEnded = false;
  destroyed = false;
  writeHead(status) {
    this.status = status;
  }
  end(body) {
    this.body = JSON.parse(body);
    this.writableEnded = true;
    this.emit("finish");
  }
}
async function invoke(handler, body) {
  const req = new Req();
  const res = new Res();
  const promise = handler(req, res);
  queueMicrotask(() => {
    req.emit("data", Buffer.from(JSON.stringify(body)));
    req.emit("end");
  });
  await promise;
  return res;
}

const line = (pieces) => ({ page: 1, region: "main", x: 54, size: 10, bold: false, italic: false, marker: false, pieces });
const importBody = { provider: "openai", model: "synthetic-model", lines: [line([{ id: "p1", text: "Jane Doe" }])] };
const reviewBody = {
  provider: "openai",
  model: "synthetic-model",
  jobText: "Build Python services.",
  company: "Acme",
  role: "Engineer",
  includeResume: true,
  includeCoverLetter: false,
  resumeText: "Built Python services.",
  coverLetterText: "",
  evidence: [{ id: "original", kind: "resume", label: "Loaded resume evidence", text: "Built Python services." }]
};

const oldFetch = globalThis.fetch;
const oldKey = process.env.OPENAI_API_KEY;
process.env.OPENAI_API_KEY = "synthetic-test-key";
let failure = () => new FetchTimeoutError("The request timed out.");
globalThis.fetch = async () => {
  throw failure();
};
try {
  const imported = await invoke(handleResumeImport, importBody);
  assert.equal(imported.status, 504, "a resume import timeout is a 504");
  assert.equal(imported.body.error, "OpenAI · API timed out. Try again or switch providers.");

  const reviewed = await invoke(handleApplicationReview, reviewBody);
  assert.equal(reviewed.status, 200, "Final review keeps its local result on a provider failure");
  assert.equal(reviewed.body.complete, false);
  assert.equal(reviewed.body.error, "OpenAI · API timed out. Try again or switch providers.", "a Final review timeout says to retry");

  // Any other failure keeps each route's existing generic wording.
  failure = () => new Error("synthetic unrelated failure");
  const importOther = await invoke(handleResumeImport, importBody);
  assert.equal(importOther.status, 500);
  assert.match(importOther.body.error, /Check AI settings and retry/);
  const reviewOther = await invoke(handleApplicationReview, reviewBody);
  assert.match(reviewOther.body.error, /Check AI settings and retry/);
} finally {
  globalThis.fetch = oldFetch;
  if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = oldKey;
}

console.log("provider timeout route probes passed");
