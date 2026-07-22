// Proxy-Max SSRF policy: validate syntax, literal ranges, DNS answers, and every
// redirect hop. Local-only product features can opt out explicitly at their
// authenticated call site; remote input is deny-by-default.
import { lookup as dnsLookup } from "node:dns/promises";
import net from "node:net";
import { Agent } from "undici";

const PINNED_AGENT_TTL_MS = 60_000;
const PINNED_AGENT_LIMIT = 64;
const pinnedAgents = new Map();

const BLOCKED_HOSTNAMES = new Set([
  "localhost", "localhost.localdomain", "ip6-localhost", "ip6-loopback",
  "metadata", "metadata.google.internal",
]);
const BLOCKED_SUFFIXES = [
  ".internal", ".local", ".localhost", ".home.arpa", ".test", ".invalid", ".example",
];

function ipv4ToInt(host) {
  const parts = String(host).split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

const BLOCKED_V4_RANGES = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10],
  ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
].map(([base, bits]) => [ipv4ToInt(base), bits]);

export function isBlockedIpv4(host) {
  const ip = ipv4ToInt(host);
  if (ip === null) return false;
  return BLOCKED_V4_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (ip & mask) === (base & mask);
  });
}

function expandIpv6(value) {
  let input = String(value || "").replace(/^\[|\]$/g, "").split("%")[0].toLowerCase();
  const v4Match = input.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Match) {
    const v4 = ipv4ToInt(v4Match[1]);
    if (v4 === null) return null;
    input = `${input.slice(0, -v4Match[1].length)}${((v4 >>> 16) & 0xffff).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const halves = input.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - left.length - right.length : 0;
  const parts = [...left, ...Array(Math.max(0, fill)).fill("0"), ...right];
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  return parts.map((part) => parseInt(part, 16));
}

export function isBlockedIpv6(host) {
  const words = expandIpv6(host);
  if (!words) return false;
  const allZero = words.every((word) => word === 0);
  if (allZero || (words.slice(0, 7).every((word) => word === 0) && words[7] === 1)) return true;
  if ((words[0] & 0xfe00) === 0xfc00) return true; // unique-local fc00::/7
  if ((words[0] & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((words[0] & 0xff00) === 0xff00) return true; // multicast
  if (words[0] === 0x2001 && (words[1] === 0x0db8 || words[1] === 0x0000)) return true; // docs + Teredo
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    return isBlockedIpv4(`${words[6] >>> 8}.${words[6] & 255}.${words[7] >>> 8}.${words[7] & 255}`);
  }
  if (words[0] === 0x2002) { // 6to4 embeds an IPv4 destination
    return isBlockedIpv4(`${words[1] >>> 8}.${words[1] & 255}.${words[2] >>> 8}.${words[2] & 255}`);
  }
  return false;
}

function normalizeHost(hostname) {
  return String(hostname || "").replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
}

export function assertPublicAddress(address) {
  const family = net.isIP(address);
  if (family === 4 && isBlockedIpv4(address)) throw new Error("Blocked URL: private or reserved IP");
  if (family === 6 && isBlockedIpv6(address)) throw new Error("Blocked URL: private or reserved IP");
  if (!family) throw new Error("Blocked URL: invalid DNS address");
  return address;
}

export function assertPublicUrl(rawUrl) {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Blocked URL: unsupported protocol");
  if (parsed.username || parsed.password) throw new Error("Blocked URL: embedded credentials");
  const host = normalizeHost(parsed.hostname);
  if (!host) throw new Error("Blocked URL: missing host");
  if (BLOCKED_HOSTNAMES.has(host) || BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    throw new Error("Blocked URL: internal host");
  }
  if (net.isIP(host)) assertPublicAddress(host);
  return parsed;
}

export async function assertPublicUrlResolved(rawUrl, options = {}) {
  const parsed = assertPublicUrl(rawUrl);
  const host = normalizeHost(parsed.hostname);
  if (net.isIP(host)) return { url: parsed, addresses: [{ address: host, family: net.isIP(host) }] };
  const lookup = options.lookup || dnsLookup;
  let addresses;
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error("Blocked URL: DNS resolution failed");
  }
  if (!Array.isArray(addresses) || addresses.length === 0) throw new Error("Blocked URL: DNS returned no addresses");
  for (const result of addresses) assertPublicAddress(result?.address);
  return { url: parsed, addresses };
}

function stripCrossOriginCredentials(headers) {
  const next = new Headers(headers || {});
  for (const name of ["authorization", "proxy-authorization", "x-api-key", "api-key", "cookie"]) next.delete(name);
  return next;
}

function getPinnedDispatcher(url, addresses) {
  const normalized = addresses.map(({ address, family }) => ({ address, family: Number(family) || net.isIP(address) }));
  const key = `${url.protocol}//${url.host}|${normalized.map((item) => `${item.family}:${item.address}`).join(",")}`;
  const now = Date.now();
  for (const [cachedKey, cached] of pinnedAgents) {
    if (cached.expiresAt > now && pinnedAgents.size <= PINNED_AGENT_LIMIT) continue;
    pinnedAgents.delete(cachedKey);
    cached.agent.close().catch(() => {});
  }
  const cached = pinnedAgents.get(key);
  if (cached?.expiresAt > now) return cached.agent;

  const agent = new Agent({
    connect: {
      lookup: (_hostname, lookupOptions, callback) => {
        const family = Number(lookupOptions?.family) || 0;
        const eligible = family ? normalized.filter((item) => item.family === family) : normalized;
        if (!eligible.length) {
          const error = new Error("Pinned DNS address family unavailable");
          error.code = "EAI_AGAIN";
          callback(error);
          return;
        }
        if (lookupOptions?.all) callback(null, eligible);
        else callback(null, eligible[0].address, eligible[0].family);
      },
    },
  });
  pinnedAgents.set(key, { agent, expiresAt: now + PINNED_AGENT_TTL_MS });
  return agent;
}

