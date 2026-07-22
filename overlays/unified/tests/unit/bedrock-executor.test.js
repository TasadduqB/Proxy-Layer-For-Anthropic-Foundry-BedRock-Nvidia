import { describe, expect, it, vi } from "vitest";

const { proxyFetchMock } = vi.hoisted(() => ({ proxyFetchMock: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: proxyFetchMock }));

import {
  BEDROCK_EVENTSTREAM_LIMITS,
  BedrockExecutor,
  buildBedrockAnthropicBody,
  buildBedrockUrl,
  crc32,
  normalizeBedrockProviderSpecificData,
  parseBedrockEventStreamFrame,
  signBedrockRequest,
  transformBedrockEventStream,
} from "../../open-sse/executors/bedrock.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

const textEncoder = new TextEncoder();

function concat(...parts) {
  const size = parts.reduce((total, part) => total + part.byteLength, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function stringHeader(name, value) {
  const nameBytes = textEncoder.encode(name);
  const valueBytes = textEncoder.encode(value);
  const result = new Uint8Array(1 + nameBytes.byteLength + 1 + 2 + valueBytes.byteLength);
  const view = new DataView(result.buffer);
  let offset = 0;
  result[offset++] = nameBytes.byteLength;
  result.set(nameBytes, offset);
  offset += nameBytes.byteLength;
  result[offset++] = 7;
  view.setUint16(offset, valueBytes.byteLength, false);
  offset += 2;
  result.set(valueBytes, offset);
  return result;
}

function eventStreamFrame({
  headers = { ":message-type": "event", ":event-type": "chunk" },
  payload = {},
} = {}) {
  const headerBytes = concat(...Object.entries(headers).map(([name, value]) => stringHeader(name, value)));
  const payloadBytes = textEncoder.encode(JSON.stringify(payload));
  const totalLength = 12 + headerBytes.byteLength + payloadBytes.byteLength + 4;
  const frame = new Uint8Array(totalLength);
  const view = new DataView(frame.buffer);
  view.setUint32(0, totalLength, false);
  view.setUint32(4, headerBytes.byteLength, false);
  view.setUint32(8, crc32(frame.subarray(0, 8)), false);
  frame.set(headerBytes, 12);
  frame.set(payloadBytes, 12 + headerBytes.byteLength);
  view.setUint32(totalLength - 4, crc32(frame.subarray(0, totalLength - 4)), false);
  return frame;
}

function anthropicFrame(event) {
  return eventStreamFrame({ payload: { bytes: Buffer.from(JSON.stringify(event)).toString("base64") } });
}

function responseFromChunks(chunks, onCancel = undefined) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      if (chunks.length > 0) controller.close();
    },
    cancel: onCancel,
  }), {
    status: 200,
    headers: { "content-type": "application/vnd.amazon.eventstream", "content-length": "999" },
  });
}

