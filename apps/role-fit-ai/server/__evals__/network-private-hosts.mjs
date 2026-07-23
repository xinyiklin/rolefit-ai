// SSRF guard probes for server/network.mjs. The job-import path must reject any
// URL whose host is private/loopback/link-local — including every textual
// spelling of an IPv6 address that embeds a private IPv4. A regression here
// re-opens an SSRF hole, so these run in the offline `npm test` gate.
import assert from "node:assert/strict";
import { isPrivateHost, isPublicHttpUrl } from "../network.ts";

// --- IPv6 forms that all denote 127.0.0.1 (the bypass this probe locks down) ---
// URL parsing normalizes ::ffff:127.0.0.1 to the hex form ::ffff:7f00:1, which an
// earlier dotted-only check let through as "public".
const LOOPBACK_V6 = [
  "::1",
  "::ffff:127.0.0.1",
  "::ffff:7f00:1", // hex form of the IPv4-mapped loopback (the regression)
  "0:0:0:0:0:ffff:7f00:1", // fully-spelled, no "::"
  "[::ffff:7f00:1]", // bracketed literal as URL.hostname yields it
  "::ffff:7f00:0001", // zero-padded hextet
  "::127.0.0.1", // deprecated IPv4-compatible form
];
for (const h of LOOPBACK_V6) {
  assert.equal(isPrivateHost(h), true, `loopback IPv6 form must be private: ${h}`);
}

// --- other private / link-local / ULA / embedded-private forms ---
const PRIVATE = [
  "fe80::1", // link-local
  "fc00::1", // ULA
  "fd12:3456::1", // ULA
  "::", // unspecified
  "::ffff:10.0.0.5", // mapped private 10/8
  "::ffff:a00:5", // hex form of the same
  "::ffff:192.168.1.1", // mapped private 192.168/16
  "::ffff:169.254.169.254", // mapped link-local (cloud metadata)
  "2002:7f00:1::1", // 6to4 wrapping 127.0.0.1
  "2002:a00:1::1", // 6to4 wrapping 10.0.0.1
  "10.0.0.1",
  "127.0.0.1",
  "169.254.169.254",
  "192.168.0.1",
  "0.0.0.0",
  "100.64.0.1", // CGNAT
  "172.16.0.1", // 172.16.0.0/12 low edge — the whole /12 was previously untested
  "172.31.255.254", // 172.16.0.0/12 high edge
  "192.0.0.1", // IETF protocol assignments 192.0.0.0/24
  "192.88.99.1", // deprecated 6to4 relay anycast 192.88.99.0/24
  "192.0.2.1", // documentation
  "198.18.0.1", // benchmark 198.18.0.0/15 (low half)
  "198.19.0.1", // benchmark 198.18.0.0/15 (high half — previously untested)
  "198.51.100.5", // documentation
  "203.0.113.8", // documentation
  "224.0.0.1", // multicast 224.0.0.0/4
  "240.0.0.1", // reserved 240.0.0.0/4 (previously untested)
  "255.255.255.255", // reserved/broadcast
  "ff02::1", // IPv6 multicast
  "2001:db8::1", // IPv6 documentation
  "fec0::1", // deprecated site-local space (outside global unicast)
  "64:ff9b::7f00:1", // NAT64 well-known prefix carrying loopback
  "2001:2::1", // benchmarking inside IETF protocol assignments
  "2001:10::1", // ORCHIDv1
  "2001:20::1", // ORCHIDv2
  "3fff::1", // IPv6 documentation block
];
for (const h of PRIVATE) {
  assert.equal(isPrivateHost(h), true, `must be treated as private: ${h}`);
}

// --- non-IP guarded families: loopback name + mDNS/.local suffix ---
// isPrivateHost also blocks the loopback hostname and any .local mDNS name; a
// regression in either re-opens loopback/LAN SSRF via a name rather than a literal.
for (const h of ["localhost", "myprinter.local", "SERVICE.LOCAL"]) {
  assert.equal(isPrivateHost(h), true, `guarded non-IP host must be private: ${h}`);
}

// --- genuinely public hosts must NOT be falsely blocked ---
const PUBLIC = [
  "boards.greenhouse.io",
  "example.com",
  "8.8.8.8",
  "172.15.255.255", // just below 172.16.0.0/12 — must stay public
  "172.32.0.1", // just above 172.31.255.255 — must stay public
  "2606:4700:4700::1111", // Cloudflare public IPv6
  "2001:4860:4860::8888", // Google public IPv6 (NOT Teredo: 2001:0:: only)
];
for (const h of PUBLIC) {
  assert.equal(isPrivateHost(h), false, `public host must not be blocked: ${h}`);
}

// --- end-to-end through the URL guard used by /api/import-job ---
assert.equal(isPublicHttpUrl(new URL("http://[::ffff:7f00:1]/jobs")), false, "mapped-loopback URL rejected");
assert.equal(isPublicHttpUrl(new URL("http://[fe80::1]/")), false, "link-local URL rejected");
assert.equal(isPublicHttpUrl(new URL("https://user:secret@example.com/job")), false, "credential-bearing URL rejected");
assert.equal(isPublicHttpUrl(new URL("https://boards.greenhouse.io/acme/jobs/123")), true, "real job URL allowed");

console.log("network private-host probes passed");
