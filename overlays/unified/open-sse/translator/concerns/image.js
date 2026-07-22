// Build a base64 data URI from mime + base64 payload
export function encodeDataUri(mimeType, base64) {
  return `data:${mimeType};base64,${base64}`;
}

// Parse a base64 data URI → { mimeType, base64 }, or null if not a data URI.
// [\s\S] tolerates newlines inside the base64 payload.
const DATA_URI_RE = /^data:([^;]+);base64,([\s\S]+)$/;
export function parseDataUri(url) {
  if (typeof url !== "string") return null;
  const m = url.match(DATA_URI_RE);
  return m ? { mimeType: m[1], base64: m[2] } : null;
}

import { lookup } from "node:dns/promises";
import { Agent } from "undici";
import { MAX_IMAGE_BYTES, FETCH_TIMEOUT_MS, IMAGE_SIGNATURES, BLOCKED_HOSTS } from "../../config/mediaConfig.js";
import { assertPublicUrl, isBlockedIpv4, isBlockedIpv6 } from "../../../src/shared/utils/ssrfGuard.js";

function isPrivateIp(ip) {
  if (typeof ip !== "string" || !ip) return true;
  return ip.includes(":") ? isBlockedIpv6(ip) : isBlockedIpv4(ip);
}

// Resolve host once and return only public IPs (SSRF guard).
// Rejects if any resolved record is private/reserved (defeats multi-A tricks).
async function resolvePinnedIps(hostname) {
  if (!hostname || BLOCKED_HOSTS.has(hostname.toLowerCase())) return null;
  try {
    const resolved = await lookup(hostname, { all: true, verbatim: true });
    const records = Array.isArray(resolved) ? resolved : [resolved];
    if (!records.length || records.some((r) => isPrivateIp(r.address))) return null;
    return records;
  } catch {
    return null;
  }
}

// Verify buffer magic bytes match a known image signature; return its mime or null.
function detectImageMime(buf) {
  for (const { sig, offset, mime, verifyWebp } of IMAGE_SIGNATURES) {
    if (buf.length < offset + sig.length) continue;
    let match = true;
    for (let i = 0; i < sig.length; i++) {
      if (buf[offset + i] !== sig[i]) { match = false; break; }
    }
    if (!match) continue;
    // WEBP: RIFF....WEBP — bytes 8..11 must be "WEBP".
    if (verifyWebp && !(buf.length >= 12 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50)) continue;
    return mime;
  }
  return null;
}

/**
 * Fetch a remote image URL and return it as a base64 data URI.
 * Hardened against SSRF (private/metadata IPs), memory DoS (size cap),
 * and disguised non-image payloads (magic-byte verification).
 * Returns null on any failure or rejection.
 *
 * @param {string} imageUrl - HTTP(S) URL of the image
 * @param {object} options - { signal, timeoutMs, maxBytes }
 * @returns {Promise<{url: string, mimeType: string}|null>}
 */
export async function fetchImageAsBase64(imageUrl, options = {}) {
  const { signal, timeoutMs = FETCH_TIMEOUT_MS, maxBytes = MAX_IMAGE_BYTES } = options;
  let url;
  try { url = assertPublicUrl(imageUrl); } catch { return null; }
  const pinnedIps = await resolvePinnedIps(url.hostname);
  if (!pinnedIps) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("Image fetch timed out")), Math.max(1, Number(timeoutMs) || FETCH_TIMEOUT_MS));
  const abortFromCaller = () => controller.abort(signal.reason);
  if (signal) {
    if (signal.aborted) abortFromCaller();
    else signal.addEventListener("abort", abortFromCaller, { once: true });
  }

  // Pin connect to the validated IP so no second DNS resolution can rebind (TOCTOU fix).
  const pinned = pinnedIps[0];
  const dispatcher = new Agent({
    connect: {
      lookup: (_hostname, lookupOptions, callback) => {
        if (lookupOptions?.all) callback(null, [{ address: pinned.address, family: pinned.family }]);
        else callback(null, pinned.address, pinned.family);
      },
    },
  });

  try {
    // redirect:"manual" prevents a public URL redirecting to a private one (SSRF bypass).
    const response = await fetch(url, { signal: controller.signal, redirect: "manual", dispatcher });
    if (!response.ok || !response.body) return null;
    const advertisedSize = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(advertisedSize) && advertisedSize > maxBytes) return null;

    // Stream-read with a hard byte cap to avoid loading huge payloads into memory.
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) { try { await reader.cancel(); } catch { /* ignore */ } return null; }
      chunks.push(value);
    }

    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    const mimeType = detectImageMime(buf);
    if (!mimeType) return null; // not a recognized image — reject disguised payloads

    return { url: `data:${mimeType};base64,${buf.toString("base64")}`, mimeType };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener?.("abort", abortFromCaller);
    dispatcher.close().catch(() => {});
  }
}
