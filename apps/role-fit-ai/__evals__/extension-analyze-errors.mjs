import assert from "node:assert/strict";
import { analyzePosting } from "../extension/bridge.js";

// Analyze failures name their cause: a workspace saved by a newer RoleFit (423,
// D095) asks for an update rather than showing a bare status code.
const pageData = { text: "Synthetic posting.", url: "https://example.test/jobs/1", title: "Role", frameUrls: [] };
const realFetch = globalThis.fetch;

async function analyzeFailure(status, body) {
  globalThis.fetch = async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  try {
    await analyzePosting("http://127.0.0.1:5181", pageData);
  } catch (error) {
    return error;
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.fail(`status ${status} was not reported as a failure`);
}

const newer = await analyzeFailure(423, { error: "applications.json was saved by a newer version of RoleFit.", code: "workspace-newer" });
assert.match(newer.message, /newer version of RoleFit\. Update RoleFit/);
assert.equal(newer.status, 423);

const busy = await analyzeFailure(429, { error: "busy" });
assert.match(busy.message, /busy/);

const other = await analyzeFailure(500, { error: "x" });
assert.equal(other.message, "RoleFit could not check this posting (500).");

console.log("extension analyze errors passed");