export async function fetchUrlWithPolicy(rawUrl, options = {}, policy = {}) {
  const allowPrivate = policy.allowPrivate === true;
  const lookup = policy.lookup || dnsLookup;
  const fetchImpl = policy.fetchImpl || globalThis.fetch;
  const maxRedirects = Math.max(0, Math.min(10, Number(policy.maxRedirects ?? 5)));
  const timeoutMs = Math.max(1, Number(policy.timeoutMs || 10000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Request timeout")), timeoutMs);
  timer.unref?.();
  let current = new URL(rawUrl);
  let requestOptions = { ...options, redirect: "manual", signal: options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal };
  try {
    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      let hopOptions = requestOptions;
      if (!allowPrivate) {
        const resolved = await assertPublicUrlResolved(current.toString(), { lookup });
        // Bind the actual socket lookup to the exact public addresses just
        // validated, closing the classic validate-then-rebind (TOCTOU) gap.
        if (!policy.fetchImpl || policy.dispatcherFactory) {
          const dispatcherFactory = policy.dispatcherFactory || getPinnedDispatcher;
          hopOptions = { ...requestOptions, dispatcher: dispatcherFactory(current, resolved.addresses) };
        }
      }
      const response = await fetchImpl(current, hopOptions);
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      if (redirectCount === maxRedirects) throw new Error("Too many redirects");
      const location = response.headers.get("location");
      if (!location) return response;
      const next = new URL(location, current);
      if (current.protocol === "https:" && next.protocol !== "https:") throw new Error("Blocked URL: HTTPS downgrade redirect");
      if (next.origin !== current.origin) requestOptions = { ...requestOptions, headers: stripCrossOriginCredentials(requestOptions.headers) };
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && String(requestOptions.method || "GET").toUpperCase() === "POST")) {
        requestOptions = { ...requestOptions, method: "GET", body: undefined };
      }
      current = next;
    }
    throw new Error("Too many redirects");
  } finally {
    clearTimeout(timer);
  }
}
