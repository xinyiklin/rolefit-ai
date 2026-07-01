import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { lookup as dnsLookup } from "node:dns/promises";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

export class BlockedHostError extends Error {}
export class DnsError extends Error {}

export function isLocalHost(hostname) {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

// Returns true for any IPv4 literal in a loopback/private/link-local/CGNAT/unspecified range.
function isPrivateIPv4(ip) {
  const octets = ip.split(".");
  if (octets.length !== 4) return false;
  const parts = octets.map((part) => Number(part));
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local 169.254.0.0/16 (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  return false;
}

// Expand an IPv6 literal to its eight 16-bit hextets, or null if it is not a
// syntactically valid IPv6 address. Handles "::" zero-compression, an embedded
// dotted-IPv4 tail (::ffff:127.0.0.1), and a %zone suffix. Normalizing FIRST is
// what closes the bypass: a textual check that only recognized one form (e.g.
// dotted ::ffff:127.0.0.1) missed the equivalent hex form ::ffff:7f00:1 that the
// URL parser produces, and the fully-spelled 0:0:0:0:0:ffff:7f00:1.
function expandIPv6(value) {
  let host = String(value).toLowerCase().replace(/^\[|\]$/g, "");
  const pct = host.indexOf("%");
  if (pct >= 0) host = host.slice(0, pct); // strip zone/scope id
  if (!host.includes(":")) return null;

  // Fold a trailing dotted-IPv4 tail into two hextets so the rest is pure hex.
  const v4 = host.match(/(?:^|:)((?:\d{1,3}\.){3}\d{1,3})$/);
  if (v4) {
    const o = v4[1].split(".").map(Number);
    if (o.some((n) => !Number.isInteger(n) || n > 255)) return null;
    const hi = ((o[0] << 8) | o[1]).toString(16);
    const lo = ((o[2] << 8) | o[3]).toString(16);
    host = host.slice(0, host.length - v4[1].length) + `${hi}:${lo}`;
  }

  const halves = host.split("::");
  if (halves.length > 2) return null; // at most one "::" run
  const toHextets = (segment) => {
    if (segment === "") return [];
    const out = [];
    for (const group of segment.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
      out.push(Number.parseInt(group, 16));
    }
    return out;
  };
  const head = toHextets(halves[0]);
  const tail = halves.length === 2 ? toHextets(halves[1]) : [];
  if (head === null || tail === null) return null;

  let hextets;
  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 1) return null; // "::" must stand for at least one zero group
    hextets = [...head, ...new Array(fill).fill(0), ...tail];
  } else {
    hextets = head;
  }
  return hextets.length === 8 ? hextets : null;
}

