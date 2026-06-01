import { lookup as dnsLookup } from "node:dns/promises";

import { fetchWithTimeout } from "./http.mjs";

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
}

export function isPublicHttpUrl(url) {
  if (!["http:", "https:"].includes(url.protocol)) return false;

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

// Fetches a job page, following redirects manually and re-validating the
// host + resolved IP of every hop. Rejects private/blocked targets instead of
// auto-following them, so a public URL can't bounce to an internal address.
export async function fetchPublicHtml(startUrl) {
  let current = startUrl;
  for (let hop = 0; hop < 5; hop += 1) {
    if (!isPublicHttpUrl(current)) {
      throw new BlockedHostError("Only public http or https URLs are allowed.");
    }
    await assertPublicHost(current.hostname);

    const response = await fetchWithTimeout(
      current,
      {
        headers: { "User-Agent": "Mozilla/5.0 ResumePolisher/0.1" },
        redirect: "manual"
      },
      10_000
    );

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
