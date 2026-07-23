// SSRF-enforcing runtime probes for fetchPublicHtml + the DNS-rebinding pin in
// network.ts. The private-host predicate is unit-tested in
// network-private-hosts.mjs; THIS file drives the actual fetch path that job
// import calls, which previously had zero coverage:
//
//   - a redirect to a private host is rejected (not auto-followed);
//   - the manual redirect hop cap fires (~network.ts fetchPublicHtml loop);
//   - a 3xx with no Location header is rejected;
//   - a body over MAX_FETCH_BYTES is rejected by the real streaming byte cap;
//   - the DNS-rebinding TOCTOU is closed: a hostname that RESOLVES to a private
//     IP is rejected even though its literal name looks public;
//   - the validated address is pinned into the connection (anti-rebinding).
//
// Fully offline: no sockets and no real DNS. network.ts exposes optional
// injection seams on fetchPublicHtml (`deps.lookup` / `deps.request`) that
// default to the real resolver/client when omitted, so production behavior is
// unchanged; here we pass fakes so the real validation/pin/byte-cap logic runs
// against synthetic transport.
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";

import { fetchPublicHtml, BlockedHostError } from "../network.ts";

// A lookup that always resolves to a fixed set of addresses (LookupAddress[]).
const lookupTo = (...addresses) => async (_hostname, options) => {
  const all = addresses.map(([address, family]) => ({ address, family }));
  return options && options.all ? all : all[0];
};

// Build a fake node http/https `request(url, options, onResponse)` that returns
// a synthetic IncomingMessage. Captures the pinned lookup so we can prove the
// connection is pinned to the pre-validated address rather than re-resolving.
function fakeRequest({ status = 200, headers = {}, body = "" } = {}) {
  const capture = { pinnedAddress: undefined, calls: 0 };
  const request = (_url, options, onResponse) => {
    capture.calls += 1;
    // pinnedFetch passes a `lookup` in options that pins to the validated IP;
    // invoke it the way node's happy-eyeballs path does to capture the address.
    if (options && typeof options.lookup === "function") {
      options.lookup("pinned", { all: true }, (_err, addrs) => {
        capture.pinnedAddress = Array.isArray(addrs) ? addrs[0]?.address : undefined;
      });
    }
    const req = new EventEmitter();
    req.end = () => {};
    req.destroy = () => {};
    queueMicrotask(() => {
      const res = new Readable({ read() {} });
      res.headers = headers;
      res.statusCode = status;
      onResponse(res);
      res.push(Buffer.from(body));
      res.push(null);
    });
    return req;
  };
  return { request, capture };
}

const PUBLIC_LOOKUP = lookupTo(["93.184.216.34", 4]);

