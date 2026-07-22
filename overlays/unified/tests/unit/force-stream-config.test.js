// Guards forceStream moved from chatCore hardcode → PROVIDERS schema (#5).
import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeMock, forcedJsonMock, refreshCredentialsMock, refreshWithRetryMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  forcedJsonMock: vi.fn(),
  refreshCredentialsMock: vi.fn(),
  refreshWithRetryMock: vi.fn(),
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: vi.fn(() => ({
    execute: executeMock,
    refreshCredentials: refreshCredentialsMock,
  })),
}));

vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: vi.fn(async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logError: vi.fn(),
  })),
}));

vi.mock("../../open-sse/utils/clientDetector.js", () => ({
  detectClientTool: vi.fn(() => null),
  isNativePassthrough: vi.fn(() => false),
}));

vi.mock("../../open-sse/utils/bypassHandler.js", () => ({
  handleBypassRequest: vi.fn(() => null),
}));

vi.mock("../../open-sse/utils/streamHandler.js", () => ({
  createStreamController: vi.fn(() => ({
    signal: undefined,
    handleComplete: vi.fn(),
    handleError: vi.fn(),
  })),
}));

vi.mock("../../open-sse/services/tokenRefresh.js", () => ({
  refreshWithRetry: refreshWithRetryMock,
}));

vi.mock("../../open-sse/handlers/chatCore/sseToJsonHandler.js", () => ({
  handleForcedSSEToJson: forcedJsonMock,
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  default: vi.fn(),
  proxyAwareFetch: vi.fn(),
  runWithCredentialsProxy: (_credentials, callback) => callback(),
}));

vi.mock("../../open-sse/translator/formats/claude.js", () => ({
  normalizeClaudePassthrough: vi.fn(),
}));

vi.mock("../../open-sse/utils/toolDeduper.js", () => ({
  dedupeTools: vi.fn((tools) => ({ tools, stripped: [] })),
}));

vi.mock("../../open-sse/rtk/caveman.js", () => ({
  injectCaveman: vi.fn(),
}));

vi.mock("../../open-sse/rtk/ponytail.js", () => ({
  injectPonytail: vi.fn(),
}));

vi.mock("../../open-sse/rtk/index.js", () => ({
  compressMessages: vi.fn(() => null),
  formatRtkLog: vi.fn(() => ""),
}));

vi.mock("../../open-sse/rtk/headroom.js", () => ({
  compressWithHeadroom: vi.fn(async () => null),
  formatHeadroomLog: vi.fn(() => ""),
  formatHeadroomSizeLog: vi.fn(() => ""),
  isHeadroomPhantomSavings: vi.fn(() => false),
}));

vi.mock("../../open-sse/providers/capabilities.js", () => ({
  getCapabilitiesForModel: vi.fn(() => ({})),
}));

vi.mock("../../open-sse/translator/concerns/modality.js", () => ({
  stripUnsupportedModalities: vi.fn(() => false),
}));

vi.mock("../../open-sse/translator/concerns/prefetch.js", () => ({
  prefetchRemoteImages: vi.fn(async () => 0),
  prefetchRemoteDocuments: vi.fn(async () => 0),
}));

vi.mock("../../open-sse/handlers/chatCore/requestDetail.js", () => ({
  buildRequestDetail: vi.fn((detail) => detail),
  extractRequestConfig: vi.fn((body, stream) => ({ body, stream })),
}));

vi.mock("../../open-sse/utils/error.js", () => ({
  createErrorResult: vi.fn((status, message) => ({ success: false, status, error: message })),
  formatProviderError: vi.fn((error) => error.message),
  parseUpstreamError: vi.fn(async () => ({ statusCode: 401, message: "unauthorized" })),
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
}));

const FORCED = ["openai", "codex", "commandcode"];

