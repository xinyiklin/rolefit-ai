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
];
for (const h of PRIVATE) {
  assert.equal(isPrivateHost(h), true, `must be treated as private: ${h}`);
}

// --- genuinely public hosts must NOT be falsely blocked ---
const PUBLIC = [
  "boards.greenhouse.io",
  "example.com",
  "8.8.8.8",
  "2606:4700:4700::1111", // Cloudflare public IPv6
  "2001:4860:4860::8888", // Google public IPv6 (NOT Teredo: 2001:0:: only)
];
for (const h of PUBLIC) {
  assert.equal(isPrivateHost(h), false, `public host must not be blocked: ${h}`);
}

// --- end-to-end through the URL guard used by /api/import-job ---
assert.equal(isPublicHttpUrl(new URL("http://[::ffff:7f00:1]/jobs")), false, "mapped-loopback URL rejected");
assert.equal(isPublicHttpUrl(new URL("http://[fe80::1]/")), false, "link-local URL rejected");
assert.equal(isPublicHttpUrl(new URL("https://boards.greenhouse.io/acme/jobs/123")), true, "real job URL allowed");

console.log("network private-host probes passed");
