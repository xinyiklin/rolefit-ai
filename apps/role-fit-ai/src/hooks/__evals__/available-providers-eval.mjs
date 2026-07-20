import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  fetchProviderConnections,
  parseProviderConnectionsPayload,
  providerReadiness
} from "../useAvailableProviders.ts";

const provider = (id, kind, ready, authState, guidance = "Provider status guidance.") => ({
  id,
  kind,
  configured: true,
  ready,
  authState,
  guidance
});

const unmanaged = parseProviderConnectionsPayload({
  schemaVersion: 1,
  companionManaged: false,
  providers: []
});
assert.deepEqual(unmanaged, {
  schemaVersion: 1,
  companionManaged: false,
  providers: []
});

const managed = parseProviderConnectionsPayload({
  schemaVersion: 1,
  companionManaged: true,
  providers: [
    provider("openai", "api", true, "not-applicable"),
    provider("claude-cli", "cli", false, "signed-out"),
    provider("antigravity-cli", "cli", true, "unknown", "Antigravity sign-in is verified when first used.")
  ]
});
assert.deepEqual(managed.providers.map(({ id }) => id), ["claude-cli", "antigravity-cli", "openai"]);
assert.equal(managed.providers[0].ready, false);
assert.equal(managed.providers[1].ready, true);
assert.equal(managed.providers[1].authState, "unknown");
assert.equal(
  managed.providers[1].guidance,
  "Antigravity sign-in is verified when first used.",
  "a ready-to-verify Antigravity connection preserves its honest unknown-auth guidance"
);
assert.equal(managed.providers[2].ready, true);

assert.deepEqual(providerReadiness({
  status: "loading",
  companionManaged: false,
  providers: [],
  message: "Checking the local provider companion…"
}, "claude-cli"), {
  ready: false,
  message: "Checking providers in RoleFit Companion…"
});
assert.deepEqual(providerReadiness({
  status: "ready",
  companionManaged: true,
  providers: managed.providers,
  message: "Providers are managed by RoleFit Companion."
}, "claude-cli"), {
  ready: false,
  message: "Provider status guidance."
});
assert.deepEqual(providerReadiness({
  status: "ready",
  companionManaged: true,
  providers: managed.providers,
  message: "Providers are managed by RoleFit Companion."
}, "antigravity-cli"), {
  ready: true,
  message: ""
});
assert.deepEqual(providerReadiness({
  status: "ready",
  companionManaged: true,
  providers: managed.providers,
  message: "Providers are managed by RoleFit Companion."
}, "anthropic"), {
  ready: false,
  message: "Add Claude · API in RoleFit Companion."
});

const reject = (payload) => assert.throws(
  () => parseProviderConnectionsPayload(payload),
  /Invalid provider status response/
);
reject({ ...managed, schemaVersion: 2 });
reject({ ...managed, extra: true });
reject({ schemaVersion: 1, companionManaged: false, providers: [managed.providers[0]] });
reject({ schemaVersion: 1, companionManaged: true, providers: [
  provider("claude-cli", "cli", true, "signed-in"),
  provider("claude-cli", "cli", true, "signed-in")
] });
reject({ schemaVersion: 1, companionManaged: true, providers: [
  provider("gemini", "api", true, "not-applicable")
] });
reject({ schemaVersion: 1, companionManaged: true, providers: [{
  ...provider("openai", "api", true, "not-applicable"),
  apiKey: "must-not-cross"
}] });
reject({ schemaVersion: 1, companionManaged: true, providers: [
  provider("openai", "cli", true, "unknown")
] });
reject({ schemaVersion: 1, companionManaged: true, providers: [
  provider("openai", "api", true, "signed-in")
] });
reject({ schemaVersion: 1, companionManaged: true, providers: [
  provider("anthropic", "api", false, "not-applicable", "x".repeat(241))
] });

const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = (_input, init = {}) => new Promise((_resolve, rejectRequest) => {
    const signal = init.signal;
    if (!(signal instanceof AbortSignal)) {
      rejectRequest(new Error("missing abort signal"));
      return;
    }
    const rejectAborted = () => rejectRequest(new DOMException("Aborted", "AbortError"));
    if (signal.aborted) rejectAborted();
    else signal.addEventListener("abort", rejectAborted, { once: true });
  });

  await assert.rejects(
    fetchProviderConnections(new AbortController().signal, 5),
    /Provider status request timed out/,
    "a stalled provider status fetch is bounded"
  );

  const caller = new AbortController();
  const externallyCanceled = fetchProviderConnections(caller.signal, 1_000);
  caller.abort();
  await assert.rejects(
    externallyCanceled,
    (error) => error instanceof Error && !/timed out/i.test(error.message),
    "effect cleanup cancellation remains distinct from a request timeout"
  );
} finally {
  globalThis.fetch = originalFetch;
}

const hookSource = await readFile(new URL("../useAvailableProviders.ts", import.meta.url), "utf8");
assert.match(
  hookSource,
  /if \(activeRequestRef\.current === owner\) activeRequestRef\.current = null/,
  "an older request can clear the shared slot only while it still owns it"
);
assert.match(
  hookSource,
  /if \(activeRequestRef\.current === activeRequest\) activeRequestRef\.current = null/,
  "StrictMode cleanup clears only the request instance it canceled"
);

console.log("available provider response parser: PASS");
