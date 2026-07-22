import crypto from "node:crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { FORMATS } from "../translator/formats.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { FETCH_CONNECT_TIMEOUT_MS } from "../config/runtimeConfig.js";

const BEDROCK_ANTHROPIC_VERSION = "bedrock-2023-05-31";
const DEFAULT_REGION = "us-east-1";
const SERVICE = "bedrock";
const encoder = new TextEncoder();
const strictDecoder = new TextDecoder("utf-8", { fatal: true });

export const BEDROCK_EVENTSTREAM_LIMITS = Object.freeze({
  maxMessageBytes: 4 * 1024 * 1024,
  maxHeadersBytes: 64 * 1024,
  maxBufferedBytes: 8 * 1024 * 1024,
  maxInnerEventBytes: 4 * 1024 * 1024,
  maxHeaderCount: 64,
  maxHeaderNameBytes: 128,
});

const ANTHROPIC_STREAM_EVENTS = new Set([
  "message_start",
  "content_block_start",
  "ping",
  "content_block_delta",
  "content_block_stop",
  "message_delta",
  "message_stop",
  "error",
]);

const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return value >>> 0;
});

class BedrockProtocolError extends Error {
  constructor(code) {
    super("AWS Bedrock EventStream protocol error");
    this.name = "BedrockProtocolError";
    this.code = code;
  }
}

function protocolError(code) {
  return new BedrockProtocolError(code);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function requireCredential(value, label) {
  const normalized = nonEmptyString(value);
  if (!normalized) throw new Error(`AWS Bedrock requires ${label}`);
  return normalized;
}

function normalizeRegion(value) {
  const region = nonEmptyString(value) || DEFAULT_REGION;
  if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/u.test(region)) {
    throw new Error("AWS Bedrock region is invalid");
  }
  return region;
}

function encodeRfc3986(value) {
  return encodeURIComponent(value).replace(/[!'()*]/gu, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function normalizeEndpoint(endpoint, region) {
  const raw = nonEmptyString(endpoint) || `https://bedrock-runtime.${region}.amazonaws.com`;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("AWS Bedrock endpoint must be an absolute HTTPS URL");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("AWS Bedrock endpoint must use HTTPS");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("AWS Bedrock endpoint cannot contain credentials, a query, or a fragment");
  }
  return parsed;
}

export function normalizeBedrockProviderSpecificData(value = {}, { requireSecret = false } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("AWS Bedrock configuration is invalid");
  }
  const secretAccessKey = nonEmptyString(value.secretAccessKey);
  if (requireSecret && !secretAccessKey) throw new Error("AWS Bedrock requires a secret access key");
  const region = normalizeRegion(value.region);
  const sessionToken = nonEmptyString(value.sessionToken);
  const endpoint = nonEmptyString(value.endpoint);
  let normalizedEndpoint = "";
  if (endpoint) normalizedEndpoint = normalizeEndpoint(endpoint, region).toString().replace(/\/+$/u, "");
  return {
    ...(secretAccessKey ? { secretAccessKey } : {}),
    ...(Object.prototype.hasOwnProperty.call(value, "sessionToken") ? { sessionToken } : {}),
    region,
    ...(Object.prototype.hasOwnProperty.call(value, "endpoint") ? { endpoint: normalizedEndpoint } : {}),
  };
}

