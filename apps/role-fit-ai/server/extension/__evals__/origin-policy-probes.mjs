import assert from "node:assert/strict";

import {
  handleExtensionPairingRequests,
  handleExtensionRoutes,
  isAllowedExtensionOrigin,
  listPendingExtensionPairingOrigins,
  parseAllowedExtensionOrigins
} from "../routes.ts";

const chromeOrigin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
const firefoxOrigin = "moz-extension://6e59a9f2-92a8-4f65-b6ab-1be636a9f732";
const safariOrigin = "safari-web-extension://com.example.rolefit.extension";

const configured = parseAllowedExtensionOrigins(
  ` ${chromeOrigin},${firefoxOrigin},${safariOrigin},https://example.com,chrome-extension:// `
);
assert.deepEqual([...configured], [chromeOrigin, firefoxOrigin, safariOrigin]);
assert.equal(isAllowedExtensionOrigin(chromeOrigin, configured), true);
assert.equal(isAllowedExtensionOrigin(firefoxOrigin, configured), true);
assert.equal(isAllowedExtensionOrigin(safariOrigin, configured), true);

for (const rejected of [
  undefined,
  "",
  "null",
  "https://example.com",
  "http://localhost:5181",
  "chrome-extension://different-extension",
  `${chromeOrigin}.attacker`,
  `${chromeOrigin}/`,
  `${chromeOrigin}/popup.html`,
  `${chromeOrigin}?unexpected=true`,
  `${chromeOrigin}#fragment`,
  "chrome-extension://user@abcdefghijklmnopabcdefghijklmnop",
  "chrome-extension://abcdefghijklmnopabcdefghijklmnop:5181"
]) {
  assert.equal(
    isAllowedExtensionOrigin(rejected, configured),
    false,
    `unexpected extension origin must be rejected: ${String(rejected)}`
  );
}

assert.equal(
  isAllowedExtensionOrigin(chromeOrigin, parseAllowedExtensionOrigins("")),
  false,
  "an empty configuration must reject even a well-formed extension origin"
);
assert.equal(
  parseAllowedExtensionOrigins("x".repeat(4_097)).size,
  0,
  "oversized configuration fails closed"
);
assert.equal(
  parseAllowedExtensionOrigins(Array.from({ length: 17 }, (_, index) =>
    `chrome-extension://${String(index).padStart(32, "a")}`
  ).join(",")).size,
  0,
  "too many configured identities fail closed"
);
assert.equal(
  parseAllowedExtensionOrigins(`${chromeOrigin}\n`).size,
  0,
  "control characters cannot enter the identity allowlist"
);

class FakeResponse {
  status = 0;
  body = "";
  headers = new Map();

  setHeader(name, value) {
    this.headers.set(String(name).toLowerCase(), String(value));
  }

  writeHead(status) {
    this.status = status;
  }

  end(chunk = "") {
    this.body = String(chunk);
  }
}

