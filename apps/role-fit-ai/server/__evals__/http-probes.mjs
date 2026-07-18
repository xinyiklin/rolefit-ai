// Deterministic HTTP/provider cancellation probes. No network or live model calls.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { runCli } from "../ai-cli/index.ts";
import { base64ToBuffer } from "../base64.ts";
import { isApiPathname, RequestAbortedError, fetchWithTimeout, readBody } from "../http.ts";

assert.equal(isApiPathname("/api"), true);
assert.equal(isApiPathname("/api/nonexistent"), true);
assert.equal(isApiPathname("/apiary"), false);
assert.equal(isApiPathname("/applications"), false);

assert.throws(() => base64ToBuffer("====", "PDF"), /not valid base64/);
assert.equal(base64ToBuffer(Buffer.from("%PDF-1.7").toString("base64"), "PDF").toString(), "%PDF-1.7");

class FakeRequest extends EventEmitter {
  resumed = false;
  destroyedByReader = false;
  resume() { this.resumed = true; }
  destroy() { this.destroyedByReader = true; }
}

const oversized = new FakeRequest();
const bodyPromise = readBody(oversized, 4);
oversized.emit("data", Buffer.from("12345"));
await assert.rejects(bodyPromise, /Request is too large/);
assert.equal(oversized.resumed, true, "oversized bodies are drained so routes can return JSON");
assert.equal(oversized.destroyedByReader, false, "oversized bodies do not reset the response socket");

const hostedController = new AbortController();
hostedController.abort();
await assert.rejects(
  () => fetchWithTimeout("data:text/plain,unused", { signal: hostedController.signal }, 5_000),
  (error) => error instanceof RequestAbortedError,
  "caller cancellation remains cancellation rather than being mislabeled as timeout"
);

const cliController = new AbortController();
const cliPromise = runCli(
  process.execPath,
  ["-e", "setInterval(() => {}, 1000)"],
  undefined,
  { timeoutMs: 10_000, signal: cliController.signal }
);
setTimeout(() => cliController.abort(), 25);
await assert.rejects(
  cliPromise,
  (error) => error instanceof RequestAbortedError,
  "browser cancellation terminates an in-flight CLI process"
);

console.log("HTTP cancellation probes: PASS");
