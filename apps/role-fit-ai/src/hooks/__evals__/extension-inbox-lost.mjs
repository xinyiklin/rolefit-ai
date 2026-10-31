// useExtensionInbox tells its owner when an import it saw "preparing" is gone
// before delivery (a server restart drops the in-memory inbox), so Prepare
// never stays in its receiving state until a reload.
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const bundled = await esbuild.build({
  entryPoints: [fileURLToPath(new URL("../useExtensionInbox.ts", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  logLevel: "silent",
  plugins: [{
    name: "inbox-harness",
    setup(build) {
      build.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "harness" }));
      build.onLoad({ filter: /.*/, namespace: "harness" }, () => ({
        loader: "js",
        contents: [
          "export const useRef = (initial) => ({ current: initial });",
          "export const useEffect = (effect) => { globalThis.__inboxCleanup = effect(); };"
        ].join("\n")
      }));
    }
  }]
});

const timers = [];
globalThis.window = {
  location: { href: "http://127.0.0.1:5181/" },
  history: { state: null, replaceState() {} },
  addEventListener() {},
  removeEventListener() {}
};
globalThis.document = { visibilityState: "visible", addEventListener() {}, removeEventListener() {} };
globalThis.sessionStorage = { getItem: () => "tab-1", setItem() {} };
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn) => { timers.push(fn); return timers.length; };
globalThis.clearTimeout = () => {};

const { useExtensionInbox } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const settle = () => new Promise((resolve) => realSetTimeout(resolve, 0));
const runTimers = async () => { while (timers.length) { timers.shift()(); await settle(); } };

async function scenario(responses) {
  const calls = [];
  let poll = 0;
  globalThis.fetch = async () => {
    const [status, body] = responses[Math.min(poll, responses.length - 1)];
    poll += 1;
    return { ok: status === 200, status, json: async () => body };
  };
  useExtensionInbox(() => { calls.push("import"); }, () => calls.push("preparing"), true, () => calls.push("gone"));
  await settle();
  await runTimers();
  globalThis.__inboxCleanup?.();
  return calls;
}

// Seen preparing, then the entry is gone: one onGone call.
assert.deepEqual(await scenario([[200, { status: "preparing" }], [200, null]]), ["preparing", "gone"]);
// A non-transient error after preparing also ends the wait.
assert.deepEqual(await scenario([[200, { status: "preparing" }], [404, { error: "Not found." }]]), ["preparing", "gone"]);
// No import in flight: an empty inbox is not a lost posting.
assert.deepEqual(await scenario([[200, null]]), []);
// A delivered import never reports gone.
assert.deepEqual(await scenario([[200, { status: "preparing" }], [200, { text: "Posting", url: "https://example.test/job" }]]), ["preparing", "import"]);

console.log("extension inbox lost-import probes passed");
