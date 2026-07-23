// Cross-tab extension inbox claim/token state-machine probes.
//
// handleExtensionInbox + the module-internal pruneExtensionInbox /
// releaseStaleExtensionClaims form a per-tab claim queue with no HTTP-level
// coverage. This locks the CURRENT contract:
//   - a token-reserved, still-unclaimed entry is claimable ONLY by the matching
//     fresh tab (isReservedForFreshTab);
//   - no other tab may drain/steal it, and there is deliberately NO
//     "steal after grace period" fallback — a reserved entry that no matching
//     tab ever claims simply expires via the TTL;
//   - TTL expiry prunes unclaimed entries;
//   - claim hand-off delivers the settled posting once and drains it.
//
// Deterministic time: the module reads Date.now() directly (no injected seam),
// so this isolated subprocess overrides Date.now to a controllable fake clock.
// That fixes each entry's createdAt (set inside the import route) AND every poll
// instant, making the TTL / stale-window boundaries exact rather than wall-clock
// dependent. No product change is required.
//
// Offline determinism: the background prepare step (runExtensionPrepare →
// resolveImportedJobText) is fed a private-loopback URL, so it resolves the raw
// captured text with NO network and settles the entry to "done" within a
// microtask. Because an entry always settles to "done" before a poll can read
// it here, a poll that SELECTS an entry also drains it; the releaseStaleClaims
// clearing branch only fires for a still-"distilling" (undelivered) entry, which
// cannot be held open offline without a network-backed prepare. Its
// security-relevant guarantee — that a stale release never hands a token-reserved
// entry to another tab regardless of elapsed time — IS locked below.
import assert from "node:assert/strict";
import { Readable } from "node:stream";

// Mirror the module's own bounds (not exported) so the boundaries are explicit.
const EXTENSION_IMPORT_TTL_MS = 10 * 60 * 1000;
const EXTENSION_CLAIM_STALE_MS = 8 * 1000;

const chromeOrigin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
process.env.EXTENSION_ALLOWED_ORIGINS = chromeOrigin;

const realDateNow = Date.now;
let fakeNow = 1_000_000_000_000;
Date.now = () => fakeNow;

class FakeResponse {
  status = 0;
  body = "";
  headers = new Map();
  setHeader(name, value) { this.headers.set(String(name).toLowerCase(), String(value)); }
  writeHead(status) { this.status = status; }
  end(chunk = "") { this.body = String(chunk); }
}

async function settle() {
  // Let the serialized background prepare microtask run to completion.
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

let handleExtensionRoutes;
let handleExtensionInbox;
let cleanExtensionClaimToken;

async function importPosting({ text, url, claimToken } = {}) {
  const res = new FakeResponse();
  const req = Readable.from([JSON.stringify({ text, url, claimToken })]);
  req.method = "POST";
  req.headers = { origin: chromeOrigin };
  await handleExtensionRoutes(req, res, "/api/extension/import");
  assert.equal(res.status, 200, "a paired extension import is accepted");
  await settle();
}

async function poll(tabId, claimToken = "") {
  const res = new FakeResponse();
  await handleExtensionInbox({ method: "GET" }, res, tabId, claimToken);
  assert.equal(res.status, 200, "the inbox answers 200 on GET");
  return JSON.parse(res.body);
}

try {
  ({ handleExtensionRoutes, handleExtensionInbox, cleanExtensionClaimToken } =
    await import(`../routes.ts?inbox-probe=${realDateNow()}`));

  // --- claim-token sanitizer (inbox routing identity) ---
  assert.equal(cleanExtensionClaimToken("tok_fresh_alpha"), "tok_fresh_alpha", "a well-formed claim token passes");
  assert.equal(cleanExtensionClaimToken("short"), "", "a too-short token is dropped");
  assert.equal(cleanExtensionClaimToken("bad token/../x"), "", "a token with illegal characters is dropped");
  assert.equal(cleanExtensionClaimToken(undefined), "", "a non-string token is dropped");

  // --- Token reservation, no-steal, no steal-after-grace, matching-tab claim ---
  fakeNow = 2_000_000_000_000;
  const token = "tok_fresh_alpha";
  const alphaText = "Alpha role — responsibilities and requirements padding padding";
  const alphaUrl = "http://127.0.0.1/jobs/alpha";
  await importPosting({ text: alphaText, url: alphaUrl, claimToken: token });

  assert.equal(
    await poll("older-visible-tab", ""),
    null,
    "an older token-less tab cannot claim a token-reserved entry"
  );
  assert.equal(
    await poll("other-tab", "tok_some_wrong_token"),
    null,
    "a tab presenting the wrong token cannot claim the reserved entry"
  );

  // No steal-after-grace: advance far past the stale-claim window. The reserved
  // (still unclaimed) entry must NOT be handed to a non-matching tab.
  fakeNow += EXTENSION_CLAIM_STALE_MS * 5;
  assert.equal(
    await poll("older-visible-tab", ""),
    null,
    "there is no steal-after-grace fallback for a token-reserved entry"
  );

  // The matching fresh tab claims and receives the settled posting exactly once.
  const claimed = await poll("fresh-tab", token);
  assert.ok(claimed && typeof claimed === "object", "the matching fresh tab receives its reserved posting");
  assert.equal(claimed.text, alphaText, "the delivered posting carries the captured text");
  assert.equal(claimed.url, alphaUrl, "the delivered posting carries the captured url");
  assert.equal(await poll("fresh-tab", token), null, "the reserved entry is drained after hand-off");

  // --- TTL expiry prunes an unclaimed reserved entry (no cross-tab leak) ---
  fakeNow = 3_000_000_000_000;
  const ttlToken = "tok_never_arrives";
  await importPosting({
    text: "Orphan role that no matching tab ever claims padding padding",
    url: "http://127.0.0.1/jobs/orphan",
    claimToken: ttlToken
  });
  fakeNow += EXTENSION_IMPORT_TTL_MS + 1;
  assert.equal(
    await poll("fresh-tab", ttlToken),
    null,
    "an unclaimed reserved entry expires via the TTL rather than leaking"
  );

  // --- Claim hand-off happy path (token-less legacy entry) ---
  fakeNow = 4_000_000_000_000;
  const handoffText = "Handoff role body with enough length to be a real posting padding";
  const handoffUrl = "http://127.0.0.1/jobs/handoff";
  await importPosting({ text: handoffText, url: handoffUrl });

  const handoff = await poll("tab-A", "");
  assert.ok(handoff && typeof handoff === "object", "a claiming tab receives the token-less posting");
  assert.equal(handoff.text, handoffText, "the hand-off carries the prepared posting text");
  assert.equal(handoff.url, handoffUrl, "the hand-off carries the posting url");
  assert.equal(handoff.fields, null, "the server hands off with fields:null so the tab distills client-side");
  assert.equal(await poll("tab-A", ""), null, "the entry is drained after a single hand-off");

  console.log("extension inbox probes: PASS");
} finally {
  Date.now = realDateNow;
}