// Decode two hextets into a dotted-IPv4 string (for the embedded-IPv4 IPv6 forms).
const embeddedIPv4 = (hi, lo) => `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;

// Returns true for IPv6 loopback, unspecified, ULA (fc00::/7), link-local
// (fe80::/10), or any form that embeds a private IPv4 — IPv4-mapped
// (::ffff:a.b.c.d), IPv4-compatible (::a.b.c.d), 6to4 (2002::/16), or Teredo
// (2001:0::/32). Works off the fully-expanded address so it can't be evaded by
// choosing a different textual spelling of the same address.
function isPrivateIPv6(ip) {
  const h = expandIPv6(ip);
  if (!h) return false;
  if (h.every((x) => x === 0)) return true; // :: (unspecified)
  if (h.slice(0, 7).every((x) => x === 0) && h[7] === 1) return true; // ::1 (loopback)
  // ::ffff:a.b.c.d (mapped) and ::a.b.c.d (compatible): judge the embedded IPv4.
  if (h.slice(0, 5).every((x) => x === 0) && (h[5] === 0xffff || h[5] === 0)) {
    return isPrivateIPv4(embeddedIPv4(h[6], h[7]));
  }
  if (h[0] === 0x2002) return isPrivateIPv4(embeddedIPv4(h[1], h[2])); // 6to4 gateway IPv4
  if (h[0] === 0x2001 && h[1] === 0x0000) {
    return isPrivateIPv4(embeddedIPv4(h[6] ^ 0xffff, h[7] ^ 0xffff)); // Teredo client IPv4 (XOR-obfuscated)
  }
  if ((h[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 (ULA)
  if ((h[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 (link-local)
  return false;
}

function isPrivateIpLiteral(value) {
  const host = String(value).replace(/^\[|\]$/g, "");
  if (host.includes(":")) return isPrivateIPv6(host);
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return isPrivateIPv4(host);
  return false;
}

export function isPrivateHost(hostname) {
  const host = hostname.toLowerCase();
  return isLocalHost(host) || host.endsWith(".local") || isPrivateIpLiteral(host);
}

// Resolves a hostname and rejects if it is a private literal or any resolved
// address is private/link-local/loopback. Throws a tagged error otherwise.
export async function assertPublicHost(hostname) {
  const host = String(hostname).toLowerCase();
  if (isPrivateHost(host)) {
    throw new BlockedHostError("Private or local hosts are not allowed.");
  }
  let resolved;
  try {
    resolved = await dnsLookup(host.replace(/^\[|\]$/g, ""), { all: true });
  } catch {
    throw new DnsError("Could not resolve the host for that URL.");
  }
  if (!resolved.length) {
    throw new DnsError("Could not resolve the host for that URL.");
  }
  for (const { address } of resolved) {
    if (isPrivateIpLiteral(address)) {
      throw new BlockedHostError("That URL resolves to a private or local address.");
    }
  }
  // Return the validated addresses so the caller can pin the connection to one
  // of them instead of letting the HTTP client re-resolve the name (rebinding).
  return resolved;
}

export function isPublicHttpUrl(url) {
  if (!["http:", "https:"].includes(url.protocol)) return false;
  // Only the protocol-default port (URL.port is "" for 80/443). A redirect to a
  // non-standard port (e.g. :8080, :22) would turn a job-page fetch into an
  // arbitrary-port probe from the user's IP; real job postings use default ports.
  if (url.port !== "") return false;

  return !isPrivateHost(url.hostname);
}

export function chatCompletionsEndpoint(rawBaseUrl) {
  const raw = String(rawBaseUrl ?? "").trim();
  if (!raw) throw new Error("Add an OpenAI-compatible base URL.");

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Enter a valid OpenAI-compatible base URL.");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("AI base URL must start with http:// or https://.");
  }

  if (url.protocol === "http:" && !isLocalHost(url.hostname)) {
    throw new Error("Use https:// for remote AI providers. http:// is only allowed for localhost.");
  }

  if (url.protocol === "https:" && isPrivateHost(url.hostname) && !isLocalHost(url.hostname)) {
    throw new Error("Private-network AI base URLs are blocked. Use localhost for local AI or a public https provider URL.");
  }

  url.hash = "";
  url.search = "";
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith("/chat/completions") ? path : `${path || "/v1"}/chat/completions`;
  return url;
}

const MAX_FETCH_BYTES = 5_000_000;

function decompressResponse(res) {
  const encoding = String(res.headers["content-encoding"] || "").toLowerCase();
  if (encoding === "gzip") return res.pipe(createGunzip());
  if (encoding === "deflate") return res.pipe(createInflate());
  if (encoding === "br") return res.pipe(createBrotliDecompress());
  return res;
}

// Fetch `url`, connecting ONLY to `pinnedAddress` (already validated as public)
// while keeping the real hostname for the Host header and TLS SNI. This closes
// the DNS-rebinding TOCTOU: Node's global fetch re-resolves the hostname after
// validation, so a short-TTL/rebinding host could swap in a private/metadata IP
// between the check and the connection. Redirects are NOT auto-followed here —
// fetchPublicHtml re-validates and re-pins each hop. Returns a minimal,
// fetch-like response ({ status, ok, headers.get, text }).
function pinnedFetch(url, { headers = {}, timeoutMs = 10_000, pinnedAddress, pinnedFamily }) {
  const requestFn = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(arg);
    };
    const req = requestFn(
      url,
      {
        method: "GET",
        servername: url.protocol === "https:" ? url.hostname : undefined,
        headers: { "Accept-Encoding": "gzip, deflate, br", ...headers },
        // Pin DNS to the pre-validated address; never re-resolve the name.
        // Node's happy-eyeballs path calls lookup with { all: true } and expects
        // the array form, so support both callback shapes.
        lookup: (_hostname, options, cb) =>
          options && options.all
            ? cb(null, [{ address: pinnedAddress, family: pinnedFamily }])
            : cb(null, pinnedAddress, pinnedFamily)
      },
      (res) => {
        const stream = decompressResponse(res);
        const chunks = [];
        let total = 0;
        stream.on("data", (chunk) => {
          if (settled) return;
          total += chunk.length;
          if (total > MAX_FETCH_BYTES) {
            req.destroy();
            finish(reject, new BlockedHostError("The job page was too large to read."));
            return;
          }
          chunks.push(chunk);
        });
        stream.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode ?? 0;
          finish(resolve, {
            status,
            ok: status >= 200 && status < 300,
            headers: { get: (name) => res.headers[String(name).toLowerCase()] ?? null },
            text: async () => body
          });
        });
        stream.on("error", (error) => {
          req.destroy();
          finish(reject, error);
        });
      }
    );
    const timer = setTimeout(() => {
      req.destroy();
      finish(reject, new BlockedHostError("The job page request timed out."));
    }, timeoutMs);
    req.on("error", (error) => finish(reject, error));
    req.end();
  });
}

// Fetches a job page, following redirects manually and re-validating + re-pinning
// the host's resolved IP on every hop. Rejects private/blocked targets instead
// of auto-following them, so a public URL can't bounce to an internal address.
export async function fetchPublicHtml(startUrl, extraHeaders = {}) {
  let current = startUrl;
  for (let hop = 0; hop < 5; hop += 1) {
    if (!isPublicHttpUrl(current)) {
      throw new BlockedHostError("Only public http or https URLs are allowed.");
    }
    const [pinned] = await assertPublicHost(current.hostname);

    const response = await pinnedFetch(current, {
      headers: { "User-Agent": "Mozilla/5.0 ResumePolisher/0.1", ...extraHeaders },
      timeoutMs: 10_000,
      pinnedAddress: pinned.address,
      pinnedFamily: pinned.family
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new BlockedHostError("The site redirected without a destination.");
      current = new URL(location, current);
      continue;
    }

    return response;
  }
  throw new BlockedHostError("The site redirected too many times.");
}