const previousAllowedOrigins = process.env.EXTENSION_ALLOWED_ORIGINS;
try {
  delete process.env.EXTENSION_ALLOWED_ORIGINS;
  const pendingBeforeStatus = [...listPendingExtensionPairingOrigins()];
  const unpairedStatus = new FakeResponse();
  await handleExtensionRoutes(
    { method: "GET", headers: { origin: firefoxOrigin } },
    unpairedStatus,
    "/api/extension/status"
  );
  assert.equal(unpairedStatus.status, 200);
  assert.deepEqual(JSON.parse(unpairedStatus.body), {
    service: "rolefit-ai-extension",
    schemaVersion: 1,
    status: "ok",
    paired: false
  });
  assert.equal(unpairedStatus.headers.get("access-control-allow-origin"), firefoxOrigin);
  assert.equal(unpairedStatus.headers.get("vary"), "Origin");
  assert.equal(unpairedStatus.headers.get("cache-control"), "no-store");
  assert.deepEqual(
    listPendingExtensionPairingOrigins(),
    pendingBeforeStatus,
    "status must not enqueue an unpaired origin"
  );

  const statusOptions = new FakeResponse();
  await handleExtensionRoutes(
    { method: "OPTIONS", headers: { origin: firefoxOrigin } },
    statusOptions,
    "/api/extension/status"
  );
  assert.equal(statusOptions.status, 204);
  assert.equal(statusOptions.headers.get("access-control-allow-origin"), firefoxOrigin);
  assert.equal(statusOptions.headers.get("vary"), "Origin");
  assert.equal(statusOptions.headers.get("cache-control"), "no-store");
  assert.equal(statusOptions.headers.get("access-control-allow-methods"), "GET, OPTIONS");
  assert.equal(statusOptions.headers.has("access-control-allow-headers"), false);

  const statusMethod = new FakeResponse();
  await handleExtensionRoutes(
    { method: "POST", headers: { origin: firefoxOrigin } },
    statusMethod,
    "/api/extension/status"
  );
  assert.equal(statusMethod.status, 405);
  assert.deepEqual(JSON.parse(statusMethod.body), { error: "Use GET." });
  assert.equal(statusMethod.headers.get("access-control-allow-origin"), firefoxOrigin);
  assert.equal(statusMethod.headers.get("cache-control"), "no-store");

  const originlessStatus = new FakeResponse();
  await handleExtensionRoutes(
    { method: "GET", headers: {} },
    originlessStatus,
    "/api/extension/status"
  );
  assert.equal(originlessStatus.status, 200);
  assert.deepEqual(JSON.parse(originlessStatus.body), {
    service: "rolefit-ai-extension",
    schemaVersion: 1,
    status: "ok",
    paired: false
  });
  assert.equal(originlessStatus.headers.has("access-control-allow-origin"), false);
  assert.equal(originlessStatus.headers.get("cache-control"), "no-store");
  assert.deepEqual(
    listPendingExtensionPairingOrigins(),
    pendingBeforeStatus,
    "an originless status probe must not enqueue a pairing request"
  );

  for (const headers of [
    { origin: "null" },
    { origin: `${firefoxOrigin}.attacker` }
  ]) {
    const invalidStatus = new FakeResponse();
    await handleExtensionRoutes(
      { method: "GET", headers },
      invalidStatus,
      "/api/extension/status"
    );
    assert.equal(invalidStatus.status, 403);
    assert.equal(invalidStatus.headers.has("access-control-allow-origin"), false);
    assert.equal(invalidStatus.headers.get("cache-control"), "no-store");
  }

  const originlessStatusOptions = new FakeResponse();
  await handleExtensionRoutes(
    { method: "OPTIONS", headers: {} },
    originlessStatusOptions,
    "/api/extension/status"
  );
  assert.equal(originlessStatusOptions.status, 403);
  assert.equal(originlessStatusOptions.headers.has("access-control-allow-origin"), false);

  const denied = new FakeResponse();
  await handleExtensionRoutes(
    { method: "OPTIONS", headers: { origin: chromeOrigin } },
    denied,
    "/api/extension/import"
  );
  assert.equal(denied.status, 403);
  assert.deepEqual(JSON.parse(denied.body), {
    error: "Extension not paired.",
    code: "extension-not-paired"
  });
  assert.equal(denied.headers.get("access-control-allow-origin"), chromeOrigin);

  const pairingRequest = new FakeResponse();
  await handleExtensionRoutes(
    { method: "POST", headers: { origin: chromeOrigin } },
    pairingRequest,
    "/api/extension/pairing-request"
  );
  assert.equal(pairingRequest.status, 202);
  assert.deepEqual(JSON.parse(pairingRequest.body), { status: "pending" });
  assert.deepEqual(listPendingExtensionPairingOrigins(), [chromeOrigin]);

  const pending = new FakeResponse();
  handleExtensionPairingRequests({ method: "GET", headers: {} }, pending);
  assert.equal(pending.status, 200);
  assert.deepEqual(JSON.parse(pending.body), { origins: [chromeOrigin] });

  process.env.EXTENSION_ALLOWED_ORIGINS = chromeOrigin;
  const pairedStatus = new FakeResponse();
  await handleExtensionRoutes(
    { method: "GET", headers: { origin: chromeOrigin } },
    pairedStatus,
    "/api/extension/status"
  );
  assert.equal(pairedStatus.status, 200);
  assert.deepEqual(JSON.parse(pairedStatus.body), {
    service: "rolefit-ai-extension",
    schemaVersion: 1,
    status: "ok",
    paired: true
  });
  assert.equal(pairedStatus.headers.get("access-control-allow-origin"), chromeOrigin);
  assert.equal(pairedStatus.headers.get("vary"), "Origin");
  assert.equal(pairedStatus.headers.get("cache-control"), "no-store");

  const allowed = new FakeResponse();
  await handleExtensionRoutes(
    { method: "OPTIONS", headers: { origin: chromeOrigin } },
    allowed,
    "/api/extension/import"
  );
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("access-control-allow-origin"), chromeOrigin);
  assert.equal(allowed.headers.get("vary"), "Origin");
  assert.equal(allowed.headers.get("access-control-allow-methods"), "GET, POST, OPTIONS");
  assert.equal(allowed.headers.get("access-control-allow-headers"), "Content-Type");

  const alreadyPaired = new FakeResponse();
  await handleExtensionRoutes(
    { method: "POST", headers: { origin: chromeOrigin } },
    alreadyPaired,
    "/api/extension/pairing-request"
  );
  assert.equal(alreadyPaired.status, 200);
  assert.deepEqual(JSON.parse(alreadyPaired.body), { status: "paired" });

  const nearMatch = new FakeResponse();
  await handleExtensionRoutes(
    { method: "OPTIONS", headers: { origin: `${chromeOrigin}.attacker` } },
    nearMatch,
    "/api/extension/analyze"
  );
  assert.equal(nearMatch.status, 403);
  assert.equal(nearMatch.headers.has("access-control-allow-origin"), false);
} finally {
  if (previousAllowedOrigins === undefined) {
    delete process.env.EXTENSION_ALLOWED_ORIGINS;
  } else {
    process.env.EXTENSION_ALLOWED_ORIGINS = previousAllowedOrigins;
  }
}

console.log("extension origin policy probes: PASS");