export function buildBedrockUrl({ model, stream = false, region, endpoint } = {}) {
  const normalizedModel = nonEmptyString(model);
  if (!normalizedModel || normalizedModel.length > 2048) {
    throw new Error("AWS Bedrock model ID is invalid");
  }
  const normalizedRegion = normalizeRegion(region);
  const parsed = normalizeEndpoint(endpoint, normalizedRegion);
  const basePath = parsed.pathname.replace(/\/+$/u, "");
  const action = stream ? "invoke-with-response-stream" : "invoke";
  parsed.pathname = `${basePath}/model/${encodeRfc3986(normalizedModel)}/${action}`;
  return parsed.toString();
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hmac(key, value, encoding = undefined) {
  return crypto.createHmac("sha256", key).update(value, "utf8").digest(encoding);
}

function canonicalizePath(pathname) {
  try {
    return pathname
      .split("/")
      .map((segment) => encodeRfc3986(decodeURIComponent(segment)))
      .join("/");
  } catch {
    throw new Error("AWS Bedrock request path is invalid");
  }
}

function canonicalizeQuery(searchParams) {
  return [...searchParams.entries()]
    .map(([name, value]) => [encodeRfc3986(name), encodeRfc3986(value)])
    .sort(([nameA, valueA], [nameB, valueB]) => (
      nameA.localeCompare(nameB) || valueA.localeCompare(valueB)
    ))
    .map(([name, value]) => `${name}=${value}`)
    .join("&");
}

function normalizeHeaderValue(value) {
  return String(value).trim().replace(/\s+/gu, " ");
}

/**
 * Deterministic AWS Signature Version 4 signing for Bedrock Runtime requests.
 * The secret key is used only as HMAC input and is never included in a URL or
 * exception message.
 */
export function signBedrockRequest({
  url,
  body = "",
  accessKeyId,
  secretAccessKey,
  sessionToken,
  region,
  now = new Date(),
} = {}) {
  const normalizedAccessKeyId = requireCredential(accessKeyId, "an access key ID");
  const normalizedSecret = requireCredential(secretAccessKey, "a secret access key");
  const normalizedRegion = normalizeRegion(region);
  const parsed = normalizeEndpoint(url, normalizedRegion);
  const timestamp = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(timestamp.getTime())) throw new Error("AWS Bedrock signing time is invalid");

  const amzDate = timestamp.toISOString().replace(/[:-]|\.\d{3}/gu, "");
  const dateStamp = amzDate.slice(0, 8);
  const payload = typeof body === "string" ? body : String(body ?? "");
  const payloadHash = sha256Hex(payload);
  const canonicalHeaders = {
    "content-type": "application/json",
    host: parsed.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    "x-amzn-bedrock-accept": "application/json",
  };
  const normalizedSessionToken = nonEmptyString(sessionToken);
  if (normalizedSessionToken) canonicalHeaders["x-amz-security-token"] = normalizedSessionToken;

  const signedHeaderNames = Object.keys(canonicalHeaders).sort();
  const canonicalHeaderBlock = signedHeaderNames
    .map((name) => `${name}:${normalizeHeaderValue(canonicalHeaders[name])}\n`)
    .join("");
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalRequest = [
    "POST",
    canonicalizePath(parsed.pathname),
    "",
    canonicalHeaderBlock,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/${normalizedRegion}/${SERVICE}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const dateKey = hmac(`AWS4${normalizedSecret}`, dateStamp);
  const regionKey = hmac(dateKey, normalizedRegion);
  const serviceKey = hmac(regionKey, SERVICE);
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = hmac(signingKey, stringToSign, "hex");

  return {
    "Content-Type": "application/json",
    Host: parsed.host,
    "X-Amz-Content-Sha256": payloadHash,
    "X-Amz-Date": amzDate,
    "X-Amzn-Bedrock-Accept": "application/json",
    ...(normalizedSessionToken ? { "X-Amz-Security-Token": normalizedSessionToken } : {}),
    Authorization: `AWS4-HMAC-SHA256 Credential=${normalizedAccessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

/** Sign Bedrock control-plane GETs such as ListFoundationModels and
 * ListInferenceProfiles. Runtime endpoints deliberately continue to reject
 * query strings; this separate signer allows only an absolute HTTPS control
 * URL and includes its canonical query in SigV4.
 */
export function signBedrockControlRequest({
  url,
  accessKeyId,
  secretAccessKey,
  sessionToken,
  region,
  now = new Date(),
} = {}) {
  const normalizedAccessKeyId = requireCredential(accessKeyId, "an access key ID");
  const normalizedSecret = requireCredential(secretAccessKey, "a secret access key");
  const normalizedRegion = normalizeRegion(region);
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("AWS Bedrock control endpoint must be an absolute HTTPS URL");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("AWS Bedrock control endpoint must use HTTPS");
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw new Error("AWS Bedrock control endpoint cannot contain credentials or a fragment");
  }

  const timestamp = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(timestamp.getTime())) throw new Error("AWS Bedrock signing time is invalid");
  const amzDate = timestamp.toISOString().replace(/[:-]|\.\d{3}/gu, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex("");
  const canonicalHeaders = {
    accept: "application/json",
    host: parsed.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  const normalizedSessionToken = nonEmptyString(sessionToken);
  if (normalizedSessionToken) canonicalHeaders["x-amz-security-token"] = normalizedSessionToken;

  const signedHeaderNames = Object.keys(canonicalHeaders).sort();
  const canonicalHeaderBlock = signedHeaderNames
    .map((name) => `${name}:${normalizeHeaderValue(canonicalHeaders[name])}\n`)
    .join("");
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalRequest = [
    "GET",
    canonicalizePath(parsed.pathname),
    canonicalizeQuery(parsed.searchParams),
    canonicalHeaderBlock,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/${normalizedRegion}/${SERVICE}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const dateKey = hmac(`AWS4${normalizedSecret}`, dateStamp);
  const regionKey = hmac(dateKey, normalizedRegion);
  const serviceKey = hmac(regionKey, SERVICE);
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = hmac(signingKey, stringToSign, "hex");

  return {
    Accept: "application/json",
    Host: parsed.host,
    "X-Amz-Content-Sha256": payloadHash,
    "X-Amz-Date": amzDate,
    ...(normalizedSessionToken ? { "X-Amz-Security-Token": normalizedSessionToken } : {}),
    Authorization: `AWS4-HMAC-SHA256 Credential=${normalizedAccessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

export function buildBedrockAnthropicBody(body = {}) {
  const result = { ...(body && typeof body === "object" ? body : {}) };
  delete result.model;
  delete result.stream;
  delete result._toolNameMap;
  result.anthropic_version = BEDROCK_ANTHROPIC_VERSION;
  if (!Array.isArray(result.messages)) result.messages = [];
  if (!Number.isFinite(Number(result.max_tokens)) || Number(result.max_tokens) <= 0) {
    result.max_tokens = 1024;
  }
  return result;
}

export function crc32(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError("crc32 expects Uint8Array");
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function decodeUtf8(bytes, code) {
  try {
    return strictDecoder.decode(bytes);
  } catch {
    throw protocolError(code);
  }
}

function parseHeaders(data, view, start, length, limits) {
  const headers = Object.create(null);
  let offset = start;
  const end = start + length;
  let count = 0;
  const requireBytes = (size) => {
    if (!Number.isInteger(size) || size < 0 || offset + size > end) {
      throw protocolError("header_bounds");
    }
  };

  while (offset < end) {
    if (++count > limits.maxHeaderCount) throw protocolError("header_count");
    requireBytes(1);
    const nameLength = data[offset++];
    if (nameLength < 1 || nameLength > limits.maxHeaderNameBytes) throw protocolError("header_name_length");
    requireBytes(nameLength + 1);
    const name = decodeUtf8(data.subarray(offset, offset + nameLength), "header_name_utf8");
    offset += nameLength;
    if (Object.prototype.hasOwnProperty.call(headers, name)) throw protocolError("duplicate_header");
    const type = data[offset++];

    if (type === 0 || type === 1) {
      headers[name] = type === 0;
    } else if (type === 2) {
      requireBytes(1);
      headers[name] = view.getInt8(offset);
      offset += 1;
    } else if (type === 3) {
      requireBytes(2);
      headers[name] = view.getInt16(offset, false);
      offset += 2;
    } else if (type === 4) {
      requireBytes(4);
      headers[name] = view.getInt32(offset, false);
      offset += 4;
    } else if (type === 5 || type === 8) {
      requireBytes(8);
      headers[name] = view.getBigInt64(offset, false);
      offset += 8;
    } else if (type === 6 || type === 7) {
      requireBytes(2);
      const valueLength = view.getUint16(offset, false);
      offset += 2;
      requireBytes(valueLength);
      const value = data.subarray(offset, offset + valueLength);
      headers[name] = type === 7 ? decodeUtf8(value, "header_value_utf8") : value.slice();
      offset += valueLength;
    } else if (type === 9) {
      requireBytes(16);
      headers[name] = data.subarray(offset, offset + 16).slice();
      offset += 16;
    } else {
      throw protocolError("header_type");
    }
  }
  if (offset !== end) throw protocolError("header_alignment");
  return headers;
}

export function parseBedrockEventStreamFrame(data, limits = BEDROCK_EVENTSTREAM_LIMITS) {
  if (!(data instanceof Uint8Array) || data.byteLength < 16) throw protocolError("frame_short");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const totalLength = view.getUint32(0, false);
  const headersLength = view.getUint32(4, false);
  if (totalLength !== data.byteLength) throw protocolError("frame_length");
  if (totalLength > limits.maxMessageBytes || headersLength > limits.maxHeadersBytes || headersLength > totalLength - 16) {
    throw protocolError("frame_bounds");
  }
  if (view.getUint32(8, false) !== crc32(data.subarray(0, 8))) throw protocolError("prelude_crc");
  if (view.getUint32(totalLength - 4, false) !== crc32(data.subarray(0, totalLength - 4))) {
    throw protocolError("message_crc");
  }
  const headers = parseHeaders(data, view, 12, headersLength, limits);
  const payloadBytes = data.subarray(12 + headersLength, totalLength - 4);
  let payload = null;
  if (payloadBytes.byteLength > 0) {
    const payloadText = decodeUtf8(payloadBytes, "payload_utf8");
    try {
      payload = JSON.parse(payloadText);
    } catch {
      throw protocolError("payload_json");
    }
  }
  return { headers, payload };
}

function decodeBase64(value, limits) {
  if (typeof value !== "string" || value.length === 0 || value.length > Math.ceil(limits.maxInnerEventBytes / 3) * 4 + 4) {
    throw protocolError("chunk_base64_length");
  }
  if (value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    throw protocolError("chunk_base64");
  }
  const bytes = Uint8Array.from(Buffer.from(value, "base64"));
  if (bytes.byteLength > limits.maxInnerEventBytes) throw protocolError("inner_event_bounds");
  return bytes;
}

function parseAnthropicEvent(frame, limits) {
  const messageType = frame.headers[":message-type"];
  const eventType = frame.headers[":event-type"];
  if (messageType === "exception" || (typeof eventType === "string" && /exception$/iu.test(eventType))) {
    throw protocolError("upstream_exception");
  }
  if (messageType !== "event" || eventType !== "chunk") throw protocolError("unexpected_event_type");
  if (!frame.payload || typeof frame.payload !== "object" || Array.isArray(frame.payload)) {
    throw protocolError("chunk_payload");
  }
  const bytes = decodeBase64(frame.payload.bytes, limits);
  const text = decodeUtf8(bytes, "inner_event_utf8");
  let event;
  try {
    event = JSON.parse(text);
  } catch {
    throw protocolError("inner_event_json");
  }
  if (!event || typeof event !== "object" || Array.isArray(event) || !ANTHROPIC_STREAM_EVENTS.has(event.type)) {
    throw protocolError("inner_event_shape");
  }
  if (event.type === "error") {
    if (!event.error || typeof event.error !== "object") throw protocolError("error_event_shape");
    return {
      type: "error",
      error: { type: "api_error", message: "AWS Bedrock ended the stream with an error." },
    };
  }
  return event;
}

function validateAnthropicSequence(event, state) {
  if (state.terminal) throw protocolError("event_after_terminal");
  if (event.type === "ping") return;
  if (event.type === "error") {
    if (!event.error || typeof event.error !== "object") throw protocolError("error_event_shape");
    state.terminal = true;
    return;
  }
  if (event.type === "message_start") {
    if (state.started || !event.message || typeof event.message !== "object") throw protocolError("message_start_sequence");
    state.started = true;
    return;
  }
  if (!state.started) throw protocolError("missing_message_start");
  if (event.type === "content_block_start") {
    if (!Number.isInteger(event.index) || event.index < 0 || state.openBlocks.has(event.index) || !event.content_block) {
      throw protocolError("content_block_start_shape");
    }
    state.openBlocks.add(event.index);
    return;
  }
  if (event.type === "content_block_delta") {
    if (!Number.isInteger(event.index) || !state.openBlocks.has(event.index) || !event.delta) {
      throw protocolError("content_block_delta_shape");
    }
    return;
  }
  if (event.type === "content_block_stop") {
    if (!Number.isInteger(event.index) || !state.openBlocks.delete(event.index)) {
      throw protocolError("content_block_stop_sequence");
    }
    return;
  }
  if (event.type === "message_delta") {
    if (!event.delta || typeof event.delta !== "object") throw protocolError("message_delta_shape");
    return;
  }
  if (event.type === "message_stop") {
    if (state.openBlocks.size > 0) throw protocolError("unclosed_content_block");
    state.terminal = true;
  }
}

function encodeAnthropicSse(event) {
  return encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

function encodeSanitizedStreamError() {
  return encodeAnthropicSse({
    type: "error",
    error: {
      type: "api_error",
      message: "AWS Bedrock returned an invalid or incomplete event stream.",
    },
  });
}

function appendBytes(left, right) {
  if (left.byteLength === 0) return right.slice();
  const joined = new Uint8Array(left.byteLength + right.byteLength);
  joined.set(left);
  joined.set(right, left.byteLength);
  return joined;
}

export function transformBedrockEventStream(response, { signal, limits = BEDROCK_EVENTSTREAM_LIMITS } = {}) {
  if (!response?.body?.getReader) {
    return new Response(encodeSanitizedStreamError(), {
      status: response?.status || 502,
      headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache" },
    });
  }

  const reader = response.body.getReader();
  const state = { buffer: new Uint8Array(0), started: false, terminal: false, openBlocks: new Set() };
  let closed = false;
  let cancelled = false;
  let abortHandler;

  const stream = new ReadableStream({
    async start(controller) {
      const fail = async () => {
        if (closed || cancelled) return;
        closed = true;
        await reader.cancel("invalid Bedrock EventStream").catch(() => {});
        controller.enqueue(encodeSanitizedStreamError());
        controller.close();
      };

      abortHandler = () => {
        cancelled = true;
        closed = true;
        reader.cancel("Bedrock request aborted").catch(() => {});
        const abortError = new Error("AWS Bedrock request aborted");
        abortError.name = "AbortError";
        try { controller.error(abortError); } catch { /* downstream already closed */ }
      };
      signal?.addEventListener?.("abort", abortHandler, { once: true });

      try {
        while (!closed && !cancelled) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!(value instanceof Uint8Array) || state.buffer.byteLength + value.byteLength > limits.maxBufferedBytes) {
            throw protocolError("buffer_bounds");
          }
          state.buffer = appendBytes(state.buffer, value);

          while (state.buffer.byteLength >= 12) {
            const prelude = new DataView(state.buffer.buffer, state.buffer.byteOffset, 12);
            if (prelude.getUint32(8, false) !== crc32(state.buffer.subarray(0, 8))) throw protocolError("prelude_crc");
            const totalLength = prelude.getUint32(0, false);
            const headersLength = prelude.getUint32(4, false);
            if (totalLength < 16 || totalLength > limits.maxMessageBytes || headersLength > limits.maxHeadersBytes || headersLength > totalLength - 16) {
              throw protocolError("frame_bounds");
            }
            if (state.buffer.byteLength < totalLength) break;
            const frameBytes = state.buffer.slice(0, totalLength);
            state.buffer = state.buffer.slice(totalLength);
            const event = parseAnthropicEvent(parseBedrockEventStreamFrame(frameBytes, limits), limits);
            validateAnthropicSequence(event, state);
            controller.enqueue(encodeAnthropicSse(event));
          }
        }

        if (cancelled) return;
        if (state.buffer.byteLength !== 0 || !state.terminal) throw protocolError("incomplete_stream");
        closed = true;
        controller.close();
      } catch {
        await fail();
      } finally {
        signal?.removeEventListener?.("abort", abortHandler);
      }
    },
    async cancel() {
      cancelled = true;
      signal?.removeEventListener?.("abort", abortHandler);
      await reader.cancel("Bedrock downstream cancelled").catch(() => {});
    },
  });

  const headers = new Headers(response.headers || {});
  headers.set("Content-Type", "text/event-stream; charset=utf-8");
  headers.set("Cache-Control", "no-cache");
  headers.delete("Content-Length");
  headers.delete("Content-Encoding");
  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export class BedrockExecutor extends BaseExecutor {
  constructor() {
    super("bedrock", PROVIDERS.bedrock || { baseUrl: "", format: FORMATS.CLAUDE });
  }

  buildUrl(model, stream, _urlIndex = 0, credentials = null) {
    const providerSpecificData = credentials?.providerSpecificData || {};
    return buildBedrockUrl({
      model,
      stream,
      region: providerSpecificData.region,
      endpoint: providerSpecificData.endpoint,
    });
  }

  buildHeaders(_credentials, stream = true) {
    return {
      "Content-Type": "application/json",
      Accept: stream ? "application/vnd.amazon.eventstream" : "application/json",
      "X-Amzn-Bedrock-Accept": "application/json",
    };
  }

  transformRequest(_model, body) {
    return buildBedrockAnthropicBody(body);
  }

  parseError(response) {
    const status = Number(response?.status) || 502;
    return { status, message: `AWS Bedrock rejected the request (HTTP ${status})` };
  }

  async execute({ model, body, stream, credentials = {}, signal, proxyOptions = null }) {
    const providerSpecificData = credentials.providerSpecificData || {};
    const region = normalizeRegion(providerSpecificData.region);
    const url = this.buildUrl(model, stream, 0, credentials);
    const transformedBody = this.transformRequest(model, body, stream, credentials);
    const bodyText = JSON.stringify(transformedBody);
    const signedHeaders = signBedrockRequest({
      url,
      body: bodyText,
      accessKeyId: credentials.apiKey,
      secretAccessKey: providerSpecificData.secretAccessKey,
      sessionToken: providerSpecificData.sessionToken,
      region,
    });
    const headers = {
      ...signedHeaders,
      Accept: stream ? "application/vnd.amazon.eventstream" : "application/json",
    };

    const connectController = new AbortController();
    const connectTimeoutMs = this.config?.timeoutMs || FETCH_CONNECT_TIMEOUT_MS;
    const connectTimer = setTimeout(
      () => connectController.abort(new Error("Bedrock connection timeout")),
      connectTimeoutMs,
    );
    connectTimer.unref?.();
    const requestSignal = signal
      ? AbortSignal.any([signal, connectController.signal])
      : connectController.signal;

    let response;
    try {
      response = await proxyAwareFetch(url, {
        method: "POST",
        headers,
        body: bodyText,
        signal: requestSignal,
      }, proxyOptions);
    } catch (error) {
      if (signal?.aborted) {
        const abortError = new Error("AWS Bedrock request aborted");
        abortError.name = "AbortError";
        throw abortError;
      }
      if (connectController.signal.aborted) throw new Error("AWS Bedrock connection timed out");
      if (error?.name === "AbortError") throw error;
      throw new Error("AWS Bedrock request failed");
    } finally {
      clearTimeout(connectTimer);
    }

    const outputResponse = stream && response.ok
      ? transformBedrockEventStream(response, { signal })
      : response;
    return {
      response: outputResponse,
      url,
      headers,
      transformedBody,
      responseFormat: FORMATS.CLAUDE,
    };
  }
}

export default BedrockExecutor;
