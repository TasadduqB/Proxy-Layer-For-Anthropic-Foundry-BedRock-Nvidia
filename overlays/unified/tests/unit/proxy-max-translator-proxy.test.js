import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
  getExecutor: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
}));

vi.mock("@/lib/localDb.js", () => ({
  getProviderConnections: mocks.getProviderConnections,
  updateProviderConnection: mocks.updateProviderConnection,
}));

vi.mock("open-sse/index.js", () => ({ getExecutor: mocks.getExecutor }));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
}));

const { POST } = await import("../../src/app/api/translator/send/route.js");

function request(body) {
  return new Request("http://localhost/api/translator/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("translator provider execution", () => {
  let executor;
  const connection = {
    id: "conn-1",
    provider: "openai",
    isActive: true,
    apiKey: "secret",
    providerSpecificData: {
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://proxy.internal:8080",
      strictProxy: true,
    },
  };
  const proxyOptions = {
    connectionProxyEnabled: true,
    connectionProxyUrl: "http://proxy.internal:8080",
    strictProxy: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    executor = {
      execute: vi.fn(),
      refreshCredentials: vi.fn(),
    };
    mocks.getExecutor.mockReturnValue(executor);
    mocks.getProviderConnections.mockResolvedValue([connection]);
    mocks.resolveConnectionProxyConfig.mockResolvedValue(proxyOptions);
  });

  it("passes resolved proxy policy and preserves non-stream JSON", async () => {
    executor.execute.mockResolvedValue({
      response: new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      }),
    });

    const response = await POST(request({
      provider: "openai",
      model: "gpt-5",
      body: { stream: false, messages: [{ role: "user", content: "hi" }] },
    }));

    expect(executor.execute).toHaveBeenCalledWith(expect.objectContaining({
      stream: false,
      proxyOptions,
    }));
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("keeps refresh and retry on the same strict connection proxy", async () => {
    executor.execute
      .mockResolvedValueOnce({ response: new Response("denied", { status: 401 }) })
      .mockResolvedValueOnce({
        response: new Response("data: done\n\n", {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      });
    executor.refreshCredentials.mockResolvedValue({ accessToken: "refreshed" });

    const response = await POST(request({
      provider: "openai",
      model: "gpt-5",
      body: { stream: true, messages: [{ role: "user", content: "hi" }] },
    }));

    expect(executor.refreshCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: "conn-1" }),
      console,
      proxyOptions,
    );
    expect(executor.execute).toHaveBeenCalledTimes(2);
    expect(executor.execute.mock.calls[1][0].proxyOptions).toBe(proxyOptions);
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith(
      "conn-1",
      expect.objectContaining({ accessToken: "refreshed" }),
    );
    expect(response.headers.get("content-type")).toContain("text/event-stream");
  });
});
