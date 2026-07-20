import assert from "node:assert/strict";
import {
  applyProviderSnapshot,
  clearProviderSnapshot,
  getManagedApiKey,
  getManagedProviderConnection,
  getProviderConnectionsPayload,
  handleProviderConnections,
  isCompanionManaged
} from "../provider-connections.ts";

const openAiSecret = "sk-rolefit-provider-probe-openai";
const anthropicSecret = "sk-ant-rolefit-provider-probe-anthropic";

function provider(id, kind, ready, authState, guidance) {
  return { id, kind, configured: true, ready, authState, guidance };
}

function snapshot(providers, credentials = {}) {
  return {
    type: "rolefit-provider-snapshot",
    schemaVersion: 1,
    providers,
    credentials
  };
}

class FakeResponse {
  status = 0;
  body = "";
  headers = {};
  writeHead(status, headers) {
    this.status = status;
    this.headers = headers;
  }
  end(chunk = "") {
    this.body = String(chunk);
  }
}

function currentReceipt() {
  return {
    payload: JSON.stringify(getProviderConnectionsPayload()),
    openai: getManagedApiKey("openai"),
    anthropic: getManagedApiKey("anthropic")
  };
}

function assertRejectedAtomically(candidate, message) {
  const before = currentReceipt();
  assert.throws(() => applyProviderSnapshot(candidate), undefined, message);
  assert.deepEqual(currentReceipt(), before, `${message}: active state must be unchanged`);
}