function makeOptions(bodyStream) {
  const body = {
    model: "gpt-4.1",
    messages: [{ role: "user", content: "hello" }],
  };
  if (bodyStream !== undefined) body.stream = bodyStream;

  return {
    body,
    modelInfo: { provider: "openai", model: "gpt-4.1" },
    credentials: { apiKey: "sk-test" },
    clientRawRequest: {
      endpoint: "/v1/chat/completions",
      body,
      headers: { accept: "application/json" },
    },
    connectionId: "test-connection",
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

describe("forceStream provider config", () => {
  beforeEach(() => {
    executeMock.mockReset();
    executeMock.mockRejectedValue(new Error("boom"));
    forcedJsonMock.mockReset();
    forcedJsonMock.mockResolvedValue({ success: true, response: new Response("{}") });
    refreshCredentialsMock.mockReset();
    refreshCredentialsMock.mockResolvedValue(null);
    refreshWithRetryMock.mockReset();
    refreshWithRetryMock.mockImplementation(async (refresh) => refresh());
  });

  it("only openai/codex/commandcode force streaming", async () => {
    const { PROVIDERS } = await import("../../open-sse/config/providers.js");
    for (const id of FORCED) {
      expect(PROVIDERS[id]?.forceStream, `${id} forced`).toBe(true);
    }
    // a sample of others must NOT force
    for (const id of ["deepseek", "claude", "gemini", "openrouter"]) {
      expect(PROVIDERS[id]?.forceStream, `${id} not forced`).not.toBe(true);
    }
  });

  it.each([undefined, false])( "keeps forced-stream providers streaming for JSON clients when body.stream is %s", async (bodyStream) => {
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

    await handleChatCore(makeOptions(bodyStream));

    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(executeMock.mock.calls[0][0].stream).toBe(true);
  }, 15000);

  it("uses Azure Responses transport, forces SSE upstream, and collects JSON for a non-stream client", async () => {
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
    executeMock.mockReset();
    executeMock.mockResolvedValue({
      response: new Response("data: [DONE]\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
      url: "https://azure.example.test/openai/responses?api-version=v1",
      headers: {},
      transformedBody: null,
      responseFormat: "openai-responses",
    });

    const options = makeOptions(false);
    options.modelInfo.provider = "azure";
    options.credentials.providerSpecificData = {
      apiType: "responses",
      endpointMode: "deployment",
      authMode: "api-key",
      azureEndpoint: "https://azure.example.test",
      deployment: "gpt-4.1",
      apiVersion: "v1",
    };

    const result = await handleChatCore(options);

    expect(result.success).toBe(true);
    expect(options.credentials.runtimeTransport).toMatchObject({
      format: "openai-responses",
      forceStream: true,
    });
    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(executeMock.mock.calls[0][0].stream).toBe(true);
    expect(executeMock.mock.calls[0][0].body).toMatchObject({
      model: "gpt-4.1",
      stream: true,
      input: [{ role: "user" }],
    });
    expect(forcedJsonMock).toHaveBeenCalledTimes(1);
    expect(forcedJsonMock.mock.calls[0][0].sourceFormat).toBe("openai");
  }, 15_000);

  it("carries strict connection proxy policy into execution and 401 refresh", async () => {
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
    executeMock.mockReset();
    executeMock.mockResolvedValue({
      response: new Response(JSON.stringify({ error: { message: "expired" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
      url: "https://api.openai.com/v1/chat/completions",
      headers: {},
      transformedBody: null,
    });

    const options = makeOptions(false);
    options.credentials.providerSpecificData = {
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://proxy.example:8080",
      connectionNoProxy: "localhost",
      vercelRelayUrl: "",
      strictProxy: true,
    };

    await handleChatCore(options);

    const expectedProxy = {
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://proxy.example:8080",
      connectionNoProxy: "localhost",
      vercelRelayUrl: "",
      strictProxy: true,
    };
    expect(executeMock.mock.calls[0][0].proxyOptions).toEqual(expectedProxy);
    expect(refreshCredentialsMock).toHaveBeenCalledWith(
      options.credentials,
      options.log,
      expectedProxy
    );
  });
});
