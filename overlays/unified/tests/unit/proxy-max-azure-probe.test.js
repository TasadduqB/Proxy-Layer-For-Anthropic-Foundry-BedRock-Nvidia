import { afterEach, describe, expect, it } from "vitest";
import { buildAzureChatProbe } from "../../src/lib/providers/azureProbe.js";

const ORIGINAL_ENV = {
  AZURE_ENDPOINT: process.env.AZURE_ENDPOINT,
  AZURE_OPENAI_API_KEY: process.env.AZURE_OPENAI_API_KEY,
  AZURE_ACCESS_TOKEN: process.env.AZURE_ACCESS_TOKEN,
};

afterEach(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("Azure validation probe", () => {
  it("uses encoded executor URL construction and JSON negotiation", () => {
    const probe = buildAzureChatProbe({
      apiKey: "azure-secret",
      providerSpecificData: {
        azureEndpoint: "https://resource.openai.azure.com/custom-root/",
        deployment: "gpt 5/deploy",
        apiVersion: "2026-06-01-preview",
      },
    });

    expect(probe.url).toBe(
      "https://resource.openai.azure.com/custom-root/openai/deployments/gpt%205%2Fdeploy/chat/completions?api-version=2026-06-01-preview",
    );
    expect(probe.options.headers).toMatchObject({
      "api-key": "azure-secret",
      Accept: "application/json",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(probe.options.body)).toMatchObject({
      max_completion_tokens: 1,
      messages: [{ role: "user", content: "test" }],
    });
  });

  it("supports Entra bearer auth and omits an empty organization", () => {
    const probe = buildAzureChatProbe({
      accessToken: "entra-token",
      providerSpecificData: {
        azureEndpoint: "https://resource.openai.azure.com",
        deployment: "prod",
        organization: "   ",
      },
    });

    expect(probe.options.headers.Authorization).toBe("Bearer entra-token");
    expect(probe.options.headers).not.toHaveProperty("api-key");
    expect(probe.options.headers).not.toHaveProperty("OpenAI-Organization");
  });

  it.each([
    "not-a-url",
    "file:///tmp/token",
    "https://user:pass@resource.openai.azure.com",
    "https://resource.openai.azure.com?redirect=http://127.0.0.1",
  ])("rejects malformed or unsafe endpoint syntax: %s", (azureEndpoint) => {
    expect(() =>
      buildAzureChatProbe({
        apiKey: "secret",
        providerSpecificData: { azureEndpoint, deployment: "prod" },
      }),
    ).toThrow(/Azure endpoint/);
  });
});
