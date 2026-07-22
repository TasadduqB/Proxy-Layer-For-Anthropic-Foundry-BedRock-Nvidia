import { describe, expect, it, vi } from "vitest";
import {
  AzureExecutor,
  buildAzureEndpoint,
  normalizeAzureProviderSpecificData,
} from "../../open-sse/executors/azure.js";
import { resolveTransport } from "../../open-sse/services/provider.js";
import { openaiToOpenAIResponsesRequest } from "../../open-sse/translator/request/openai-responses.js";
import {
  buildAzureProbe,
  executeAzureProbe,
} from "../../src/lib/providers/azureProbe.js";

function credentials(providerSpecificData, extra = {}) {
  return {
    apiKey: "api-secret",
    accessToken: "entra-secret",
    providerSpecificData,
    ...extra,
  };
}

describe("Azure unified endpoint construction", () => {
  it("supports deployment Chat with encoded deployment names", () => {
    const url = buildAzureEndpoint("ignored", credentials({
      apiType: "chat",
      endpointMode: "deployment",
      authMode: "api-key",
      azureEndpoint: "https://resource.openai.azure.com/tenant/",
      deployment: "prod blue/v2",
      apiVersion: "2026-06-01-preview",
    }));
    expect(url).toBe(
      "https://resource.openai.azure.com/tenant/openai/deployments/prod%20blue%2Fv2/chat/completions?api-version=2026-06-01-preview",
    );
  });

  it("supports Azure Responses without putting deployment in the URL", () => {
    const url = buildAzureEndpoint("gpt-5", credentials({
      apiType: "responses",
      endpointMode: "deployment",
      authMode: "api-key",
      azureEndpoint: "https://resource.openai.azure.com",
      deployment: "response-deployment",
      apiVersion: "2025-04-01-preview",
    }));
    expect(url).toBe(
      "https://resource.openai.azure.com/openai/responses?api-version=2025-04-01-preview",
    );
  });

  it.each([
    ["chat", "https://foundry.services.ai.azure.com/models", "https://foundry.services.ai.azure.com/models/chat/completions?api-version=2024-05-01-preview"],
    ["responses", "https://foundry.services.ai.azure.com/openai/v1", "https://foundry.services.ai.azure.com/openai/v1/responses?api-version=2024-05-01-preview"],
  ])("supports direct %s endpoints", (apiType, azureEndpoint, expected) => {
    expect(buildAzureEndpoint("model", credentials({
      apiType,
      endpointMode: "direct",
      authMode: "bearer",
      azureEndpoint,
      apiVersion: "2024-05-01-preview",
    }))).toBe(expected);
  });

  it("preserves a safe full endpoint path and its explicit API version", () => {
    const full = "https://gateway.example.test/custom/openai/v1/responses?api-version=v1";
    expect(buildAzureEndpoint("model", credentials({
      apiType: "responses",
      endpointMode: "full",
      authMode: "both",
      azureEndpoint: full,
      apiVersion: "ignored-because-full-url-is-explicit",
    }))).toBe(full);
  });

  it.each([
    "not-a-url",
    "file:///tmp/azure",
    "https://user:pass@example.test/openai/v1/responses",
    "https://example.test/openai/v1/responses#credential",
    "https://example.test/openai/v1/responses?redirect=http://127.0.0.1",
    "https://example.test/openai/v1/responses?api-version=v1&api-version=preview",
  ])("rejects unsafe endpoint input without reflecting it: %s", (azureEndpoint) => {
    let message = "";
    try {
      normalizeAzureProviderSpecificData({
        apiType: "responses",
        endpointMode: "full",
        authMode: "api-key",
        azureEndpoint,
      });
    } catch (error) {
      message = error.message;
    }
    expect(message).toMatch(/^Azure /);
    expect(message).not.toContain(azureEndpoint);
    expect(message).not.toContain("user:pass");
  });

  it("requires full endpoints to match the selected API type", () => {
    expect(() => buildAzureEndpoint("model", credentials({
      apiType: "responses",
      endpointMode: "full",
      authMode: "api-key",
      azureEndpoint: "https://example.test/v1/chat/completions",
    }))).toThrow(/must end in \/responses/);
  });
});

