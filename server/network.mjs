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

// Returns true for IPv6 loopback, ULA (fc00::/7), link-local (fe80::/10),
// unspecified, or IPv4-mapped addresses that map to a private IPv4.
function isPrivateIPv6(ip) {
  const host = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "::1" || host === "::") return true;
  const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  const head = host.split(":")[0];
  if (!head) return false;
  const block = Number.parseInt(head, 16);
  if (Number.isNaN(block)) return false;
  if ((block & 0xfe00) === 0xfc00) return true; // fc00::/7 (ULA)
  if ((block & 0xffc0) === 0xfe80) return true; // fe80::/10 (link-local)
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