try {
  clearProviderSnapshot();
  assert.deepEqual(
    getProviderConnectionsPayload(),
    { schemaVersion: 1, companionManaged: false, providers: [] },
    "headless server starts with no companion-managed providers"
  );
  assert.equal(getManagedApiKey("openai"), undefined);
  assert.equal(getManagedApiKey("anthropic"), undefined);
  assert.equal(isCompanionManaged(), false);
  assert.equal(getManagedProviderConnection("claude-cli"), undefined);

  applyProviderSnapshot(snapshot([]));
  assert.deepEqual(
    getProviderConnectionsPayload(),
    { schemaVersion: 1, companionManaged: true, providers: [] },
    "an empty startup snapshot establishes the authoritative companion boundary"
  );
  assert.equal(getManagedApiKey("openai"), undefined);
  clearProviderSnapshot();

  applyProviderSnapshot(snapshot([
    provider("openai", "api", true, "not-applicable", "OpenAI API access is stored securely on this device."),
    provider("claude-cli", "cli", true, "signed-in", "Claude Code is connected through its local CLI session."),
    provider("anthropic", "api", false, "not-applicable", "Claude API access needs attention in the companion.")
  ], { openai: openAiSecret }));

  const firstPayload = getProviderConnectionsPayload();
  assert.equal(isCompanionManaged(), true);
  assert.equal(firstPayload.schemaVersion, 1);
  assert.equal(firstPayload.companionManaged, true);
  assert.deepEqual(
    firstPayload.providers.map(({ id }) => id),
    ["claude-cli", "openai", "anthropic"],
    "public providers use canonical catalog order"
  );
  assert(
    firstPayload.providers.every((entry) =>
      Object.keys(entry).sort().join(",") ===
      "authState,configured,guidance,id,kind,ready"
    ),
    "public records expose exactly the six shape-only fields"
  );
  const serialized = JSON.stringify(firstPayload);
  assert.equal(serialized.includes(openAiSecret), false, "public JSON never includes API keys");
  assert.equal(serialized.includes("apiKey"), false, "public JSON has no credential field");
  assert.equal(getManagedApiKey("openai"), openAiSecret);
  assert.equal(getManagedApiKey("anthropic"), undefined);
  assert.deepEqual(
    getManagedProviderConnection("claude-cli"),
    firstPayload.providers[0],
    "provider resolution can inspect the configured public readiness record"
  );

  const stableSnapshot = snapshot([
    provider("codex-cli", "cli", false, "signed-out", "Sign in to Codex CLI through the RoleFit companion."),
    provider("anthropic", "api", true, "not-applicable", "Claude API access is stored securely on this device.")
  ], { anthropic: anthropicSecret });
  applyProviderSnapshot(stableSnapshot);
  assert.equal(getManagedApiKey("openai"), undefined, "full replacement clears removed API credentials");
  assert.equal(getManagedApiKey("anthropic"), anthropicSecret);
  assert.deepEqual(
    getProviderConnectionsPayload().providers.map(({ id }) => id),
    ["codex-cli", "anthropic"],
    "full replacement clears removed public providers"
  );

  assertRejectedAtomically(
    { ...stableSnapshot, extra: true },
    "extra snapshot-envelope fields fail closed"
  );
  assertRejectedAtomically(
    { ...stableSnapshot, schemaVersion: 2 },
    "unknown snapshot versions fail closed"
  );
  assertRejectedAtomically(
    snapshot([{ ...stableSnapshot.providers[0], extra: true }]),
    "extra provider fields fail closed"
  );
  assertRejectedAtomically(
    snapshot([provider("gemini", "api", false, "not-applicable", "Unsupported provider.")]),
    "unknown provider IDs fail closed"
  );
  assertRejectedAtomically(
    snapshot([provider("openai", "cli", false, "unknown", "Wrong provider kind.")]),
    "provider kind mismatches fail closed"
  );
  assertRejectedAtomically(
    snapshot([
      stableSnapshot.providers[0],
      stableSnapshot.providers[0]
    ]),
    "duplicate provider IDs fail closed"
  );
  assertRejectedAtomically(
    snapshot([{ ...stableSnapshot.providers[0], configured: false }]),
    "unconfigured records cannot enter a configured snapshot"
  );
  assertRejectedAtomically(
    snapshot([provider("openai", "api", true, "not-applicable", "OpenAI configured.")], {
      openai: "x".repeat(16_385)
    }),
    "overlong credentials fail closed"
  );
  assertRejectedAtomically(
    snapshot([provider("openai", "api", true, "not-applicable", "OpenAI configured.")], {
      openai: "secret\nvalue"
    }),
    "credential control characters fail closed"
  );
  assertRejectedAtomically(
    snapshot([stableSnapshot.providers[0]], { openai: openAiSecret }),
    "credentials for unconfigured API providers fail closed"
  );
  assertRejectedAtomically(
    snapshot([provider("openai", "api", true, "not-applicable", "OpenAI configured.")]),
    "ready API providers require an in-memory credential"
  );
  assertRejectedAtomically(
    snapshot([provider("openai", "api", false, "not-applicable", "OpenAI needs attention.")], {
      openai: openAiSecret
    }),
    "API readiness cannot contradict credential availability"
  );
  assertRejectedAtomically(
    snapshot([provider("claude-cli", "cli", true, "not-applicable", "Wrong auth state.")]),
    "CLI providers reject API-only auth state"
  );
  assertRejectedAtomically(
    snapshot([provider("anthropic", "api", false, "signed-out", "Wrong auth state.")]),
    "API providers reject CLI auth state"
  );
  assertRejectedAtomically(
    snapshot([provider("anthropic", "api", false, "not-applicable", "x".repeat(241))]),
    "overlong guidance fails closed"
  );
  assertRejectedAtomically(
    snapshot(stableSnapshot.providers, { anthropic: anthropicSecret, extra: "secret" }),
    "extra credential fields fail closed"
  );

  const getResponse = new FakeResponse();
  handleProviderConnections({ method: "GET" }, getResponse);
  assert.equal(getResponse.status, 200);
  assert.equal(getResponse.headers["Content-Type"], "application/json");
  assert.equal(getResponse.headers["Cache-Control"], "no-store");
  assert.equal(getResponse.body.includes(anthropicSecret), false, "GET handler never serializes a key");
  assert.deepEqual(JSON.parse(getResponse.body), getProviderConnectionsPayload());

  const postResponse = new FakeResponse();
  handleProviderConnections({ method: "POST" }, postResponse);
  assert.equal(postResponse.status, 405);
  assert.deepEqual(JSON.parse(postResponse.body), { error: "Use GET." });

  clearProviderSnapshot();
  assert.deepEqual(
    getProviderConnectionsPayload(),
    { schemaVersion: 1, companionManaged: false, providers: [] },
    "clearing restores the headless default"
  );
  assert.equal(getManagedApiKey("anthropic"), undefined);
  assert.equal(isCompanionManaged(), false);
  assert.equal(getManagedProviderConnection("anthropic"), undefined);

  console.log("provider connections probes: PASS");
} finally {
  clearProviderSnapshot();
}
