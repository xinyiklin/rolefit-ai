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