let failures = 0;
async function expectRejects(name, run, matcher) {
  try {
    await run();
    failures += 1;
    console.log(`FAIL ${name} (did not reject)`);
  } catch (error) {
    const ok = matcher(error);
    console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
    if (!ok) failures += 1;
  }
}
async function expectOk(name, run) {
  try {
    await run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${name}: ${error?.message ?? error}`);
  }
}

// 1) Redirect to a private host is rejected, not followed. First hop resolves
// public; the 302 points at the cloud-metadata IP; the next loop iteration's
// isPublicHttpUrl rejects it before any second connection.
await expectRejects(
  "redirect to a private/metadata host is rejected",
  () => fetchPublicHtml(new URL("http://jobs.example.com/posting"), {}, {
    lookup: PUBLIC_LOOKUP,
    request: fakeRequest({ status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } }).request
  }),
  (e) => e instanceof BlockedHostError && /public http or https/i.test(e.message)
);

// 1b) The private redirect target can also be an IPv6 mapped-loopback literal.
await expectRejects(
  "redirect to a mapped-loopback IPv6 literal is rejected",
  () => fetchPublicHtml(new URL("http://jobs.example.com/posting"), {}, {
    lookup: PUBLIC_LOOKUP,
    request: fakeRequest({ status: 301, headers: { location: "http://[::ffff:7f00:1]/admin" } }).request
  }),
  (e) => e instanceof BlockedHostError
);

await expectRejects(
  "a DNS answer in IPv6 ORCHID special-use space is rejected",
  () => fetchPublicHtml(new URL("http://special.example.com/posting"), {}, {
    lookup: lookupTo(["2001:20::1", 6]),
    request: () => { throw new Error("transport must not be reached for a special-use address"); }
  }),
  (e) => e instanceof BlockedHostError && /private or local address/i.test(e.message)
);

// 2) Redirect hop cap: every hop returns a public 3xx, so the loop exhausts and
// throws instead of following redirects forever.
await expectRejects(
  "redirect hop cap fires on an endless public redirect chain",
  () => fetchPublicHtml(new URL("http://jobs.example.com/loop"), {}, {
    lookup: PUBLIC_LOOKUP,
    request: fakeRequest({ status: 302, headers: { location: "http://jobs.example.com/loop" } }).request
  }),
  (e) => e instanceof BlockedHostError && /too many times/i.test(e.message)
);

// 3) A 3xx with no Location header is rejected (can't silently swallow it).
await expectRejects(
  "a redirect with no Location header is rejected",
  () => fetchPublicHtml(new URL("http://jobs.example.com/posting"), {}, {
    lookup: PUBLIC_LOOKUP,
    request: fakeRequest({ status: 302, headers: {} }).request
  }),
  (e) => e instanceof BlockedHostError && /without a destination/i.test(e.message)
);

// 4) A body over MAX_FETCH_BYTES (5 MB) trips the real streaming byte cap in
// pinnedFetch — the fake transport streams an oversized body, the real
// byte-counting logic aborts it.
await expectRejects(
  "an over-limit response body is rejected by the streaming byte cap",
  () => fetchPublicHtml(new URL("http://jobs.example.com/huge"), {}, {
    lookup: PUBLIC_LOOKUP,
    request: fakeRequest({ status: 200, body: "x".repeat(5_000_001) }).request
  }),
  (e) => e instanceof BlockedHostError && /too large/i.test(e.message)
);

// 5) DNS-rebinding pin: a public-LOOKING hostname that RESOLVES to a private IP
// is rejected by assertPublicHost's resolved-address check. The fake transport
// throws if reached, proving rejection happens before any connection.
const neverConnect = {
  request: () => {
    throw new Error("transport must not be reached for a rebinding host");
  }
};
await expectRejects(
  "a hostname resolving to a private IP is rejected (rebinding TOCTOU closed)",
  () => fetchPublicHtml(new URL("http://rebind.example.com/posting"), {}, {
    lookup: lookupTo(["169.254.169.254", 4]),
    request: neverConnect.request
  }),
  (e) => e instanceof BlockedHostError && /private or local address/i.test(e.message)
);

// 5b) Even when the FIRST resolved address is public, ANY private address in the
// resolved set rejects (a rebinding host can return a mixed answer).
await expectRejects(
  "a mixed public+private resolution is rejected on the private member",
  () => fetchPublicHtml(new URL("http://mixed.example.com/posting"), {}, {
    lookup: lookupTo(["93.184.216.34", 4], ["10.0.0.5", 4]),
    request: neverConnect.request
  }),
  (e) => e instanceof BlockedHostError && /private or local address/i.test(e.message)
);

// 6) Happy path: a public host with a 200 returns its body, AND the connection
// is pinned to the validated resolved address (never re-resolved by the client).
const happy = fakeRequest({ status: 200, body: "<html>job posting body</html>" });
await expectOk("a public 200 returns the body and pins the validated address", async () => {
  const response = await fetchPublicHtml(new URL("http://jobs.example.com/ok"), {}, {
    lookup: lookupTo(["93.184.216.34", 4]),
    request: happy.request
  });
  assert.equal(response.status, 200);
  assert.equal(response.ok, true);
  assert.equal(await response.text(), "<html>job posting body</html>");
  assert.equal(happy.capture.pinnedAddress, "93.184.216.34", "connection pinned to the validated resolved IP");
});

console.log(`\n${failures ? "FAILED" : "PASS"} network fetch/SSRF probes (${failures} failing)`);
process.exit(failures ? 1 : 0);