describe("AWS Bedrock SigV4 and native payload", () => {
  it("advertises Claude vision, PDF, tools, and reasoning capabilities", () => {
    expect(getCapabilitiesForModel("bedrock", "us.anthropic.claude-sonnet-4-20250514-v1:0")).toMatchObject({
      vision: true,
      pdf: true,
      tools: true,
      reasoning: true,
      thinkingFormat: "claude-budget",
    });
  });

  it("builds safe encoded runtime URLs and rejects credential-bearing endpoints", () => {
    expect(buildBedrockUrl({
      model: "us.anthropic.claude-sonnet-4-20250514-v1:0",
      stream: true,
      region: "us-east-1",
      endpoint: "https://bedrock.example.test/private/",
    })).toBe(
      "https://bedrock.example.test/private/model/us.anthropic.claude-sonnet-4-20250514-v1%3A0/invoke-with-response-stream",
    );
    expect(() => buildBedrockUrl({ model: "m", endpoint: "http://bedrock.example.test" })).toThrow(/HTTPS/);
    expect(() => buildBedrockUrl({ model: "m", endpoint: "https://user:secret@bedrock.example.test" })).toThrow(/credentials/);
    expect(() => buildBedrockUrl({ model: "m", endpoint: "https://bedrock.example.test?token=secret" })).toThrow(/query/);
  });

  it("produces a deterministic signature without reflecting the secret", () => {
    const url = buildBedrockUrl({ model: "anthropic.claude-3-haiku-20240307-v1:0", region: "us-east-1" });
    const signed = signBedrockRequest({
      url,
      body: "{\"hello\":\"world\"}",
      accessKeyId: "AKIDEXAMPLE",
      secretAccessKey: "super-secret-signing-key",
      sessionToken: "temporary-session-token",
      region: "us-east-1",
      now: new Date("2026-07-21T12:34:56.000Z"),
    });
    expect(signed["X-Amz-Date"]).toBe("20260721T123456Z");
    expect(signed["X-Amz-Content-Sha256"]).toBe("93a23971a914e5eacbf0a8d25154cda309c3c1c72fbb9914d47c60f3cb681588");
    expect(signed.Authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20260721\/us-east-1\/bedrock\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date;x-amz-security-token;x-amzn-bedrock-accept, Signature=[a-f0-9]{64}$/,
    );
    expect(signed["X-Amzn-Bedrock-Accept"]).toBe("application/json");
    expect(JSON.stringify(signed)).not.toContain("super-secret-signing-key");
    expect(url).not.toContain("AKIDEXAMPLE");
    expect(url).not.toContain("temporary-session-token");
  });

  it("uses the native Anthropic Bedrock envelope", () => {
    expect(buildBedrockAnthropicBody({
      model: "client-model",
      stream: true,
      max_tokens: 20,
      messages: [{ role: "user", content: "hello" }],
      thinking: { type: "enabled", budget_tokens: 10 },
      _toolNameMap: new Map(),
    })).toEqual({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 20,
      messages: [{ role: "user", content: "hello" }],
      thinking: { type: "enabled", budget_tokens: 10 },
    });
  });

  it("normalizes stored Bedrock configuration and requires the secret on writes", () => {
    expect(normalizeBedrockProviderSpecificData({
      secretAccessKey: " secret ",
      sessionToken: " session ",
      region: " us-west-2 ",
      endpoint: "https://bedrock.example.test/root/",
    }, { requireSecret: true })).toEqual({
      secretAccessKey: "secret",
      sessionToken: "session",
      region: "us-west-2",
      endpoint: "https://bedrock.example.test/root",
    });
    expect(() => normalizeBedrockProviderSpecificData({ region: "us-east-1" }, { requireSecret: true })).toThrow(
      "AWS Bedrock requires a secret access key",
    );
  });

  it("passes non-stream Claude JSON through the request-scoped proxy", async () => {
    proxyFetchMock.mockReset();
    const upstream = new Response(JSON.stringify({ type: "message", content: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    proxyFetchMock.mockResolvedValueOnce(upstream);
    const proxyOptions = { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.test:8080", strictProxy: true };
    const result = await new BedrockExecutor().execute({
      model: "anthropic.claude-3-haiku-20240307-v1:0",
      body: { model: "ignored", stream: false, max_tokens: 3, messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: {
        apiKey: "AKIDEXAMPLE",
        providerSpecificData: { secretAccessKey: "secret", sessionToken: "session", region: "us-east-1" },
      },
      proxyOptions,
    });
    expect(proxyFetchMock).toHaveBeenCalledTimes(1);
    expect(proxyFetchMock.mock.calls[0][2]).toBe(proxyOptions);
    expect(proxyFetchMock.mock.calls[0][1].headers["X-Amzn-Bedrock-Accept"]).toBe("application/json");
    expect(proxyFetchMock.mock.calls[0][0]).not.toContain("AKIDEXAMPLE");
    expect(proxyFetchMock.mock.calls[0][0]).not.toContain("secret");
    expect(JSON.parse(proxyFetchMock.mock.calls[0][1].body)).toMatchObject({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 3,
    });
    expect(result.response).toBe(upstream);
    expect(result.responseFormat).toBe("claude");
  });

  it("never reflects AWS error payloads or endpoint details", () => {
    const parsed = new BedrockExecutor().parseError(new Response(
      JSON.stringify({ message: "AKIDEXAMPLE secret at https://private.example" }),
      { status: 403 },
    ));
    expect(parsed).toEqual({ status: 403, message: "AWS Bedrock rejected the request (HTTP 403)" });
    expect(parsed.message).not.toContain("AKIDEXAMPLE");
    expect(parsed.message).not.toContain("private.example");
  });

  it("bounds the wait for response headers, sanitizes timeout, and clears its timer", async () => {
    proxyFetchMock.mockReset();
    proxyFetchMock.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      const rejectOnAbort = () => reject(options.signal.reason);
      if (options.signal.aborted) rejectOnAbort();
      else options.signal.addEventListener("abort", rejectOnAbort, { once: true });
    }));
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const executor = new BedrockExecutor();
    executor.config = { ...executor.config, timeoutMs: 5 };
    await expect(executor.execute({
      model: "anthropic.claude-3-haiku-20240307-v1:0",
      body: { max_tokens: 1, messages: [] },
      stream: false,
      credentials: { apiKey: "AKID", providerSpecificData: { secretAccessKey: "secret", region: "us-east-1" } },
    })).rejects.toThrow("AWS Bedrock connection timed out");
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  it("preserves caller cancellation as a sanitized AbortError", async () => {
    proxyFetchMock.mockReset();
    proxyFetchMock.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      const rejectOnAbort = () => reject(options.signal.reason);
      if (options.signal.aborted) rejectOnAbort();
      else options.signal.addEventListener("abort", rejectOnAbort, { once: true });
    }));
    const executor = new BedrockExecutor();
    executor.config = { ...executor.config, timeoutMs: 1000 };
    const caller = new AbortController();
    const pending = executor.execute({
      model: "anthropic.claude-3-haiku-20240307-v1:0",
      body: { max_tokens: 1, messages: [] },
      stream: false,
      credentials: { apiKey: "AKID", providerSpecificData: { secretAccessKey: "secret", region: "us-east-1" } },
      signal: caller.signal,
    });
    caller.abort("private caller reason");
    await expect(pending).rejects.toMatchObject({
      name: "AbortError",
      message: "AWS Bedrock request aborted",
    });
  });

  it("clears the connection timer after successful response headers", async () => {
    proxyFetchMock.mockReset();
    proxyFetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    await new BedrockExecutor().execute({
      model: "anthropic.claude-3-haiku-20240307-v1:0",
      body: { max_tokens: 1, messages: [] },
      stream: false,
      credentials: { apiKey: "AKID", providerSpecificData: { secretAccessKey: "secret", region: "us-east-1" } },
    });
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});

describe("AWS Bedrock EventStream decoding", () => {
  it("validates CRCs and converts arbitrarily fragmented frames to Anthropic SSE", async () => {
    const messageStart = anthropicFrame({ type: "message_start", message: { type: "message", content: [] } });
    const messageStop = anthropicFrame({ type: "message_stop" });
    expect(parseBedrockEventStreamFrame(messageStart).headers[":event-type"]).toBe("chunk");
    const joined = concat(messageStart, messageStop);
    const chunks = [joined.slice(0, 1), joined.slice(1, 11), joined.slice(11, 53), joined.slice(53)];
    const output = transformBedrockEventStream(responseFromChunks(chunks));
    expect(output.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(output.headers.has("content-length")).toBe(false);
    expect(await output.text()).toBe(
      `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { type: "message", content: [] } })}\n\n` +
      `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
    );
  });

  it("turns corrupt prelude/message CRCs and upstream exceptions into sanitized errors", async () => {
    const secret = "do-not-reflect-this-payload";
    const badMessageCrc = anthropicFrame({ type: "message_start", message: { type: "message", content: [secret] } });
    badMessageCrc[badMessageCrc.length - 1] ^= 0xff;

    const badPreludeCrc = anthropicFrame({ type: "message_start", message: { type: "message" } });
    badPreludeCrc[8] ^= 0xff;

    const exception = eventStreamFrame({
      headers: { ":message-type": "exception", ":event-type": "accessDeniedException" },
      payload: { message: secret },
    });

    for (const frame of [badMessageCrc, badPreludeCrc, exception]) {
      const text = await transformBedrockEventStream(responseFromChunks([frame])).text();
      expect(text).toContain("event: error");
      expect(text).toContain("invalid or incomplete event stream");
      expect(text).not.toContain(secret);
      expect(text).not.toContain("accessDeniedException");
    }

    const innerError = anthropicFrame({
      type: "error",
      error: { type: "api_error", message: secret },
    });
    const innerText = await transformBedrockEventStream(responseFromChunks([innerError])).text();
    expect(innerText).toContain("AWS Bedrock ended the stream with an error");
    expect(innerText).not.toContain(secret);
  });

  it("rejects oversized frame preludes before buffering a payload", async () => {
    const prelude = new Uint8Array(12);
    const view = new DataView(prelude.buffer);
    view.setUint32(0, BEDROCK_EVENTSTREAM_LIMITS.maxMessageBytes + 1, false);
    view.setUint32(4, 0, false);
    view.setUint32(8, crc32(prelude.subarray(0, 8)), false);
    const text = await transformBedrockEventStream(responseFromChunks([prelude])).text();
    expect(text).toContain("event: error");
  });

  it("cancels the upstream reader when the downstream response is cancelled", async () => {
    const cancelled = vi.fn();
    const upstream = new Response(new ReadableStream({
      pull() { return new Promise(() => {}); },
      cancel: cancelled,
    }), { status: 200 });
    const output = transformBedrockEventStream(upstream);
    await output.body.getReader().cancel("client disconnected");
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it("propagates request cancellation without exposing the abort reason", async () => {
    const cancelled = vi.fn();
    const abortController = new AbortController();
    const upstream = new Response(new ReadableStream({
      pull() { return new Promise(() => {}); },
      cancel: cancelled,
    }), { status: 200 });
    const reader = transformBedrockEventStream(upstream, { signal: abortController.signal }).body.getReader();
    const pending = reader.read();
    abortController.abort("private abort reason");
    await expect(pending).rejects.toMatchObject({ name: "AbortError", message: "AWS Bedrock request aborted" });
    expect(cancelled).toHaveBeenCalledTimes(1);
  });
});