describe("Azure auth, translation, and transport", () => {
  const baseData = {
    apiType: "chat",
    endpointMode: "direct",
    azureEndpoint: "https://foundry.example.test/models",
  };

  it("supports API-key, Bearer/Entra, and explicit dual-header auth", () => {
    const executor = new AzureExecutor();
    const apiHeaders = executor.buildHeaders(credentials({ ...baseData, authMode: "api-key" }), false);
    expect(apiHeaders["api-key"]).toBe("api-secret");
    expect(apiHeaders).not.toHaveProperty("Authorization");

    const bearerHeaders = executor.buildHeaders(credentials({ ...baseData, authMode: "bearer" }), true);
    expect(bearerHeaders.Authorization).toBe("Bearer entra-secret");
    expect(bearerHeaders).not.toHaveProperty("api-key");

    const bothHeaders = executor.buildHeaders(credentials({ ...baseData, authMode: "both", organization: "org-one" }), true);
    expect(bothHeaders).toMatchObject({
      "api-key": "api-secret",
      Authorization: "Bearer entra-secret",
      "OpenAI-Organization": "org-one",
      Accept: "text/event-stream",
    });
  });

  it("uses the API-key field as a Bearer token for dashboard-created Entra connections", () => {
    const executor = new AzureExecutor();
    const headers = executor.buildHeaders({
      apiKey: "entra-in-api-key-slot",
      providerSpecificData: { ...baseData, authMode: "bearer" },
    }, true);
    expect(headers.Authorization).toBe("Bearer entra-in-api-key-slot");
    expect(headers).not.toHaveProperty("api-key");
  });

  it("redacts upstream bodies and network endpoint details from client-facing errors", () => {
    const executor = new AzureExecutor();
    const endpoint = "https://private.azure.example/tenant/openai/responses";
    const secret = "super-secret-token";
    const parsed = executor.parseError(new Response(JSON.stringify({
      error: { message: `failed at ${endpoint} with ${secret}` },
    }), { status: 400 }));
    expect(parsed.message).toBe("Azure rejected the request");
    expect(parsed.message).not.toContain(endpoint);
    expect(parsed.message).not.toContain(secret);

    const safe = executor.sanitizeClientError(new Error(`fetch ${endpoint}?key=${secret} failed`));
    expect(safe.message).toBe("Azure upstream request failed");
  });

  it("selects Responses transport and force-stream only for opted-in Azure connections", () => {
    expect(resolveTransport("azure", "openai", credentials({ ...baseData, apiType: "responses" }))).toEqual({
      format: "openai-responses",
      forceStream: true,
      forceTargetFormat: true,
    });
    expect(resolveTransport("azure", "openai", credentials({ ...baseData, apiType: "chat" }))).toBeNull();
  });

  it("normalizes Chat token limits to Responses and forces the upstream stream", () => {
    const executor = new AzureExecutor();
    const transformed = executor.transformRequest("client-model", {
      model: "client-model",
      input: "hello",
      stream: false,
      max_completion_tokens: 9,
    }, false, credentials({
      ...baseData,
      apiType: "responses",
      deployment: "azure-deployment",
    }));
    expect(transformed).toMatchObject({
      model: "azure-deployment",
      input: "hello",
      stream: true,
      max_output_tokens: 9,
    });
    expect(transformed).not.toHaveProperty("max_completion_tokens");
    expect(transformed).not.toHaveProperty("max_tokens");
  });

  it("translates Chat request limits to the Responses field name", () => {
    const translated = openaiToOpenAIResponsesRequest("gpt-5", {
      messages: [{ role: "user", content: "hello" }],
      max_tokens: 7,
    }, false);
    expect(translated.max_output_tokens).toBe(7);
    expect(translated).not.toHaveProperty("max_tokens");
    expect(translated.stream).toBe(true);
  });
});

describe("canonical Azure probe", () => {
  it("uses Responses URL, auth, payload, and force-stream behavior together", () => {
    const probe = buildAzureProbe({
      apiKey: "azure-secret",
      providerSpecificData: {
        apiType: "responses",
        endpointMode: "deployment",
        authMode: "both",
        azureEndpoint: "https://resource.openai.azure.com",
        deployment: "gpt-5-deploy",
        apiVersion: "2025-04-01-preview",
      },
      model: "gpt-5",
    });
    expect(probe.url).toBe("https://resource.openai.azure.com/openai/responses?api-version=2025-04-01-preview");
    expect(probe.targetFormat).toBe("openai-responses");
    expect(probe.forceStream).toBe(true);
    expect(probe.options.headers).toMatchObject({
      "api-key": "azure-secret",
      Authorization: "Bearer azure-secret",
      Accept: "text/event-stream",
    });
    expect(JSON.parse(probe.options.body)).toMatchObject({
      model: "gpt-5-deploy",
      stream: true,
      max_output_tokens: 1,
      input: [{ role: "user" }],
    });
  });

  it("propagates the exact request and connection proxy policy", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 400 }));
    const proxyOptions = {
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://proxy.example:8080",
      strictProxy: true,
    };
    const result = await executeAzureProbe({
      apiKey: "secret",
      providerSpecificData: {
        apiType: "chat",
        endpointMode: "direct",
        authMode: "api-key",
        azureEndpoint: "https://foundry.example.test/models",
        apiVersion: "2024-05-01-preview",
      },
      model: "model-one",
    }, {
      fetchFn,
      proxyOptions,
      signal: AbortSignal.timeout(1_000),
    });

    expect(result.response.status).toBe(400);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][0]).toBe(result.probe.url);
    expect(fetchFn.mock.calls[0][1].body).toBe(result.probe.options.body);
    expect(fetchFn.mock.calls[0][2]).toBe(proxyOptions);
  });
});
